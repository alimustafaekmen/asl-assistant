// A Model Test failure does not leave the last answer on screen.
//
// After a good run the panel shows a prediction, its confidence and a ranked
// list. If the next file is unreadable, or the next run fails, the badge says
// "Hata" but the old answer used to stay beside it, so a visitor read A at
// 100 % as the outcome of a file that never ran. ONNX Runtime is the boundary
// and is faked (helpers/fake-ort.mjs); the panel itself is the real one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { file, rankedRows, runBundledLetter, text } from "./helpers/model-test-panel.mjs";

test("an unreadable file clears the previous run's answer instead of leaving it beside 'Hata'", async () => {
  const app = await appWithFakeOrt({ boot: true });
  await runBundledLetter(app, "A");
  assert.equal(text(app, "modelTestPredictedLabel"), "A", "precondition: the run showed its answer");
  assert.equal(text(app, "modelTestConfidence"), "%90", "precondition: and its confidence");

  await app.get("readModelTestSampleFile")(file("broken.json", "{ not json"));

  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  assert.equal(text(app, "modelTestPredictedLabel"), "-");
  assert.equal(text(app, "modelTestConfidence"), "-");
  assert.equal(text(app, "modelTestLatency"), "-");
  assert.ok(
    rankedRows(app).every((row) => !row.includes("A")),
    `the ranked list still names the old answer: ${rankedRows(app).join(" | ")}`,
  );
});

test("a run that fails clears the previous answer of the same sample", async () => {
  const app = await appWithFakeOrt({ boot: true });
  await runBundledLetter(app, "C");
  assert.equal(text(app, "modelTestPredictedLabel"), "C");

  app.evaluate("__ort.failRun = () => true");
  await app.get("runModelTestSample")();

  assert.equal(text(app, "modelTestMatchBadge"), "Hata");
  assert.equal(text(app, "modelTestPredictedLabel"), "-");
  assert.equal(text(app, "modelTestConfidence"), "-");
});
