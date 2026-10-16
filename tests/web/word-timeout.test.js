// A word recording the camera cannot fill ends on its own, and says why.
//
// A frame counts toward a recording only when hand, face and shoulders are
// all in view. Before this, a recording that never got such a frame waited at
// 0/45 for as long as the page stayed open: no timeout, no message, and the
// record button stayed busy, so the only way out was to stop the camera.
//
// The recording's clock is the render loop: every animation frame calls
// realInference() with its timestamp, whether or not MediaPipe saw anyone, so
// these tests drive time the same way, one call per frame. The countdown runs
// on a fake setTimeout. Only the boundaries are faked: the ONNX session,
// MediaPipe's results and the two clocks (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, mediaPipeFrame, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

const read = (app, expression) => app.evaluate(expression);
const wordState = (app) => read(app, "state.wordState");
const buffers = (app) => ({
  frames: read(app, "frameBuffer.length"),
  normalized: read(app, "normalizedFrameBuffer.length"),
  previous: read(app, "previousFrame"),
});
const EMPTY_BUFFERS = { frames: 0, normalized: 0, previous: null };

/** A booted word app on the word tab, with the camera on. */
async function bootedWordApp() {
  const ctx = wordModeApp({ boot: true, fakeTimers: true });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

/** Start a recording and run its countdown out, leaving it in RECORDING. */
async function startRecording(ctx) {
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(ctx.app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  assert.equal(wordState(ctx.app), "RECORDING", "precondition: the countdown ended in a recording");
}

/** A booted word app already recording. */
async function recordingApp() {
  const ctx = await bootedWordApp();
  await startRecording(ctx);
  return ctx;
}

let nextTimestamp = 10_000;

/**
 * Render-loop frames for `ms` milliseconds, one every `everyMs`, each showing
 * what `frame` returns: by default nobody at all.
 */
async function framesFor(app, ms, { everyMs = 100, frame = () => emptyFrame() } = {}) {
  const realInference = app.get("realInference");
  for (let elapsed = 0; elapsed < ms; elapsed += everyMs) {
    app.evaluate(`__clock += ${everyMs};`);
    app.evaluate(`latestMediaPipeResult = ${JSON.stringify(frame())};`);
    await realInference(app.evaluate("__clock"));
  }
}

/** A MediaPipe result in which nothing was detected. */
function emptyFrame() {
  return {
    rightHandLandmarks: null,
    leftHandLandmarks: null,
    handednessDebug: [],
    poseLandmarks: null,
    faceLandmarks: null,
    timestamp: nextTimestamp++,
  };
}

/** A hand and a face, but no shoulders: not enough for a word frame. */
function handWithoutShoulders() {
  return { ...mediaPipeFrame(0), poseLandmarks: null, timestamp: nextTimestamp++ };
}

/** A frame the recording accepts, with a timestamp of its own. */
function usableFrame() {
  return { ...mediaPipeFrame(nextTimestamp % 40), timestamp: nextTimestamp++ };
}

function assertEndedForLackOfFrames(app, label) {
  assert.equal(wordState(app), "IDLE", `${label}: the recording ends`);
  assert.equal(read(app, "state.wordEnd"), "timeout", `${label}: it ended because nothing usable arrived`);
  assert.equal(read(app, "state.wordFrames"), 0, `${label}: its frames are discarded`);
  assert.deepEqual(buffers(app), EMPTY_BUFFERS, `${label}: nothing is left in the buffers`);
  assert.notEqual(read(app, "els.cameraStage.dataset.state"), "recording", `${label}: the stage no longer says recording`);
  const message = read(app, "els.confidenceMessage.textContent");
  assert.match(message, /görünmedi/, `${label}: the user is told nothing usable was seen`);
  assert.equal(read(app, "els.announcer.textContent").trim(), message, `${label}: and it is announced`);
}

test("a recording that sees nobody ends within ten seconds and says why", async () => {
  const { app } = await recordingApp();
  await framesFor(app, 10_000);

  assertEndedForLackOfFrames(app, "no one in view");
  assert.equal(read(app, "els.recordWord.disabled"), false, "a new recording can be started");
  assert.equal(read(app, "els.retryWord.disabled"), false, "and retried");
});

test("frames with a hand but no shoulders do not keep a recording alive", async () => {
  const { app } = await recordingApp();
  await framesFor(app, 10_000, { frame: handWithoutShoulders });

  assertEndedForLackOfFrames(app, "a hand alone");
});

test("the first usable frame may take the configured time, and no longer", async () => {
  const { app } = await recordingApp();
  const firstFrameMs = read(app, "CONFIG.WORD_FIRST_FRAME_TIMEOUT_MS");
  assert.equal(typeof firstFrameMs, "number", "the first-frame timeout is configured");

  // The render loop's first tick of the recording starts its clock.
  await framesFor(app, 100);
  await framesFor(app, firstFrameMs - 100);
  assert.equal(wordState(app), "RECORDING", "just inside the limit the recording waits");
  await framesFor(app, 100);
  assertEndedForLackOfFrames(app, "past the limit");
});

test("a recording whose usable frames stop ends after the stall timeout, and its frames go", async () => {
  const ctx = await recordingApp();
  const { app } = ctx;
  const stallMs = read(app, "CONFIG.WORD_NO_HAND_TIMEOUT_MS");
  assert.equal(typeof stallMs, "number", "the stall timeout is configured");
  await framesFor(app, 1000, { frame: usableFrame });
  assert.equal(read(app, "state.wordFrames"), 10, "precondition: progress began");

  await framesFor(app, stallMs - 100);
  assert.equal(wordState(app), "RECORDING", "just inside the limit the recording waits");
  await framesFor(app, 200);
  assertEndedForLackOfFrames(app, "after a stall");

  // The ten stalled frames must not count toward the next recording: it needs
  // a full 45 of its own.
  await startRecording(ctx);
  await feedFrames(app, 0, RECORDING_FRAMES - 10);
  assert.equal(wordState(app), "RECORDING", "35 new frames do not finish a recording");
  await feedFrames(app, RECORDING_FRAMES - 10, 10);
  assert.equal(wordState(app), "RESULT", "45 new frames do");
});

test("slow but steady usable frames keep a recording going to its result", async () => {
  const { app } = await recordingApp();
  // One usable frame a second for ten seconds: longer than either timeout
  // measured from the start, shorter than the stall timeout between frames.
  await framesFor(app, 10_000, { everyMs: 1000, frame: usableFrame });
  assert.equal(wordState(app), "RECORDING");
  assert.equal(read(app, "state.wordFrames"), 10);

  await framesFor(app, (RECORDING_FRAMES - 10) * 50, { everyMs: 50, frame: usableFrame });
  assert.equal(wordState(app), "RESULT", "the recording finishes normally");
  assert.equal(read(app, "els.appendWordResult.disabled"), false, "and its word is offered");
});

test("a recording that never fills is ended by the overall limit", async () => {
  const { app } = await recordingApp();
  const maxMs = read(app, "CONFIG.WORD_MAX_RECORDING_MS");
  assert.equal(typeof maxMs, "number", "the overall limit is configured");
  // A usable frame every three seconds keeps the stall timeout from firing,
  // and 45 of them would take over two minutes.
  await framesFor(app, 60_000, { everyMs: 3000, frame: usableFrame });

  assertEndedForLackOfFrames(app, "a recording that trickles");
});

test("an abandoned recording's clock does not end the next one", async () => {
  const ctx = await recordingApp();
  const { app } = ctx;
  const firstFrameMs = read(app, "CONFIG.WORD_FIRST_FRAME_TIMEOUT_MS");
  await framesFor(app, 1000);
  // Leave and come back: the recording is abandoned, not ended by a timeout.
  openTab(app, "letter");
  openTab(app, "word");
  assert.equal(wordState(app), "IDLE");

  await startRecording(ctx);
  // Past the first recording's limit, well inside the second's.
  await framesFor(app, firstFrameMs - 500);
  assert.equal(wordState(app), "RECORDING", "the new recording has its own clock");
  await framesFor(app, 1000);
  assertEndedForLackOfFrames(app, "the new recording, on its own clock");
});

test("a finished result is never ended by the recording clock", async () => {
  const { app } = await recordingApp();
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(wordState(app), "RESULT");

  await framesFor(app, 60_000, { everyMs: 500 });
  assert.equal(wordState(app), "RESULT", "the result stays on screen");
  assert.equal(read(app, "state.prediction"), "book");
  assert.equal(read(app, "els.appendWordResult.disabled"), false);
});
