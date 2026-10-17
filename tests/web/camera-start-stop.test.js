// A stop after the permission prompt, while the camera start is still running.
//
// Granting the camera does not finish the start. The app then waits for the
// first video frame (up to 2.5 s), and then for hand tracking to load. The
// UI already offers Stop in that time, and Home and the information screens
// stop the camera too. A stop there has to be the last word: the camera stays
// off, the status says so, and the start does not go on to load models or
// start MediaPipe on a stream that is gone.
//
// The camera, the video element's play(), the MediaPipe import and ONNX
// Runtime are faked at their boundaries (helpers/fake-camera.mjs). A model
// load or a MediaPipe start is observed there, as a session created or a
// bundle imported, not by replacing the app's functions.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

/** What the camera area shows once the camera is off. */
function assertIdle(camera) {
  const { app } = camera;
  assert.equal(app.evaluate("state.cameraOn"), false, "the camera must stay off");
  assert.equal(app.evaluate("state.stream"), null);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false, "the empty stage must be shown again");
  assert.equal(app.evaluate("els.cameraStatus.lastChild.textContent"), "Hazır", "the status pill must read idle");
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "Hazır", "the badge must read idle");
  for (const stream of camera.streams) {
    for (const track of stream.tracks) assert.equal(track.stops, 1, "every track is stopped once");
  }
}

const stops = {
  "the camera toggle": (app) => app.get("toggleCamera")(),
  "returning home": (app) => app.get("showHome")(),
  "opening the project screen": (app) => app.get("setMode")("project"),
};

for (const [name, stop] of Object.entries(stops)) {
  test(`${name} while the video starts leaves the camera off`, async () => {
    const camera = appWithFakeCamera({ hold: { play: true } });
    const { app } = camera;

    const starting = app.get("toggleCamera")();
    await flush();
    assert.equal(camera.plays.length, 1, "precondition: the start waits for the first frame");

    stop(app);
    camera.plays[0].resolve();
    await starting;
    await flush();

    assertIdle(camera);
    assert.equal(camera.imports.length, 0, "MediaPipe must not be started");
    assert.equal(camera.onnx.sessions, 0, "no model may start loading");
    assert.equal(camera.frames.pending.size, 0, "no detection frame may be scheduled");
  });
}

test("a stop while hand tracking loads leaves the idle status", async () => {
  const camera = appWithFakeCamera({ hold: { hand: true } });
  const { app } = camera;

  const starting = app.get("toggleCamera")();
  await flush();
  app.get("toggleCamera")();
  camera.created("hand")[0].resolve();
  await starting;
  await flush();

  assertIdle(camera);
});

test("hand tracking that fails after a stop reports nothing about it", async () => {
  const camera = appWithFakeCamera({ hold: { hand: true } });
  const { app } = camera;

  const starting = app.get("toggleCamera")();
  await flush();
  app.get("toggleCamera")();
  // The GPU attempt fails, then the CPU fallback does.
  camera.created("hand")[0].reject(new Error("no GPU"));
  await flush();
  camera.created("hand")[1].reject(new Error("offline"));
  await starting;
  await flush();

  assertIdle(camera);
  assert.doesNotMatch(app.evaluate("els.confidenceMessage.textContent"), /El izleme/);
  assert.doesNotMatch(app.evaluate("els.announcer.textContent"), /El izleme/);
});

test("a stop while the models load after a hand-tracking failure reports nothing about it", async () => {
  const camera = appWithFakeCamera({ hold: { hand: true, onnx: true } });
  const { app } = camera;

  const starting = app.get("toggleCamera")();
  await flush();
  camera.created("hand")[0].reject(new Error("no GPU"));
  await flush();
  camera.created("hand")[1].reject(new Error("offline"));
  await flush();
  // Here the start waits for the model download before it reports the failure.
  assert.equal(camera.onnx.pending.length, 1, "precondition: the letter model is loading");

  app.get("toggleCamera")();
  camera.onnx.pending[0].reject(new Error("offline"));
  await starting;
  await flush();

  // Both failures belong to the stopped camera, so neither may be reported:
  // this test checks the hand-tracking one, and
  // camera-cancelled-reports.test.js the model download.
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false);
  assert.equal(app.evaluate("els.cameraStatus.lastChild.textContent"), "Hazır");
  assert.doesNotMatch(app.evaluate("els.latencyBadge.textContent"), /El izleme/);
  assert.doesNotMatch(app.evaluate("els.confidenceMessage.textContent"), /El izleme/);
  assert.doesNotMatch(app.evaluate("els.announcer.textContent"), /El izleme/);
});

test("a start nobody stopped still finishes", async () => {
  // The control for the tests above: the same fakes, no stop.
  const camera = appWithFakeCamera({ hold: { play: true } });
  const { app } = camera;

  const starting = app.get("toggleCamera")();
  await flush();
  camera.plays[0].resolve();
  await starting;
  await flush();

  assert.equal(app.evaluate("state.cameraOn"), true);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), true);
  assert.equal(app.evaluate("els.cameraStatus.lastChild.textContent"), "Kamera açık");
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "El izleme hazır");
  assert.equal(app.evaluate("mpRunning"), true);
  assert.equal(camera.frames.pending.size, 1);
  assert.equal(camera.onnx.sessions, 1, "the letter model started loading");
});
