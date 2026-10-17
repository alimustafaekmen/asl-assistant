// A word recording needs hand tracking; without the camera code there is none.
//
// The record button and the start of a recording read the MediaPipe state
// camera.js declares. The fault these tests kill is reading "not declared"
// as "ready": on a page that could not fetch camera.js the button is enabled
// with the camera on, and a recording counts down into a buffer nothing can
// fill. Undeclared has to mean not ready, in the button and in the start.
//
// The script is unloaded at the network boundary; the camera (getUserMedia
// and the video's playback) and ONNX Runtime are faked. Everything else is
// the booted app, driven through its own controls.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";
import { fakeOrt } from "./helpers/word-recording.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** The word screen without camera.js, with its camera started from the stage. */
async function wordScreenWithoutCameraCode() {
  const ort = fakeOrt();
  const app = loadWebApp({
    boot: true,
    unloadedScripts: ["js/media/camera.js"],
    globals: {
      console: quietConsole,
      location: new URL("https://asl-assistant.netlify.app/#word"),
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const track = { kind: "video", stop() {}, addEventListener() {}, removeEventListener() {} };
            return { getTracks: () => [track], getVideoTracks: () => [track] };
          },
        },
      },
      ort: ort.ort,
    },
  });
  await app.ready.catch(() => {});
  app.evaluate(`
    els.video.play = async () => {};
    els.video.readyState = 4;
    els.video.videoWidth = 640;
    els.video.videoHeight = 480;
  `);
  app.evaluate(`document.querySelector('[data-trigger="camera"]')`).dispatchEvent({ type: "click", detail: 1 });
  await flush(20);
  assert.equal(app.evaluate("state.mode"), "word", "precondition: the word screen is open");
  assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera is on");
  return { app, ort };
}

/** Click a mode tab, as the visitor does. */
const openTab = (app, mode) =>
  app.evaluate(`document.querySelector('[data-ui="mode-tab"][data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });

test("without the camera code the record button stays disabled with the camera on", async () => {
  const { app } = await wordScreenWithoutCameraCode();

  // Coming back to the word screen redraws the button for the camera now on.
  openTab(app, "letter");
  openTab(app, "word");
  await flush();
  assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera stayed on across the camera screens");

  assert.equal(app.evaluate("els.recordWord.disabled"), true, "a recording nothing can fill was offered");
});

test("without the camera code a recording asked for from the keyboard does not start", async () => {
  const { app } = await wordScreenWithoutCameraCode();

  app.windowHandler("keydown")({
    key: "Enter",
    code: "Enter",
    target: app.makeTarget({ tagName: "DIV" }),
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
  });
  await flush(20);

  assert.equal(app.evaluate("state.wordState"), "IDLE", "a recording started with no hand tracking");
  assert.equal(app.evaluate("els.countdown.hidden"), true, "a countdown was shown");
});
