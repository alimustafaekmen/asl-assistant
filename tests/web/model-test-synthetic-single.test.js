// A made-up sample run on its own must not claim the model got it right.
//
// The only word sample a clone or the live site ships is made up: seeded
// random numbers, not a recorded sign, whose "expected" word is whatever the
// model answered when the file was made. The run-all batch reports it as a
// pipeline check. The fault these tests kill is a single run that says
// "Eşleşti" and that the model chose the right class, at 8% confidence,
// right after "Kelime örneği dene"; and a fix so broad that a real sample
// stops being scored. ONNX Runtime is faked at its boundary; the manifest
// and the fixtures are the real files.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS, WORD_INDEX, appWithFakeOrt, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { MANIFEST, match, readJson, text } from "./helpers/model-test-panel.mjs";

test("the made-up word sample, run on its own, is shown as a pipeline check", async () => {
  const app = await appWithFakeOrt({ boot: true });
  // The model gives the answer recorded as "expected" in the file.
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);

  await app.get("loadAndRunPreferredModelTestSample")("word");

  assert.equal(text(app, "modelTestPredictedLabel"), "give", "precondition: the model ran and answered");
  assert.equal(text(app, "modelTestMatchBadge"), "Çalışma kontrolü");
  assert.equal(match(app), "unknown", "a made-up input is neither a match nor a miss");
  assert.equal(text(app, "modelTestExpectedLabel"), "Referans yok", "the model's own old answer is no reference");
  const note = text(app, "modelTestResultNote");
  assert.match(note, /gerçek bir işaret kaydı değil/);
  assert.match(note, /doğruluk ölçmez/);
  assert.doesNotMatch(note, /doğru sınıfı|eşleşti/i);
});

test("a recorded sample run on its own is still scored", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const sample = MANIFEST.letters.find((item) => item.id === "letter-a");
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf(sample.expected_label)}`);

  await app.get("loadAndRunPreferredModelTestSample")("letter");

  assert.equal(text(app, "modelTestMatchBadge"), "Eşleşti");
  assert.equal(match(app), "yes");
  assert.equal(text(app, "modelTestExpectedLabel"), "A");
});

test("the run-all line promises a count only when there is something to count", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.get("setModelTestTask")("word");
  const onlyMadeUp = text(app, "modelTestBatchHint");
  assert.doesNotMatch(onlyMadeUp, /kaçının doğru olduğunu sayar/, "every published word sample is made up");
  assert.match(onlyMadeUp, /doğruluk sayılmaz/);

  app.get("setModelTestTask")("letter");
  assert.match(text(app, "modelTestBatchHint"), /kaçının doğru olduğunu sayar/, "letters are recorded samples");

  // With a recorded word sample present, as on a machine holding the local
  // competition fixtures, the word line counts again.
  const recorded = { ...MANIFEST.words[0], id: "word-recorded", kind: undefined };
  const local = await appWithFakeOrt();
  routeFetch(local, (path) => {
    if (path.includes("model-test-samples/manifest.json") && !path.includes("/local/")) {
      return jsonResponse({ ...MANIFEST, words: [recorded] });
    }
    return undefined;
  });
  await local.get("loadModelTestManifest")();
  local.get("setModelTestTask")("word");
  assert.match(text(local, "modelTestBatchHint"), /kaçının doğru olduğunu sayar/);
});

test("the made-up sample is named for what it is", () => {
  const smoke = MANIFEST.words.find((item) => item.kind === "deterministic-smoke");
  assert.ok(smoke, "precondition: the published word sample is marked as made up");
  assert.doesNotMatch(smoke.title, /smoke|give/i, "the list shows it as a word sample of 'give'");
  assert.equal(readJson(smoke.path.replace(/^\.\//, "")).expected_label, "give", "the file itself is unchanged");
});
