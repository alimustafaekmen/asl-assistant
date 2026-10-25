// ONNX Runtime Web needs WebAssembly SIMD. A browser without it is told so
// before the camera prompt, and is not offered a retry or the demo, which
// need the same runtime.
//
// The browser's WebAssembly engine is the boundary: its validate() is made to
// reject any module that uses a SIMD instruction (opcode prefix 0xfd).

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";

function withoutSimd(options) {
  const camera = appWithFakeCamera(options);
  camera.app.evaluate(`(() => {
    const validate = WebAssembly.validate.bind(WebAssembly);
    WebAssembly.validate = (bytes) => validate(bytes) && !new Uint8Array(bytes).includes(0xfd);
  })()`);
  return camera;
}

function stageOf(app) {
  return app.evaluate(`(() => {
    const byId = (id) => document.getElementById(id);
    return {
      camera: els.cameraStage.dataset.camera ?? null,
      problem: !byId("cameraProblem").hidden,
      title: byId("cameraProblemTitle").textContent.trim(),
      retry: !byId("cameraRetry").hidden,
      demo: !byId("cameraNoCamera").hidden,
      help: !byId("cameraHelp").hidden,
      on: state.cameraOn,
    };
  })()`);
}

for (const [languages, lang] of [[["tr-TR"], "tr"], [["en-US"], "en"]]) {
  for (const mode of ["letter", "word"]) {
    test(`${lang} ${mode}: a browser without WebAssembly SIMD is told so before the camera opens`, async () => {
      const camera = withoutSimd({ languages, mode });
      const { app } = camera;

      await app.get("toggleCamera")();
      await flush();

      assert.equal(camera.streams.length, 0, "the camera was asked for");
      assert.equal(camera.onnx.sessions, 0, "a model started to load");
      const stage = stageOf(app);
      assert.equal(stage.on, false);
      assert.equal(stage.camera, "outdated");
      assert.equal(stage.problem, true);
      assert.equal(stage.title, app.evaluate('t("shell.cameraProblem.outdated.title")'));
      assert.equal(stage.retry, false, "a retry cannot help");
      assert.equal(stage.demo, false, "the demo needs the same runtime");
      assert.equal(stage.help, false, "camera permission is not the problem");
    });
  }
}

test("a browser with SIMD opens the camera, and the demo and the help come back for a later problem", async () => {
  const camera = appWithFakeCamera({ hold: { onnx: true } });
  const { app } = camera;
  app.evaluate(`(() => {
    const validate = WebAssembly.validate.bind(WebAssembly);
    globalThis.__simd = false;
    WebAssembly.validate = (bytes) => validate(bytes) && (__simd || !new Uint8Array(bytes).includes(0xfd));
  })()`);
  await app.get("toggleCamera")();
  await flush();
  assert.equal(stageOf(app).demo, false, "precondition: the outdated problem hides the demo");

  app.evaluate("__simd = true");
  const nav = app.get("navigator");
  nav.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error("busy"), { name: "NotReadableError" });
  };
  await app.get("toggleCamera")();
  await flush();
  assert.equal(stageOf(app).camera, "busy");
  assert.equal(stageOf(app).demo, true);
  assert.equal(stageOf(app).help, true);
});
