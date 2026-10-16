// A camera the user stopped reports nothing more about itself.
//
// A camera start sets off slow work: the permission prompt, then the live
// models' download. The user can stop the camera, go home, or open an
// information screen while that work is still out. When it then fails, the
// failure belongs to a camera session that no longer exists: the badge must
// keep reading idle and no error may be shown or announced. The fault these
// tests kill is a late failure overwriting the idle state the stop left.
//
// The camera, the MediaPipe import and ONNX Runtime are faked at their
// boundaries (helpers/fake-camera.mjs); the rest is the app's own code.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const shown = (app) => ({
  badge: app.evaluate("els.latencyBadge.textContent"),
  message: app.evaluate("els.confidenceMessage.textContent"),
  announced: app.evaluate("els.announcer.textContent"),
});

/** Start the camera and let it finish, with the letter model still downloading. */
async function startedWithModelDownloading() {
  const camera = appWithFakeCamera({ hold: { onnx: true } });
  await camera.app.get("toggleCamera")();
  await flush();
  assert.equal(camera.app.evaluate("state.cameraOn"), true, "precondition: the camera is on");
  assert.equal(camera.onnx.pending.length, 1, "precondition: the letter model is downloading");
  return camera;
}

test("a model download that fails after the camera was stopped reports nothing", async () => {
  const camera = await startedWithModelDownloading();
  const { app } = camera;

  app.get("toggleCamera")();
  assert.equal(app.evaluate("state.cameraOn"), false);
  camera.onnx.pending[0].reject(new Error("offline"));
  await flush();

  const after = shown(app);
  assert.equal(after.badge, "Hazır", "the badge keeps the idle state the stop left");
  assert.doesNotMatch(after.message, /indirilemedi/, "no download error is shown for a stopped camera");
  assert.doesNotMatch(after.announced, /indirilemedi/, "nor announced");
});

test("a model download that fails while the camera runs is reported", async () => {
  // The control: the same failure, no stop.
  const camera = await startedWithModelDownloading();
  camera.onnx.pending[0].reject(new Error("offline"));
  await flush();

  const after = shown(camera.app);
  assert.match(after.message, /indirilemedi/);
  assert.match(after.announced, /indirilemedi/);
});

/** A camera whose permission prompt stays open until the test answers it. */
function cameraWithOpenPrompt() {
  const camera = appWithFakeCamera();
  let refuse;
  camera.app.get("navigator").mediaDevices.getUserMedia = () =>
    new Promise((_resolve, reject) => {
      refuse = () => reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    });
  return { ...camera, refuse: () => refuse() };
}

const LEAVES_DURING_PROMPT = {
  "going home": (app) => app.get("showHome")(),
  "opening the project screen": (app) => app.get("setMode")("project"),
};

for (const [name, leave] of Object.entries(LEAVES_DURING_PROMPT)) {
  test(`a prompt refused after ${name} reports nothing`, async () => {
    const camera = cameraWithOpenPrompt();
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();

    leave(app);
    camera.refuse();
    await starting;
    await flush();

    const after = shown(app);
    assert.equal(after.badge, "Hazır", "the badge keeps the idle state");
    assert.doesNotMatch(after.message, /izni verilmedi/, "the start was cancelled, so its refusal is not shown");
    assert.doesNotMatch(after.announced, /izni verilmedi/, "nor announced");
  });
}

test("a prompt refused with nobody leaving is reported", async () => {
  // The control: the same refusal, no stop.
  const camera = cameraWithOpenPrompt();
  const starting = camera.app.get("toggleCamera")();
  await flush();
  camera.refuse();
  await starting;

  const after = shown(camera.app);
  assert.equal(after.badge, "Kamera açılamadı");
  assert.match(after.message, /izni verilmedi/);
  assert.match(after.announced, /izni verilmedi/);
});
