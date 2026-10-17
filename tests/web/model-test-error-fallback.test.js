// What the Model Test panel says when something other than the file fails.
//
// A wrong file is explained in plain Turkish (model-test-error-copy). The
// fault these tests kill is the other path: any error that was not a file
// error went to the visitor as it was, so the panel could show "Failed to
// fetch" or a raw ONNX Runtime message. A lost connection must be explained
// as one, anything else with a plain message addressed as siz, and the raw
// text kept for the console.
//
// ONNX Runtime and the network are the boundaries faked here (helpers/
// fake-ort.mjs); everything else is the booted app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MANIFEST, batchOf, file, mask, text, wordVector } from "./helpers/model-test-panel.mjs";
import { appWithFakeOrt, routeFetch } from "./helpers/fake-ort.mjs";

const CONNECTION = "Örnek indirilemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.";
const GENERIC = "Model çalıştırılamadı. Sayfayı yenileyip yeniden deneyin.";

/** The booted app with every console.error kept, as text. */
async function bootedApp() {
  const errors = [];
  const quiet = { ...console, log() {}, warn() {}, info() {}, error: (...args) => errors.push(args.map(String).join(" ")) };
  const app = await appWithFakeOrt({ boot: true, globals: { console: quiet } });
  return { app, errors };
}

test("a fixture that cannot be downloaded is explained as a connection problem", async () => {
  const { app, errors } = await bootedApp();
  app.get("globalThis").fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  await app.get("loadModelTestSampleFromUrl")("./data/model-test-samples/letters/a.json", "A");

  assert.equal(text(app, "modelTestResultNote"), CONNECTION);
  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  assert.ok(errors.some((line) => line.includes("Failed to fetch")), "the raw error is kept for the console");
});

test("a model run that fails shows a plain message, not the runtime's text", async () => {
  const { app, errors } = await bootedApp();
  await app.get("readModelTestSampleFile")(file("word.json", { task: "word", features: wordVector(), mask: mask(30) }));
  app.evaluate("__ort.failRun = () => true");

  await app.get("runModelTestSample")();

  assert.equal(text(app, "modelTestResultNote"), GENERIC);
  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  assert.ok(errors.some((line) => line.includes("the model run failed in the test")), "the raw error is kept for the console");
});

test("a batch sample that cannot be downloaded is a connection problem in its row", async () => {
  const { app } = await bootedApp();
  const missing = MANIFEST.letters[2];
  routeFetch(app, (path) => (path.includes(missing.path.replace("./", "")) ? Promise.reject(new TypeError("Failed to fetch")) : undefined));

  await app.get("runModelTestBatch")("letter");

  const { rows } = batchOf(app);
  assert.equal(rows[2].verdict, "error");
  assert.equal(rows[2].error, CONNECTION);
});

test("a batch sample whose run fails shows the plain message in its row", async () => {
  const { app } = await bootedApp();
  app.evaluate("__ort.failRun = () => true");

  await app.get("runModelTestBatch")("word");

  const { rows } = batchOf(app);
  assert.equal(rows[0].verdict, "error");
  assert.equal(rows[0].error, GENERIC);
});
