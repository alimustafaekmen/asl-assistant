// A Model Test run answers the sample it was started for.
//
// The first run of a model waits for a download that can take seconds. In that
// time the visitor may pick another sample or press Run again. The answer of
// the run that was waiting belongs to the sample it started with: written
// under another sample's name, or computed twice, the panel would claim
// something it did not measure. ONNX Runtime is the boundary and is faked
// (helpers/fake-ort.mjs), with the model creation held back to open the window.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { letterItem, match, text } from "./helpers/model-test-panel.mjs";

test("a sample loaded while a run waits for the model does not receive that run's answer", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const a = letterItem("A");
  const b = letterItem("B");
  app.evaluate("__ort.chosen = 0");
  await app.get("loadModelTestSampleFromUrl")(a.path, a.title);

  app.evaluate("__ort.hold()");
  const pending = app.get("runModelTestSample")();
  await flush(20);
  await app.get("loadModelTestSampleFromUrl")(b.path, b.title);
  assert.equal(text(app, "modelTestExpectedLabel"), "B", "precondition: the panel now shows sample B");
  app.evaluate("__ort.release()");
  await pending;
  await flush(20);

  assert.equal(text(app, "modelTestExpectedLabel"), "B");
  assert.equal(text(app, "modelTestPredictedLabel"), "-", "A's answer was written under B");
  assert.equal(text(app, "modelTestConfidence"), "-");
  assert.equal(match(app), "unknown");
  assert.equal(app.evaluate("els.runModelTestSample.disabled"), false, "the Run button belongs to sample B");
});

test("pressing Run twice while the model is loading runs the sample once", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const item = letterItem("D");
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf("D")}`);
  await app.get("loadModelTestSampleFromUrl")(item.path, item.title);

  app.evaluate("__ort.hold()");
  const first = app.get("runModelTestSample")();
  const second = app.get("runModelTestSample")();
  await flush(20);
  app.evaluate("__ort.release()");
  await Promise.all([first, second]);

  assert.equal(app.evaluate("__ort.runs"), 1, "one press, one inference");
  assert.equal(text(app, "modelTestPredictedLabel"), "D");
});

test("an answer that arrives after another sample was picked is dropped, also with the model already loaded", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const a = letterItem("A");
  const b = letterItem("B");
  await app.get("loadModelTestSampleFromUrl")(a.path, a.title);
  await app.get("runModelTestSample")();
  assert.equal(text(app, "modelTestPredictedLabel"), "A", "precondition: the model is loaded and answers");

  app.evaluate("__ort.holdRuns()");
  const pending = app.get("runModelTestSample")();
  await flush(20);
  await app.get("loadModelTestSampleFromUrl")(b.path, b.title);
  app.evaluate("__ort.releaseRuns()");
  await pending;
  await flush(20);

  assert.equal(text(app, "modelTestExpectedLabel"), "B");
  assert.equal(text(app, "modelTestPredictedLabel"), "-", "the answer to A was written under B");
  assert.equal(match(app), "unknown");
});

test("a run whose sample was replaced during the download does not spend an inference", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const a = letterItem("A");
  const b = letterItem("B");
  await app.get("loadModelTestSampleFromUrl")(a.path, a.title);

  app.evaluate("__ort.hold()");
  const pending = app.get("runModelTestSample")();
  await flush(20);
  await app.get("loadModelTestSampleFromUrl")(b.path, b.title);
  app.evaluate("__ort.release()");
  await pending;
  await flush(20);

  assert.equal(app.evaluate("__ort.runs"), 0, "nobody asked for an answer to A any more");
});

test("pressing Run for a new sample while the old one's run waits starts the new sample's own run", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const a = letterItem("A");
  const b = letterItem("B");
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf("B")}`);
  await app.get("loadModelTestSampleFromUrl")(a.path, a.title);

  app.evaluate("__ort.hold()");
  const first = app.get("runModelTestSample")();
  await flush(20);
  await app.get("loadModelTestSampleFromUrl")(b.path, b.title);
  const second = app.get("runModelTestSample")();
  app.evaluate("__ort.release()");
  await Promise.all([first, second]);
  await flush(20);

  assert.equal(text(app, "modelTestExpectedLabel"), "B");
  assert.equal(text(app, "modelTestPredictedLabel"), "B", "the press for sample B was swallowed by A's run");
  assert.equal(match(app), "yes");
  assert.equal(app.evaluate("__ort.runs"), 1);
});
