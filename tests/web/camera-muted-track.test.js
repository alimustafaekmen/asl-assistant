// A muted camera track (an incoming call, another app taking the camera)
// stays live but sends no new picture, and MediaPipe keeps re-reading the
// last frame. The plate must not keep reporting the letter in that still
// image, where Space would add it; reading resumes when the picture returns.
//
// The camera, MediaPipe and ONNX Runtime are faked at their boundaries
// (helpers/fake-camera.mjs): the hand task sees one hand, and the letter
// session reads it as A.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const read = (app, expression) => app.evaluate(expression);
const text = (app, key) => app.evaluate(`t(${JSON.stringify(key)})`);
const plate = (app) => read(app, "els.primaryPrediction.textContent");
const sessionRuns = (app) => read(app, "globalThis.__letterRuns");

/** Browser frames, each with time for the inference it starts. */
async function frames(camera, count) {
  for (let i = 0; i < count; i++) {
    camera.runFrame();
    await flush(2);
  }
}

/** A live letter camera that reads A; `boot` runs init() first, which binds the page events. */
async function readingA(languages, { boot = false } = {}) {
  const camera = appWithFakeCamera({ hold: { onnx: true }, languages });
  const { app } = camera;
  if (boot) await app.get("init")();
  const starting = app.get("toggleCamera")();
  await flush();
  app.evaluate(`
    ort.Tensor = function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; };
    globalThis.__letterRuns = 0;
  `);
  camera.onnx.pending[0].resolve(app.evaluate(`({
    inputNames: ["input"],
    outputNames: ["label", "probabilities"],
    run: async () => {
      globalThis.__letterRuns += 1;
      const probabilities = new Float32Array(24).fill(0.03 / 23);
      probabilities[0] = 0.97;
      return { label: { data: [0n] }, probabilities: { data: probabilities } };
    },
  })`));
  await starting;
  await flush();
  app.evaluate(`
    handLandmarker.detectForVideo = () => ({
      landmarks: [Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + (i % 5) / 50, y: 0.3 + Math.floor(i / 5) / 20, z: 0 }))],
      handednesses: [[{ categoryName: "Right", displayName: "Right", score: 0.95, index: 0 }]],
    });
    requestAnimationFrame(renderLoop);
  `);
  await frames(camera, 30);
  assert.equal(plate(app), "A", "precondition: the camera reads A");
  assert.equal(read(app, "els.cameraStage.dataset.state"), "good", "precondition: a clear letter");
  return camera;
}

for (const languages of [["tr-TR", "tr"], ["en-US", "en"]]) {
  const lang = languages[1];

  test(`${lang}: a muted track stops the reading and says the picture stopped`, async () => {
    const camera = await readingA(languages);
    const { app } = camera;

    camera.streams[0].tracks[0].mute();

    assert.equal(plate(app), "?");
    assert.notEqual(read(app, "els.cameraStage.dataset.state"), "good");
    assert.equal(read(app, "els.latencyBadge.textContent"), text(app, "shell.badge.paused"));
    assert.equal(read(app, "els.confidenceMessage.textContent"), text(app, "shell.camera.paused"));

    const runs = sessionRuns(app);
    await frames(camera, 30);
    app.get("updateMediaPipeStatus")(10_000_000);
    assert.equal(plate(app), "?", "the frozen frame is not read again");
    assert.equal(sessionRuns(app), runs, "the letter model does not run on the frozen frame");
    assert.equal(read(app, "els.latencyBadge.textContent"), text(app, "shell.badge.paused"));
    assert.equal(read(app, "state.cameraOn"), true, "the camera itself stays on");
  });

  test(`${lang}: an unmuted track plays again and reads letters again`, async () => {
    const camera = await readingA(languages);
    const { app } = camera;
    const track = camera.streams[0].tracks[0];
    track.mute();
    const plays = camera.plays.length;

    track.unmute();

    assert.equal(camera.plays.length, plays + 1, "the video is played again");
    assert.equal(read(app, "els.confidenceMessage.textContent"), text(app, "shell.models.ready"));
    await frames(camera, 30);
    assert.equal(plate(app), "A");
  });
}

test("coming back to a page whose camera is still muted keeps the reading paused", async () => {
  const camera = await readingA(undefined, { boot: true });
  const { app } = camera;
  camera.streams[0].tracks[0].mute();
  const plays = camera.plays.length;

  app.evaluate(`document.visibilityState = "hidden"; document.dispatchEvent({ type: "visibilitychange" });`);
  app.evaluate(`document.visibilityState = "visible"; document.dispatchEvent({ type: "visibilitychange" });`);
  await frames(camera, 30);

  assert.equal(plate(app), "?");
  assert.equal(read(app, "els.latencyBadge.textContent"), text(app, "shell.badge.paused"));
  assert.equal(camera.plays.length, plays, "a muted video is not played");
});

test("coming back to the page plays the camera video again", async () => {
  const camera = await readingA(undefined, { boot: true });
  const plays = camera.plays.length;

  camera.app.evaluate(`document.visibilityState = "hidden"; document.dispatchEvent({ type: "visibilitychange" });`);
  camera.app.evaluate(`document.visibilityState = "visible"; document.dispatchEvent({ type: "visibilitychange" });`);

  assert.equal(camera.plays.length, plays + 1);
});

test("a mute of a camera already stopped changes nothing", async () => {
  const camera = await readingA();
  const { app } = camera;
  const track = camera.streams[0].tracks[0];
  await app.get("toggleCamera")();
  assert.equal(read(app, "state.cameraOn"), false, "precondition: stopped");
  const message = read(app, "els.confidenceMessage.textContent");
  const badge = read(app, "els.latencyBadge.textContent");

  track.mute();
  track.unmute();

  assert.equal(read(app, "els.confidenceMessage.textContent"), message);
  assert.equal(read(app, "els.latencyBadge.textContent"), badge);
  assert.equal(camera.plays.length, 1, "a stopped camera is not played again");
});

test("a muted track during a word countdown abandons the countdown", async () => {
  const camera = appWithFakeCamera({ mode: "word", hold: { onnx: true } });
  const { app } = camera;
  app.get("setMode")("word");
  const starting = app.get("toggleCamera")();
  await flush();
  app.evaluate(`ort.Tensor = function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; };`);
  camera.onnx.pending[0].resolve({ inputNames: ["input", "mask"], outputNames: ["logits"], run: async () => ({}) });
  await starting;
  await flush();
  app.get("startWordRecording")();
  await flush();
  assert.equal(read(app, "state.wordState"), "COUNTDOWN", "precondition: counting down");

  camera.streams[0].tracks[0].mute();

  assert.equal(read(app, "state.wordState"), "IDLE");
  assert.equal(read(app, "els.countdown.hidden"), true);
  assert.equal(read(app, "els.confidenceMessage.textContent"), text(app, "shell.camera.paused"));
});
