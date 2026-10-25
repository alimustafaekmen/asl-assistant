// The word model sees one hand for the whole recording.
//
// Training picks the dominant hand once per sign, from how often each hand is
// visible. If the browser picked it frame by frame, a left hand that shows up
// for a moment while the right one is out of view would be mirrored into the
// right hand's place for those frames, and the model would read a jump the
// signer never made.

import assert from "node:assert/strict";
import { test } from "node:test";

import { RECORDING_FRAMES, mediaPipeFrame, wordModeApp } from "./helpers/word-recording.mjs";

const FRAME_DIM = 168;
const LEFT_ONLY = new Set([10, 11, 12]);

/** A frame of the shared recording, with the right hand swapped for a left one in LEFT_ONLY. */
function frame(t) {
  const result = mediaPipeFrame(t);
  if (!LEFT_ONLY.has(t)) return result;
  const left = result.rightHandLandmarks[0].map((point) => ({ ...point, x: point.x - 0.2 }));
  return { ...result, rightHandLandmarks: null, leftHandLandmarks: [left] };
}

test("a hand that appears for a few frames does not replace the dominant one", async () => {
  const { app, runs } = wordModeApp();
  const realInference = app.get("realInference");

  await app.get("startWordRecording")();
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    app.evaluate(`__clock += 50;`);
    app.evaluate(`latestMediaPipeResult = ${JSON.stringify(frame(t))};`);
    await realInference(app.evaluate("__clock"));
  }

  assert.equal(app.evaluate("state.wordState"), "RESULT", "precondition: the recording reached the model");
  const input = runs.at(-1).input.data;
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    const dominant = input.subarray(t * FRAME_DIM, t * FRAME_DIM + 63);
    const visible = dominant.some((value) => value !== 0);
    if (LEFT_ONLY.has(t)) {
      assert.equal(visible, false, `frame ${t}: the right hand is out of view, so its place stays empty`);
    } else {
      assert.equal(visible, true, `frame ${t}: the right hand is the dominant one`);
    }
  }
});
