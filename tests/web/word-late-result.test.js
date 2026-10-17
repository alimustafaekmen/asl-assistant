// A word result that arrives after the user left its recording is dropped,
// even when the user has come back by then.
//
// A late result is already dropped while the user is away (word-flow-guards
// covers a stop and a mode change). The fault here is the round trip: the
// model is still computing, the user switches to letter mode and back, or
// stops and restarts the camera, and starts nothing new. The recording that
// result belongs to is abandoned by the switch, yet the result would arrive on
// a word screen with the camera on and be offered for acceptance, so the user
// could append a word for a recording the screen has already cleared. The
// consent invariant needs the result to belong to a recording that is still
// waiting for it.
//
// Only the boundaries are faked: the ONNX session (held until the test
// releases it), MediaPipe's results and the countdown clock.

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

const read = (app, expression) => app.evaluate(expression);

async function bootedWordApp() {
  const ctx = wordModeApp({ boot: true, fakeTimers: true });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

/** Record a full window and leave the model computing it. */
async function recordingInProcessing(ctx) {
  const { app, timers, hold } = ctx;
  const starting = app.get("startWordRecording")();
  await timers.advance(app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "PROCESSING", "precondition: the model is computing");
  // Wrapped: an async function returning the promise would wait for it.
  return { last };
}

const ROUND_TRIPS = {
  "to letter mode and back": (app) => {
    openTab(app, "letter");
    openTab(app, "word");
  },
  "a camera stop and restart": (app) => {
    app.get("toggleCamera")();
    // The state a successful camera start leaves.
    app.evaluate(`
      state.cameraOn = true;
      mpRunning = true;
      poseLandmarker = { close() {} };
      faceLandmarker = { close() {} };
    `);
    app.get("syncRecordButton")();
  },
};

for (const [name, roundTrip] of Object.entries(ROUND_TRIPS)) {
  test(`a result that arrives after ${name} is not offered`, async () => {
    const ctx = await bootedWordApp();
    const { app, release } = ctx;
    const { last } = await recordingInProcessing(ctx);

    roundTrip(app);
    assert.equal(read(app, "state.mode"), "word", "precondition: back on the word screen");
    assert.equal(read(app, "state.cameraOn"), true, "precondition: with the camera on");
    release();
    await last;

    assert.equal(read(app, "state.wordState"), "IDLE", "the abandoned recording does not come back as a result");
    assert.notEqual(read(app, "state.prediction"), "book", "its word is not shown");
    assert.equal(read(app, "els.appendWordResult.disabled"), true, "nothing is offered");
    app.evaluate("__clock += 1000;");
    app.get("appendWordResultToTranscript")();
    assert.equal(read(app, "state.transcript"), "", "nothing is appended");

    // The screen is ready for a recording of its own, which is offered.
    const starting = app.get("startWordRecording")();
    await ctx.timers.advance(app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
    await starting;
    await feedFrames(app, 0, RECORDING_FRAMES);
    assert.equal(read(app, "state.wordState"), "RESULT");
    assert.equal(read(app, "els.appendWordResult.disabled"), false);
  });
}

test("a result that arrives while the user stayed is offered", async () => {
  const ctx = await bootedWordApp();
  const { app, release } = ctx;
  const { last } = await recordingInProcessing(ctx);
  release();
  await last;

  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.equal(read(app, "state.prediction"), "book");
  assert.equal(read(app, "els.appendWordResult.disabled"), false);
});
