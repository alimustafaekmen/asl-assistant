// What the word model actually receives.
//
// A dimensionally valid input in the wrong order, or with the mask inverted,
// still runs and silently predicts nonsense, so these read the tensors the
// fake ONNX session was handed rather than any intermediate buffer.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HAND_STEP_X,
  RECORDING_FRAMES,
  SHOULDER_MID_X,
  SHOULDER_WIDTH,
  recordWord,
  wordModeApp,
  wristX,
} from "./helpers/word-recording.mjs";

const FRAME_DIM = 168;
// Index 0 of each frame is the dominant wrist's x; 105 is its motion.
const WRIST_X = 0;
const WRIST_MOTION_X = 105;

test("a recording reaches the model frame-major and in recording order", async () => {
  const { app, runs } = wordModeApp();
  await recordWord(app);

  const feeds = runs.at(-1);
  assert.deepEqual([...feeds.input.dims], [1, RECORDING_FRAMES, FRAME_DIM]);
  assert.equal(feeds.input.data.length, RECORDING_FRAMES * FRAME_DIM);

  // The wrist moves right by one step per frame, so after the shoulder
  // normalisation frame t must hold the wrist where frame t of the recording
  // put it, and its motion must be one step forward rather than back.
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    const frame = feeds.input.data.subarray(t * FRAME_DIM, (t + 1) * FRAME_DIM);
    const expectedX = (wristX(t) - SHOULDER_MID_X) / SHOULDER_WIDTH;
    const expectedMotion = t === 0 ? 0 : HAND_STEP_X / SHOULDER_WIDTH;
    assert.ok(Math.abs(frame[WRIST_X] - expectedX) < 1e-5, `frame ${t}: wrist x ${frame[WRIST_X]}, expected ${expectedX}`);
    assert.ok(
      Math.abs(frame[WRIST_MOTION_X] - expectedMotion) < 1e-5,
      `frame ${t}: wrist motion ${frame[WRIST_MOTION_X]}, expected ${expectedMotion}`,
    );
  }

  // Every one of the 45 frames is real, so every mask entry is true.
  assert.deepEqual([...feeds.mask.dims], [1, RECORDING_FRAMES]);
  assert.deepEqual(Array.from(feeds.mask.data, Boolean), new Array(RECORDING_FRAMES).fill(true));
});

test("the mask reaches the model as given, true for real frames, in every element type", async () => {
  // Thirty real frames, then padding.
  const mask = Array.from({ length: RECORDING_FRAMES }, (_, i) => i < 30);

  for (const maskDtype of ["bool", "uint8", "int64"]) {
    const { app, runs } = wordModeApp({ maskDtype });
    assert.equal(await app.get("ensureWordModel")(), true);

    await app.get("predictWord")(new Float32Array(RECORDING_FRAMES * FRAME_DIM), mask);

    const sent = runs.at(-1).mask;
    assert.equal(sent.type, maskDtype);
    // The exported graph inverts the mask itself; inverting it here would
    // hand the model the padding instead of the recording.
    assert.deepEqual(Array.from(sent.data, Boolean), mask, `${maskDtype} mask`);
  }
});
