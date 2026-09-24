// What the word record button says before and after the camera starts.
//
// Word recording needs the MediaPipe pose and face tasks, which only start with
// the camera. Before that nothing is loading, so the button must ask for the
// camera rather than claim to be loading.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

function buttonIn(mode, { cameraOn, mpRunning }) {
  const app = loadWebApp();
  app.evaluate(`
    state.mode = ${JSON.stringify(mode)};
    state.coachTarget = "water";
    state.cameraOn = ${cameraOn};
    mpRunning = ${mpRunning};
  `);
  app.get("syncRecordButton")();
  return {
    text: app.evaluate("els.recordWord.textContent"),
    disabled: app.evaluate("els.recordWord.disabled"),
  };
}

for (const mode of ["word", "coach"]) {
  test(`${mode}: with the camera off the button asks for the camera`, () => {
    const button = buttonIn(mode, { cameraOn: false, mpRunning: false });

    assert.equal(button.disabled, true);
    assert.doesNotMatch(button.text, /Yükleniyor/, "nothing loads before the camera starts");
    assert.match(button.text, /Kamera/);
  });

  test(`${mode}: with the camera on and the tasks starting it says loading`, () => {
    const button = buttonIn(mode, { cameraOn: true, mpRunning: false });

    assert.equal(button.disabled, true);
    assert.match(button.text, /Yükleniyor/);
  });
}
