// Word mode keys, and cancelling a recording.
//
// Enter records or records again, Space accepts through the same guard the
// button uses, and Escape cancels a countdown or a recording. An unmodified
// key still belongs to a focused button or field, and nothing acts while the
// reference viewer is open. The tests press keys through the real keydown
// handler and read the transcript and the recording state; only the ONNX
// runtime, the clock and the MediaPipe results are fake.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECORDING_FRAMES,
  feedFrames,
  recordWord,
  wordModeApp,
  wristX,
} from "./helpers/word-recording.mjs";

const FRAME_DIM = 168;
const WRIST_X = 0;
const SHOULDER_MID_X = 0.5;
const SHOULDER_WIDTH = 0.2;

/** Let the promise work a key press started finish. */
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

function keyedWordApp(options = {}) {
  const ctx = wordModeApp(options);
  ctx.app.get("bindEvents")();
  const onKeyDown = ctx.app.windowHandler("keydown");
  assert.ok(onKeyDown, "bindEvents() should bind a keydown handler");
  const page = ctx.app.makeTarget({ tagName: "DIV" });
  const button = ctx.app.makeTarget({ tagName: "BUTTON" });
  const codes = { " ": "Space", Enter: "Enter", Escape: "Escape" };
  /** @param {string} key @param {{target?: object}} [extra] */
  const press = (key, { target = page, ...modifiers } = {}) => {
    ctx.app.evaluate("__clock += 1000;");
    onKeyDown({
      key,
      code: codes[key] ?? key,
      target,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      preventDefault() {},
    });
  };
  return { ...ctx, press, button };
}

const transcript = (app) => app.evaluate("state.transcript");
const wordState = (app) => app.evaluate("state.wordState");

test("Space accepts a confident result once, however often it is pressed", async () => {
  const { app, press } = keyedWordApp({ winner: "book" });
  await recordWord(app);
  assert.equal(wordState(app), "RESULT");

  press(" ");
  assert.equal(transcript(app), "book ");

  press(" ");
  assert.equal(transcript(app), "book ", "a second Space must not append the word again");
});

test("Space appends nothing while recording, on a weak result, or after a failed recording", async () => {
  // During a recording.
  const recording = keyedWordApp({ winner: "book" });
  await recording.app.get("startWordRecording")();
  assert.equal(wordState(recording.app), "RECORDING");
  recording.press(" ");
  assert.equal(transcript(recording.app), "");

  // A result too weak to accept.
  const weak = keyedWordApp({ winner: "book", winnerLogit: 0 });
  await recordWord(weak.app);
  assert.equal(weak.app.evaluate("els.appendWordResult.disabled"), true, "precondition: the weak result cannot be accepted");
  weak.press(" ");
  assert.equal(transcript(weak.app), "");
  assert.match(weak.app.evaluate("els.announcer.textContent"), /yeterince net olmadığı için eklenemez/);

  // A recording whose model run failed, after one that was good.
  const failed = keyedWordApp({ winner: "book" });
  await recordWord(failed.app);
  failed.app.evaluate("wordSession.run = async () => { throw new Error('model failed'); };");
  await recordWord(failed.app);
  failed.press(" ");
  assert.equal(transcript(failed.app), "", "the first recording was never accepted");
});

test("Enter starts a recording from rest and records again from a result", async () => {
  const { app, press } = keyedWordApp({ winner: "book" });
  assert.equal(wordState(app), "IDLE");

  press("Enter");
  await settle();
  assert.equal(wordState(app), "RECORDING");

  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(wordState(app), "RESULT");
  assert.equal(app.evaluate("state.prediction"), "book");

  press("Enter");
  await settle();
  assert.equal(wordState(app), "RECORDING", "Enter in a result records again");
  assert.equal(app.evaluate("state.prediction"), "?", "the previous word leaves the screen");
});

test("Enter and Space leave a focused button to the button", async () => {
  const { app, press, button } = keyedWordApp({ winner: "book" });
  await recordWord(app);

  press(" ", { target: button });
  assert.equal(transcript(app), "");

  press("Enter", { target: button });
  await settle();
  assert.equal(wordState(app), "RESULT", "the key press was the button's, not the page's");
});

test("the letter keys do not edit the transcript in word mode", async () => {
  const { app, press } = keyedWordApp({ winner: "book" });
  app.evaluate('state.transcript = "AB"; state.prediction = "C"; state.confidence = 0.95;');

  press("Backspace");
  assert.equal(transcript(app), "AB", "Backspace is not bound in word mode");

  press("Enter");
  await settle();
  assert.equal(wordState(app), "RECORDING");
  assert.equal(transcript(app), "AB", "Enter starts a recording; it does not add a space");

  press(" ");
  assert.equal(transcript(app), "AB", "Space must not add the letter that was on screen");
});

test("Escape cancels a recording from anywhere, even from a focused button", async () => {
  const { app, press, button } = keyedWordApp({ winner: "book" });
  await app.get("startWordRecording")();
  assert.equal(wordState(app), "RECORDING");

  press("Escape", { target: button });

  assert.equal(wordState(app), "IDLE");
  assert.equal(app.evaluate("state.wordEnd"), "cancelled");
});

test("no word key acts while the reference viewer is open", async () => {
  const { app, press } = keyedWordApp({ winner: "book" });
  await recordWord(app);
  app.evaluate(`
    const dialog = document.getElementById("lightbox");
    dialog.showModal = () => dialog.setAttribute("open", "");
    dialog.close = () => dialog.removeAttribute("open");
  `);
  app.get("openReferenceViewer")({ kind: "page", index: 0, opener: null });
  assert.equal(app.evaluate("referenceViewerOpen()"), true);

  press(" ");
  assert.equal(transcript(app), "", "Space inside the viewer must not accept the word");
});

test("a cancelled recording says so, and its frames never reach the next one", async () => {
  const { app, runs } = keyedWordApp({ winner: "book" });
  await app.get("startWordRecording")();
  await feedFrames(app, 100, 20);
  assert.equal(app.evaluate("state.wordFrames"), 20);

  app.get("cancelWordRecording")();
  assert.equal(wordState(app), "IDLE");
  assert.equal(app.evaluate("state.wordEnd"), "cancelled");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "Kayıt iptal edildi.");
  assert.equal(app.evaluate("state.wordFrames"), 0);

  await recordWord(app);
  const feeds = runs.at(-1);
  const first = feeds.input.data.subarray(0, FRAME_DIM)[WRIST_X];
  const expected = (wristX(0) - SHOULDER_MID_X) / SHOULDER_WIDTH;
  assert.ok(
    Math.abs(first - expected) < 1e-5,
    `the model's first frame is the new recording's (wrist x ${first}, expected ${expected}), not a cancelled one`,
  );
});

test("a cancel during the countdown stops the count and never starts recording", async () => {
  const { app, timers } = keyedWordApp({ fakeTimers: true });
  const starting = app.get("startWordRecording")();
  await timers.advance(720);
  assert.equal(wordState(app), "COUNTDOWN");

  app.get("cancelWordRecording")();
  assert.equal(wordState(app), "IDLE");
  assert.equal(app.evaluate("els.countdown.hidden"), true);

  await timers.advance(5 * 720);
  await starting;
  assert.equal(wordState(app), "IDLE", "the countdown that was cancelled must not carry on into a recording");
});

test("cancelling with nothing to cancel does nothing", async () => {
  const { app } = keyedWordApp({ winner: "book" });
  app.get("cancelWordRecording")();
  assert.equal(app.evaluate("state.wordEnd"), null);

  await recordWord(app);
  app.get("cancelWordRecording")();
  assert.equal(wordState(app), "RESULT", "a finished result is not cancelled");
});

test("the Vazgeç button appears for a countdown or a recording and cancels it", async () => {
  const { app } = keyedWordApp({ winner: "book" });
  const cancelHidden = () => app.evaluate("els.cancelWord.hidden");
  app.evaluate("updateWordState();");
  assert.equal(cancelHidden(), true, "there is nothing to cancel at rest");

  await app.get("startWordRecording")();
  assert.equal(wordState(app), "RECORDING");
  assert.equal(cancelHidden(), false);

  app.evaluate("els.cancelWord").dispatchEvent({ type: "click", detail: 1 });
  assert.equal(wordState(app), "IDLE");
  assert.equal(app.evaluate("state.wordEnd"), "cancelled");
  assert.equal(cancelHidden(), true);

  await recordWord(app);
  assert.equal(cancelHidden(), true, "a finished result is not cancelled");
});
