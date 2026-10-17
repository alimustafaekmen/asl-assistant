// Hash routing contract.
//
// QR deep links and the browser back button both go through modeFromHash, so
// unknown input must resolve to the letter workspace instead of a blank screen.

import test from "node:test";
import assert from "node:assert/strict";

let modeFromHash;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  modeFromHash = loadWebApp().get("modeFromHash");
});

test("every published mode is reachable from its hash", () => {
  for (const mode of ["letter", "coach", "word", "project", "test", "qr"]) {
    assert.equal(modeFromHash(`#${mode}`), mode);
  }
});

test("the leading hash and letter case are optional", () => {
  assert.equal(modeFromHash("word"), "word");
  assert.equal(modeFromHash("#WORD"), "word");
  assert.equal(modeFromHash("#Qr"), "qr");
  assert.equal(modeFromHash("#word  "), "word");
});

test("unknown or empty input falls back to letter mode", () => {
  for (const hash of ["", "#", "#bogus", "#word-extra", null, undefined, 0]) {
    assert.equal(modeFromHash(hash), "letter");
  }
});

test("the brand link opens the letter screen with the camera released", async () => {
  // The app has no separate home view: the letter screen's empty camera stage
  // is where the app explains itself, so "home" means that screen.
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  const app = loadWebApp();
  app.evaluate(`
    globalThis.__stopped = 0;
    stopCamera = () => { __stopped += 1; state.cameraOn = false; };
    state.cameraOn = true;
    state.mode = "word";
  `);

  app.get("showHome")();

  assert.equal(app.evaluate("__stopped"), 1, "going home must release the camera");
  assert.equal(app.evaluate("state.mode"), "letter");
  assert.equal(app.evaluate("els.appShell.dataset.view"), "app");
});
