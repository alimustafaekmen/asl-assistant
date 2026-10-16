// A finished word result gets one verdict, and every readout gives it.
//
// The accept threshold (WORD_ACCEPT_THRESHOLD, 0.15) decides whether a word
// can be appended. The plate's decision word, the confidence ring, the stage
// frame and the message line used a separate band edge (0.10), so a word at
// 12 % read "Büyük olasılıkla" on a yellow ring while its accept button was
// disabled and the result guide called it weak: three readouts, two verdicts.
// A word too weak to accept must look too weak everywhere.
//
// The recording runs through the app's own flow; only the ONNX session,
// MediaPipe's results and the countdown clock are faked.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { WEB_DIR } from "./helpers/web-app-context.mjs";
import { recordWord, wordModeApp } from "./helpers/word-recording.mjs";

const LABEL_COUNT = Object.keys(JSON.parse(readFileSync(join(WEB_DIR, "data", "word_labels.json"), "utf8"))).length;

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

const read = (app, expression) => app.evaluate(expression);

/** A word-model logit that comes out of calibration and softmax as `p`. */
function logitFor(app, p) {
  return app.get("temperature") * Math.log((p * (LABEL_COUNT - 1)) / (1 - p));
}

/** A booted word app whose model answers "book" at `p`, after one recording. */
async function resultAt(p) {
  let app = null;
  const ctx = wordModeApp({ boot: true, fakeTimers: true, winnerLogit: () => logitFor(app, p) });
  app = ctx.app;
  await app.ready;
  openTab(app, "word");
  await recordWord(app, ctx);
  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.ok(Math.abs(read(app, "state.confidence") - p) < 0.002, `the fake model answers at ${p}`);
  return app;
}

/** Every readout of the result on screen. */
function readouts(app) {
  return {
    decision: read(app, "els.decisionLabel.textContent"),
    ring: read(app, "els.confidenceRing.className"),
    stage: read(app, "els.cameraStage.dataset.state"),
    message: read(app, "els.confidenceMessage.dataset.level"),
    guide: read(app, "els.wordResultGuide.dataset.level"),
    acceptable: !read(app, "els.appendWordResult.disabled"),
  };
}

test("a word below the accept threshold reads as uncertain in every readout", async () => {
  const app = await resultAt(0.12);
  assert.ok(read(app, "CONFIG.WORD_ACCEPT_THRESHOLD") > 0.12, "precondition: 0.12 cannot be accepted");

  assert.deepEqual(readouts(app), {
    decision: "Emin değil",
    ring: "confidence-ring low",
    stage: "low",
    message: "low",
    guide: "low",
    acceptable: false,
  });
});

test("a word just above the accept threshold reads as likely in every readout, and can be accepted", async () => {
  const app = await resultAt(0.16);
  assert.ok(read(app, "CONFIG.WORD_ACCEPT_THRESHOLD") < 0.16, "precondition: 0.16 can be accepted");

  const shown = readouts(app);
  assert.equal(shown.decision, "Büyük olasılıkla");
  assert.equal(shown.ring, "confidence-ring maybe");
  assert.equal(shown.stage, "maybe");
  assert.notEqual(shown.message, "low");
  assert.notEqual(shown.guide, "low");
  assert.equal(shown.acceptable, true);
});

test("the band edge for an uncertain word is the accept threshold", async () => {
  const app = await resultAt(0.16);
  const { WORD_UNKNOWN_THRESHOLD, WORD_ACCEPT_THRESHOLD } = app.get("CONFIG");
  const level = app.get("getConfidenceLevel");
  assert.equal(level(WORD_ACCEPT_THRESHOLD - 0.001), "low", "just below the accept threshold is low");
  assert.notEqual(level(WORD_ACCEPT_THRESHOLD), "low", "the accept threshold itself is not");
  assert.equal(WORD_UNKNOWN_THRESHOLD, WORD_ACCEPT_THRESHOLD);
});

/**
 * Logits that come out of calibration and softmax as `p1` for "book" and
 * `p2` for "water", every other label sharing the rest equally at logit 0.
 */
function closePairLogits(app, p1, p2) {
  const others = LABEL_COUNT - 2;
  const rest = 1 - p1 - p2;
  const t = app.get("temperature");
  return { book: t * Math.log((p1 * others) / rest), water: t * Math.log((p2 * others) / rest) };
}

test("a weak word with a close runner-up still reads as uncertain, not as a close call", async () => {
  let app = null;
  const ctx = wordModeApp({
    boot: true,
    fakeTimers: true,
    winnerLogit: () => closePairLogits(app, 0.12, 0.1).book,
    runnerUp: { label: "water", logit: () => closePairLogits(app, 0.12, 0.1).water },
  });
  app = ctx.app;
  await app.ready;
  openTab(app, "word");
  await recordWord(app, ctx);
  assert.ok(Math.abs(read(app, "state.confidence") - 0.12) < 0.002, "precondition: book at 12 %");
  assert.equal(read(app, "state.top3[1].label"), "water", "precondition: water is second");
  assert.ok(Math.abs(read(app, "state.top3[1].confidence") - 0.1) < 0.002, "precondition: at 10 %");

  assert.deepEqual(readouts(app), {
    decision: "Emin değil",
    ring: "confidence-ring low",
    stage: "low",
    message: "low",
    guide: "low",
    acceptable: false,
  });
});
