// A camera the browser takes away.
//
// A live track can end without the app asking: the user revokes the
// permission, unplugs the camera, or another app takes it. The browser then
// fires "ended" on the track; track.stop() never does. Until the app listens,
// it keeps showing a live camera and running MediaPipe on a stream that
// delivers nothing. It must release the camera as a stop does and tell the
// user, on screen and to a screen reader, what happened.
//
// The track is faked at the camera boundary (helpers/fake-camera.mjs); end()
// is the browser ending it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const LOST = "Kamera bağlantısı kesildi. Kamerayı yeniden açabilirsiniz.";

/** Every track of every stream the app was given. */
const tracksOf = (camera) => camera.streams.flatMap((stream) => stream.tracks);

test("a track the browser ends releases the camera and says so", async () => {
  const camera = appWithFakeCamera({ mode: "word" });
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  assert.equal(app.evaluate("mpRunning"), true, "precondition: hand tracking runs");
  assert.equal(camera.frames.pending.size, 1);

  tracksOf(camera)[0].end();

  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("state.stream"), null);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false, "the empty stage is shown again");
  assert.equal(app.evaluate("mpRunning"), false, "MediaPipe is released");
  assert.equal(camera.frames.pending.size, 0, "no detection frame is left scheduled");
  for (const kind of ["hand", "pose", "face"]) {
    assert.equal(camera.alive(kind), 0, `the ${kind} task is closed`);
  }
  assert.equal(app.evaluate("els.confidenceMessage.textContent"), LOST);
  assert.equal(app.evaluate("els.announcer.textContent").trim(), LOST);
});

test("a track that ends while the video starts ends the start too", async () => {
  const camera = appWithFakeCamera({ hold: { play: true } });
  const { app } = camera;

  const starting = app.get("toggleCamera")();
  await flush();
  tracksOf(camera)[0].end();
  camera.plays[0].resolve();
  await starting;
  await flush();

  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false);
  assert.equal(camera.imports.length, 0, "MediaPipe must not be started");
  assert.equal(app.evaluate("els.confidenceMessage.textContent"), LOST);
});

test("the camera can be opened again after its track ended", async () => {
  const camera = appWithFakeCamera();
  const { app } = camera;
  const toggleCamera = app.get("toggleCamera");
  await toggleCamera();
  await flush();

  tracksOf(camera)[0].end();
  await toggleCamera();
  await flush();

  assert.equal(camera.streams.length, 2, "the next Start asks for a new stream");
  assert.equal(app.evaluate("state.cameraOn"), true);
  assert.equal(app.evaluate("mpRunning"), true);
  assert.equal(camera.frames.pending.size, 1, "one detection loop");
  assert.equal(camera.alive("hand"), 1, "one hand task");
});

// A browser that still fires "ended" after stop(), or a track that ends just
// after it, must not reach a camera that is already off, whether the stop
// came after the start or during its video wait.
for (const when of ["after the start", "during the video wait"]) {
  test(`a stop the user made ${when} does not report a lost camera`, async () => {
    const duringWait = when === "during the video wait";
    const camera = appWithFakeCamera({ hold: { play: duringWait } });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();

    app.get("toggleCamera")();
    if (duringWait) camera.plays[0].resolve();
    await starting;
    await flush();
    for (const track of tracksOf(camera)) {
      assert.equal(track.listenerCount("ended"), 0, "the stop removes its listener");
      track.end();
    }

    assert.notEqual(app.evaluate("els.confidenceMessage.textContent"), LOST);
    assert.notEqual(app.evaluate("els.announcer.textContent").trim(), LOST);
  });
}
