// Model Test in English, and the switch while a result is on screen.
//
// The faults these tests kill:
// - a part of the panel left in Turkish for an English reader, in any state:
//   idle, a sample ready, a match, a mismatch, a run check on the made-up
//   word sample, a refused file, a sample that cannot be fetched, a model that
//   does not load, a run over every sample, and a list with no samples;
// - the manifest's Turkish sample names ("Harf A") shown on an English page;
// - a percentage in the Turkish order ("%90") or with a decimal comma, or a
//   time in "sn", on an English page;
// - a switch while a result, an error or a batch is shown that leaves any of
//   it in the old language, loses the selected sample, or does not give the
//   same Turkish back.
//
// ONNX Runtime, fetch, the clock and the browser's languages are faked at
// their boundaries; the manifest, the fixtures and the panel are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FAKE_ORT_SOURCE, LETTER_LABELS, WORD_INDEX, fakeClock, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import {
  MANIFEST,
  answerPlan,
  expectedLetterIndices,
  file,
  letterVector,
  rankedRows,
  readJson,
  text,
} from "./helpers/model-test-panel.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };
const ENGLISH = ["en-US", "en"];

/** The app booted in `languages` on Model Test, with its fixture list read. */
async function modelTest(languages = ENGLISH, globals = {}) {
  const app = loadWebApp({ boot: true, languages, globals: { console: quietConsole, ...globals } });
  await app.ready;
  app.evaluate(FAKE_ORT_SOURCE);
  app.get("setMode")("test");
  await app.get("loadModelTestManifest")();
  return app;
}

const screen = (app) => app.evaluate('document.getElementById("modelTestScreen")');
const turkishOn = (app) => turkishLeft(screen(app), { includeHidden: true });
const missing = (app) => [...app.get("I18N_PROBLEMS").missing];
const optionTexts = (app) => Array.from(app.evaluate("els.modelTestSampleSelect.options"), (option) => option.textContent);
const rowCells = (app) =>
  JSON.parse(app.evaluate("JSON.stringify(Array.from(els.modelTestRows.children, (row) => Array.from(row.children, (cell) => cell.textContent)))"));

/** Everything the panel shows as one string, to compare a page before and after a round trip. */
const panelText = (app) =>
  [
    app.evaluate("document.getElementById('modelTestScreen').textContent"),
    ...optionTexts(app),
  ].join("|").replace(/\s+/g, " ");

test("an idle English panel has no Turkish, its sample names included", async () => {
  const app = await modelTest();

  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestSampleStatus"), "Waiting for a sample");
  assert.equal(optionTexts(app)[0], "Letter A · expected 100%");

  app.get("setModelTestTask")("word");
  assert.deepEqual(turkishOn(app), []);
  assert.equal(optionTexts(app)[0], "Word model smoke test");
  assert.match(text(app, "modelTestBatchHint"), /^Runs the word model's ready-made sample\./);
  assert.deepEqual(missing(app), []);
});

test("a letter that matches and one that does not are reported in English", async () => {
  const app = await modelTest();
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf("A")}`);

  await app.get("loadAndRunPreferredModelTestSample")("letter");

  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestMatchBadge"), "Match");
  assert.equal(text(app, "modelTestConfidence"), "90%");
  assert.equal(text(app, "modelTestFileName"), "Letter A");
  assert.equal(text(app, "modelTestMaskLabel"), "None");
  assert.equal(text(app, "modelTestSourceLabel"), "data/processed/test_landmarks.csv", "the fixture names its own source");
  assert.match(rankedRows(app)[0], /^#1A90%$/);
  assert.match(text(app, "modelTestResultNote"), /Top three: 1\. A 90% · 2\. \w 0% · 3\. \w 0%\.$/);

  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf("B")}`);
  await app.get("runModelTestSample")();
  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestMatchBadge"), "No match");
  assert.match(text(app, "modelTestResultNote"), /^The prediction differs from the expected label\./);
  assert.deepEqual(missing(app), []);
});

test("the made-up word sample is a run check in English", async () => {
  const app = await modelTest();

  await app.get("loadAndRunPreferredModelTestSample")("word");

  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestMatchBadge"), "Smoke test");
  assert.equal(text(app, "modelTestMaskLabel"), "30 of 45");
  assert.match(text(app, "modelTestResultNote"), /you can try word mode with your camera\.$/);
});

test("refused files, a missing sample and a model that does not load are explained in English", async () => {
  const app = await modelTest();

  await app.get("readModelTestSampleFile")(file("broken.json", "{ not json"));
  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestResultNote"), "The file could not be read: it is not valid JSON.");
  assert.equal(text(app, "modelTestSampleStatus"), "Error");

  await app.get("readModelTestSampleFile")(file("short.json", { task: "letter", features: letterVector(90) }));
  assert.equal(text(app, "modelTestResultNote"), "A letter sample must hold 93 numbers; this file has 90.");

  const sample = MANIFEST.letters[0];
  routeFetch(app, (path) => (path.includes(sample.path.replace("./", "")) ? jsonResponse({}, 404) : undefined));
  await app.get("loadAndRunPreferredModelTestSample")("letter");
  assert.equal(text(app, "modelTestResultNote"), "Could not get Letter A (HTTP 404)");
  assert.deepEqual(turkishOn(app), []);

  const failing = await modelTest();
  failing.evaluate("__ort.fail = true");
  await failing.get("readModelTestSampleFile")(file("letter.json", { task: "letter", features: letterVector() }));
  await failing.get("runModelTestSample")();
  assert.equal(text(failing, "modelTestResultNote"), "The letter model could not load");
  await failing.get("runModelTestBatch")("letter");
  assert.equal(text(failing, "modelTestSummary"), "The letter model could not load");
  assert.deepEqual(turkishOn(failing), []);
  assert.deepEqual(missing(failing), []);
});

test("a run over every letter is summed up and listed in English", async () => {
  const clock = fakeClock();
  const app = await modelTest(ENGLISH, clock.globals);
  app.evaluate("__ort.createMs = 1500; __ort.runMs = 0.6;");
  const failed = MANIFEST.letters[3];
  routeFetch(app, (path) => (path.includes(failed.path.replace("./", "")) ? jsonResponse({}, 404) : undefined));
  const plan = expectedLetterIndices().filter((_, index) => index !== 3);
  plan[0] = (plan[0] + 1) % LETTER_LABELS.length;
  answerPlan(app, plan);

  await app.get("runModelTestBatch")("letter");

  assert.deepEqual(turkishOn(app), []);
  const total = MANIFEST.letters.length;
  assert.equal(
    text(app, "modelTestSummary"),
    `${total - 2} of ${total} samples correct (${Math.round(((total - 2) / total) * 100)}%). ` +
      "Median time 0.6 ms. Preparing the model took 1.5 s; that time is not added to the samples' times. " +
      "1 sample did not run.",
  );
  const rows = rowCells(app);
  assert.deepEqual(rows[1], ["Letter B", "B", "B", "90%", "0.6 ms", "Correct"]);
  assert.equal(rows[0][5], "Wrong");
  assert.deepEqual(rows[3].slice(0, 3), [`Letter ${failed.expected_label}`, failed.expected_label, `Could not get Letter ${failed.expected_label} (HTTP 404)`]);
  assert.equal(rows[3][5], "Error");
  assert.deepEqual(missing(app), []);
});

test("a list with no samples says so in English", async () => {
  const emptyList = async (url) =>
    String(url).endsWith("model-test-samples/manifest.json") ? jsonResponse({ letters: [], words: [] }) : jsonResponse({}, 404);
  const app = loadWebApp({ languages: ENGLISH, globals: { console: quietConsole, fetch: emptyList } });
  app.evaluate(FAKE_ORT_SOURCE);
  await app.get("loadModelTestManifest")();

  assert.deepEqual(optionTexts(app), ["No ready-made letter samples"]);
  await app.get("loadAndRunPreferredModelTestSample")("word");
  assert.equal(text(app, "modelTestResultNote"), "No ready-made word sample was found.");
  await app.get("runModelTestBatch")("letter");
  assert.equal(text(app, "modelTestSummary"), "No samples to run were found.");
  assert.deepEqual(turkishOn(app), []);
});

test("local word samples keep their number and are marked local in English", async () => {
  const smoke = readJson("data/model-test-samples/words/word-give-smoke.json");
  const local = {
    words: [
      {
        id: "word-all-01",
        label: "all",
        title: "Kelime all #1",
        path: "./data/model-test-samples/local/word-all-01.json",
        expected_label: "all",
      },
    ],
  };
  // A development server: the only host the local folder can be served from.
  const app = loadWebApp({ languages: ENGLISH, globals: { console: quietConsole, location: new URL("http://localhost:8080/") } });
  app.evaluate(FAKE_ORT_SOURCE);
  routeFetch(app, (path) => {
    if (path.includes("local/manifest.json")) return jsonResponse(local);
    if (path.includes("local/word-all-01.json")) return jsonResponse({ ...smoke, expected_label: "all", expected_word: "all" });
    return undefined;
  });
  await app.get("loadModelTestManifest")();
  answerPlan(app, [WORD_INDEX.give, WORD_INDEX.all]);

  await app.get("runModelTestBatch")("word");

  assert.deepEqual(rowCells(app).map((row) => [row[0], row[5]]), [
    ["Word model smoke test", "Smoke test"],
    ["Word all #1 · Local", "Correct"],
  ]);
  assert.match(text(app, "modelTestSummary"), /^1 of 1 sample correct \(100%\)\./);
  assert.match(text(app, "modelTestSummary"), /Local samples belong to this computer only/);
  assert.deepEqual(turkishOn(app), []);
});

test("a switch while a result and a batch are shown rewrites them all, and back", async () => {
  const app = await modelTest(["tr-TR", "tr"]);
  const failed = MANIFEST.letters[3];
  routeFetch(app, (path) => (path.includes(failed.path.replace("./", "")) ? jsonResponse({}, 404) : undefined));
  answerPlan(app, expectedLetterIndices().filter((_, index) => index !== 3));
  await app.get("runModelTestBatch")("letter");
  app.evaluate(`__ort.answer = () => ${LETTER_LABELS.indexOf("A")}`);
  await app.get("loadAndRunPreferredModelTestSample")("letter");
  const turkish = panelText(app);
  assert.equal(text(app, "modelTestConfidence"), "%90");
  assert.equal(text(app, "modelTestFileName"), "Harf A");

  app.get("setLanguage")("en");
  assert.deepEqual(turkishOn(app), []);
  assert.equal(text(app, "modelTestConfidence"), "90%");
  assert.equal(text(app, "modelTestFileName"), "Letter A");
  assert.equal(text(app, "modelTestSampleStatus"), "Done");
  assert.equal(text(app, "modelTestMatchBadge"), "Match");
  assert.match(text(app, "modelTestResultNote"), /^The prediction matches the expected label/);
  const total = MANIFEST.letters.length;
  assert.match(text(app, "modelTestSummary"), new RegExp(`^${total - 1} of ${total} samples correct `));
  assert.equal(rowCells(app)[0][0], "Letter A");
  assert.equal(rowCells(app)[3][2], `Could not get Letter ${failed.expected_label} (HTTP 404)`);
  assert.equal(optionTexts(app)[0], "Letter A · expected 100%");

  app.get("setLanguage")("tr");
  assert.equal(panelText(app), turkish, "switching back must give the same Turkish panel");
  assert.deepEqual(missing(app), []);
});

test("a switch while the word sample is shown rewrites its frame count", async () => {
  const app = await modelTest(["tr-TR", "tr"]);
  await app.get("loadAndRunPreferredModelTestSample")("word");
  assert.equal(text(app, "modelTestMaskLabel"), "30/45 real frame");

  app.get("setLanguage")("en");
  assert.equal(text(app, "modelTestMaskLabel"), "30 of 45");
  assert.equal(text(app, "modelTestFileName"), "Word model smoke test");
  assert.deepEqual(turkishOn(app), []);
});

test("a switch while an error is shown explains it again in the new language", async () => {
  const app = await modelTest(["tr-TR", "tr"]);
  await app.get("readModelTestSampleFile")(file("short.json", { task: "word", features: [1, 2], mask: [] }));
  const turkish = text(app, "modelTestResultNote");
  assert.match(turkish, /^Kelime örneği 7560 sayı/);

  app.get("setLanguage")("en");
  assert.equal(text(app, "modelTestResultNote"), "A word sample must hold 7560 numbers (45 × 168); this file has 2.");
  assert.equal(text(app, "modelTestMatchBadge"), "Error");
  assert.deepEqual(turkishOn(app), []);

  app.get("setLanguage")("tr");
  assert.equal(text(app, "modelTestResultNote"), turkish);
});
