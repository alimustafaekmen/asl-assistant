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
    state.mode = "letter";
    appendCurrentLetter = () => __fired.push("add");
    insertSpaceInTranscript = () => __fired.push("space");
    removeLastTranscriptChar = () => __fired.push("delete");
  `);

  const codes = { " ": "Space", Enter: "Enter", Backspace: "Backspace" };
  const press = (key, target) =>
    onKeyDown({ key, code: codes[key], target, preventDefault() {} });

  // In a select, Space opens the list and Backspace edits type-ahead; in a
  // text field they edit text. None of them may reach the transcript.
  for (const tagName of ["SELECT", "INPUT", "TEXTAREA"]) {
    const control = app.makeTarget({ tagName });
    for (const key of [" ", "Enter", "Backspace"]) press(key, control);
  }
  assert.deepStrictEqual([...app.evaluate("__fired")], []);

  // The same keys work when focus is not in a control.
  const page = app.makeTarget({ tagName: "DIV" });
  for (const key of [" ", "Enter", "Backspace"]) press(key, page);
  assert.deepStrictEqual([...app.evaluate("__fired")], ["add", "space", "delete"]);
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

test("trigger buttons elsewhere in the markup reach the same camera commands", () => {
  const app = loadWebApp();
  // Stand in for the commands, and hand bindEvents one element per trigger so
  // the test can click it. The empty camera stage carries these triggers; the
  // toggles they mirror live in the action bar.
  app.evaluate(`
    globalThis.__fired = [];
    toggleCamera = () => __fired.push("camera");
    globalThis.__clicks = new Map();
    const realQueryAll = document.querySelectorAll;
    document.querySelectorAll = (selector) => {
      const match = /^\\[data-trigger="([\\w-]+)"\\]$/.exec(selector);
      if (!match) return realQueryAll(selector);
      const button = new HTMLElement();
      button.addEventListener = (type, handler) => __clicks.set(match[1], handler);
      return [button];
    };
  `);
  app.get("bindEvents")();

  const clicks = app.evaluate("__clicks");
  assert.ok(clicks.has("camera"), "a camera trigger should get a click handler");
  assert.ok(!clicks.has("coach-start"), "the coach starts the camera with the shared camera trigger");
  clicks.get("camera")();
  assert.deepStrictEqual([...app.evaluate("__fired")], ["camera"]);
});

test("choosing a mode from the phone menu closes the menu", () => {
  const app = loadWebApp();
  app.evaluate(`
    globalThis.__modes = [];
    globalThis.__closed = 0;
    setMode = (mode) => __modes.push(mode);
    globalThis.__tabs = [];
    const realQueryAll = document.querySelectorAll;
    document.querySelectorAll = (selector) => {
      if (selector !== '[data-ui="mode-tab"]') return realQueryAll(selector);
      const menu = new HTMLElement();
      menu.matches = () => true;
      menu.hidePopover = () => { __closed += 1; };
      const inMenu = new HTMLElement();
      inMenu.dataset.mode = "test";
      inMenu.closest = () => menu;
      const inBar = new HTMLElement();
      inBar.dataset.mode = "letter";
      inBar.closest = () => null;
      for (const tab of [inMenu, inBar]) {
        tab.addEventListener = (type, handler) => __tabs.push(handler);
      }
      return [inMenu, inBar];
    };
  `);
  app.get("bindEvents")();

  const [clickMenuTab, clickBarTab] = app.evaluate("__tabs");
  clickMenuTab();
  clickBarTab();
  assert.deepStrictEqual([...app.evaluate("__modes")], ["test", "letter"]);
  assert.equal(app.evaluate("__closed"), 1, "only the tab inside the menu closes it");
});

test("a pointer click leaves no button focused, a keyboard press does", () => {
  // A clicked button keeps focus, so the next Space would press it again
  // (another space after Boşluk) instead of adding the current letter.
  const app = loadWebApp();
  app.get("bindEvents")();
  const onClick = app.windowHandler("click");
  assert.ok(onClick, "bindEvents() should bind a click handler on the window");

  app.evaluate("globalThis.__blurred = 0;");
  const button = app.makeTarget({ tagName: "BUTTON" });
  button.blur = () => app.evaluate("__blurred += 1");
  const icon = app.makeTarget({ tagName: "SPAN" });
  icon.closest = (selector) => (selector === "button" ? button : null);

  onClick({ detail: 1, target: icon });
  assert.equal(app.evaluate("__blurred"), 1, "a pointer click on a button's child releases the button");

  onClick({ detail: 0, target: icon });
  assert.equal(app.evaluate("__blurred"), 1, "Enter or Space on a focused button keeps its focus");

  const page = app.makeTarget({ tagName: "DIV" });
  page.closest = () => null;
  onClick({ detail: 1, target: page });
  assert.equal(app.evaluate("__blurred"), 1);
});

test("transcript keys leave links, summaries and button-like elements alone", () => {
  // Enter follows a focused link and opens a focused <summary>; the reference
  // image is a role=button with its own Enter and Space handling.
  const app = loadWebApp();
  app.get("bindEvents")();
  const onKeyDown = app.windowHandler("keydown");
  app.evaluate(`
    globalThis.__fired = [];
    state.mode = "letter";
    appendCurrentLetter = () => __fired.push("add");
    insertSpaceInTranscript = () => __fired.push("space");
    removeLastTranscriptChar = () => __fired.push("delete");
  `);
  const codes = { " ": "Space", Enter: "Enter", Backspace: "Backspace" };
  const targets = [
    app.makeTarget({ tagName: "A" }),
    app.makeTarget({ tagName: "SUMMARY" }),
    app.makeTarget({ tagName: "IMG", getAttribute: (name) => (name === "role" ? "button" : null) }),
  ];
  let prevented = 0;
  for (const target of targets) {
    for (const key of [" ", "Enter", "Backspace"]) {
      onKeyDown({ key, code: codes[key], target, preventDefault() { prevented += 1; } });
    }
  }
  assert.deepStrictEqual([...app.evaluate("__fired")], []);
  assert.equal(prevented, 0, "the element's own key behaviour must not be cancelled");
});

test("starting and stopping the camera by keyboard keeps focus on a visible control", async () => {
  // The start button sits in the empty stage, which hides when the camera is
  // on, and the stop button hides when it is off: focus fell to the page.
  const app = loadWebApp();
  app.evaluate(`
    globalThis.__focused = [];
    toggleCamera = async () => { state.cameraOn = !state.cameraOn; };
    globalThis.__handlers = {};
    els.cameraToggle.focus = () => __focused.push("stop");
    els.cameraToggle.addEventListener = (type, handler) => { __handlers.stop = handler; };
    const realQueryAll = document.querySelectorAll;
    globalThis.__startButton = new HTMLElement();
    __startButton.focus = () => __focused.push("start");
    __startButton.addEventListener = (type, handler) => { __handlers.start = handler; };
    document.querySelectorAll = (selector) =>
      selector === '[data-trigger="camera"]' ? [__startButton] : realQueryAll(selector);
    state.cameraOn = false;
  `);
  app.get("bindEvents")();

  await app.evaluate("__handlers.start({ detail: 0 })");
  assert.equal(app.evaluate("state.cameraOn"), true);
  await app.evaluate("__handlers.stop({ detail: 0 })");
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.deepStrictEqual([...app.evaluate("__focused")], ["stop", "start"]);

  // A pointer start leaves focus where the pointer put it.
  await app.evaluate("__handlers.start({ detail: 1 })");
  await app.evaluate("__handlers.stop({ detail: 1 })");
  assert.deepStrictEqual([...app.evaluate("__focused")], ["stop", "start"]);
});
