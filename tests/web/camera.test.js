// Camera pipeline guards that do not need a real camera.
//
// Real task creation, the CDN import and the detection loop need a browser
// (the camera check in tests/browser). What is covered here are the decisions
// around them: which frames may be recorded, when the optional tasks are
// needed, how handedness is mapped, and what stopping releases.

import test from "node:test";
import assert from "node:assert/strict";

let app;
test.beforeEach(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

const hand = [[{ x: 0.5, y: 0.5, z: 0 }]];
const list = [{ x: 0.5, y: 0.5, z: 0 }];

/** A frame result with the requested groups present. */
function frame({ right = null, left = null, pose = null, face = null } = {}) {
  return {
    rightHandLandmarks: right,
    leftHandLandmarks: left,
    handednessDebug: [],
    poseLandmarks: pose,
    faceLandmarks: face,
    timestamp: 0,
  };
}

test("a word frame is recordable only with hand, pose, and face together", () => {
  const hasRequired = app.get("_hasRequiredWordLandmarks");

  assert.equal(hasRequired(frame({ right: hand, pose: list, face: list })), true);
  assert.equal(hasRequired(frame({ left: hand, pose: list, face: list })), true);

  // The 321D layout has a fixed slot per group, so a missing group would reach
  // the model as zeros rather than as "absent".
  assert.equal(hasRequired(frame({ pose: list, face: list })), false);
  assert.equal(hasRequired(frame({ right: hand, face: list })), false);
  assert.equal(hasRequired(frame({ right: hand, pose: list })), false);
  assert.equal(hasRequired(frame()), false);
  assert.equal(hasRequired(null), false);
  assert.equal(hasRequired(undefined), false);
});

test("the optional pose and face tasks are needed only in word contexts", () => {
  const needsHolistic = app.get("_needsHolisticLandmarks");
  const state = app.get("state");

  state.mode = "letter";
  assert.equal(needsHolistic(), false);

  state.mode = "word";
  assert.equal(needsHolistic(), true);

  // A coach target is a word context only when it is longer than one character.
  state.mode = "coach";
  state.coachTarget = "A";
  assert.equal(needsHolistic(), false);
  state.coachTarget = "water";
  assert.equal(needsHolistic(), true);
});

test("the selfie handedness swap follows the configuration flag", () => {
  const shouldSwap = app.get("_shouldSwapHandedness");
  const config = app.get("CONFIG");

  config.SELFIE_HANDEDNESS_SWAP = false;
  assert.equal(shouldSwap(), false);

  config.SELFIE_HANDEDNESS_SWAP = true;
  assert.equal(shouldSwap(), true);

  // Without the key at all, the swap defaults to on.
  delete config.SELFIE_HANDEDNESS_SWAP;
  assert.equal(shouldSwap(), true);
});

test("stopping clears the published frame and the running flag", () => {
  app.evaluate("mpRunning = true; mpStarting = true; mpOptionalLoading = true;");
  app.evaluate("latestMediaPipeResult = { timestamp: 1 };");

  app.get("stopMediaPipe")();

  assert.equal(app.get("mpRunning"), false);
  assert.equal(app.get("mpStarting"), false);
  assert.equal(app.get("mpOptionalLoading"), false);
  assert.equal(app.get("latestMediaPipeResult"), null);
  assert.equal(app.get("handLandmarker"), null);
  assert.equal(app.get("poseLandmarker"), null);
  assert.equal(app.get("faceLandmarker"), null);
  // Dropping the factories stops a late background load from reviving a task.
  assert.equal(app.get("mpPoseFactory"), null);
  assert.equal(app.get("mpFaceFactory"), null);
});

test("stopping closes every task that was open", () => {
  app.evaluate(`
    globalThis._closed = [];
    const task = (name) => ({ close() { globalThis._closed.push(name); } });
    handLandmarker = task("hand");
    poseLandmarker = task("pose");
    faceLandmarker = task("face");
  `);

  app.get("stopMediaPipe")();

  assert.deepEqual([...app.get("_closed")].sort(), ["face", "hand", "pose"]);
});

test("stopping survives a task whose close throws", () => {
  app.evaluate(`
    handLandmarker = { close() { throw new Error("already disposed"); } };
  `);

  // A failed release must not leave mpRunning true, or the loop never stops.
  app.get("stopMediaPipe")();

  assert.equal(app.get("mpRunning"), false);
  assert.equal(app.get("handLandmarker"), null);
});
