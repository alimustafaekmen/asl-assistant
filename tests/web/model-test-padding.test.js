// A word sample with no real frame is refused.
//
// The word model reads a mask where true marks a real frame. A mask that is
// all padding gives it nothing to look at, yet it would still return a word
// with a confidence, which the panel would then score as if it meant
// something. The fixture is refused when it is loaded, in words a visitor can
// act on, and the model is never reached.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { file, mask, text, wordVector } from "./helpers/model-test-panel.mjs";

const silentWord = () => file("silent.json", { task: "word", features: wordVector(), mask: mask(0) });

test("a word whose mask marks every frame as padding is explained in plain Turkish", async () => {
  const app = await appWithFakeOrt({ boot: true });

  await app.get("readModelTestSampleFile")(silentWord());

  assert.equal(text(app, "modelTestResultNote"), "Bu örnekte gerçek kare yok; kelime modeli çalıştırılamaz.");
  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
});

test("a word whose mask is all padding is refused before the model is touched", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const before = app.evaluate("__ort.created");

  await app.get("readModelTestSampleFile")(silentWord());
  await app.get("runModelTestSample")();

  assert.equal(app.evaluate("state.modelTestSample"), null, "the refused sample must not be kept as the loaded one");
  assert.equal(app.evaluate("__ort.runs"), 0, "no inference may run on a mask with no real frame");
  assert.equal(app.evaluate("__ort.created"), before, "not even a model session is needed");
});

test("a word with a single real frame is accepted", async () => {
  const app = await appWithFakeOrt({ boot: true });

  await app.get("readModelTestSampleFile")(file("one.json", { task: "word", features: wordVector(), mask: mask(1) }));

  assert.equal(app.evaluate("state.modelTestSample.maskLabel"), "1/45 real frame");
});
