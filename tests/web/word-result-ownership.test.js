// A word result belongs to the recording that produced it.
//
// word-consent.test.js shows that a result waits for the user's accept. These
// tests show what may be accepted: only the result of the latest recording,
// in word mode, once it has finished. A recording that produced no result
// offers nothing, not the word left over from the one before; a new recording
// takes the old word off offer as it starts; and a model run that finishes
// after a newer recording began is not shown at all.
//
// The fault each one kills is a word appended without the user accepting it,
// which breaks the app's consent rule: a failed second recording that left
// "book" acceptable would turn the transcript into "book book ".
//
// The app boots through its own init(); only the ONNX session, MediaPipe's
// results and the countdown clock are faked (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, recordWord, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

/** A booted word app on the word tab with the camera on. */
async function bootedWordApp(options = {}) {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, ...options });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

/** Call the accept handler a second after anything before it, past the debounce. */
function pressAccept(app) {
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
}

const read = (app, expression) => app.evaluate(expression);
const transcript = (app) => read(app, "state.transcript");

test("a recording whose model run fails offers nothing, not the previous word", async () => {
  let failing = false;
  const ctx = await bootedWordApp({
    winnerLogit: () => {
      if (failing) throw new Error("the model run failed");
      return 10;
    },
  });
  const { app } = ctx;
  await recordWord(app, ctx);
  pressAccept(app);
  assert.equal(transcript(app), "book ", "precondition: the first word was accepted");

  failing = true;
  await recordWord(app, ctx);
  assert.equal(read(app, "state.wordState"), "RESULT", "the recording finishes, with no word");
  assert.notEqual(read(app, "els.primaryPrediction.textContent"), "book", "the old word is not shown as this recording's result");
  assert.equal(read(app, "els.appendWordResult.disabled"), true, "a recording that produced no result offers no word");
  assert.notEqual(read(app, "els.announcer.textContent").trim(), "", "the user is told the recording could not be read");

  pressAccept(app);
  assert.equal(transcript(app), "book ", "the previous word must not be appended a second time");
});

test("a new recording takes the previous result off offer as it starts", async () => {
  const ctx = await bootedWordApp();
  const { app, timers } = ctx;
  await recordWord(app, ctx);
  assert.equal(read(app, "els.appendWordResult.disabled"), false, "precondition: the first result is on offer");

  const starting = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "COUNTDOWN");
  assert.notEqual(read(app, "els.primaryPrediction.textContent"), "book", "the old word is cleared when the new recording starts");

  pressAccept(app);
  assert.equal(transcript(app), "", "the old result belongs to the old recording; it is not accepted during the next");

  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  assert.equal(read(app, "state.wordState"), "RECORDING");
  pressAccept(app);
  assert.equal(transcript(app), "", "nor while the next one records");
});

test("a word result in the coach never reaches the transcript", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  openTab(app, "coach");
  app.evaluate("els.coachWordsOnly").dispatchEvent({ type: "click", detail: 1 });
  assert.ok(read(app, "state.coachTarget").length > 1, "precondition: the coach asks for a word");

  await recordWord(app, ctx);
  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.equal(read(app, "state.prediction"), "book", "precondition: the coach has a confident word result");

  pressAccept(app);
  assert.equal(transcript(app), "", "the transcript belongs to word mode");
});

test("a model run that finishes after a newer recording began is not shown", async () => {
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  const starting = app.get("startWordRecording")();
  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  hold();
  const first = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "PROCESSING", "precondition: the first recording is being computed");

  // The user leaves and comes back, which abandons the first recording, and
  // starts a new one before the first model run returns.
  openTab(app, "letter");
  openTab(app, "word");
  const second = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "COUNTDOWN", "precondition: the second recording is counting down");

  release();
  await first;
  assert.equal(read(app, "state.wordState"), "COUNTDOWN", "the late result must not replace the recording now running");
  assert.notEqual(read(app, "els.primaryPrediction.textContent"), "book");
  pressAccept(app);
  assert.equal(transcript(app), "");

  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await second;
  assert.equal(read(app, "state.wordState"), "RECORDING", "the second recording goes on");
});

test("a result is no longer on offer once the camera has stopped", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await recordWord(app, ctx);
  assert.equal(read(app, "els.appendWordResult.disabled"), false, "precondition: the result is on offer");

  app.get("toggleCamera")();
  assert.equal(read(app, "state.cameraOn"), false);
  assert.equal(read(app, "els.appendWordResult.disabled"), true, "the button is withdrawn with the camera");
  // The handler keeps the button's rule, so a path that reaches it another
  // way cannot accept what the button no longer offers.
  pressAccept(app);
  assert.equal(transcript(app), "");
});
