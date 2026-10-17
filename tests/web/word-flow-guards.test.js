// The word flow around consent: when a recording may start, what a stop or a
// mode change does to it, and when the accept button is offered.
//
// word-consent.test.js shows that a result waits for the user. These tests
// show the gates in front of that: a result too weak to offer is never
// appended, accept exists only for a finished word in word mode, a recording
// cannot be started twice or survive the camera, and every way out of a
// recording leaves empty motion buffers behind.
//
// The app boots through its own init() and is driven the way a user drives
// it: clicks on the real buttons (a disabled button does not click, as in a
// browser), a camera toggle, a tab. Only the boundaries are faked: the ONNX
// session, MediaPipe's results, and the clock that the 720 ms countdown steps
// run on, which the test advances by hand (helpers/word-recording.mjs).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { WEB_DIR } from "./helpers/web-app-context.mjs";
import { feedFrames, recordWord, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const LABEL_COUNT = Object.keys(JSON.parse(readFileSync(join(WEB_DIR, "data", "word_labels.json"), "utf8"))).length;
const STEP_MS = 720;

/** A word app that has booted, is on the word tab, with a camera that is on. */
async function bootedWordApp(options = {}) {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, ...options });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

/** Click a button by its registry name; a disabled button ignores the click. */
function click(app, name) {
  const button = app.evaluate(`els.${name}`);
  if (button.disabled) return false;
  button.dispatchEvent({ type: "click", detail: 1 });
  return true;
}

/** The state the camera start leaves, set again after a stop released it. */
function cameraBackOn(app) {
  app.evaluate(`
    state.cameraOn = true;
    mpRunning = true;
    poseLandmarker = { close() {} };
    faceLandmarker = { close() {} };
  `);
}

const read = (app, expression) => app.evaluate(expression);
const wordState = (app) => read(app, "state.wordState");
const acceptDisabled = (app) => read(app, "els.appendWordResult.disabled");
const retryDisabled = (app) => read(app, "els.retryWord.disabled");
const transcript = (app) => read(app, "state.transcript");
const buffers = (app) => ({
  frames: read(app, "frameBuffer.length"),
  normalized: read(app, "normalizedFrameBuffer.length"),
  previous: read(app, "previousFrame"),
});
const EMPTY_BUFFERS = { frames: 0, normalized: 0, previous: null };

/** Start a recording and run its countdown out, leaving it in RECORDING. */
async function startAndCountDown(ctx) {
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(ctx.app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  assert.equal(wordState(ctx.app), "RECORDING", "precondition: the countdown ended in a recording");
}

/** A word-model logit that comes out of calibration and softmax as `p`. */
function logitFor(app, p) {
  return app.get("temperature") * Math.log((p * (LABEL_COUNT - 1)) / (1 - p));
}

/** A word app whose model answers "book" with confidence `p` (to three places). */
async function appAnsweringAt(p) {
  let app = null;
  const ctx = await bootedWordApp({ winnerLogit: () => logitFor(app, p) });
  app = ctx.app;
  return ctx;
}

// Which results may be offered, and which may be appended

test("a result below the accept threshold cannot be appended, and its accept button stays disabled", async () => {
  const ctx = await appAnsweringAt(0.12);
  const { app } = ctx;
  assert.ok(app.evaluate("CONFIG.WORD_ACCEPT_THRESHOLD") > 0.12, "precondition: 0.12 is below the threshold");
  await recordWord(app, ctx);

  assert.equal(wordState(app), "RESULT");
  assert.ok(Math.abs(read(app, "state.confidence") - 0.12) < 0.002, "the fake model answers at 12 %");
  assert.equal(read(app, "state.prediction"), "book");
  assert.equal(acceptDisabled(app), true, "a weak result is not offered for acceptance");
  assert.equal(read(app, "els.wordResultGuide.hidden"), false);
  assert.equal(read(app, "els.wordResultGuide.dataset.level"), "low", "the result guide says the confidence is low");

  assert.equal(click(app, "appendWordResult"), false, "a disabled button does not click");
  // The handler guards itself as well: a keyboard path or a later binding
  // that reaches it must not append a word the model is not sure of.
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(transcript(app), "", "a weak word must not reach the transcript");
  assert.equal(acceptDisabled(app), true);
});

test("a result above the accept threshold is offered, and the user's click appends it once", async () => {
  const ctx = await appAnsweringAt(0.16);
  const { app } = ctx;
  await recordWord(app, ctx);

  assert.equal(wordState(app), "RESULT");
  assert.ok(Math.abs(read(app, "state.confidence") - 0.16) < 0.002);
  assert.equal(acceptDisabled(app), false, "a result above the threshold can be accepted");
  assert.notEqual(read(app, "els.wordResultGuide.dataset.level"), "low");
  assert.equal(transcript(app), "", "offering the word appends nothing");

  assert.equal(click(app, "appendWordResult"), true);
  assert.equal(transcript(app), "book ");
});

test("the accept button is offered only for a finished recording, and only in word mode", async () => {
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  assert.equal(acceptDisabled(app), true, "nothing recorded yet");

  await recordWord(app, ctx);
  assert.equal(acceptDisabled(app), false, "a finished confident word is offered");

  // A new recording takes the old word off the screen, and nothing may be
  // on offer while it runs.
  assert.equal(click(app, "recordWord"), true);
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN");
  assert.equal(acceptDisabled(app), true, "no accept during the countdown");
  await timers.advance(STEP_MS * app.evaluate("CONFIG.COUNTDOWN_SECONDS"));
  assert.equal(wordState(app), "RECORDING");
  await feedFrames(app, 0, 10);
  assert.equal(acceptDisabled(app), true, "no accept while frames are being recorded");

  hold();
  const last = feedFrames(app, 10, RECORDING_FRAMES - 10);
  await timers.advance(0);
  assert.equal(wordState(app), "PROCESSING");
  assert.equal(acceptDisabled(app), true, "no accept while the model is computing");
  release();
  await last;
  assert.equal(wordState(app), "RESULT");
  assert.equal(acceptDisabled(app), false, "accept returns with the new result");
});

test("a finished word recording in the coach is not offered for the transcript", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  openTab(app, "coach");
  assert.equal(click(app, "coachWordsOnly"), true);
  assert.equal(read(app, "state.coachTarget"), "water", "the coach asks for a word");

  await recordWord(app, ctx);
  assert.equal(wordState(app), "RESULT", "the coach records and finishes a word");
  assert.equal(read(app, "state.prediction"), "book");
  assert.equal(read(app, "els.wordResultGuide.hidden"), false, "the result guide is shown in the coach");
  assert.equal(acceptDisabled(app), true, "the transcript belongs to word mode; the coach does not offer accept");
});

// Starting

test("a second start during the countdown does not restart it", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  const first = app.get("startWordRecording")();
  await timers.advance(STEP_MS * 2 + 100);
  assert.equal(read(app, "els.countdown.textContent"), "1", "precondition: two steps into the countdown");

  const second = app.get("startWordRecording")();
  await timers.advance(0);
  await second;
  assert.equal(read(app, "els.countdown.textContent"), "1", "the countdown must keep counting down, not begin again at 3");
  assert.equal(wordState(app), "COUNTDOWN");

  await timers.advance(STEP_MS);
  await first;
  assert.equal(wordState(app), "RECORDING", "recording starts when the first countdown ends");
  assert.equal(timers.pending, 0, "no second countdown is still running");
});

test("a second start while recording keeps the frames already recorded", async () => {
  const ctx = await bootedWordApp();
  const { app, runs, timers } = ctx;
  await startAndCountDown(ctx);
  await feedFrames(app, 0, 10);
  assert.equal(read(app, "state.wordFrames"), 10);

  await app.get("startWordRecording")();
  await timers.advance(STEP_MS * app.evaluate("CONFIG.COUNTDOWN_SECONDS"));
  assert.equal(wordState(app), "RECORDING", "still the same recording");
  assert.equal(read(app, "state.wordFrames"), 10, "the recorded frames are kept");
  assert.equal(buffers(app).frames, 10);

  const before = runs.length;
  await feedFrames(app, 10, RECORDING_FRAMES - 10);
  assert.equal(wordState(app), "RESULT", "35 more frames finish the original recording");
  assert.equal(runs.length, before + 1, "one model run for one recording");
});

test("recording cannot start without hand, pose and face tracking ready", async () => {
  const cases = {
    "no pose tracking": "poseLandmarker = null;",
    "no face tracking": "faceLandmarker = null;",
    "tracking not running": "mpRunning = false;",
  };
  for (const [name, fault] of Object.entries(cases)) {
    const { app, timers } = await bootedWordApp();
    assert.equal(read(app, "els.recordWord.disabled"), false, `${name}: precondition, the button works when all is ready`);
    app.evaluate(fault);
    app.get("syncRecordButton")();

    assert.equal(read(app, "els.recordWord.disabled"), true, `${name}: the record button is disabled`);
    assert.equal(click(app, "recordWord"), false);
    // Whoever reaches the start function by another way is refused too.
    await app.get("startWordRecording")();
    await timers.advance(STEP_MS * 3);
    assert.equal(wordState(app), "IDLE", `${name}: no recording begins`);
    assert.equal(read(app, "els.countdown.hidden"), true, `${name}: no countdown is shown`);
    assert.notEqual(read(app, "els.confidenceMessage.textContent"), "", `${name}: the user is told why`);
  }
});

test("the record button rule treats a running recording as busy", async () => {
  // The rule itself, called here at each busy state. The app redraws the
  // button with every recording step (updateWordState() calls this rule);
  // record-button-redraw.test.js shows that redraw.
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  const sync = () => {
    app.get("syncRecordButton")();
    return read(app, "els.recordWord.disabled");
  };
  assert.equal(sync(), false, "idle: a recording can be started");

  const starting = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN");
  assert.equal(sync(), true, "countdown: busy");
  await timers.advance(STEP_MS * app.evaluate("CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  assert.equal(sync(), true, "recording: busy");
  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(wordState(app), "PROCESSING");
  assert.equal(sync(), true, "processing: busy");
  release();
  await last;
  assert.equal(wordState(app), "RESULT");
  assert.equal(sync(), false, "result: a new recording can be started");
});

// Stopping, and moving away, during a recording

const LEAVES = {
  "the camera toggle": (app) => app.get("toggleCamera")(),
  "the letter tab": (app) => openTab(app, "letter"),
  "the project tab": (app) => openTab(app, "project"),
};

for (const [name, leave] of Object.entries(LEAVES)) {
  test(`${name} in the last countdown second ends in IDLE with nothing recorded`, async () => {
    const ctx = await bootedWordApp();
    const { app, runs, timers } = ctx;
    const starting = app.get("startWordRecording")();
    await timers.advance(STEP_MS * 3 - 100);
    assert.equal(wordState(app), "COUNTDOWN");
    assert.equal(read(app, "els.countdown.hidden"), false, "precondition: the count is on screen");
    // A word run is the one fed a mask; the letter model may run in letter mode.
    const wordRuns = () => runs.filter((feeds) => feeds.mask).length;
    const runsBefore = wordRuns();

    leave(app);
    await timers.advance(200);
    await starting;

    assert.equal(wordState(app), "IDLE", "the recording must not begin after the user left");
    assert.equal(read(app, "els.countdown.hidden"), true);
    assert.notEqual(read(app, "els.cameraStage.dataset.state"), "recording");
    assert.equal(read(app, "state.wordFrames"), 0);
    await feedFrames(app, 0, 5);
    assert.equal(read(app, "state.wordFrames"), 0, "frames after the stop are not recorded");
    assert.deepEqual(buffers(app), EMPTY_BUFFERS);
    assert.equal(wordRuns(), runsBefore, "the word model is never run");
  });
}

test("a stop in an earlier countdown step takes the count off the screen for good", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  const starting = app.get("startWordRecording")();
  await timers.advance(100);
  assert.equal(read(app, "els.countdown.hidden"), false);

  app.get("toggleCamera")();
  assert.equal(read(app, "els.countdown.hidden"), true);
  // The count must not come back on the next steps of the abandoned countdown.
  for (let step = 0; step < 3; step++) {
    await timers.advance(STEP_MS);
    assert.equal(read(app, "els.countdown.hidden"), true, `still hidden after step ${step + 1}`);
  }
  await starting;
  assert.equal(wordState(app), "IDLE");
});

test("stopping the camera abandons a recording and the next one can start", async () => {
  for (const phase of ["countdown", "recording"]) {
    const ctx = await bootedWordApp();
    const { app, timers } = ctx;
    if (phase === "countdown") {
      app.get("startWordRecording")();
      await timers.advance(STEP_MS + 100);
      assert.equal(wordState(app), "COUNTDOWN");
    } else {
      await startAndCountDown(ctx);
      await feedFrames(app, 0, 10);
    }

    app.get("toggleCamera")();
    await timers.advance(STEP_MS * 3);

    assert.equal(wordState(app), "IDLE", `${phase}: a stop resets the word state`);
    assert.equal(read(app, "state.wordFrames"), 0);
    assert.equal(read(app, "els.frameProgress.style.width"), "0%", `${phase}: the progress bar is empty`);
    assert.equal(read(app, "els.cameraStage.dataset.state"), "idle");

    cameraBackOn(app);
    app.get("syncRecordButton")();
    assert.equal(click(app, "recordWord"), true, `${phase}: the record button works after the camera is back`);
    await timers.advance(0);
    assert.equal(wordState(app), "COUNTDOWN", `${phase}: the next recording reaches its countdown`);
  }
});

test("a result that arrives after a stop or a mode change is discarded", async () => {
  const leaves = {
    "a camera stop": (app) => app.get("toggleCamera")(),
    "a switch to letter mode": (app) => openTab(app, "letter"),
  };
  for (const [name, leave] of Object.entries(leaves)) {
    const ctx = await bootedWordApp();
    const { app, timers, hold, release } = ctx;
    await startAndCountDown(ctx);
    hold();
    const last = feedFrames(app, 0, RECORDING_FRAMES);
    await timers.advance(0);
    assert.equal(wordState(app), "PROCESSING", `${name}: precondition, the model is still computing`);

    leave(app);
    release();
    await last;

    assert.equal(wordState(app), "IDLE", `${name}: no result is shown for a recording the user left`);
    assert.notEqual(read(app, "state.prediction"), "book", `${name}: the late word is not displayed`);
    assert.equal(read(app, "els.wordResultGuide.hidden"), true);
    assert.equal(acceptDisabled(app), true);
    assert.equal(transcript(app), "");
    assert.deepEqual(buffers(app), EMPTY_BUFFERS);
  }
});

test("a coach switch to a letter target while the model computes discards the word result", async () => {
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  openTab(app, "coach");
  click(app, "coachWordsOnly");
  await startAndCountDown(ctx);
  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(wordState(app), "PROCESSING", "precondition: the model is still computing a coach word");

  // The mode stays "coach", so nothing but the result itself can drop it.
  const select = app.evaluate("els.coachTarget");
  select.value = "A";
  select.dispatchEvent({ type: "change" });
  assert.equal(read(app, "state.mode"), "coach");
  release();
  await last;

  assert.equal(wordState(app), "IDLE", "a word result is not shown for a letter target");
  assert.notEqual(read(app, "state.prediction"), "book");
  assert.equal(read(app, "els.wordStateLabel.textContent"), "Hazır", "the recording panel is back at rest");
  assert.deepEqual(buffers(app), EMPTY_BUFFERS);
});

// Retry

test("retry is disabled while a recording runs and available on a finished result", async () => {
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  await recordWord(app, ctx);
  assert.equal(retryDisabled(app), false, "retry is available on a result");

  assert.equal(click(app, "recordWord"), true);
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN");
  assert.equal(retryDisabled(app), true, "retry is disabled during the countdown");
  await timers.advance(STEP_MS * app.evaluate("CONFIG.COUNTDOWN_SECONDS"));
  assert.equal(wordState(app), "RECORDING");
  assert.equal(retryDisabled(app), true, "retry is disabled while recording, so it cannot wipe the frames");
  assert.equal(click(app, "retryWord"), false);
  await feedFrames(app, 0, 10);
  assert.equal(read(app, "state.wordFrames"), 10, "the recording went on");

  hold();
  const last = feedFrames(app, 10, RECORDING_FRAMES - 10);
  await timers.advance(0);
  assert.equal(wordState(app), "PROCESSING");
  assert.equal(retryDisabled(app), true, "retry is disabled while the model computes");
  release();
  await last;
  assert.equal(wordState(app), "RESULT");
  assert.equal(retryDisabled(app), false);
});

test("retry discards the result and starts a new recording that can be finished and accepted", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  await recordWord(app, ctx);
  assert.equal(read(app, "state.prediction"), "book");

  assert.equal(click(app, "retryWord"), true);
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN", "retry begins a new recording");
  assert.equal(read(app, "state.prediction"), "?", "the old word is cleared from the screen");
  assert.equal(read(app, "els.primaryPrediction.textContent"), "?");
  assert.equal(transcript(app), "", "retry does not add anything to the transcript");

  await timers.advance(STEP_MS * app.evaluate("CONFIG.COUNTDOWN_SECONDS"));
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(wordState(app), "RESULT");
  assert.equal(acceptDisabled(app), false);
  assert.equal(click(app, "appendWordResult"), true);
  assert.equal(transcript(app), "book ");
});

test("retry is unavailable when the camera is off", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await recordWord(app, ctx);
  app.get("toggleCamera")();
  assert.equal(retryDisabled(app), true);
  assert.equal(click(app, "retryWord"), false);
});

// The motion buffers are empty after every way out of a recording

test("a finished recording leaves no frames, previous frame or visibility counts behind", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await recordWord(app, ctx);
  assert.equal(wordState(app), "RESULT");
  assert.deepEqual(buffers(app), EMPTY_BUFFERS);
  assert.equal(read(app, "_wordRecordingStats.totalObservedFrames"), 0, "the per-recording counters are reset");
  assert.equal(read(app, "_wordRecordingStats.handVisibleCount"), 0);
});

test("a new recording starts from empty buffers, whatever was left in them", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  app.evaluate(`
    frameBuffer = [new Float32Array(168)];
    normalizedFrameBuffer = [new Float32Array(168)];
    previousFrame = new Float32Array(168);
    _wordRecordingStats.totalObservedFrames = 7;
  `);

  assert.equal(click(app, "recordWord"), true);
  await timers.advance(0);
  assert.equal(wordState(app), "COUNTDOWN");
  assert.deepEqual(buffers(app), EMPTY_BUFFERS);
  assert.equal(read(app, "_wordRecordingStats.totalObservedFrames"), 0);
});

test("retry empties the buffers even when the new recording cannot start", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  await recordWord(app, ctx);
  app.evaluate(`
    frameBuffer = [new Float32Array(168)];
    normalizedFrameBuffer = [new Float32Array(168)];
    previousFrame = new Float32Array(168);
    _wordRecordingStats.totalObservedFrames = 7;
    mpRunning = false;
  `);

  assert.equal(click(app, "retryWord"), true);
  await timers.advance(0);
  assert.equal(wordState(app), "IDLE", "the new recording did not start: tracking is down");
  assert.deepEqual(buffers(app), EMPTY_BUFFERS);
  assert.equal(read(app, "_wordRecordingStats.totalObservedFrames"), 0);
});

for (const [name, leave] of Object.entries({
  "a mode change": (app) => openTab(app, "letter"),
  "a camera stop": (app) => app.get("toggleCamera")(),
})) {
  test(`${name} in the middle of a recording empties the buffers`, async () => {
    const ctx = await bootedWordApp();
    const { app } = ctx;
    await startAndCountDown(ctx);
    await feedFrames(app, 0, 10);
    assert.equal(buffers(app).frames, 10, "precondition: frames were recorded");
    assert.notEqual(buffers(app).previous, null);

    leave(app);

    assert.deepEqual(buffers(app), EMPTY_BUFFERS);
    assert.equal(wordState(app), "IDLE");
  });
}
