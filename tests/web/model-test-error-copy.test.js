// What the Model Test panel says when a file is wrong.
//
// The validator keeps its technical messages (model-test-fixtures.test.js
// reads them); the panel shows plain Turkish built from what was wrong, with
// the counts a visitor needs to fix the file. The raw parser text of a
// JSON.parse failure is not a message for a visitor at all.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { file, letterVector, mask, text, wordVector } from "./helpers/model-test-panel.mjs";

const PLAIN_ERRORS = [
  ["not JSON", () => "{ not json", "Dosya okunamadı: geçerli bir JSON değil."],
  ["a JSON value that is not an object", () => "5", "Bu dosyada örnek verisi bulunamadı."],
  ["an object with no features", () => ({}), "Bu dosyada örnek verisi bulunamadı."],
  [
    "a letter with 92 numbers",
    () => ({ features: letterVector(92) }),
    "Harf örneği 93 sayı içermeli; bu dosyada 92 sayı var.",
  ],
  [
    "a word with too few numbers",
    () => ({ task: "word", features: wordVector(100), mask: mask(30) }),
    "Kelime örneği 7560 sayı (45 × 168) içermeli; bu dosyada 100 var.",
  ],
  [
    "a word mask of 30 entries",
    () => ({ task: "word", features: wordVector(), mask: mask(20, 30) }),
    "Maske 45 değer içermeli; bu dosyada 30 var.",
  ],
  [
    "a mask entry that is neither true nor false",
    () => ({ task: "word", features: wordVector(), mask: [2, ...mask(30).slice(1)] }),
    "Maske yalnızca doğru/yanlış (true/false ya da 1/0) değerleri içerebilir.",
  ],
  [
    "a feature that is not a number",
    () => ({ features: [...letterVector(92), "abc"] }),
    "Dosyada sayı olmayan bir değer var.",
  ],
];

for (const [name, build, expected] of PLAIN_ERRORS) {
  test(`${name} is explained in plain Turkish`, async () => {
    const app = await appWithFakeOrt({ boot: true });

    await app.get("readModelTestSampleFile")(file("sample.json", build()));

    assert.equal(text(app, "modelTestResultNote"), expected);
    assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  });
}

test("a fixture fetched by URL that fails validation is explained the same way", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const short = { ok: true, status: 200, json: async () => ({ features: letterVector(92) }) };
  app.get("globalThis").fetch = async () => short;

  await app.get("loadModelTestSampleFromUrl")("./data/model-test-samples/letters/short.json", "short");

  assert.equal(text(app, "modelTestResultNote"), "Harf örneği 93 sayı içermeli; bu dosyada 92 sayı var.");
});

test("running with no sample loaded asks for one, addressing the visitor as siz", async () => {
  const app = await appWithFakeOrt({ boot: true });

  await app.get("runModelTestSample")();

  assert.equal(text(app, "modelTestResultNote"), "Önce bir örnek seçin ya da JSON dosyası yükleyin.");
  assert.equal(app.evaluate("__ort.created"), 0);
});
