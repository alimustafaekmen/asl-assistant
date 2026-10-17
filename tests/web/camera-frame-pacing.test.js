// Hand tracking runs once per camera frame, not once per screen refresh.
//
// A webcam presents 20 to 30 frames a second while a screen fires 60 to 120
// animation frames, so a loop that detects on every animation frame runs
// MediaPipe two to six times on the same picture (measured in Chrome with its
// fake camera: 50 detections a second for 20 camera frames). A phone pays for
// that in battery and heat. The faults these tests kill are that waste; the
// opposite one, a video that stops reporting frames and so stops tracking;
// and a frame watcher left running after the camera stops.
//
// requestVideoFrameCallback is the browser's per-frame signal. The camera,
// the MediaPipe import and ONNX Runtime are faked by helpers/coach-app.mjs;
// the hand task is wrapped here to count its calls, and the video element's
// frame callback is faked so the test decides when a camera frame arrives.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FRAME_MS, coachApp } from "./helpers/coach-app.mjs";

/** The booted letter screen with a fake frame clock and counted detections. */
async function pacedApp() {
  const coach = await coachApp({ hash: "#letter" });
  const calls = { n: 0 };
  const vision = coach.app.evaluate("__vision");
  const create = vision.HandLandmarker.createFromOptions;
  vision.HandLandmarker.createFromOptions = async (...args) => {
    const task = await create(...args);
    return {
      detectForVideo(...frame) {
        calls.n += 1;
        return task.detectForVideo(...frame);
      },
      close: () => task.close(),
    };
  };
  const frames = { pending: new Map(), nextId: 1 };
  const video = coach.app.evaluate("els.video");
  video.requestVideoFrameCallback = (callback) => {
    const id = frames.nextId++;
    frames.pending.set(id, callback);
    return id;
  };
  video.cancelVideoFrameCallback = (id) => frames.pending.delete(id);
  /** The camera presents one new frame. */
  const present = () => {
    const due = [...frames.pending.values()];
    frames.pending.clear();
    for (const callback of due) callback(0, {});
  };
  await coach.startCamera();
  coach.show("L", 0.9);
  return { ...coach, calls, frames, present };
}

/** Play `count` animation frames, presenting a camera frame every `every` of them. */
async function playFrames(coach, count, every) {
  for (let i = 0; i < count; i++) {
    if (every && i % every === 0) coach.present();
    await coach.play(FRAME_MS);
  }
}

test("a camera frame is detected once, however many animation frames show it", async () => {
  const coach = await pacedApp();
  await playFrames(coach, 8, 2);

  const before = coach.calls.n;
  // 60 animation frames, a new camera frame on every second one: 30 pictures.
  await playFrames(coach, 60, 2);
  const detected = coach.calls.n - before;

  assert.ok(detected >= 28 && detected <= 32, `expected about 30 detections for 30 camera frames, got ${detected}`);
});

test("hand tracking goes on when the video stops reporting frames", async () => {
  const coach = await pacedApp();
  await playFrames(coach, 8, 2);

  const before = coach.calls.n;
  // One second in which no new frame is reported.
  await playFrames(coach, 63, 0);
  const detected = coach.calls.n - before;

  assert.ok(detected >= 4, `tracking stopped without frame reports: ${detected} detections in a second`);
  assert.ok(detected <= 10, `without frame reports detection should slow, not run every animation frame: ${detected}`);
  assert.equal(
    coach.app.evaluate("Boolean(latestMediaPipeResult?.rightHandLandmarks || latestMediaPipeResult?.leftHandLandmarks)"),
    true,
    "the hand is no longer tracked",
  );
});

test("stopping the camera releases the frame watcher, and reopening leaves exactly one", async () => {
  const coach = await pacedApp();
  await playFrames(coach, 8, 2);
  assert.equal(coach.frames.pending.size, 1, "precondition: one frame callback is registered while the camera runs");

  coach.app.evaluate("stopCamera()");
  await coach.play(FRAME_MS * 4);
  assert.equal(coach.frames.pending.size, 0, "a frame callback is still registered after the camera stopped");

  await coach.startCamera();
  await playFrames(coach, 8, 2);
  assert.equal(coach.frames.pending.size, 1, "reopening the camera left more or fewer than one frame watcher");
});
