// Fixed runtime constants and the letter/word threshold selector.
//
// These values define the model contract shared with the Python pipeline, so a
// refactor must move them without editing them.
//
// Values read out of the scripts live in the vm realm, so arrays and objects
// are copied into plain local values before being compared.

const test = require("node:test");
const assert = require("node:assert/strict");

let app;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

test("word input geometry matches the published model contract", () => {
  const config = app.get("CONFIG");

  assert.equal(config.WORD_FRAME_COUNT, 45);
  assert.equal(config.TOP_K, 3);
  assert.equal(config.SMOOTHER_WINDOW, 5);
});

test("letter thresholds stay above word thresholds", () => {
  const config = app.get("CONFIG");

  assert.ok(config.UNKNOWN_THRESHOLD > config.WORD_UNKNOWN_THRESHOLD);
  assert.ok(config.CONFIDENT_THRESHOLD > config.WORD_CONFIDENT_THRESHOLD);
  assert.ok(config.LETTER_THRESHOLD > config.WORD_ACCEPT_THRESHOLD);
});

test("the static letter domain excludes the two motion letters", () => {
  const letters = [...app.get("LETTERS")];

  assert.equal(letters.length, 24);
  assert.ok(!letters.includes("J"));
  assert.ok(!letters.includes("Z"));
  // Label order is a model contract; the published order happens to be sorted.
  assert.deepEqual([...letters].sort(), letters);
});

test("the word domain matches the 50-class model", () => {
  const words = [...app.get("WORDS")];

  assert.equal(words.length, 50);
  assert.equal(new Set(words).size, 50);
  assert.deepEqual([...words].sort(), words);
});

test("difficulty sets describe disjoint groups of known words", () => {
  const words = new Set([...app.get("WORDS")]);
  const easy = [...app.get("EASY_WORDS")];
  const hard = [...app.get("HARD_WORDS")];

  for (const word of [...easy, ...hard]) {
    assert.ok(words.has(word), `unknown word in difficulty set: ${word}`);
  }
  for (const word of easy) {
    assert.ok(!hard.includes(word), `word is both easy and hard: ${word}`);
  }
});

test("_thresholdsForMode resolves letter thresholds for letter contexts", () => {
  const config = app.get("CONFIG");
  const state = app.get("state");
  const thresholdsForMode = app.get("_thresholdsForMode");

  state.mode = "letter";
  assert.deepEqual({ ...thresholdsForMode() }, {
    unknown: config.UNKNOWN_THRESHOLD,
    confident: config.CONFIDENT_THRESHOLD,
    accept: config.LETTER_THRESHOLD,
  });

  // A single-character coach target is a letter context too.
  state.mode = "coach";
  state.coachTarget = "A";
  assert.equal(thresholdsForMode().accept, config.LETTER_THRESHOLD);
});

test("_thresholdsForMode resolves word thresholds for word contexts", () => {
  const config = app.get("CONFIG");
  const state = app.get("state");
  const thresholdsForMode = app.get("_thresholdsForMode");
  const expected = {
    unknown: config.WORD_UNKNOWN_THRESHOLD,
    confident: config.WORD_CONFIDENT_THRESHOLD,
    accept: config.WORD_ACCEPT_THRESHOLD,
  };

  state.mode = "word";
  assert.deepEqual({ ...thresholdsForMode() }, expected);

  // A multi-character coach target follows the word thresholds.
  state.mode = "coach";
  state.coachTarget = "water";
  assert.deepEqual({ ...thresholdsForMode() }, expected);
});

test("the preferred model-test word fixtures are real words", () => {
  const words = new Set([...app.get("WORDS")]);

  for (const id of app.get("PREFERRED_MODEL_TEST_WORD_IDS")) {
    const word = id.replace(/^word-/, "").replace(/-\d+$/, "");
    assert.ok(words.has(word), `preferred fixture is not a model word: ${id}`);
  }
});

test("the reference gallery keeps the five split word pages", () => {
  const assets = app.get("REFERENCE_ASSETS");

  assert.deepEqual(
    [...assets.wordPages],
    [1, 2, 3, 4, 5].map((page) => `./assets/signs/word-50-${page}.png`),
  );
  assert.equal(assets.letter.src, "./assets/signs/letters.png");
});
