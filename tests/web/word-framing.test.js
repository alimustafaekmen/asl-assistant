// While a word is counted down and recorded, the framing readout says what
// the camera sees, including when it sees no hand.
//
// A word frame is recorded only with hand, face and shoulders in view, so the
// user needs to know which of the three is missing. Before this, live
// inference returned before the word branch on any frame without a hand: the
// readout froze at its last state exactly when the hand was the problem, and
// during the countdown, when framing can still be fixed, it never ran at all.
//
// Only the boundaries are faked: the ONNX session, MediaPipe's results and
// the countdown clock (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, mediaPipeFrame, wordModeApp } from "./helpers/word-recording.mjs";

const STEP_MS = 720;

const HINTS = {
  hand: "Eliniz görünmüyor; kadrajın ortasına getirin.",
  face: "Yüzünüz görünmüyor; kameraya bakın.",
  pose: "Omuzlarınız görünmüyor; biraz geri çekilin.",
  several: "Eliniz, yüzünüz ve omuzlarınız birlikte görünmeli; biraz geri çekilin.",
};

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

async function recordingApp() {
  const ctx = await bootedWordApp();
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(ctx.app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  assert.equal(read(ctx.app, "state.wordState"), "RECORDING", "precondition: recording");
  return ctx;
}

let nextTimestamp = 1000;

/** One render-loop frame whose MediaPipe result shows only the given groups. */
async function showOnly(app, { hand = false, face = false, pose = false }) {
  const full = mediaPipeFrame(0);
  const frame = {
    ...full,
    rightHandLandmarks: hand ? full.rightHandLandmarks : null,
    faceLandmarks: face ? full.faceLandmarks : null,
    poseLandmarks: pose ? full.poseLandmarks : null,
    timestamp: nextTimestamp++,
  };
  app.evaluate(`__clock += 50; latestMediaPipeResult = ${JSON.stringify(frame)};`);
  await app.get("realInference")(app.evaluate("__clock"));
}

const framing = (app) => ({ ...read(app, "state.wordFraming") });
const hint = (app) => read(app, "els.wordStateHint.textContent");
const pills = (app) =>
  Object.fromEntries(
    ["hand", "face", "pose"].map((group) => [
      group,
      read(app, `els.wordQualityPills.querySelector('[data-quality="${group}"]').dataset.ok`),
    ]),
  );

test("a recording frame without a hand says the hand is missing", async () => {
  const { app } = await recordingApp();
  await showOnly(app, { face: true, pose: true });

  assert.deepEqual(framing(app), { hand: false, face: true, pose: true });
  assert.ok(hint(app).includes(HINTS.hand), `hint: ${hint(app)}`);
  assert.deepEqual(pills(app), { hand: "false", face: "true", pose: "true" });
  assert.equal(read(app, "state.wordFrames"), 0, "a frame without a hand is not recorded");
});

test("the readout follows the frame: shoulders missing, then everything in view", async () => {
  const { app } = await recordingApp();
  await showOnly(app, { face: true, pose: true });
  await showOnly(app, { hand: true, face: true });

  assert.deepEqual(framing(app), { hand: true, face: true, pose: false });
  assert.ok(hint(app).includes(HINTS.pose), `hint: ${hint(app)}`);
  assert.ok(!hint(app).includes(HINTS.hand), "the hand hint is gone once the hand is back");
  assert.deepEqual(pills(app), { hand: "true", face: "true", pose: "false" });

  await showOnly(app, { hand: true, face: true, pose: true });
  assert.deepEqual(framing(app), { hand: true, face: true, pose: true });
  for (const text of Object.values(HINTS)) assert.ok(!hint(app).includes(text), `no missing-part hint: ${hint(app)}`);
  assert.deepEqual(pills(app), { hand: "true", face: "true", pose: "true" });
  assert.equal(read(app, "state.wordFrames"), 1, "the full frame is recorded");
});

test("a missing face, and more than one missing part, have their own hints", async () => {
  const { app } = await recordingApp();
  await showOnly(app, { hand: true, pose: true });
  assert.ok(hint(app).includes(HINTS.face), `hint: ${hint(app)}`);

  await showOnly(app, {});
  assert.deepEqual(framing(app), { hand: false, face: false, pose: false });
  assert.ok(hint(app).includes(HINTS.several), `hint: ${hint(app)}`);
});

test("during the countdown the readout already reports what is missing", async () => {
  const { app, timers } = await bootedWordApp();
  const starting = app.get("startWordRecording")();
  await timers.advance(STEP_MS);
  assert.equal(read(app, "state.wordState"), "COUNTDOWN", "precondition: counting down");

  await showOnly(app, { face: true, pose: true });
  assert.deepEqual(framing(app), { hand: false, face: true, pose: true });
  assert.ok(hint(app).includes(HINTS.hand), `hint: ${hint(app)}`);
  assert.deepEqual(pills(app), { hand: "false", face: "true", pose: "true" });

  await timers.advance(STEP_MS * 3);
  await starting;
  assert.equal(read(app, "state.wordFrames"), 0, "nothing seen in the countdown is recorded");
});

test("the readout does not alter what the recording records", async () => {
  const { app, runs } = await recordingApp();
  // Frames without a hand between the recorded ones change nothing in the
  // model input: the same 45 frames reach it in the same order.
  for (let t = 0; t < 45; t++) {
    await showOnly(app, { face: true, pose: true });
    await feedFrames(app, t, 1);
  }
  assert.equal(read(app, "state.wordState"), "RESULT");
  const wordRun = runs.filter((feeds) => feeds.mask).at(-1);
  assert.equal(Array.from(wordRun.mask.data).filter(Boolean).length, 45, "45 real frames reach the model");
});
