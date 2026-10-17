// One inference pass never rejects, even when camera.js never loaded.
//
// The render loop calls realInference() on every frame and does not wait for
// it or catch it; the function promises never to reject, logging failures
// instead. It reads the frame camera.js publishes, latestMediaPipeResult. If
// camera.js failed to load (a 404, a deploy that left it out), that name does
// not exist, and reading it bare throws a ReferenceError before any of the
// function's own error handling, which in a browser is an unhandled
// rejection on every frame. The fault this kills is that bare read.
//
// The network is the boundary: the script is one the page could not fetch.
// Everything else is the real app, not booted, with the camera marked on as
// the render loop would see it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

for (const mode of ["letter", "word"]) {
  test(`an inference pass in ${mode} mode resolves when camera.js never loaded`, async () => {
    const app = loadWebApp({ unloadedScripts: ["js/media/camera.js"], globals: { console: quietConsole } });
    assert.equal(app.has("latestMediaPipeResult"), false, "camera.js must not have published its frame");
    app.evaluate(`state.cameraOn = true; state.mode = ${JSON.stringify(mode)};`);

    await assert.doesNotReject(app.get("realInference")(1000));
  });
}
