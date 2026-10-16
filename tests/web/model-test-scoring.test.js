// The Model Test screen scores a run honestly.
//
// The screen is the app's proof that the published models work without a
// camera: it feeds a bundled fixture to the model and says whether the answer
// matches the fixture's reference. A badge that says "Eşleşti" for a wrong
// answer would make that proof worthless, so the verdict is tested against a
// model whose answer the test chooses.
//
// ONNX Runtime is the boundary and is faked: its sessions return the class
// the test picks, in the shapes the published graphs have (a probability
// tensor for letters, logits for words). The fixtures, the label files, the
// manifest and every line of the screen are the real ones, read from disk.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };
const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));

const LETTER_LABELS = Object.entries(readJson("data/letter_labels.json"))
  .sort(([, a], [, b]) => a - b)
  .map(([letter]) => letter);
const WORD_INDEX = readJson("data/word_labels.json");

/**
 * The ORT sessions as the browser build would hand them out. They are
 * defined inside the app's own realm, so the arrays they return are the
 * app's own types, as in a browser.
 */
const FAKE_ORT = `
  globalThis.__ort = { chosen: 0, created: 0, fail: false, feeds: [] };
  globalThis.ort = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
    InferenceSession: {
      create: async (model) => {
        if (__ort.fail) throw new Error("no model in the test");
        __ort.created += 1;
        return String(model).includes("word") ? __wordSession : __letterSession;
      },
    },
  };
  globalThis.__letterSession = {
    inputNames: ["input"],
    outputNames: ["label", "probabilities"],
    run: async (feeds) => {
      __ort.feeds.push(feeds);
      const probabilities = new Float32Array(24).fill(0.1 / 23);
      probabilities[__ort.chosen] = 0.9;
      return { label: { data: new BigInt64Array([BigInt(__ort.chosen)]) }, probabilities: { data: probabilities } };
    },
  };
  globalThis.__wordSession = {
    inputNames: ["input", "mask"],
    outputNames: ["logits"],
    run: async (feeds) => {
      __ort.feeds.push(feeds);
      const logits = new Float32Array(50);
      logits[__ort.chosen] = 12;
      return { logits: { data: logits } };
    },
  };
`;

async function bootedApp() {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  app.evaluate(FAKE_ORT);
  return app;
}

/** Make the fake model answer with class `index` from now on. */
const modelAnswers = (app, index) => app.evaluate(`__ort.chosen = ${index}`);
const text = (app, id) => app.evaluate(`document.getElementById("${id}").textContent`);
const match = (app) => app.evaluate('document.getElementById("modelTestMatchBadge").dataset.match');

/** Load a bundled letter fixture the way the dropdown does, then press Run. */
async function runLetterFixture(app, item) {
  await app.get("loadModelTestSampleFromUrl")(item.path, item.title);
  await app.get("runModelTestSample")();
}

const bundledLetters = (app) => Array.from(app.evaluate("state.modelTestManifest.letters"));

test("a letter the model gets right is scored as a match, for every bundled fixture", async () => {
  const app = await bootedApp();
  const letters = bundledLetters(app);
  assert.equal(letters.length, 24, "precondition: the manifest bundles one fixture per letter");

  for (const item of letters) {
    modelAnswers(app, LETTER_LABELS.indexOf(item.expected_label));
    await runLetterFixture(app, item);

    const where = `fixture ${item.id}`;
    assert.equal(text(app, "modelTestMatchBadge"), "Eşleşti", where);
    assert.equal(match(app), "yes", where);
    assert.equal(text(app, "modelTestPredictedLabel"), item.expected_label, where);
    assert.equal(text(app, "modelTestExpectedLabel"), item.expected_label, where);
    assert.equal(text(app, "modelTestConfidence"), "%90.0", where);
    assert.match(text(app, "modelTestResultNote"), /^Tahmin beklenen etiketle eşleşti\./, where);
  }
});

test("a letter the model gets wrong is scored as a mismatch, and both letters are shown", async () => {
  const app = await bootedApp();

  for (const item of bundledLetters(app)) {
    const expectedIndex = LETTER_LABELS.indexOf(item.expected_label);
    const wrong = LETTER_LABELS[(expectedIndex + 1) % LETTER_LABELS.length];
    modelAnswers(app, LETTER_LABELS.indexOf(wrong));
    await runLetterFixture(app, item);

    const where = `fixture ${item.id} answered ${wrong}`;
    assert.equal(text(app, "modelTestMatchBadge"), "Eşleşmedi", where);
    assert.equal(match(app), "no", where);
    assert.equal(text(app, "modelTestPredictedLabel"), wrong, where);
    assert.equal(text(app, "modelTestExpectedLabel"), item.expected_label, where);
    assert.match(text(app, "modelTestResultNote"), /^Tahmin beklenen etiketten farklı\./, where);
  }
});

test("the verdict follows the latest run when the same fixture is run again", async () => {
  const app = await bootedApp();
  const item = bundledLetters(app).find((candidate) => candidate.expected_label === "C");
  await app.get("loadModelTestSampleFromUrl")(item.path, item.title);

  modelAnswers(app, LETTER_LABELS.indexOf("C"));
  await app.get("runModelTestSample")();
  assert.equal(match(app), "yes");

  modelAnswers(app, LETTER_LABELS.indexOf("D"));
  await app.get("runModelTestSample")();
  assert.equal(match(app), "no");
  assert.equal(text(app, "modelTestMatchBadge"), "Eşleşmedi");

  modelAnswers(app, LETTER_LABELS.indexOf("C"));
  await app.get("runModelTestSample")();
  assert.equal(match(app), "yes");
  assert.equal(text(app, "modelTestMatchBadge"), "Eşleşti");
});

test("the model is given the fixture's own 93 features and the top three are listed", async () => {
  const app = await bootedApp();
  const item = bundledLetters(app).find((candidate) => candidate.expected_label === "G");
  modelAnswers(app, LETTER_LABELS.indexOf("G"));

  await runLetterFixture(app, item);

  const features = readJson(item.path.replace("./", "")).features;
  const fed = app.evaluate("__ort.feeds.at(-1).input");
  assert.equal(fed.dims.join("x"), "1x93");
  assert.equal(fed.data.length, 93);
  assert.deepEqual(Array.from(fed.data), features.map(Math.fround));

  const rows = app.evaluate("Array.from(els.modelTestTop3List.children, (row) => row.textContent)");
  assert.equal(rows.length, 3, "three ranked rows");
  assert.match(rows[0], /^#1G/);
  assert.match(rows[0], /90%$/);
  assert.match(text(app, "modelTestResultNote"), /Top-3: 1\. G %90 /);
});

test("a fixture without a reference label is not scored", async () => {
  const app = await bootedApp();
  const item = bundledLetters(app)[0];
  const raw = readJson(item.path.replace("./", ""));
  for (const key of ["expected_label", "expected_letter", "expected_word", "label"]) delete raw[key];
  modelAnswers(app, LETTER_LABELS.indexOf("B"));

  const input = app.evaluate("els.modelTestSampleFile");
  input.files = [{ name: "no-reference.json", text: async () => JSON.stringify(raw) }];
  await app.get("handleModelTestSampleFile")({ target: input });
  await app.get("runModelTestSample")();

  assert.equal(text(app, "modelTestMatchBadge"), "Referans yok");
  assert.equal(match(app), "unknown");
  assert.equal(text(app, "modelTestPredictedLabel"), "B");
  assert.equal(text(app, "modelTestExpectedLabel"), "Referans yok");
});

test("the demo button loads the letter fixture, runs it and scores it", async () => {
  const app = await bootedApp();
  modelAnswers(app, LETTER_LABELS.indexOf("A"));

  app.evaluate('document.getElementById("loadDemoLetter")').dispatchEvent({ type: "click" });
  await flush(30);

  assert.equal(text(app, "modelTestSampleStatus"), "Tamamlandı");
  assert.equal(text(app, "modelTestMatchBadge"), "Eşleşti");
  assert.equal(match(app), "yes");
  assert.equal(text(app, "modelTestPredictedLabel"), "A");
});

test("a model that cannot load is reported as an error, never as a match", async () => {
  const app = await bootedApp();
  const item = bundledLetters(app)[0];
  app.evaluate("__ort.fail = true");

  await runLetterFixture(app, item);

  assert.equal(text(app, "modelTestSampleStatus"), "Hata");
  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  assert.equal(match(app), "no");
  assert.equal(text(app, "modelTestResultNote"), "Harf modeli yüklenemedi");
});

// ---------------------------------------------------------------------------
// The offline check: the word model against the fixed smoke fixture.
// ---------------------------------------------------------------------------

const SMOKE = readJson("data/test_sample.json");
const message = (app) => app.evaluate("els.confidenceMessage.textContent");
const level = (app) => app.evaluate("els.confidenceMessage.dataset.level");

async function runOfflineCheck(app) {
  app.evaluate('document.getElementById("offlineTest")').dispatchEvent({ type: "click" });
  await flush(30);
}

test("the offline check reports a match when the model gives the expected word", async () => {
  const app = await bootedApp();
  modelAnswers(app, WORD_INDEX[SMOKE.expected_word]);

  await runOfflineCheck(app);

  assert.equal(text(app, "offlineTest"), "✓ Eşleşiyor");
  assert.equal(level(app), "good");
  assert.match(message(app), new RegExp(`^Beklenen: ${SMOKE.expected_word} · ONNX: ${SMOKE.expected_word} `));
});

test("the offline check reports a mismatch when the model gives another word", async () => {
  const app = await bootedApp();
  const other = Object.keys(WORD_INDEX).find((word) => word !== SMOKE.expected_word);
  modelAnswers(app, WORD_INDEX[other]);

  await runOfflineCheck(app);

  assert.equal(text(app, "offlineTest"), "✗ Eşleşmiyor");
  assert.equal(level(app), "low");
  assert.match(message(app), new RegExp(`^Beklenen: ${SMOKE.expected_word} · ONNX: ${other} `));
});

test("the offline check says so when the model cannot load", async () => {
  const app = await bootedApp();
  app.evaluate("__ort.fail = true");

  await runOfflineCheck(app);

  assert.equal(text(app, "offlineTest"), "Offline test");
  assert.equal(level(app), "low");
  assert.match(message(app), /^Test hatası: /);
});
