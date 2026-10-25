// Camera start and stop, around the permission prompt.
//
// getUserMedia resolves only after the user answers the prompt, so a start is
// pending for as long as they take. During that window the UI still shows the
// camera off. A second Start must not open a second stream, and leaving the
// workspace must still win: when the stream arrives, its tracks are stopped
// and the camera stays off.
//
// The camera is the boundary faked here: getUserMedia hands out streams the
// test resolves by hand, and each track records whether it was stopped. The
// rest is the app's own code.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

/** A stream whose one track records whether it was stopped. */
function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

function loadWithCamera() {
  /** @type {{resolve: (stream: unknown) => void, reject: (error: unknown) => void}[]} */
  const prompts = [];
  const getUserMedia = () =>
    new Promise((resolve, reject) => prompts.push({ resolve, reject }));
  /** @type {unknown[]} */
  const cancelledFrames = [];
  const app = loadWebApp({
    globals: {
      navigator: { mediaDevices: { getUserMedia } },
      // The QR screen builds its link from the page's own address and draws
      // it with the kjua CDN script.
      URL,
      location: new URL("https://asl-assistant.pages.dev/#letter"),
      kjua: () => ({}),
      history: { replaceState() {} },
      cancelAnimationFrame: (id) => cancelledFrames.push(id),
    },
  });
  // The status pill's last child is its label text node in the markup.
  app.evaluate('els.cameraStatus.lastChild = { textContent: "" };');
  return { app, prompts, cancelledFrames };
}

/**
 * Put the app in the state a granted camera leaves it in: a live stream, a
 * scheduled detection frame, and an open hand task.
 */
function runningCamera(app) {
  const stream = fakeStream();
  app.evaluate("globalThis.__handClosed = false;");
  app.evaluate("handLandmarker = { close() { globalThis.__handClosed = true; } };");
  app.evaluate("mpRunning = true; _rafId = 7;");
  app.get("state").stream = stream;
  app.get("state").cameraOn = true;
  return stream;
}

/** Let the awaited getUserMedia continuation run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a second Start while the prompt is open does not ask again", async () => {
  const { app, prompts } = loadWithCamera();
  const toggleCamera = app.get("toggleCamera");

  toggleCamera();
  toggleCamera();
  await settle();

  assert.equal(prompts.length, 1, "only one getUserMedia call may be in flight");
});

test("going home during the prompt stops the stream when it arrives", async () => {
  const { app, prompts } = loadWithCamera();

  const starting = app.get("toggleCamera")();
  app.get("showHome")();
  const stream = fakeStream();
  prompts[0].resolve(stream);
  await starting;

  assert.equal(stream.track.stopped, true, "the late stream's tracks must be stopped");
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("state.stream"), null);
});

test("stopping the camera during the prompt stops the stream when it arrives", async () => {
  const { app, prompts } = loadWithCamera();

  const starting = app.get("toggleCamera")();
  app.get("stopCamera")();
  const stream = fakeStream();
  prompts[0].resolve(stream);
  await starting;

  assert.equal(stream.track.stopped, true);
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("state.stream"), null);
});

test("a cancelled start does not take over a newer one", async () => {
  const { app, prompts } = loadWithCamera();
  const toggleCamera = app.get("toggleCamera");

  const first = toggleCamera();
  app.get("showHome")();
  toggleCamera();
  await settle();
  assert.equal(prompts.length, 2, "a new Start after a cancel must ask again");

  const late = fakeStream();
  prompts[0].resolve(late);
  await first;

  // The newer prompt is still open, so nothing is live yet.
  assert.equal(late.track.stopped, true);
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("state.stream"), null);
});

test("a refused prompt lets the next Start ask again", async () => {
  const { app, prompts } = loadWithCamera();
  const toggleCamera = app.get("toggleCamera");

  const first = toggleCamera();
  await settle();
  prompts[0].reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  await first;

  toggleCamera();
  await settle();
  assert.equal(prompts.length, 2);
});

// The information screens replace the camera workspace, so opening one
// releases the camera exactly as returning home does.
for (const mode of ["test", "qr", "project"]) {
  test(`opening #${mode} releases the camera`, () => {
    const { app, cancelledFrames } = loadWithCamera();
    const stream = runningCamera(app);

    app.get("setMode")(mode);

    assert.equal(stream.track.stopped, true, "the stream's tracks must be stopped");
    assert.equal(app.evaluate("state.cameraOn"), false);
    assert.equal(app.evaluate("state.stream"), null);
    assert.deepEqual(cancelledFrames, [7], "the detection loop must be cancelled");
    assert.equal(app.evaluate("mpRunning"), false);
    assert.equal(app.evaluate("__handClosed"), true, "the hand task must be closed");
  });
}

test("opening an information screen during the prompt stops the stream when it arrives", async () => {
  const { app, prompts } = loadWithCamera();

  const starting = app.get("toggleCamera")();
  app.get("setMode")("test");
  const stream = fakeStream();
  prompts[0].resolve(stream);
  await starting;

  assert.equal(stream.track.stopped, true);
  assert.equal(app.evaluate("state.cameraOn"), false);
});

test("switching between live modes keeps the camera running", () => {
  const { app } = loadWithCamera();
  const stream = runningCamera(app);

  app.get("setMode")("word");
  app.get("setMode")("coach");
  app.get("setMode")("letter");

  assert.equal(stream.track.stopped, false);
  assert.equal(app.evaluate("state.cameraOn"), true);
  assert.equal(app.evaluate("mpRunning"), true);
});
