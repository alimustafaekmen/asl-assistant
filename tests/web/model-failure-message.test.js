// When the letter model fails to load, the plate keeps its "reload the page"
// text: a reload is the one thing that recovers a failed ONNX Runtime start.
// Neither the five-second no-hand hint nor a hand-tracking failure that
// says "try again" may replace it, and a failed tracking start keeps its badge.
//
// The camera, MediaPipe and ONNX Runtime are faked at their boundaries
// (helpers/fake-camera.mjs). An ONNX session that is not held fails, as offline.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const LETTER_SESSION = { inputNames: ["input"], outputNames: ["label", "probabilities"], run: async () => ({}) };

const message = (app) => app.evaluate("els.confidenceMessage.textContent");
const badge = (app) => app.evaluate("els.latencyBadge.textContent");
const text = (app, key) => app.evaluate(`t(${JSON.stringify(key)})`);

/** Seconds of status ticks with the camera seeing no hand. */
function noHandFor(camera, seconds) {
  camera.runFrame();
  for (let s = 1; s <= seconds; s++) camera.app.get("updateMediaPipeStatus")(100000 + s * 1000);
}

for (const languages of [["tr-TR", "tr"], ["en-US", "en"]]) {
  const lang = languages[1];

  test(`${lang}: the no-hand hint does not replace a failed model download`, async () => {
    const camera = appWithFakeCamera({ languages });
    const { app } = camera;
    await app.get("toggleCamera")();
    await flush();
    assert.equal(app.evaluate("aslDebug.mediapipe.handLandmarker"), true, "precondition: hand tracking runs");
    assert.equal(message(app), text(app, "shell.models.failed"), "precondition: the failure is reported");

    noHandFor(camera, 7);

    assert.equal(message(app), text(app, "shell.models.failed"));
  });

  test(`${lang}: a hand coming into view does not replace a failed model download`, async () => {
    const camera = appWithFakeCamera({ languages });
    const { app } = camera;
    await app.get("toggleCamera")();
    await flush();
    noHandFor(camera, 2);
    // The hand task now sees one right hand.
    app.evaluate(`handLandmarker.detectForVideo = () => ({
      landmarks: [Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i / 100, y: 0.5, z: 0 }))],
      handednesses: [[{ categoryName: "Right", displayName: "Right", score: 0.95, index: 0 }]],
    })`);
    camera.runFrame();
    camera.runFrame();
    assert.ok(app.evaluate("!!(latestMediaPipeResult.rightHandLandmarks || latestMediaPipeResult.leftHandLandmarks)"),
      "precondition: the hand is detected");

    app.get("updateMediaPipeStatus")(200000);

    assert.equal(badge(app), text(app, "shell.badge.handDetected"), "precondition: the badge reports the hand");
    assert.equal(message(app), text(app, "shell.models.failed"));
  });

  test(`${lang}: a hand-tracking failure keeps the reload text of a failed model`, async () => {
    const camera = appWithFakeCamera({ hold: { hand: true }, languages });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();
    camera.created("hand")[0].reject(new Error("GPU task download failed"));
    await flush();
    camera.created("hand")[1].reject(new Error("CPU task download failed"));
    await starting;
    await flush();

    assert.equal(message(app), text(app, "shell.models.failed"));
  });

  test(`${lang}: a failed tracking start keeps its badge`, async () => {
    const camera = appWithFakeCamera({ hold: { hand: true, onnx: true }, languages });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();
    camera.onnx.pending[0].resolve(LETTER_SESSION);
    camera.created("hand")[0].reject(new Error("GPU task download failed"));
    await flush();
    camera.created("hand")[1].reject(new Error("CPU task download failed"));
    await starting;
    await flush();
    assert.equal(message(app), text(app, "shell.tracking.failed"), "precondition: tracking alone failed");

    noHandFor(camera, 3);

    assert.equal(badge(app), text(app, "shell.badge.trackingMissing"));
    assert.equal(message(app), text(app, "shell.tracking.failed"));
  });

  test(`${lang}: with the model loaded, five seconds without a hand still bring the hint`, async () => {
    const camera = appWithFakeCamera({ hold: { onnx: true }, languages });
    const { app } = camera;
    const starting = app.get("toggleCamera")();
    await flush();
    camera.onnx.pending[0].resolve(LETTER_SESSION);
    await starting;
    await flush();
    assert.equal(message(app), text(app, "shell.models.ready"), "precondition: ready");

    noHandFor(camera, 5);

    assert.equal(message(app), text(app, "shell.hand.missing"));
  });
}
