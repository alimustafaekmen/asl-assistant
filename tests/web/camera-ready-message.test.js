// "Ready, show your hand" is a promise that a hand shown now is read. On a
// first start the letter model (2 MB) arrives well before the hand task
// (8 MB), so the message waits for both.
//
// The camera, MediaPipe and ONNX Runtime are faked at their boundaries
// (helpers/fake-camera.mjs); each download is held and let go by the test.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

/** A letter session as ONNX Runtime hands it over; its runs are not needed here. */
const LETTER_SESSION = { inputNames: ["input"], outputNames: ["label", "probabilities"], run: async () => ({}) };

const message = (app) => app.evaluate("els.confidenceMessage.textContent");
const text = (app, key) => app.evaluate(`t(${JSON.stringify(key)})`);

for (const languages of [["tr-TR", "tr"], ["en-US", "en"]]) {
  test(`${languages[1]}: the letter model alone does not make the camera ready`, async () => {
    const camera = appWithFakeCamera({ hold: { hand: true, onnx: true }, languages });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();
    assert.equal(camera.created("hand").length, 1, "precondition: the hand task is downloading");

    camera.onnx.pending[0].resolve(LETTER_SESSION);
    await flush();
    assert.equal(app.evaluate("aslDebug.models.letterSession"), true, "precondition: the letter model is ready");
    assert.equal(app.evaluate("aslDebug.mediapipe.handLandmarker"), false);
    assert.notEqual(message(app), text(app, "shell.models.ready"));

    camera.created("hand")[0].resolve();
    await starting;
    await flush();
    assert.equal(message(app), text(app, "shell.models.ready"));
  });
}

test("hand tracking ready first: the camera is ready when the letter model arrives", async () => {
  const camera = appWithFakeCamera({ hold: { onnx: true } });
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  assert.equal(app.evaluate("aslDebug.mediapipe.handLandmarker"), true, "precondition: hand tracking is ready");
  assert.notEqual(message(app), text(app, "shell.models.ready"));

  camera.onnx.pending[0].resolve(LETTER_SESSION);
  await flush();
  assert.equal(message(app), text(app, "shell.models.ready"));
});
