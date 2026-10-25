// The plate's message line describes the camera as it is now. A stop puts it
// back to the idle text, and a start that succeeds after a lost camera does
// not leave "the camera was disconnected" under a live picture.
//
// The camera, MediaPipe and ONNX Runtime are faked at their boundaries
// (helpers/fake-camera.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const LETTER_SESSION = { inputNames: ["input"], outputNames: ["label", "probabilities"], run: async () => ({}) };

const message = (app) => app.evaluate("els.confidenceMessage.textContent");
const text = (app, key) => app.evaluate(`t(${JSON.stringify(key)})`);
const lostText = (app) => app.evaluate('`${t("shell.cameraProblem.ended.title")}. ${t("shell.cameraProblem.ended.text")}`');

const LANGUAGES = [["tr-TR", "tr"], ["en-US", "en"]];

for (const languages of LANGUAGES) {
  const lang = languages[1];

  test(`${lang}: a start after a lost camera replaces the lost-camera message`, async () => {
    const camera = appWithFakeCamera({ hold: { hand: true, onnx: true }, languages });
    const { app } = camera;
    const toggleCamera = app.get("toggleCamera");
    const first = toggleCamera();
    await flush();
    camera.onnx.pending[0].resolve(LETTER_SESSION);
    camera.created("hand")[0].resolve();
    await first;
    await flush();
    assert.equal(message(app), text(app, "shell.models.ready"), "precondition: the first start is ready");

    camera.streams[0].tracks[0].end();
    assert.equal(message(app), lostText(app), "precondition: the lost camera is reported");

    const retry = toggleCamera();
    await flush();
    assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera is live again");
    assert.equal(camera.created("hand").length, 2, "precondition: hand tracking is starting again");
    assert.notEqual(message(app), lostText(app));
    assert.equal(message(app), text(app, "shell.tracking.preparing"));

    camera.created("hand")[1].resolve();
    await retry;
    await flush();
    assert.equal(message(app), text(app, "shell.models.ready"));
  });

  test(`${lang}: stopping a ready camera puts the idle text back`, async () => {
    const camera = appWithFakeCamera({ hold: { onnx: true }, languages });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();
    camera.onnx.pending[0].resolve(LETTER_SESSION);
    await starting;
    await flush();
    assert.equal(message(app), text(app, "shell.models.ready"), "precondition: ready");

    await app.get("toggleCamera")();

    assert.equal(app.evaluate("state.cameraOn"), false);
    assert.equal(message(app), text(app, "letter.plate.idle"));
  });

  test(`${lang}: stopping while the models download puts the idle text back, and the download stays quiet`, async () => {
    const camera = appWithFakeCamera({ hold: { onnx: true }, languages });
    const { app } = camera;
    await app.get("toggleCamera")();
    await flush();
    assert.equal(message(app), text(app, "shell.models.downloading"), "precondition: downloading");

    await app.get("toggleCamera")();
    assert.equal(message(app), text(app, "letter.plate.idle"));

    camera.onnx.pending[0].resolve(LETTER_SESSION);
    await flush();
    assert.equal(message(app), text(app, "letter.plate.idle"), "a load that ends after the stop says nothing");
  });
}

test("stopping the coach's camera shows the coach's camera-off text", async () => {
  const camera = appWithFakeCamera({ mode: "coach", hold: { onnx: true } });
  const { app } = camera;
  app.get("setMode")("coach");
  const starting = app.get("toggleCamera")();
  await flush();
  camera.onnx.pending[0].resolve(LETTER_SESSION);
  await starting;
  await flush();
  assert.notEqual(message(app), app.evaluate('t("coach.plate.cameraOff")'), "precondition: the camera is on");

  await app.get("toggleCamera")();

  assert.equal(message(app), app.evaluate('t("coach.plate.cameraOff")'));
});
