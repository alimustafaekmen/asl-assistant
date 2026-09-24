// Single-letter shortcuts and modifier keys.
//
// A key pressed with Ctrl, Meta, or Alt belongs to the browser: Cmd+C and
// Ctrl+C are copy, not "clear the transcript". These tests drive the real
// keydown handler and read the transcript and mode it leaves behind; only the
// browser storage and the URL are faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

function loadWithShortcuts() {
  const app = loadWebApp({
    globals: {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { hash: "#letter" },
      history: { replaceState() {} },
    },
  });
  app.get("bindEvents")();
  const onKeyDown = app.windowHandler("keydown");
  assert.ok(onKeyDown, "bindEvents() should bind a keydown handler");
  const page = app.makeTarget({ tagName: "DIV" });
  /** @param {string} key @param {Record<string, boolean>} [modifiers] */
  const press = (key, modifiers = {}) =>
    onKeyDown({
      key,
      code: `Key${key.toUpperCase()}`,
      target: page,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      preventDefault() {},
    });
  return { app, press };
}

for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
  test(`${modifier} with c leaves the transcript alone`, () => {
    const { app, press } = loadWithShortcuts();
    app.evaluate('state.transcript = "MERHABA";');

    press("c", { [modifier]: true });
    press("C", { [modifier]: true, shiftKey: true });

    assert.equal(app.evaluate("state.transcript"), "MERHABA");
  });

  test(`${modifier} with m leaves the mode alone`, () => {
    const { app, press } = loadWithShortcuts();
    app.evaluate('state.mode = "letter";');

    press("m", { [modifier]: true });

    assert.equal(app.evaluate("state.mode"), "letter");
  });
}

test("the unmodified shortcuts still act", () => {
  const { app, press } = loadWithShortcuts();
  app.evaluate('state.transcript = "MERHABA"; state.mode = "letter";');

  press("c");
  assert.equal(app.evaluate("state.transcript"), "");

  press("m");
  assert.equal(app.evaluate("state.mode"), "word");
});

test("ctrl with d still toggles the debug panel", () => {
  const { app, press } = loadWithShortcuts();
  app.evaluate("state.debug = false;");

  press("d", { ctrlKey: true });
  assert.equal(app.evaluate("state.debug"), true);
  assert.equal(app.evaluate("els.debugPanel.hidden"), false);

  press("d", { ctrlKey: true });
  assert.equal(app.evaluate("state.debug"), false);
});
