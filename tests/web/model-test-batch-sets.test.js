// What a Model Test batch may claim about the samples it ran.
//
// Not every bundled sample measures the model. The word sample a clone ships is
// a made-up input that proves the pipeline runs end to end, and answering it
// "correctly" says nothing about accuracy. The word samples cut from the
// competition data exist only on the owner's computer, and the rules of that
// competition forbid publishing them, so the panel has to say which samples
// those are. ONNX Runtime and the network are faked; the manifest shapes are
// the ones the app reads, and the fixtures are the real files.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS, WORD_INDEX, appWithFakeOrt, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { MANIFEST, answerPlan, batchOf, readJson, shownRows, summaryText } from "./helpers/model-test-panel.mjs";

const PUBLISHED = "data/model-test-samples/manifest.json";
const LOCAL = "data/model-test-samples/local/manifest.json";
const SMOKE_WORD = readJson("data/model-test-samples/words/word-give-smoke.json");

/** An unbooted app whose manifests are the ones given; the fixtures come from disk. */
async function appWithManifests({ published, local, localFixtures = {} }) {
  const app = await appWithFakeOrt();
  routeFetch(app, (path) => {
    if (path.includes(PUBLISHED)) return jsonResponse(published);
    if (path.includes(LOCAL)) return local ? jsonResponse(local) : jsonResponse({}, 404);
    for (const [fixturePath, body] of Object.entries(localFixtures)) {
      if (path.includes(fixturePath)) return jsonResponse(body);
    }
    return undefined;
  });
  await app.get("loadModelTestManifest")();
  return app;
}

test("a made-up sample runs but does not count towards accuracy", async () => {
  const [a, b, c] = MANIFEST.letters;
  const published = { letters: [a, b, { ...c, kind: "deterministic-smoke" }], words: [] };
  const app = await appWithManifests({ published });
  answerPlan(app, [0, 1, 2].map((index) => LETTER_LABELS.indexOf(MANIFEST.letters[index].expected_label)));

  await app.get("runModelTestBatch")("letter");

  const { rows, summary } = batchOf(app);
  assert.deepEqual(rows.map((row) => row.synthetic), [false, false, true]);
  assert.equal(rows[2].verdict, "correct", "it did run, and the model did answer it");
  assert.equal(summary.total, 3);
  assert.equal(summary.counted, 2, "the made-up sample is not evidence of accuracy");
  assert.equal(summary.correct, 2);
  assert.match(summaryText(app), /^2 örnekten 2 tanesi doğru \(%100\)\./);
  assert.equal(shownRows(app)[2].cells.at(-1), "Çalışma kontrolü", "not 'Doğru'");
});

test("when only made-up samples ran, no accuracy is claimed", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);

  await app.get("runModelTestBatch")("word");

  const { rows, summary } = batchOf(app);
  assert.equal(rows.length, 1, "a clone's only word sample is the made-up one");
  assert.equal(rows[0].synthetic, true);
  assert.equal(summary.counted, 0);
  assert.equal(summary.accuracy, null, "1 of 1 would be a claim the sample cannot support");
  assert.match(summaryText(app), /yapay/);
  assert.doesNotMatch(summaryText(app), /tanesi doğru/);
});

const localItem = (id, label) => ({
  id,
  label,
  title: `Kelime ${label}`,
  path: `./data/model-test-samples/local/${id}.json`,
  expected_label: label,
});
const localFixture = (label) => ({ ...SMOKE_WORD, sample_id: label, expected_label: label, expected_word: label });

test("samples from the local competition folder are marked as local-only", async () => {
  const published = { letters: [], words: MANIFEST.words };
  const local = { words: [localItem("word-all-01", "all"), localItem("word-bird-01", "bird")] };
  const app = await appWithManifests({
    published,
    local,
    localFixtures: {
      "local/word-all-01.json": localFixture("all"),
      "local/word-bird-01.json": localFixture("bird"),
    },
  });
  answerPlan(app, [WORD_INDEX.give, WORD_INDEX.all, WORD_INDEX.bird]);

  await app.get("runModelTestBatch")("word");

  const { rows, summary } = batchOf(app);
  assert.deepEqual(rows.map((row) => row.id), ["word-give-smoke", "word-all-01", "word-bird-01"]);
  assert.deepEqual(rows.map((row) => row.local), [false, true, true]);
  assert.equal(summary.hasLocal, true);
  assert.equal(summary.counted, 2, "the local samples are real recordings and count");
  // A row carries the mark only when it is local; the others have no attribute.
  assert.deepEqual(shownRows(app).map((row) => row.local), [undefined, "true", "true"]);
  assert.match(summaryText(app), /Yerel örnekler bu bilgisayara özeldir/);
});

test("a clone without the local folder shows no local mark and no local note", async () => {
  const app = await appWithManifests({ published: { letters: [], words: MANIFEST.words } });
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);

  await app.get("runModelTestBatch")("word");

  const { rows, summary } = batchOf(app);
  assert.equal(rows.some((row) => row.local), false);
  assert.equal(summary.hasLocal, false);
  assert.doesNotMatch(summaryText(app), /Yerel/);
});

test("the sample picker marks the local samples too", async () => {
  const local = { words: [localItem("word-all-01", "all")] };
  const app = await appWithManifests({ published: { letters: [], words: MANIFEST.words }, local });

  app.get("setModelTestTask")("word");

  const marks = JSON.parse(
    app.evaluate("JSON.stringify(Array.from(els.modelTestSampleSelect.options, (o) => [o.dataset.sampleId, o.dataset.local ?? '']))"),
  );
  assert.deepEqual(marks, [
    ["word-give-smoke", ""],
    ["word-all-01", "true"],
  ]);
});
