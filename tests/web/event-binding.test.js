// Event binding and keyboard shortcut contracts.
//
// Every binding in bindEvents() adds a listener rather than replacing one, so
// the only thing stopping a second call from doubling them is the guard. The
// vm context counts addEventListener calls, which is enough to show that.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

test("binding events twice leaves one listener of each", () => {
  const app = loadWebApp();
  const bindEvents = app.get("bindEvents");

  bindEvents();
  const afterFirst = app.listenerCount();
  bindEvents();
  const afterSecond = app.listenerCount();

  assert.ok(afterFirst > 0, "the first bind should register listeners");
  assert.equal(
    afterSecond,
    afterFirst,
    "a second bindEvents() must not add a second copy of every listener",
  );
});

test("the bind guard is what makes the second call a no-op", () => {
  const app = loadWebApp();
  const bindEvents = app.get("bindEvents");

  bindEvents();
  assert.equal(app.evaluate("_eventsBound"), true);
});


test("form controls consume plain typing, the page does not", () => {
  const app = loadWebApp();
  const isEditableTarget = app.get("isEditableTarget");

  for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON"]) {
    assert.equal(isEditableTarget(app.makeTarget({ tagName })), true, tagName);
  }
  assert.equal(isEditableTarget(app.makeTarget({ tagName: "DIV" })), false);
  assert.equal(
    isEditableTarget(app.makeTarget({ tagName: "DIV", isContentEditable: true })),
    true,
  );
  // A key event can carry no target at all.
  assert.equal(isEditableTarget(null), false);
});

test("global shortcuts ignore keys typed into a form control", () => {
  const app = loadWebApp();
  app.get("bindEvents")();
  const onKeyDown = app.windowHandler("keydown");
  assert.ok(onKeyDown, "bindEvents() should bind a keydown handler");

  // Stand in for the three shortcut commands so the test observes intent
  // rather than the DOM writes each one performs.
  app.evaluate(`
    globalThis.__fired = [];
    speakTranscript = () => __fired.push("speak");
    clearTranscript = () => __fired.push("clear");
    cycleMode = () => __fired.push("cycle");
  `);

  const press = (key, target) =>
    onKeyDown({ key, code: `Key${key.toUpperCase()}`, target, preventDefault() {} });

  // Typing into the coach target select performs type-ahead. Before the guard,
  // "c" cleared the transcript and "m" left the screen.
  const select = app.makeTarget({ tagName: "SELECT" });
  for (const key of ["s", "c", "m"]) press(key, select);
  assert.deepStrictEqual([...app.evaluate("__fired")], []);

  // The same keys still work when focus is not in a control.
  const page = app.makeTarget({ tagName: "DIV" });
  for (const key of ["s", "c", "m"]) press(key, page);
  assert.deepStrictEqual([...app.evaluate("__fired")], ["speak", "clear", "cycle"]);
});

test("space over a focused button is left to the button", () => {
  const app = loadWebApp();
  app.get("bindEvents")();
  const onKeyDown = app.windowHandler("keydown");
  app.evaluate('state.mode = "letter"; globalThis.__appended = 0; appendCurrentLetter = () => { __appended += 1; };');

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    target: app.makeTarget({ tagName: "BUTTON" }),
    preventDefault() { prevented = true; },
  };
  onKeyDown(event);

  // Cancelling the key would stop the button activating for a keyboard user.
  assert.equal(prevented, false);
  assert.equal(app.evaluate("__appended"), 0);
});
