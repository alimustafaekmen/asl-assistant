// What a screen reader hears.
//
// Camera and download errors went only to the visible message line, which is
// not a live region, so they were silent. The transcript's caret was read as a
// character and its English letters in a Turkish voice. And a live region
// whose text does not change is not announced again, so a second "A eklendi"
// was lost. getUserMedia is faked at the camera boundary; the rest is the
// app's own code.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a refused camera is announced, not only shown", async () => {
  const prompts = [];
  const app = loadWebApp({
    globals: {
      navigator: {
        mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => prompts.push({ resolve, reject })) },
      },
    },
  });
  app.evaluate('els.cameraStatus.lastChild = { textContent: "" };');

  const starting = app.get("toggleCamera")();
  await settle();
  prompts[0].reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  await starting;

  const shown = app.evaluate("els.confidenceMessage.textContent");
  assert.match(shown, /izni/);
  assert.equal(app.evaluate("els.announcer.textContent").trim(), shown);
});

test("the transcript marks its letters as English and hides the caret", () => {
  const app = loadWebApp();
  app.evaluate('state.transcript = "HELLO";');
  app.get("renderTranscript")();
  assert.equal(app.evaluate("els.transcriptText.lang"), "en");
  assert.match(app.evaluate("els.transcriptText.innerHTML"), /<span class="cursor" aria-hidden="true">/);

  app.evaluate('state.transcript = "";');
  app.get("renderTranscript")();
  // The placeholder is Turkish.
  assert.equal(app.evaluate("els.transcriptText.lang"), "tr");
});

test("the same message twice still changes the live region", () => {
  const app = loadWebApp();
  const announce = app.get("announce");

  announce("A eklendi");
  const first = app.evaluate("els.announcer.textContent");
  announce("A eklendi");
  const second = app.evaluate("els.announcer.textContent");

  assert.notEqual(first, second);
  assert.equal(first.trim(), "A eklendi");
  assert.equal(second.trim(), "A eklendi");
});
