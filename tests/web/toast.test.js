// Confirmations: the toast the user sees and the line a screen reader hears.
//
// Copy feedback goes to the toast, not to the camera status chip, which the
// status loop rewrites every second; and clearing the transcript can be undone.
// The clock and the clipboard are faked; everything else is the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

function loadApp(extraGlobals = {}) {
  // A clock the test advances by hand; a cleared timer never runs.
  const timers = new Map();
  let nextId = 1;
  const app = loadWebApp({
    globals: {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout: (fn) => { timers.set(nextId, fn); return nextId++; },
      clearTimeout: (id) => { timers.delete(id); },
      ...extraGlobals,
    },
  });
  const runTimers = () => {
    const due = [...timers.values()];
    timers.clear();
    due.forEach((fn) => fn());
  };
  return { app, runTimers };
}

test("clearing the transcript offers an undo that brings the text back", () => {
  const { app } = loadApp();
  app.evaluate('state.transcript = "MERHABA";');

  app.get("clearTranscript")();
  assert.equal(app.evaluate("state.transcript"), "");
  assert.equal(app.evaluate("els.toast.hidden"), false);
  assert.equal(app.evaluate("els.toastText.textContent"), "Metin temizlendi");
  assert.equal(app.evaluate("els.toastAction.hidden"), false);

  app.evaluate("els.toastAction.onclick()");
  assert.equal(app.evaluate("state.transcript"), "MERHABA");
  assert.equal(app.evaluate("els.toast.hidden"), true);
});

test("clearing an empty transcript shows nothing to undo", () => {
  const { app } = loadApp();
  app.evaluate('state.transcript = ""; els.toast.hidden = true;');

  app.get("clearTranscript")();
  assert.equal(app.evaluate("els.toast.hidden"), true);
});

test("a copy is confirmed in the toast, not in the camera status chip", async () => {
  const written = [];
  const { app } = loadApp({
    navigator: { clipboard: { writeText: async (text) => { written.push(text); } } },
  });
  app.evaluate('state.transcript = "HELLO "; els.latencyBadge.textContent = "El algılandı";');

  await app.get("copyTranscript")();
  assert.deepEqual(written, ["HELLO"]);
  assert.equal(app.evaluate("els.toastText.textContent"), "Metin kopyalandı");
  assert.equal(app.evaluate("els.latencyBadge.textContent"), "El algılandı");
  assert.equal(app.evaluate("els.announcer.textContent"), "Metin kopyalandı");
});

test("a toast hides itself after a while", () => {
  const { app, runTimers } = loadApp();
  app.get("showToast")("Metin kopyalandı");
  assert.equal(app.evaluate("els.toast.hidden"), false);
  runTimers();
  assert.equal(app.evaluate("els.toast.hidden"), true);
});

test("an added letter is announced to screen readers", () => {
  const { app } = loadApp();
  app.evaluate(`
    state.mode = "letter"; state.transcript = "";
    state.prediction = "L"; state.confidence = 0.95;
  `);

  app.get("appendCurrentLetter")();
  assert.equal(app.evaluate("state.transcript"), "L");
  assert.equal(app.evaluate("els.announcer.textContent"), "L eklendi");
});

test("an undo toast waits while it has focus or the pointer, then returns focus", () => {
  const { app, runTimers } = loadApp();
  app.evaluate(`
    state.transcript = "MERHABA";
    globalThis.__returned = 0;
    els.clearText.focus = () => { __returned += 1; };
  `);
  app.get("clearTranscript")();

  app.evaluate("els.toastAction.onfocus()");
  runTimers();
  assert.equal(app.evaluate("els.toast.hidden"), false, "a focused toast must not time out");
  app.evaluate("els.toastAction.onblur()");
  runTimers();
  assert.equal(app.evaluate("els.toast.hidden"), true);

  app.evaluate('state.transcript = "HELLO";');
  app.get("clearTranscript")();
  app.evaluate("els.toast.onmouseenter()");
  runTimers();
  assert.equal(app.evaluate("els.toast.hidden"), false, "a hovered toast must not time out");
  app.evaluate("els.toastAction.onclick()");
  assert.equal(app.evaluate("__returned"), 1, "after undo, focus goes back to the clear button");
});

// A second clear while the first one's undo is still offered must not replace
// that undo, or "Geri al" would bring back only the second part and lose the
// first for good. While the toast is up, clears add up; "Geri al" restores all
// of it, in order.

test("a second clear keeps the first restorable", () => {
  const { app } = loadApp();
  app.evaluate('state.transcript = "ABC";');
  app.get("clearTranscript")();
  app.evaluate('state.mode = "letter"; state.prediction = "D"; state.confidence = 0.95;');
  app.get("appendCurrentLetter")();
  assert.equal(app.evaluate("state.transcript"), "D", "precondition: typed after the first clear");

  app.get("clearTranscript")();
  app.evaluate("els.toastAction.onclick()");

  assert.equal(app.evaluate("state.transcript"), "ABCD");
});

test("once the undo toast has gone, the next clear starts its own undo", () => {
  const { app, runTimers } = loadApp();
  app.evaluate('state.transcript = "XY";');
  app.get("clearTranscript")();
  runTimers();
  assert.equal(app.evaluate("els.toast.hidden"), true, "precondition: the first undo is no longer offered");

  app.evaluate('state.transcript = "Z";');
  app.get("clearTranscript")();
  app.evaluate("els.toastAction.onclick()");

  assert.equal(app.evaluate("state.transcript"), "Z");
});

test("a toast that replaces the undo ends it, so the next clear starts afresh", () => {
  const { app } = loadApp();
  app.evaluate('state.transcript = "AB";');
  app.get("clearTranscript")();
  app.get("showToast")("Kopyalanacak metin yok");

  app.evaluate('state.transcript = "C";');
  app.get("clearTranscript")();
  app.evaluate("els.toastAction.onclick()");

  assert.equal(app.evaluate("state.transcript"), "C");
});
