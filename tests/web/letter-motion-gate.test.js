// The letter motion gate skips a frame whose hand is still moving.
//
// The gate is off by default (CONFIG.LETTER_MOTION_GATE_ENABLED). When it is
// on, a frame whose hand moved more than the threshold since the last one is
// not sent to the model: a handshape in transit is not a letter. The fault
// this kills is a gate that no longer decides, whether it stops skipping
// moving frames or starts skipping when it is off, which nothing else here
// would see: the decision is made next to the debug snapshot it also feeds.
//
// Frames go in through the render loop; ONNX Runtime is faked at its
// boundary, and what it is asked to run is what the test counts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { appWithFakeOrt } from "./helpers/fake-ort.mjs";

/** A hand of 21 landmarks, wrist at the bottom, moved right by `dx`. */
function hand(dx = 0) {
  const landmarks = [{ x: 0.3 + dx, y: 0.85, z: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    for (let joint = 1; joint <= 4; joint++) {
      landmarks.push({ x: 0.2 + dx + finger * 0.05 + joint * 0.004 * finger, y: 0.8 - joint * 0.1 - finger * 0.01, z: -0.01 * joint });
    }
  }
  return landmarks;
}

/** The booted app with the letter model loaded and the camera on, gate as given. */
async function letterApp(gateEnabled) {
  const app = await appWithFakeOrt({ boot: true });
  assert.equal(await app.get("ensureLetterModel")(), true);
  app.evaluate(`CONFIG.LETTER_MOTION_GATE_ENABLED = ${gateEnabled}; state.cameraOn = true;`);
  let time = 1000;
  let timestamp = 1;
  /** One render frame showing the hand moved by `dx`; returns the model runs so far. */
  const frame = async (dx) => {
    app.evaluate(`latestMediaPipeResult = {
      rightHandLandmarks: ${JSON.stringify(hand(dx))},
      leftHandLandmarks: null,
      poseLandmarks: null,
      faceLandmarks: null,
      timestamp: ${timestamp++},
    };`);
    assert.equal(app.runFrame(time), 1, "the render loop must be running");
    time += 200;
    await flush();
    return app.evaluate("__ort.runs");
  };
  return frame;
}

// 0.3 of the frame's width across every landmark moves each x by 0.3, a mean
// absolute change of 0.1 over the hand's 63 values; the threshold is 0.08.
const MOVED = 0.3;

test("with the gate on, a frame whose hand moved is not classified; a still one is", async () => {
  const frame = await letterApp(true);

  assert.equal(await frame(0), 1, "the first frame has nothing to compare with and is classified");
  assert.equal(await frame(MOVED), 1, "the frame the hand moved in is skipped");
  assert.equal(await frame(MOVED), 2, "once the hand holds still, the frame is classified");
});

test("with the gate off, every frame is classified, moving or not", async () => {
  const frame = await letterApp(false);

  assert.equal(await frame(0), 1);
  assert.equal(await frame(MOVED), 2);
  assert.equal(await frame(MOVED), 3);
});
