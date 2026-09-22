// Letter prediction smoothing and word-level evaluation feedback.
//
// The smoother is what makes the label-only ONNX fallback usable: it converts
// repeated labels into a confidence. Callers treat its result as always
// present, so the first test here pins that invariant before anything relies
// on it.

const test = require("node:test");
const assert = require("node:assert/strict");

let app;
test.beforeEach(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

/** One model result with a single alternative. */
function prediction(label, confidence) {
  return { label, confidence, alternatives: [{ label, confidence }] };
}

test("smoothing always returns a result once something was pushed", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");

  // Callers use the result without a null check. Pushing before reading means
  // the buffer can never be empty, so that is safe.
  for (const confidence of [0, 0.5, 1]) {
    const smoothed = smoothLetterPrediction(prediction("A", confidence));
    assert.notEqual(smoothed, null);
    assert.equal(typeof smoothed.label, "string");
    assert.ok(Number.isFinite(smoothed.confidence));
    assert.ok(Array.isArray(smoothed.alternatives));
  }
});

test("an untouched smoother has nothing to report", () => {
  assert.equal(app.get("_smoother").get(), null);
});

test("a stable label reports its mean raw confidence", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");

  let smoothed = null;
  for (let i = 0; i < app.get("CONFIG").SMOOTHER_WINDOW; i += 1) {
    smoothed = smoothLetterPrediction(prediction("A", 0.8));
  }

  // A label filling the whole window keeps its raw confidence.
  assert.equal(smoothed.label, "A");
  assert.ok(Math.abs(smoothed.confidence - 0.8) < 1e-9);
});

test("an unstable label is penalised by how little of the window it holds", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");

  smoothLetterPrediction(prediction("A", 1));
  smoothLetterPrediction(prediction("A", 1));
  smoothLetterPrediction(prediction("A", 1));
  smoothLetterPrediction(prediction("B", 1));
  const smoothed = smoothLetterPrediction(prediction("B", 1));

  // Three of five frames, at full raw confidence.
  assert.equal(smoothed.label, "A");
  assert.ok(Math.abs(smoothed.confidence - 0.6) < 1e-9);
});

test("the window is bounded, so an old sign stops counting", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");
  const window = app.get("CONFIG").SMOOTHER_WINDOW;

  for (let i = 0; i < window; i += 1) smoothLetterPrediction(prediction("A", 1));
  let smoothed = null;
  for (let i = 0; i < window; i += 1) smoothed = smoothLetterPrediction(prediction("B", 1));

  assert.equal(smoothed.label, "B");
  assert.ok(Math.abs(smoothed.confidence - 1) < 1e-9);
  assert.equal(app.get("_smoother").buffer.length, window);
});

test("the reported alternatives come from the most recent matching frame", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");

  smoothLetterPrediction({
    label: "A",
    confidence: 0.9,
    alternatives: [{ label: "A", confidence: 0.9 }, { label: "S", confidence: 0.1 }],
  });
  const smoothed = smoothLetterPrediction({
    label: "A",
    confidence: 0.9,
    alternatives: [{ label: "A", confidence: 0.9 }, { label: "M", confidence: 0.1 }],
  });

  assert.deepEqual(
    smoothed.alternatives.map((item) => item.label),
    ["A", "M"],
  );
});

test("resetting clears the window so a previous sign cannot leak", () => {
  const smoothLetterPrediction = app.get("smoothLetterPrediction");
  const smoother = app.get("_smoother");

  smoothLetterPrediction(prediction("A", 1));
  app.get("resetSmoother")();

  assert.equal(smoother.buffer.length, 0);
  assert.equal(smoother.get(), null);
});

test("confusion feedback needs a close call between two known labels", () => {
  const getConfusionFeedback = app.get("getConfusionFeedback");
  app.evaluate('confusionPairs = [{ word_a: "hear", word_b: "listen" }];');

  const close = [{ label: "hear", confidence: 0.30 }, { label: "listen", confidence: 0.25 }];
  const clear = [{ label: "hear", confidence: 0.80 }, { label: "listen", confidence: 0.25 }];

  assert.match(getConfusionFeedback(close[0], close[1]), /hear/);
  // The pair still matches in the other order.
  assert.match(getConfusionFeedback(close[1], close[0]), /listen/);
  // A comfortable margin is not a confusion, even for a known pair.
  assert.equal(getConfusionFeedback(clear[0], clear[1]), null);
  assert.equal(getConfusionFeedback(null, close[1]), null);
  assert.equal(getConfusionFeedback(close[0], null), null);
});

test("confusion pairs are accepted in every published spelling", () => {
  const getConfusionFeedback = app.get("getConfusionFeedback");
  const top1 = { label: "hear", confidence: 0.3 };
  const top2 = { label: "listen", confidence: 0.25 };

  for (const pairs of [
    '[{ word_a: "hear", word_b: "listen" }]',
    '[{ a: "hear", b: "listen" }]',
    '[["hear", "listen"]]',
  ]) {
    app.evaluate(`confusionPairs = ${pairs};`);
    assert.notEqual(getConfusionFeedback(top1, top2), null, `pair form rejected: ${pairs}`);
  }

  app.evaluate('confusionPairs = [{ word_a: "give", word_b: "food" }];');
  assert.equal(getConfusionFeedback(top1, top2), null);
});

test("every published pair spelling unpacks to the same words", () => {
  const readConfusionPair = app.get("readConfusionPair");

  // The three spellings the bundled data has used, plus the count field names.
  assert.deepStrictEqual({ ...readConfusionPair({ word_a: "hear", word_b: "listen", count: 7 }) },
    { a: "hear", b: "listen", count: 7 });
  assert.deepStrictEqual({ ...readConfusionPair({ a: "hear", b: "listen", confusions: 4 }) },
    { a: "hear", b: "listen", count: 4 });
  assert.deepStrictEqual({ ...readConfusionPair(["hear", "listen"]) },
    { a: "hear", b: "listen", count: 0 });

  // A pair that names no words is readable rather than a crash, and matches
  // nothing because both words come back empty.
  assert.deepStrictEqual({ ...readConfusionPair({}) }, { a: "", b: "", count: 0 });
});


test("word difficulty falls back to unknown without published statistics", () => {
  const getWordDifficulty = app.get("getWordDifficulty");

  assert.equal(getWordDifficulty("water"), "unknown");
  assert.equal(app.get("getDifficultyMessage")("water"), null);
});

test("word difficulty prefers a recognised published label over the F1 threshold", () => {
  const getWordDifficulty = app.get("getWordDifficulty");
  app.evaluate(`perWordStats = {
    stated: { difficulty: "hard", f1: 0.99 },
    mislabelled: { difficulty: "impossible", f1: 0.9 },
    strong: { f1: 0.9 },
    middling: { f1_score: 0.7 },
    weak: { test_f1: 0.2 },
    blank: {},
  };`);

  assert.equal(getWordDifficulty("stated"), "hard");
  assert.equal(getWordDifficulty("mislabelled"), "easy");
  assert.equal(getWordDifficulty("strong"), "easy");
  assert.equal(getWordDifficulty("middling"), "medium");
  assert.equal(getWordDifficulty("weak"), "hard");
  assert.equal(getWordDifficulty("blank"), "hard");
  assert.match(app.get("getDifficultyMessage")("weak"), /weak/);
  assert.equal(app.get("getDifficultyMessage")("strong"), null);
});
