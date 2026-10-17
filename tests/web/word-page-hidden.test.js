// A page sent to the background during a word countdown or recording
// abandons that recording, and says so.
//
// A hidden tab gets no animation frames, so the recording would freeze
// half-filled and resume minutes later with a gap the model never saw in
// training, or the countdown would end while nobody was looking. Only the
// recording ends: the camera is left on, and these tests do not decide
// whether a hidden page should release it too.
//
// Only the boundaries are faked: the ONNX session, MediaPipe's results, the
// countdown clock and the document's visibility (helpers/web-app-context.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;
const HIDDEN_COPY = "Sayfa arka plana geçtiği için kayıt iptal edildi.";

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

function setPageVisibility(app, visibility) {
  app.evaluate(`document.visibilityState = "${visibility}"; document.dispatchEvent({ type: "visibilitychange" });`);
}

async function bootedWordApp() {
  const ctx = wordModeApp({ boot: true, fakeTimers: true });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

async function startRecording(ctx) {
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(ctx.app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  assert.equal(wordState(ctx.app), "RECORDING", "precondition: recording");
}

function assertAbandonedByHiding(app, label) {
  assert.equal(wordState(app), "IDLE", `${label}: the recording is abandoned`);
  assert.equal(read(app, "state.wordEnd"), "hidden", `${label}: because the page was hidden`);
  assert.equal(read(app, "state.wordFrames"), 0, `${label}: nothing recorded is kept`);
  assert.deepEqual(buffers(app), EMPTY_BUFFERS, `${label}: the buffers are empty`);
  assert.equal(read(app, "els.countdown.hidden"), true, `${label}: no count on screen`);
  assert.equal(read(app, "els.confidenceMessage.textContent"), HIDDEN_COPY, `${label}: the user is told why`);
  assert.equal(read(app, "els.announcer.textContent").trim(), HIDDEN_COPY, `${label}: and it is announced`);
  assert.equal(read(app, "state.cameraOn"), true, `${label}: the camera itself is left on`);
}

test("hiding the page during a recording abandons it, and the next one starts from nothing", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await startRecording(ctx);
  await feedFrames(app, 0, 10);
  assert.equal(read(app, "state.wordFrames"), 10, "precondition: frames were recorded");

  setPageVisibility(app, "hidden");
  assertAbandonedByHiding(app, "recording");
  await feedFrames(app, 10, 5);
  assert.equal(read(app, "state.wordFrames"), 0, "frames after the hide are not recorded");

  setPageVisibility(app, "visible");
  assert.equal(wordState(app), "IDLE", "coming back does not restart anything on its own");
  await startRecording(ctx);
  await feedFrames(app, 0, RECORDING_FRAMES - 10);
  assert.equal(wordState(app), "RECORDING", "the ten abandoned frames do not count");
  await feedFrames(app, RECORDING_FRAMES - 10, 10);
  assert.equal(wordState(app), "RESULT");
});

test("hiding the page during the countdown abandons it before any recording", async () => {
  const ctx = await bootedWordApp();
  const { app, runs, timers } = ctx;
  const starting = app.get("startWordRecording")();
  await timers.advance(STEP_MS + 100);
  assert.equal(wordState(app), "COUNTDOWN", "precondition: counting down");

  setPageVisibility(app, "hidden");
  assertAbandonedByHiding(app, "countdown");
  await timers.advance(STEP_MS * 3);
  await starting;
  assert.equal(wordState(app), "IDLE", "the countdown does not finish into a recording");
  const wordRuns = runs.filter((feeds) => feeds.mask).length;
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(runs.filter((feeds) => feeds.mask).length, wordRuns, "the word model is never run");
});

test("a countdown started right after a hidden one runs its full length", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  app.get("startWordRecording")();
  await timers.advance(STEP_MS - 100);
  setPageVisibility(app, "hidden");
  setPageVisibility(app, "visible");

  const second = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN");
  // The abandoned countdown's steps fall due in this window; none of them
  // may take over the new countdown and end it early.
  await timers.advance(STEP_MS * 3 - 100);
  assert.equal(wordState(app), "COUNTDOWN", "just before its third step ends, the new countdown is still counting");
  assert.equal(read(app, "els.countdown.textContent"), "1");
  await timers.advance(100);
  await second;
  assert.equal(wordState(app), "RECORDING", "it ends after its own three steps");
});

test("hiding the page outside a recording leaves the result alone", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await startRecording(ctx);
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(wordState(app), "RESULT");
  const message = read(app, "els.confidenceMessage.textContent");

  setPageVisibility(app, "hidden");
  setPageVisibility(app, "visible");
  assert.equal(wordState(app), "RESULT", "a finished result stays on screen");
  assert.equal(read(app, "state.prediction"), "book");
  assert.equal(read(app, "els.appendWordResult.disabled"), false, "and can still be accepted");
  assert.equal(read(app, "els.confidenceMessage.textContent"), message);
});

test("a page that becomes visible again does not touch a recording", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await startRecording(ctx);
  await feedFrames(app, 0, 10);

  setPageVisibility(app, "visible");
  assert.equal(wordState(app), "RECORDING");
  assert.equal(read(app, "state.wordFrames"), 10);
});
