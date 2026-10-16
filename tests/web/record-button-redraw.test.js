// The record button follows the recording as it runs.
//
// word-flow-guards.test.js shows the button's rule: busy while a recording
// counts down, records or is computed. This test shows the button is redrawn
// when the recording state changes, without anything else calling the rule.
// The fault it kills is a record button that stays enabled with its start
// label through the countdown, inviting a second press that does nothing.
//
// The app boots through its own init(); only the ONNX session, MediaPipe's
// results and the countdown clock are faked (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;
const read = (app, expression) => app.evaluate(expression);
const button = (app) => ({
  disabled: read(app, "els.recordWord.disabled"),
  label: read(app, "els.recordWord.textContent"),
});

test("the record button is disabled from the countdown until the result", async () => {
  const { app, timers, hold, release } = wordModeApp({ boot: true, fakeTimers: true });
  await app.ready;
  app.evaluate('document.querySelector(\'button[data-mode="word"]\')').dispatchEvent({ type: "click", detail: 1 });
  const idle = button(app);
  assert.equal(idle.disabled, false, "precondition: a recording can be started");

  const starting = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "COUNTDOWN");
  assert.equal(button(app).disabled, true, "the button must not invite a second press during the countdown");
  assert.notEqual(button(app).label, idle.label, "nor still say it starts a recording");

  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  assert.equal(read(app, "state.wordState"), "RECORDING");
  assert.equal(button(app).disabled, true, "nor while recording");

  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "PROCESSING");
  assert.equal(button(app).disabled, true, "nor while the model computes");

  release();
  await last;
  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.equal(button(app).disabled, false, "a new recording can start once the result is in");
});
