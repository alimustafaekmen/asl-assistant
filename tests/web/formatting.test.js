// Percentage and top-prediction formatters shared by the live UI and the
// offline Model Test panel. They are the only place model confidences are
// turned into user-facing text, so rounding and fallbacks are locked here.

const test = require("node:test");
const assert = require("node:assert/strict");

let clampPercent;
let formatPercent;
let formatTopPredictions;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  const app = loadWebApp();
  clampPercent = app.get("clampPercent");
  formatPercent = app.get("formatPercent");
  formatTopPredictions = app.get("formatTopPredictions");
});

test("clampPercent keeps progress bars inside 0-100", () => {
  assert.equal(clampPercent(0), 0);
  assert.equal(clampPercent(42.4), 42);
  assert.equal(clampPercent(42.6), 43);
  assert.equal(clampPercent(100), 100);
  assert.equal(clampPercent(-12), 0);
  assert.equal(clampPercent(1200), 100);
});

test("clampPercent treats unusable numbers as zero", () => {
  assert.equal(clampPercent(NaN), 0);
  assert.equal(clampPercent(Infinity), 0);
  assert.equal(clampPercent(undefined), 0);
});

test("formatPercent renders one decimal and a dash for missing values", () => {
  assert.equal(formatPercent(0.1234), "%12.3");
  assert.equal(formatPercent(1), "%100.0");
  assert.equal(formatPercent(0), "%0.0");
  assert.equal(formatPercent(NaN), "-");
  assert.equal(formatPercent(undefined), "-");
});

test("formatTopPredictions numbers the ranked labels", () => {
  const items = [
    { label: "water", confidence: 0.5 },
    { label: "sad", confidence: 0.25 },
    { label: "cow", confidence: 0.125 },
    { label: "duck", confidence: 0.06 },
  ];

  assert.equal(formatTopPredictions(items), "1. water %50 · 2. sad %25 · 3. cow %13");
  assert.equal(formatTopPredictions(items, 2), "1. water %50 · 2. sad %25");
  assert.equal(formatTopPredictions([]), "");
});

test("formatTopPredictions treats a missing confidence as zero", () => {
  assert.equal(formatTopPredictions([{ label: "go" }]), "1. go %0");
});
