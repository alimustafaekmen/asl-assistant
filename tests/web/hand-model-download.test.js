// The hand model is 7.8 MB, and a private window downloads it again on every
// camera start. One download serves the whole visit: a reopened camera, a
// stop in the middle of the download, a rebuild after a lost GPU context.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

const handDownloads = (camera) => camera.downloads.filter((download) => download.url.endsWith("/hand_landmarker.task"));
const toggle = (camera) => camera.app.get("toggleCamera")();
const LETTER_SESSION = { inputNames: ["input"], outputNames: ["label", "probabilities"], run: async () => ({}) };

test("a reopened camera does not download the hand model again", async () => {
  const camera = appWithFakeCamera();
  await toggle(camera);
  await flush();
  assert.equal(camera.app.evaluate("mpRunning"), true, "precondition: hand tracking runs");

  toggle(camera);
  await toggle(camera);
  await flush();

  assert.equal(camera.app.evaluate("mpRunning"), true);
  assert.equal(camera.created("hand").length, 2, "precondition: the reopened camera made its own task");
  assert.equal(handDownloads(camera).length, 1, "the hand model was downloaded again");
});

test("a download a stop interrupted serves the next start", async () => {
  const camera = appWithFakeCamera({ hold: { models: true } });
  toggle(camera);
  await flush();
  assert.equal(handDownloads(camera).length, 1, "precondition: the hand model is downloading");

  toggle(camera);
  const reopened = toggle(camera);
  await flush();
  handDownloads(camera).forEach((download) => download.resolve());
  await reopened;
  await flush();

  assert.equal(handDownloads(camera).length, 1, "the reopened camera started a second download");
  assert.equal(camera.app.evaluate("mpRunning"), true);
  assert.equal(camera.alive("hand"), 1);
  assert.equal(camera.frames.pending.size, 1, "one detection loop");
});

/**
 * The fake camera whose hand model requests get `answer` until `restore()`;
 * every request after that reaches the model server again.
 */
function cameraWithFailingHandModel(answer) {
  // The letter model loads, so the plate reports the hand model alone.
  const camera = appWithFakeCamera({ hold: { onnx: true } });
  const pageFetch = camera.app.evaluate("fetch");
  const failed = { count: 0, on: true };
  camera.app.evaluate("globalThis").fetch = (input, init) => {
    if (!failed.on || !String(input).endsWith("/hand_landmarker.task")) return pageFetch(input, init);
    failed.count += 1;
    return answer();
  };
  return { camera, failed };
}

for (const [name, answer] of [
  ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["an error page", () => Promise.resolve({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })],
]) {
  test(`a download that ends in ${name} is tried again on the next start`, async () => {
    const { camera, failed } = cameraWithFailingHandModel(answer);
    const started = toggle(camera);
    await flush();
    camera.onnx.pending.forEach((gate) => gate.resolve(LETTER_SESSION));
    await started;
    await flush();
    assert.ok(failed.count > 0, "precondition: the hand model was asked for");
    assert.equal(camera.app.evaluate("mpRunning"), false, "a failed download started tracking");
    assert.equal(
      camera.app.evaluate("els.confidenceMessage.textContent"),
      camera.app.evaluate('t("shell.tracking.failed")'),
    );

    failed.on = false;
    if (camera.app.evaluate("state.cameraOn")) toggle(camera);
    await toggle(camera);
    await flush();

    assert.equal(handDownloads(camera).length, 1, "the next start did not download the hand model");
    assert.equal(camera.app.evaluate("mpRunning"), true);
  });
}

test("a rebuild after a lost GPU context uses the model already downloaded", async () => {
  const camera = appWithFakeCamera();
  const canvases = [];
  const create = camera.vision.HandLandmarker.createFromOptions;
  camera.vision.HandLandmarker.createFromOptions = (resolver, options) => {
    canvases.push(options?.canvas);
    return create(resolver, options);
  };
  await toggle(camera);
  await flush();

  canvases[0].dispatchEvent({ type: "webglcontextlost", target: canvases[0] });
  await flush();

  assert.equal(camera.created("hand").length, 2, "precondition: tracking was rebuilt");
  assert.equal(camera.app.evaluate("mpRunning"), true);
  assert.equal(handDownloads(camera).length, 1, "the rebuild downloaded the hand model again");
});
