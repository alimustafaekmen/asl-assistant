// What a word recording tells the user is plain Turkish, addressed as siz,
// and never the pipeline's own vocabulary.
//
// The pipeline's own strings, such as "pose visibility < 0.5: face or
// shoulders not clearly in view", must not reach the feedback bar or the
// result. Recording quality is a list of codes in state
// (state.wordQualityWarnings), each with one sentence of copy; the technical
// strings stay in the debug snapshot, window._lastWordDebug.
//
// Only the boundaries are faked: the ONNX session, MediaPipe's results and
// the countdown clock (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { mediaPipeFrame, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;

// Pipeline and model vocabulary, and English, that must not reach the user.
// Most are matched inside a word too, because a Turkish suffix ("Modelin")
// leaves no word boundary.
const TECHNICAL = /frame|motion|pose|visibility|gesture|mask|top-?\d|mediapipe|landmark|model|\b(hand|face)\b/i;

// Every text a word screen shows or says, each with the element whose
// hidden attribute takes it off the screen (null: always shown). Hidden text
// is not read: the result guide keeps its authored markup text until a
// result fills it.
const USER_TEXT = [
  ["els.decisionLabel.textContent", null],
  ["els.confidenceMessage.textContent", null],
  ["els.feedbackBar.textContent", "els.feedbackBar"],
  ["els.announcer.textContent", null],
  ["els.wordStateLabel.textContent", null],
  ["els.wordStateHint.textContent", null],
  ["els.wordResultDecision.textContent", "els.wordResultGuide"],
  ["els.wordResultAction.textContent", "els.wordResultGuide"],
  ["els.recordWord.title", null],
  ["els.retryWord.title", null],
  ["els.appendWordResult.title", null],
];

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

const read = (app, expression) => app.evaluate(expression);

function assertNoTechnicalText(app, when) {
  for (const [expression, container] of USER_TEXT) {
    if (container && read(app, `${container}.hidden`)) continue;
    const text = read(app, expression) ?? "";
    assert.doesNotMatch(text, TECHNICAL, `${when}: ${expression} reads "${text}"`);
  }
}

/** A booted word app whose model answers "water", an easy word. */
async function bootedWordApp() {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, winner: "water" });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  return ctx;
}

async function startRecording(ctx) {
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(ctx.app.evaluate("CONFIG.COUNTDOWN_SECONDS") * STEP_MS);
  await starting;
  assert.equal(read(ctx.app, "state.wordState"), "RECORDING", "precondition: recording");
}

let nextTimestamp = 5000;

/** One render-loop frame, `everyMs` after the last. */
async function feed(app, frame, everyMs = 50) {
  app.evaluate(`__clock += ${everyMs}; latestMediaPipeResult = ${JSON.stringify({ ...frame, timestamp: nextTimestamp++ })};`);
  await app.get("realInference")(app.evaluate("__clock"));
}

test("a recording that saw the shoulders too rarely says so in plain words", async () => {
  const ctx = await bootedWordApp();
  const { app } = ctx;
  await startRecording(ctx);
  // 45 recorded frames and 68 without shoulders: the shoulders were in 40 %
  // of what the camera saw.
  let rejected = 0;
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    await feed(app, mediaPipeFrame(t));
    const owed = Math.round(((t + 1) * 68) / RECORDING_FRAMES) - rejected;
    for (let i = 0; i < owed; i++, rejected++) await feed(app, { ...mediaPipeFrame(t), poseLandmarks: null });
  }
  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.equal(rejected, 68);

  assert.deepEqual([...read(app, "state.wordQualityWarnings")], ["pose"]);
  assert.equal(read(app, "els.feedbackBar.textContent"), "Omuzlarınız az göründü.");
  assert.match(read(app, "els.wordResultAction.textContent"), /Omuzlarınız az göründü\./);
  assertNoTechnicalText(app, "after a recording with a quality warning");
  assert.ok(
    read(app, "window._lastWordDebug.qualityWarnings").some((text) => /pose visibility/.test(text)),
    "the technical reason stays in the debug snapshot",
  );
});

test("a slow recording and a recording without movement each have their own code and copy", async () => {
  {
    const ctx = await bootedWordApp();
    const { app } = ctx;
    await startRecording(ctx);
    // 45 frames 150 ms apart take 6.75 s.
    for (let t = 0; t < RECORDING_FRAMES; t++) await feed(app, mediaPipeFrame(t), 150);
    assert.equal(read(app, "state.wordState"), "RESULT");
    assert.deepEqual([...read(app, "state.wordQualityWarnings")], ["slow"]);
    assert.equal(read(app, "els.feedbackBar.textContent"), "Kayıt yavaş doldu; ışığı artırın.");
    assertNoTechnicalText(app, "after a slow recording");
  }
  {
    const ctx = await bootedWordApp();
    const { app } = ctx;
    await startRecording(ctx);
    // The same pose 45 times: nothing moved.
    for (let t = 0; t < RECORDING_FRAMES; t++) await feed(app, mediaPipeFrame(0));
    assert.equal(read(app, "state.wordState"), "RESULT");
    assert.deepEqual([...read(app, "state.wordQualityWarnings")], ["still"]);
    assert.equal(read(app, "els.feedbackBar.textContent"), "Hareket algılanmadı; işareti tam yapın.");
    assertNoTechnicalText(app, "after a recording without movement");
  }
});

test("no step of a clean recording shows technical words", async () => {
  const ctx = await bootedWordApp();
  const { app, timers, hold, release } = ctx;
  // The word tab asked for the word model when it opened; that download's
  // progress line belongs to the camera's model status, not to a recording.
  await timers.advance(0);
  assertNoTechnicalText(app, "idle");

  const starting = app.get("startWordRecording")();
  await timers.advance(0);
  assertNoTechnicalText(app, "countdown");
  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  for (let t = 0; t < 10; t++) await feed(app, mediaPipeFrame(t));
  assertNoTechnicalText(app, "recording");

  hold();
  const rest = (async () => {
    for (let t = 10; t < RECORDING_FRAMES; t++) await feed(app, mediaPipeFrame(t));
  })();
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "PROCESSING");
  assertNoTechnicalText(app, "processing");
  release();
  await rest;

  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.deepEqual([...read(app, "state.wordQualityWarnings")], []);
  assertNoTechnicalText(app, "result");
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(read(app, "state.transcript"), "water ");
  assertNoTechnicalText(app, "accepted");
});

test("a word recording that cannot start says why without technical words", async () => {
  const cases = {
    "the camera is off": "state.cameraOn = false;",
    "tracking is not running": "mpRunning = false;",
    "shoulder tracking is missing": "poseLandmarker = null;",
  };
  for (const [name, fault] of Object.entries(cases)) {
    const { app, timers } = await bootedWordApp();
    // Let the word tab's own model download settle first: its "ready" line
    // would otherwise land after, and over, the reason being checked.
    await timers.advance(0);
    app.evaluate(fault);
    app.get("syncRecordButton")();
    await app.get("startWordRecording")();
    assert.equal(read(app, "state.wordState"), "IDLE", `${name}: no recording`);
    assert.notEqual(read(app, "els.confidenceMessage.textContent"), "", `${name}: the user is told why`);
    assertNoTechnicalText(app, name);
  }
});

test("a weak result and a failed model run say what to do in plain words", async () => {
  {
    const ctx = wordModeApp({ boot: true, fakeTimers: true, winner: "water", winnerLogit: 1 });
    await ctx.app.ready;
    openTab(ctx.app, "word");
    await startRecording(ctx);
    for (let t = 0; t < RECORDING_FRAMES; t++) await feed(ctx.app, mediaPipeFrame(t));
    assert.ok(read(ctx.app, "state.confidence") < read(ctx.app, "CONFIG.WORD_ACCEPT_THRESHOLD"), "precondition: weak");
    assertNoTechnicalText(ctx.app, "a weak result");
  }
  {
    const ctx = wordModeApp({
      boot: true,
      fakeTimers: true,
      winnerLogit: () => {
        throw new Error("the model run failed");
      },
    });
    await ctx.app.ready;
    openTab(ctx.app, "word");
    await startRecording(ctx);
    for (let t = 0; t < RECORDING_FRAMES; t++) await feed(ctx.app, mediaPipeFrame(t));
    assert.equal(read(ctx.app, "state.prediction"), "?", "precondition: no result");
    assertNoTechnicalText(ctx.app, "a failed run");
  }
});
