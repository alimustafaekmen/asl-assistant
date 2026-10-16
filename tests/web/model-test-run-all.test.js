// The "Tümünü çalıştır" button of the Model Test screen.
//
// The batch run itself is covered in model-test-batch*.test.js by calling
// runModelTestBatch. What a visitor touches is the button, so these tests press
// it on the real markup and read what the screen then shows.
//
// The faults they kill:
// - the button is not bound, or is bound to a fixed model, so the word tab
//   would run the letters;
// - the results stay hidden after a run;
// - the note under the results speaks of the wrong model, or of both. The
//   letter samples come from the training photos and the word samples are not
//   published, and each model's note must say its own.
//
// ONNX Runtime and the clock are the boundaries and are faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { MANIFEST, answerPlan, expectedLetterIndices, shownRows } from "./helpers/model-test-panel.mjs";

/** The element the visitor presses or reads; a missing id fails with its name. */
function element(app, id) {
  const found = app.evaluate(`document.getElementById("${id}")`);
  assert.ok(found, `the screen has no #${id}`);
  return found;
}

const press = (app, id) => element(app, id).dispatchEvent({ type: "click", detail: 1 });

/** Wait for the batch the button started to end, with a bound so a dead button fails. */
async function untilSettled(app) {
  for (let turn = 0; turn < 500; turn += 1) {
    const status = app.evaluate("state.modelTestBatch?.status ?? ''");
    if (status === "done" || status === "error") return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("pressing the button did not run a batch");
}

const visible = (app, id) => element(app, id).hidden === false;

test("Tümünü çalıştır runs every letter sample and shows the results", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, expectedLetterIndices());

  press(app, "runModelTestBatch");
  await untilSettled(app);

  assert.equal(app.evaluate("state.modelTestBatch.task"), "letter");
  assert.equal(app.evaluate("__ort.runs"), MANIFEST.letters.length);
  assert.equal(visible(app, "modelTestBatch"), true, "the results stay hidden after a run");
  assert.equal(shownRows(app).length, MANIFEST.letters.length);
});

test("Tümünü çalıştır runs the model that is selected, not always the letters", async () => {
  const app = await appWithFakeOrt({ boot: true });
  app.get("setModelTestTask")("word");

  press(app, "runModelTestBatch");
  await untilSettled(app);

  assert.equal(app.evaluate("state.modelTestBatch.task"), "word");
});

test("the note under the results speaks of the model that ran and of no other", async () => {
  const app = await appWithFakeOrt({ boot: true });
  answerPlan(app, expectedLetterIndices());

  press(app, "runModelTestBatch");
  await untilSettled(app);
  assert.equal(visible(app, "modelTestNoteLetter"), true);
  assert.equal(visible(app, "modelTestNoteWord"), false, "the word note under letter results");

  app.get("setModelTestTask")("word");
  press(app, "runModelTestBatch");
  await untilSettled(app);
  assert.equal(visible(app, "modelTestNoteWord"), true);
  assert.equal(visible(app, "modelTestNoteLetter"), false, "the letter note under word results");
});

test("the line under the button names the model it will run", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const hint = () => element(app, "modelTestBatchHint").textContent;

  assert.match(hint(), /^Harf modelinin/);
  app.get("setModelTestTask")("word");
  assert.match(hint(), /^Kelime modelinin/);
  app.get("setModelTestTask")("letter");
  assert.match(hint(), /^Harf modelinin/);
});
