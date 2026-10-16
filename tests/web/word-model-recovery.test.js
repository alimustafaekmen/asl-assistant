// One failed word-model run costs one recording, not word mode.
//
// The word graph's mask input takes one element type, which varies by export,
// so the adapter tries bool, uint8 and int64 until the session accepts one. A
// run that throws for another reason (a WASM hiccup, during warmup or a real
// recording) is not a dtype rejection. The fault this kills is such a run
// walking the remembered mask type to the end of the list: every later run
// then sends int64 to a graph that wants bool, and no word can be recognised
// until the page is reloaded.
//
// The recording runs through the app's own flow; only ONNX Runtime and the
// MediaPipe results are faked (helpers/word-recording.mjs). The fake session
// rejects any mask that is not bool, as such an export does.

import assert from "node:assert/strict";
import { test } from "node:test";

import { recordWord, wordModeApp } from "./helpers/word-recording.mjs";

/** A word app whose model wants a bool mask and throws on the next run after `fail()`. */
function appWithOneFailure() {
  let failNext = false;
  const ctx = wordModeApp({
    winner: "book",
    maskDtype: "bool",
    winnerLogit: () => {
      if (failNext) {
        failNext = false;
        throw new Error("a transient runtime error");
      }
      return 10;
    },
  });
  return { ...ctx, fail: () => (failNext = true) };
}

const lastMask = (runs) => runs.at(-1).mask;

test("after a recording whose run threw, the next recording is recognised", async () => {
  const { app, runs, fail } = appWithOneFailure();
  await recordWord(app);
  assert.equal(app.evaluate("state.prediction"), "book", "precondition: the model works");

  fail();
  await recordWord(app);
  assert.notEqual(app.evaluate("state.prediction"), "book", "precondition: that recording failed");

  await recordWord(app);
  assert.equal(app.evaluate("state.prediction"), "book", "the recording after a failed one is recognised again");
  assert.equal(lastMask(runs).type, "bool", "with the mask type the model accepts");
});

test("a run that threw during the warmup does not break the first recording", async () => {
  const { app, runs, fail } = appWithOneFailure();
  // The model loads, and warms up, when the first recording asks for it.
  fail();
  await recordWord(app);

  assert.equal(app.evaluate("state.prediction"), "book");
  assert.equal(lastMask(runs).type, "bool");
});
