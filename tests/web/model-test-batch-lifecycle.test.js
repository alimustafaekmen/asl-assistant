// How a Model Test batch behaves while things change around it.
//
// A batch is slow: it waits for the sample list, for the model, and then for
// every sample in turn. In that time the visitor can press the button again,
// switch from letters to words, or arrive on the page before the list has
// loaded. The numbers on screen must always belong to the samples they claim,
// and the camera, which this screen never needs, must stay off. ONNX Runtime,
// the network and the camera API are the boundaries and are faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WORD_INDEX, appWithFakeOrt, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { MANIFEST, answerPlan, batchOf, expectedLetterIndices, summaryText } from "./helpers/model-test-panel.mjs";

const PUBLISHED = "data/model-test-samples/manifest.json";
const LETTER_COUNT = MANIFEST.letters.length;

/** A promise the test settles by hand. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("a run started before the sample list has loaded waits for it instead of finding no samples", async () => {
  const app = await appWithFakeOrt();
  const manifest = gate();
  routeFetch(app, (path) => (path.includes(PUBLISHED) ? manifest.promise : undefined));
  answerPlan(app, expectedLetterIndices());

  const run = app.get("runModelTestBatch")("letter");
  await flush(20);
  manifest.open(jsonResponse(MANIFEST));
  await run;

  const batch = batchOf(app);
  assert.equal(batch.status, "done");
  assert.equal(batch.rows.length, LETTER_COUNT);
  assert.doesNotMatch(summaryText(app), /bulunamadı/);
});

test("pressing the button again while a batch runs does not run the samples twice", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, expectedLetterIndices());

  app.evaluate("__ort.hold()");
  const first = app.get("runModelTestBatch")("letter");
  const second = app.get("runModelTestBatch")("letter");
  await flush(20);
  app.evaluate("__ort.release()");
  await Promise.all([first, second]);

  assert.equal(app.evaluate("__ort.runs"), LETTER_COUNT, "one inference per sample, not two");
  assert.equal(batchOf(app).rows.length, LETTER_COUNT);
});

test("switching the kind clears the results of the other kind", async () => {
  const app = await appWithFakeOrt({ boot: true });
  await app.get("runModelTestBatch")("letter");
  assert.equal(batchOf(app).status, "done", "precondition: letters have results");

  app.get("setModelTestTask")("word");

  assert.equal(app.evaluate("state.modelTestBatch"), null);
  assert.equal(summaryText(app), "");
  assert.equal(app.evaluate("els.modelTestBatch.hidden"), true);
  assert.equal(app.evaluate("els.modelTestRows.children.length"), 0);
});

test("choosing the kind that is already shown keeps its results", async () => {
  const app = await appWithFakeOrt({ boot: true });
  await app.get("runModelTestBatch")("letter");

  app.get("setModelTestTask")("letter");

  assert.equal(batchOf(app).status, "done");
  assert.equal(batchOf(app).rows.length, LETTER_COUNT);
});

test("a run that was under way when the kind changed never shows its results", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate("__ort.hold()");
  const letters = app.get("runModelTestBatch")("letter");
  await flush(20);

  app.get("setModelTestTask")("word");
  app.evaluate("__ort.release()");
  await letters;
  await flush(20);

  assert.equal(app.evaluate("state.modelTestBatch"), null, "letter rows under the word tab");
  assert.equal(app.evaluate("__ort.runs"), 0, "no sample of the abandoned run was run");
  assert.equal(summaryText(app), "");
});

test("after a kind change the new kind can be run while the abandoned run is still pending", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);
  app.evaluate("__ort.hold()");
  const letters = app.get("runModelTestBatch")("letter");
  await flush(20);

  const words = app.get("runModelTestBatch")("word");
  app.evaluate("__ort.release()");
  await Promise.all([letters, words]);
  await flush(20);

  const batch = batchOf(app);
  assert.equal(batch.task, "word");
  assert.equal(batch.status, "done");
  assert.ok(batch.rows.length >= 1);
});

test("running the samples never starts the camera or loads a MediaPipe task", async () => {
  let cameraRequests = 0;
  const navigator = {
    mediaDevices: {
      getUserMedia: async () => {
        cameraRequests += 1;
        throw new Error("the camera must stay off on this screen");
      },
    },
  };
  const app = await appWithFakeOrt({ boot: true, globals: { navigator } });
  app.evaluate(`__ort.chosen = ${WORD_INDEX.give}`);

  await app.get("runModelTestBatch")("letter");
  await app.get("runModelTestBatch")("word");

  assert.equal(cameraRequests, 0);
  assert.equal(app.evaluate("state.cameraOn"), false);
  const mediapipe = app.requests.filter((path) => /\.task\b|mediapipe|tasks-vision/i.test(path));
  assert.deepEqual(mediapipe, [], "no MediaPipe file or library may be requested");
});

test("an abandoned run stops after the sample it has in hand", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate("__ort.holdRuns()");
  const letters = app.get("runModelTestBatch")("letter");
  await flush(30);
  assert.equal(app.evaluate("__ort.runs"), 1, "precondition: the first sample is being answered");

  app.get("setModelTestTask")("word");
  app.evaluate("__ort.releaseRuns()");
  await letters;
  await flush(20);

  assert.equal(app.evaluate("__ort.runs"), 1, "the other 23 samples must not run for a screen nobody is on");
  assert.equal(app.evaluate("state.modelTestBatch"), null);
});
