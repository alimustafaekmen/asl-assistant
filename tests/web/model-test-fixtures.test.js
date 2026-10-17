// Offline Model Test fixture parsing.
//
// The panel accepts hand-written JSON from a URL, a file picker, or a drop
// target, so its validation is the only guard between a malformed fixture and
// an ONNX session. The shapes asserted here (93 letter features, 45 x 168 word
// features, 45 mask entries) are the published model contract.

import test from "node:test";
import assert from "node:assert/strict";

let flattenNumericArray;
let isRecord;
let normalizeMask;
let normalizeModelTestSample;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  const app = loadWebApp();
  flattenNumericArray = app.get("flattenNumericArray");
  isRecord = app.get("isRecord");
  normalizeMask = app.get("normalizeMask");
  normalizeModelTestSample = app.get("normalizeModelTestSample");
});

const letterFeatures = () => Array.from({ length: 93 }, (_, i) => i / 93);
const wordFeatures = () => Array.from({ length: 45 * 168 }, (_, i) => i / 10000);
const wordMask = (realFrames = 45) =>
  Array.from({ length: 45 }, (_, i) => i < realFrames);

test("flattenNumericArray flattens nested frames in row order", () => {
  assert.deepEqual([...flattenNumericArray([1, 2, 3], "features")], [1, 2, 3]);
  assert.deepEqual(
    [...flattenNumericArray([[1, 2], [3, 4], [5, 6]], "features")],
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    [...flattenNumericArray([[[1], [2]], [[3], [4]]], "features")],
    [1, 2, 3, 4],
  );
  assert.deepEqual([...flattenNumericArray([], "features")], []);
});

test("flattenNumericArray coerces numeric strings but rejects anything else", () => {
  assert.deepEqual([...flattenNumericArray(["1", "2.5"], "features")], [1, 2.5]);

  for (const bad of [["a"], [undefined], [NaN], [Infinity], [{}]]) {
    assert.throws(
      () => flattenNumericArray(bad, "features"),
      /features içinde sayısal olmayan değer var/,
    );
  }
});

test("normalizeMask accepts the documented truthy spellings", () => {
  assert.deepEqual(
    [...normalizeMask([true, false, 1, 0, "1", "0", "true", "false", "TRUE"])],
    [true, false, true, false, true, false, true, false, true],
  );
});

test("normalizeMask rejects a non-array or an unexpected entry", () => {
  assert.throws(() => normalizeMask(undefined), /Kelime fixture mask\[45\] bekler, 0 geldi/);
  assert.throws(() => normalizeMask("1111"), /Kelime fixture mask\[45\] bekler, geçersiz geldi/);
  assert.throws(() => normalizeMask([2]), /mask sadece bool, 0\/1 veya true\/false/);
  assert.throws(() => normalizeMask([null]), /mask sadece bool, 0\/1 veya true\/false/);
});

test("a letter fixture is inferred from the absence of a mask", () => {
  const sample = normalizeModelTestSample(
    { features: letterFeatures(), expected_label: "A" },
    "letter-a.json",
  );

  assert.equal(sample.task, "letter");
  assert.equal(sample.features.length, 93);
  assert.equal(sample.mask, null);
  assert.equal(sample.expectedLabel, "A");
  assert.equal(sample.shapeLabel, "93 float");
  assert.equal(sample.maskLabel, "Yok");
});

test("a word fixture is inferred from the presence of a mask", () => {
  const sample = normalizeModelTestSample(
    { features: wordFeatures(), mask: wordMask(38), expected_word: "water" },
    "word-water-01.json",
  );

  assert.equal(sample.task, "word");
  assert.equal(sample.features.length, 45 * 168);
  assert.equal(sample.mask.length, 45);
  assert.equal(sample.mask.filter(Boolean).length, 38);
  assert.equal(sample.expectedLabel, "water");
  assert.equal(sample.shapeLabel, "45 × 168 = 7560 float");
  assert.equal(sample.maskLabel, "38/45 real frame");
});

test("an explicit task field overrides mask-based inference", () => {
  const sample = normalizeModelTestSample(
    { task: "word", features: [wordFeatures()], mask: wordMask() },
    "nested.json",
  );

  assert.equal(sample.task, "word");
  assert.equal(sample.features.length, 45 * 168);
});

test("word fixtures must carry 7560 features and 45 mask entries", () => {
  assert.throws(
    () => normalizeModelTestSample({ features: letterFeatures(), mask: wordMask() }, "x"),
    /Kelime fixture features\[7560\] bekler, 93 geldi/,
  );
  assert.throws(
    () => normalizeModelTestSample({ features: wordFeatures(), mask: wordMask().slice(0, 30) }, "x"),
    /Kelime fixture mask\[45\] bekler, 30 geldi/,
  );
});

test("letter fixtures must carry exactly 93 features", () => {
  assert.throws(
    () => normalizeModelTestSample({ features: letterFeatures().slice(0, 92) }, "x"),
    /Harf fixture features\[93\] bekler, 92 geldi/,
  );
});

test("a fixture without a usable features array is rejected", () => {
  assert.throws(() => normalizeModelTestSample(null, "x"), /Fixture JSON object olmalı/);
  assert.throws(() => normalizeModelTestSample("{}", "x"), /Fixture JSON object olmalı/);
  assert.throws(() => normalizeModelTestSample({}, "x"), /features alanı array olmalı/);
  assert.throws(
    () => normalizeModelTestSample({ features: { "0": 1 } }, "x"),
    /features alanı array olmalı/,
  );
});

test("fixture metadata falls back to documented defaults", () => {
  const sample = normalizeModelTestSample({ features: letterFeatures() }, "dropped.json");

  assert.equal(sample.schemaVersion, "asl-sample-v1");
  assert.equal(sample.source, "dropped.json");
  assert.equal(sample.expectedLabel, "");
  assert.ok(Number.isNaN(sample.expectedConfidence));
});

test("isRecord accepts anything whose properties can be read", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ features: [] }), true);
  // Arrays pass here; the field reads reject them (see the next test).
  assert.equal(isRecord([]), true);

  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord("{}"), false);
  assert.equal(isRecord(7), false);
});

test("an array is still rejected for having no features field", () => {
  assert.throws(
    () => normalizeModelTestSample([1, 2, 3], "x"),
    /features alanı array olmalı/,
  );
});

test("hand-written metadata is read as text", () => {
  const sample = normalizeModelTestSample(
    {
      features: letterFeatures(),
      expected_label: 5,
      sample_id: 12,
      schema_version: 1,
      source: 0,
    },
    "numbers.json",
  );

  assert.equal(sample.expectedLabel, "5");
  assert.equal(sample.sampleId, "12");
  assert.equal(sample.schemaVersion, "1");
  // A falsy source falls through to the caller's name.
  assert.equal(sample.source, "numbers.json");
});
