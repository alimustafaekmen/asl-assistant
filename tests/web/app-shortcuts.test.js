// Keyboard shortcuts and modifier keys.
//
// The shortcut map: Space adds the current letter, Enter adds a space,
// Backspace removes the last character. Plain letter keys do nothing, S, C and
// M included: a single printable key that speaks, clears the text or leaves
// the screen, with no way to turn it off, fails WCAG 2.1.4.
//
// A key pressed with Ctrl, Meta, or Alt belongs to the browser: Cmd+Backspace
// and Alt+Enter are editing and system keys, not transcript commands. These
// tests drive the real keydown handler and read the transcript and mode it
// leaves behind; only the browser storage and the URL are faked.

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
  const codes = { " ": "Space", Enter: "Enter", Backspace: "Backspace" };
  const press = (key, modifiers = {}) =>
    onKeyDown({
      key,
      code: codes[key] ?? `Key${key.toUpperCase()}`,
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
  test(`${modifier} with Backspace leaves the transcript alone`, () => {
    const { app, press } = loadWithShortcuts();
    app.evaluate('state.transcript = "MERHABA"; state.mode = "letter";');

    press("Backspace", { [modifier]: true });

    assert.equal(app.evaluate("state.transcript"), "MERHABA");
  });

  test(`${modifier} with Enter leaves the transcript alone`, () => {
    const { app, press } = loadWithShortcuts();
    app.evaluate('state.transcript = "MERHABA"; state.mode = "letter";');

    press("Enter", { [modifier]: true });

    assert.equal(app.evaluate("state.transcript"), "MERHABA");
  });
}

test("Backspace removes the last character and Enter adds a space", () => {
  const { app, press } = loadWithShortcuts();
  app.evaluate('state.transcript = "MERHABA"; state.mode = "letter";');

  press("Backspace");
  assert.equal(app.evaluate("state.transcript"), "MERHAB");

  press("Enter");
  assert.equal(app.evaluate("state.transcript"), "MERHAB ");
});

test("Space adds the current letter in letter mode", () => {
  const { app, press } = loadWithShortcuts();
  app.evaluate(`
    state.transcript = "MERHAB"; state.mode = "letter";
    state.prediction = "A"; state.confidence = 0.95;
  `);

  press(" ");
  assert.equal(app.evaluate("state.transcript"), "MERHABA");
});

test("single-letter keys such as S, C and M do nothing", () => {
  const { app, press } = loadWithShortcuts();
  app.evaluate(`
    state.transcript = "MERHABA"; state.mode = "letter";
    globalThis.__spoken = 0; speakTranscript = () => { __spoken += 1; };
  `);

  for (const key of ["s", "c", "m", "S", "C", "M"]) press(key);

  assert.equal(app.evaluate("state.transcript"), "MERHABA");
  assert.equal(app.evaluate("state.mode"), "letter");
  assert.equal(app.evaluate("__spoken"), 0);
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
