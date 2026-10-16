// The Model Test batch run: every sample of a kind, one row each, and an
// honest summary.
//
// The screen is the app's proof that the published models work without a
// camera. One sample at a time shows that a model can be right; running all of
// them and counting is what says how often. The numbers have to be the model's
// own: a wrong answer must show as wrong, a failed sample must not vanish from
// the count, and the time of loading the model must not pass as the time of an
// inference. ONNX Runtime and the clock are the boundaries and are faked
// (helpers/fake-ort.mjs); the manifest, the fixtures and the panel are real.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS, WORD_INDEX, appWithFakeOrt, fakeClock, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import {
  MANIFEST,
  answerPlan,
  batchOf,
  expectedLetterIndices,
  shownRows,
  summaryText,
} from "./helpers/model-test-panel.mjs";

const LETTER_COUNT = MANIFEST.letters.length;

/** The model's answers: every letter right except the ones in `wrong`. */
function planWithWrong(...wrong) {
  const plan = expectedLetterIndices();
  for (const index of wrong) plan[index] = (plan[index] + 1) % LETTER_LABELS.length;
  return plan;
}

test("every letter sample runs once, in manifest order, with its own expected and predicted letter", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, planWithWrong(2, 5));

  await app.get("runModelTestBatch")("letter");

  const batch = batchOf(app);
  assert.equal(batch.status, "done");
  assert.equal(batch.task, "letter");
  assert.deepEqual(
    batch.rows.map((row) => row.id),
    MANIFEST.letters.map((item) => item.id),
    "one row per sample, in the manifest's order",
  );
  assert.equal(app.evaluate("__ort.runs"), LETTER_COUNT, "one inference per sample");

  const right = batch.rows[0];
  assert.equal(right.expected, "A");
  assert.equal(right.predicted, "A");
  assert.equal(right.verdict, "correct");
  assert.ok(Math.abs(right.confidence - 0.9) < 1e-6, `confidence ${right.confidence}`);

  const wrong = batch.rows[2];
  assert.equal(wrong.expected, MANIFEST.letters[2].expected_label);
  assert.equal(wrong.predicted, LETTER_LABELS[planWithWrong(2)[2]]);
  assert.equal(wrong.verdict, "wrong", "a wrong answer must not be scored as a match");
});

test("the summary counts what the model got right, not what it ran", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, planWithWrong(2, 5));

  await app.get("runModelTestBatch")("letter");

  const { summary } = batchOf(app);
  assert.equal(summary.total, LETTER_COUNT);
  assert.equal(summary.counted, LETTER_COUNT);
  assert.equal(summary.correct, LETTER_COUNT - 2);
  assert.ok(Math.abs(summary.accuracy - (LETTER_COUNT - 2) / LETTER_COUNT) < 1e-12);
  assert.match(summaryText(app), /^24 örnekten 22 tanesi doğru \(%92\)\./);
});

test("each shown row carries its expected and predicted letter, its confidence and its verdict", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, planWithWrong(2));

  await app.get("runModelTestBatch")("letter");

  const rows = shownRows(app);
  assert.equal(rows.length, LETTER_COUNT);
  assert.equal(rows[0].verdict, "correct");
  assert.deepEqual(rows[0].cells.slice(1, 4), ["A", "A", "%90"]);
  assert.equal(rows[0].cells.at(-1), "Doğru");
  assert.equal(rows[2].verdict, "wrong");
  assert.equal(rows[2].cells[1], "C");
  assert.equal(rows[2].cells[2], LETTER_LABELS[planWithWrong(2)[2]]);
  assert.equal(rows[2].cells.at(-1), "Yanlış");
});

test("model preparation is reported apart from the time of an inference", async () => {
  const { globals } = fakeClock();
  const app = await appWithFakeOrt({ boot: true, globals });
  // Creating the model takes two seconds of the clock; each inference one millisecond.
  app.evaluate("__ort.createMs = 2000; __ort.runMs = 1;");

  await app.get("runModelTestBatch")("letter");

  const { summary, rows } = batchOf(app);
  assert.equal(summary.prepMs, 2000, "the download and session creation are reported once, on their own");
  assert.deepEqual(new Set(rows.map((row) => row.ms)), new Set([1]), "no row carries the model's preparation");
  assert.equal(summary.medianMs, 1);
  assert.match(summaryText(app), /Model hazırlığı 2 sn/);

  // The model is ready now, so a second run has nothing to prepare.
  await app.get("runModelTestBatch")("letter");
  assert.equal(batchOf(app).summary.prepMs, null);
  assert.doesNotMatch(summaryText(app), /Model hazırlığı/);
});

test("the typical time is the median, so one slow inference does not stand for all", async () => {
  const { globals } = fakeClock();
  const app = await appWithFakeOrt({ boot: true, globals });
  app.evaluate(`__ort.runMs = (n) => (n === ${LETTER_COUNT} ? 100 : 1);`);

  await app.get("runModelTestBatch")("letter");

  const { summary } = batchOf(app);
  assert.equal(summary.medianMs, 1, "the mean would be about 5");
  assert.match(summaryText(app), /Ortanca süre 1 ms/);
});

test("a sample the model could not answer is a failed row that still counts against accuracy", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate("__ort.failRun = (n) => n === 3;");
  answerPlan(app, planWithWrong());

  await app.get("runModelTestBatch")("letter");

  const { rows, summary } = batchOf(app);
  assert.equal(rows[2].verdict, "error");
  assert.equal(rows[2].predicted, "");
  assert.equal(rows[2].ms, null);
  assert.match(rows[2].error, /tahmin/);
  assert.equal(summary.failed, 1);
  assert.equal(summary.counted, LETTER_COUNT, "dropping it would make the model look better than it is");
  assert.equal(summary.correct, LETTER_COUNT - 1);
  assert.equal(shownRows(app)[2].cells.at(-1), "Hata");
  assert.match(summaryText(app), /1 örnek çalışmadı/);
});

test("a sample that cannot be fetched is a failed row, and the run goes on", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const missing = MANIFEST.letters[3];
  routeFetch(app, (path) => (path.includes(missing.path.replace("./", "")) ? jsonResponse({}, 404) : undefined));
  // The missing sample is never run, so the model's answers skip its place.
  answerPlan(app, expectedLetterIndices().filter((_, index) => index !== 3));

  await app.get("runModelTestBatch")("letter");

  const { rows, summary } = batchOf(app);
  assert.equal(rows.length, LETTER_COUNT);
  assert.equal(rows[3].verdict, "error");
  assert.match(rows[3].error, /alınamadı \(HTTP 404\)/);
  assert.equal(rows[4].verdict, "correct", "the next sample still ran");
  assert.equal(summary.failed, 1);
});

test("a model that cannot be loaded ends the run with one plain message and no rows", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate("__ort.fail = true");

  await app.get("runModelTestBatch")("letter");

  const batch = batchOf(app);
  assert.equal(batch.status, "error");
  assert.deepEqual(batch.rows, []);
  assert.equal(batch.summary, null);
  assert.equal(summaryText(app), "Harf modeli yüklenemedi");
});

test("the word model runs the word samples with the shape it was published with", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);

  await app.get("runModelTestBatch")("word");

  const { task, rows } = batchOf(app);
  assert.equal(task, "word");
  assert.ok(rows.length >= 1, "a clone bundles at least the deterministic word sample");
  assert.equal(rows[0].predicted, "give");
  const fed = app.evaluate("__ort.feeds.at(-1)");
  assert.equal(fed.input.dims.join("x"), "1x45x168");
  assert.equal(fed.mask.data.length, 45);
});
