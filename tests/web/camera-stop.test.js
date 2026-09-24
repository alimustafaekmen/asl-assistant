// Stopping the camera releases what starting it acquired.
//
// The camera is started through the app's own toggle with fakes at the
// boundaries only: getUserMedia hands out a stream whose tracks count their
// stop() calls, the MediaPipe import resolves to fake tasks that count their
// detections, and animation frames are queued rather than run, so a test can
// see which detection frame is pending and whether it was cancelled.
//
// Hiding the camera screen is never the same as releasing it; these check the
// release itself. Real media and a real frame clock need a browser.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeTask(name, log) {
  return {
    detectForVideo() {
      log.detections += 1;
      return name === "face" ? { faceLandmarks: [] } : { landmarks: [], handednesses: [] };
    },
    close() {
      log.closed.push(name);
    },
  };
}

/** The app in word mode with a fake camera, fake MediaPipe, and queued frames. */
function appWithFakeCamera() {
  const tracks = ["video", "video"].map((kind) => ({
    kind,
    stops: 0,
    stop() {
      this.stops += 1;
    },
  }));
  const tasks = { detections: 0, closed: [] };
  const frames = { nextId: 1, pending: new Map(), cancelled: [] };
  let clock = 0;

  const vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => fakeTask("hand", tasks) },
    PoseLandmarker: { createFromOptions: async () => fakeTask("pose", tasks) },
    FaceLandmarker: { createFromOptions: async () => fakeTask("face", tasks) },
  };

  const app = loadWebApp({
    globals: {
      console: { ...console, log() {}, warn() {}, error() {} },
      navigator: {
        mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) },
      },
      requestAnimationFrame(callback) {
        const id = frames.nextId++;
        frames.pending.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.cancelled.push(id);
        frames.pending.delete(id);
      },
      __vision: vision,
      __now: () => (clock += 16),
    },
  });
  app.evaluate(`
    globalThis.performance = { now: () => __now() };
    // The CDN import is the MediaPipe runtime boundary.
    _importTasksVision = async () => __vision;
    els.video.play = async () => {};
    els.video.readyState = 4;
    els.video.videoWidth = 640;
    els.video.videoHeight = 480;
    els.cameraStatus.lastChild = { textContent: "" };
    // Layout and drawing are the browser's; the overlay only needs them to exist.
    els.canvas.getBoundingClientRect = () => ({ width: 640, height: 480 });
    ctx.setTransform = () => {};
    ctx.clearRect = () => {};
    state.mode = "word";
  `);

  /** Run the one pending animation frame, as the browser would. */
  const runFrame = () => {
    const [[id, callback]] = frames.pending;
    frames.pending.delete(id);
    callback(clock);
  };

  return { app, tracks, tasks, frames, runFrame };
}

async function startCamera(camera) {
  await camera.app.get("toggleCamera")();
  // Pose and face load in the background after the hand task.
  for (let i = 0; i < 5; i++) await flush();
}

const stopPaths = {
  "the camera toggle": (app) => app.get("toggleCamera")(),
  "returning home": (app) => app.get("showHome")(),
};

for (const [name, stop] of Object.entries(stopPaths)) {
  test(`${name} stops every track, the detection loop, and every task`, async () => {
    const camera = appWithFakeCamera();
    await startCamera(camera);
    const { app, tracks, tasks, frames, runFrame } = camera;

    // Preconditions: the camera is live and one detection loop is running.
    assert.equal(app.evaluate("state.cameraOn"), true);
    assert.equal(frames.pending.size, 1);
    runFrame();
    runFrame();
    assert.ok(tasks.detections > 0, "the loop was detecting before the stop");
    assert.equal(frames.pending.size, 1, "one loop, one pending frame");
    const [pendingId] = frames.pending.keys();
    const [pendingFrame] = frames.pending.values();

    await stop(app);

    assert.deepEqual(
      tracks.map((track) => track.stops),
      [1, 1],
      "every media track is stopped once",
    );
    assert.ok(frames.cancelled.includes(pendingId), "the pending detection frame is cancelled");
    assert.equal(frames.pending.size, 0, "no detection frame is left scheduled");
    assert.deepEqual([...tasks.closed].sort(), ["face", "hand", "pose"]);

    // A frame the browser had already begun cannot revive the loop.
    const detectionsAtStop = tasks.detections;
    pendingFrame(0);
    assert.equal(frames.pending.size, 0, "a late frame schedules no other");
    assert.equal(tasks.detections, detectionsAtStop, "a late frame detects nothing");
  });
}
