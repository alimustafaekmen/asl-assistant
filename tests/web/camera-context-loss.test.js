// A lost WebGL context leaves MediaPipe returning empty results without an
// error, so the tasks must be rebuilt, once, and only for the current session.
// The canvas each task was handed is where the browser reports the loss.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

/** The fake camera, with the canvas handed to every task creation kept in order. */
function cameraWithCanvases(options) {
  const camera = appWithFakeCamera(options);
  const canvases = { hand: [], pose: [], face: [] };
  for (const [kind, factory] of [
    ["hand", camera.vision.HandLandmarker],
    ["pose", camera.vision.PoseLandmarker],
    ["face", camera.vision.FaceLandmarker],
  ]) {
    const create = factory.createFromOptions;
    factory.createFromOptions = (resolver, taskOptions) => {
      canvases[kind].push(taskOptions?.canvas ?? null);
      return create(resolver, taskOptions);
    };
  }
  return { ...camera, canvases };
}

const loseContext = (canvas) => canvas.dispatchEvent({ type: "webglcontextlost", target: canvas });

/** Start the camera through the app's own toggle and let MediaPipe come up. */
async function start(camera) {
  await camera.app.get("toggleCamera")();
  await flush();
  assert.equal(camera.app.evaluate("mpRunning"), true, "precondition: hand tracking runs");
}

test("every task is created on a canvas the app can watch", async () => {
  const camera = cameraWithCanvases({ mode: "word" });
  await start(camera);

  for (const kind of ["hand", "pose", "face"]) {
    assert.equal(camera.canvases[kind].length, 1, `one ${kind} task`);
    assert.ok(camera.canvases[kind][0], `the ${kind} task was left to make its own canvas`);
  }
  assert.notEqual(camera.canvases.hand[0], camera.canvases.pose[0], "each task needs a context of its own");
});

test("a lost hand context rebuilds tracking with one task and one loop", async () => {
  const camera = cameraWithCanvases();
  await start(camera);

  loseContext(camera.canvases.hand[0]);
  await flush();

  assert.equal(camera.created("hand").length, 2, "a new hand task was not created");
  assert.equal(camera.created("hand")[0].task.closed, 1, "the task on the lost context was not closed");
  assert.equal(camera.alive("hand"), 1);
  assert.equal(camera.app.evaluate("mpRunning"), true);
  assert.equal(camera.frames.pending.size, 1, "one detection loop, one pending frame");
  const before = camera.detections("hand");
  camera.runFrame();
  assert.equal(camera.detections("hand") - before, 1, "one detection per frame");
  assert.equal(camera.created("hand")[1].task.detections > 0, true, "the new task does the detecting");
});

test("a lost pose context in word mode rebuilds every task", async () => {
  const camera = cameraWithCanvases({ mode: "word" });
  await start(camera);

  loseContext(camera.canvases.pose[0]);
  await flush();

  for (const kind of ["hand", "pose", "face"]) {
    assert.equal(camera.created(kind).length, 2, `the ${kind} task was not rebuilt`);
    assert.equal(camera.alive(kind), 1, `one ${kind} task stays open`);
  }
  assert.equal(camera.frames.pending.size, 1);
});

test("a loss after the camera stopped does not start tracking again", async () => {
  const camera = cameraWithCanvases();
  await start(camera);
  camera.app.get("toggleCamera")();
  assert.equal(camera.app.evaluate("state.cameraOn"), false, "precondition: the camera is off");

  loseContext(camera.canvases.hand[0]);
  await flush();

  assert.equal(camera.created("hand").length, 1, "a stopped camera created a hand task");
  assert.equal(camera.alive("hand"), 0);
  assert.equal(camera.app.evaluate("mpRunning"), false);
  assert.equal(camera.frames.pending.size, 0, "a stopped camera scheduled a detection frame");
});

test("a loss on a canvas of an earlier session is ignored", async () => {
  const camera = cameraWithCanvases();
  await start(camera);
  camera.app.get("toggleCamera")();
  await start(camera);
  assert.equal(camera.created("hand").length, 2, "precondition: the restart made its own task");

  loseContext(camera.canvases.hand[0]);
  await flush();

  assert.equal(camera.created("hand").length, 2, "an old canvas restarted the current session");
  assert.equal(camera.alive("hand"), 1);
  assert.equal(camera.frames.pending.size, 1);
});

test("two losses in a row leave one task and one loop", async () => {
  const camera = cameraWithCanvases({ mode: "word" });
  await start(camera);

  loseContext(camera.canvases.hand[0]);
  loseContext(camera.canvases.face[0]);
  await flush();

  assert.equal(camera.alive("hand"), 1);
  assert.equal(camera.alive("pose"), 1);
  assert.equal(camera.alive("face"), 1);
  assert.equal(camera.frames.pending.size, 1);
});

test("a loss while the page is hidden waits until it is shown again", async () => {
  const camera = cameraWithCanvases();
  await start(camera);
  const document = camera.app.evaluate("document");

  document.visibilityState = "hidden";
  document.dispatchEvent({ type: "visibilitychange" });
  loseContext(camera.canvases.hand[0]);
  await flush();
  assert.equal(camera.created("hand").length, 1, "tracking was rebuilt while the page was hidden");

  document.visibilityState = "visible";
  document.dispatchEvent({ type: "visibilitychange" });
  await flush();

  assert.equal(camera.created("hand").length, 2, "tracking was not rebuilt when the page came back");
  assert.equal(camera.alive("hand"), 1);
  assert.equal(camera.frames.pending.size, 1);
});

test("a camera stopped while hidden is not restarted when the page comes back", async () => {
  const camera = cameraWithCanvases();
  await start(camera);
  const document = camera.app.evaluate("document");

  document.visibilityState = "hidden";
  loseContext(camera.canvases.hand[0]);
  camera.app.get("toggleCamera")();
  document.visibilityState = "visible";
  document.dispatchEvent({ type: "visibilitychange" });
  await flush();

  assert.equal(camera.created("hand").length, 1);
  assert.equal(camera.app.evaluate("mpRunning"), false);
  assert.equal(camera.frames.pending.size, 0);
});

test("a loss while the hand task is still loading leaves the start alone", async () => {
  const camera = cameraWithCanvases({ hold: { hand: true } });
  const starting = camera.app.get("toggleCamera")();
  await flush();
  assert.equal(camera.created("hand").length, 1, "precondition: the hand task is loading");

  loseContext(camera.canvases.hand[0]);
  camera.created("hand")[0].resolve();
  await starting;
  await flush();

  assert.equal(camera.created("hand").length, 1, "a start in flight was thrown away and begun again");
  assert.equal(camera.app.evaluate("mpRunning"), true);
  assert.equal(camera.frames.pending.size, 1);
});

test("a rebuild that cannot load says hand tracking failed", async () => {
  const camera = cameraWithCanvases({ hold: { import: true } });
  const starting = camera.app.get("toggleCamera")();
  await flush();
  camera.imports[0].resolve(camera.vision);
  await starting;
  await flush();
  assert.equal(camera.app.evaluate("mpRunning"), true, "precondition: hand tracking runs");

  loseContext(camera.canvases.hand[0]);
  await flush();
  camera.imports[1].reject(new Error("offline"));
  await flush();

  assert.equal(
    camera.app.evaluate("els.confidenceMessage.textContent"),
    camera.app.evaluate('t("shell.tracking.failed")'),
  );
});
