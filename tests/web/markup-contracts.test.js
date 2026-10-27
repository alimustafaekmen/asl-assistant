// What the markup promises, checked against what the app does with it.
//
// The page tells a keyboard user and a screen reader things the scripts have to
// make true: a button says it answers to a key, a live region says it is one,
// the phone menu says which popover it opens, and a control is shown only in
// the modes where pressing it does something. None of these can fail at load,
// so a markup edit that breaks one passes every other test. The document here
// is the real index.html parsed by the harness (no pattern matching over its
// text), and the keys are pressed through the real keydown handler.
//
// What is not covered: whether a browser draws a mode-only control or opens the
// popover. That is CSS and the platform, and belongs to a browser run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const MODES = ["letter", "coach", "word"];

async function bootedApp() {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  return app;
}

/** Every element of the page matching a selector, as plain data about it. */
function elementsWith(app, selector) {
  return app.evaluate(`document.querySelectorAll(${JSON.stringify(selector)})`);
}

/** The mode a control is shown in, from its mode-only tag classes. */
function taggedModes(element) {
  return MODES.filter((mode) => element.classList.contains(`${mode}-only`));
}

/**
 * The key event a WAI-ARIA key name stands for. A value this does not know is
 * a failure, never a skip: an advertised key nobody can press is the bug.
 */
function keyEvent(name) {
  if (name === "Space") return { key: " ", code: "Space" };
  if (/^(Enter|Backspace|Escape|Tab|Delete)$/.test(name)) return { key: name, code: name };
  if (/^[A-Za-z]$/.test(name)) return { key: name, code: `Key${name.toUpperCase()}` };
  assert.fail(`no key event is defined for aria-keyshortcuts="${name}"`);
}

/** A fresh booted app in `mode` with a confident letter on screen and some text. */
async function appReadyToType(mode) {
  const app = await bootedApp();
  app.get("setMode")(mode);
  app.evaluate('state.transcript = "AB"; state.prediction = "C"; state.confidence = 0.95;');
  return app;
}

/** Press a key through the app's keydown handler; true when it was handled. */
function press(app, name) {
  const target = app.makeTarget({ tagName: "DIV" });
  let handled = false;
  app.windowHandler("keydown")({
    ...keyEvent(name),
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {
      handled = true;
    },
  });
  return handled;
}

const advertised = async () => {
  const app = await bootedApp();
  return [...elementsWith(app, "[aria-keyshortcuts]")].map((element) => ({
    id: element.getAttribute("id"),
    key: element.getAttribute("aria-keyshortcuts"),
    modes: taggedModes(element),
  }));
};

// Shortcuts

test("the page advertises at least the three transcript keys", async () => {
  // A guard on the loop below: with nothing advertised it would pass vacuously.
  const keys = (await advertised()).map(({ key }) => key).sort();
  assert.deepEqual(keys, ["Backspace", "Enter", "Space"]);
});

test("every advertised key changes the transcript in the modes the control is shown in, and in no other", async () => {
  for (const { id, key, modes } of await advertised()) {
    assert.ok(modes.length > 0, `#${id} advertises ${key} but is shown in no mode`);

    const actsIn = [];
    for (const mode of MODES) {
      const app = await appReadyToType(mode);
      const before = app.evaluate("state.transcript");
      press(app, key);
      if (app.evaluate("state.transcript") !== before) actsIn.push(mode);
    }
    assert.deepEqual(actsIn, modes, `#${id} advertises ${key}: the key acts in [${actsIn}] but the control is shown in [${modes}]`);
  }
});

test("an advertised key does exactly what clicking its button does", async () => {
  for (const { id, key, modes } of await advertised()) {
    const [mode] = modes;
    const byKey = await appReadyToType(mode);
    press(byKey, key);

    const byClick = await appReadyToType(mode);
    byClick.evaluate(`document.getElementById(${JSON.stringify(id)})`).dispatchEvent({ type: "click" });

    const typed = byKey.evaluate("state.transcript");
    assert.notEqual(typed, "AB", `#${id}: ${key} must do something in ${mode} mode`);
    assert.equal(typed, byClick.evaluate("state.transcript"), `#${id}: ${key} and a click must agree`);
  }
});

test("the keys are taken from the browser only when they act, so other modes keep their keys", async () => {
  for (const { key, modes } of await advertised()) {
    for (const mode of MODES.filter((candidate) => !modes.includes(candidate))) {
      const app = await appReadyToType(mode);
      assert.equal(press(app, key), false, `${key} must stay the browser's in ${mode} mode`);
    }
  }
});

// Controls tagged for modes

test("every mode-only control names a mode it can be shown in", async () => {
  const app = await bootedApp();
  const controls = [...elementsWith(app, ".mode-only")];
  assert.ok(controls.length >= 10, "the dock and the stage carry mode-only controls");
  for (const control of controls) {
    const name = control.getAttribute("id") ?? control.textContent;
    assert.ok(taggedModes(control).length > 0, `${name} is hidden in every mode`);
  }
});

test("each mode has a primary action in the dock, so no mode opens to an empty bar", async () => {
  const app = await bootedApp();
  const dock = app.evaluate("els.controlBar");
  const primary = [...dock.querySelectorAll(".btn--primary")];
  for (const mode of MODES) {
    const shownInMode = primary.filter((control) => taggedModes(control).includes(mode));
    assert.equal(shownInMode.length, 1, `the ${mode} dock needs exactly one primary action`);
  }
});

test("the transcript buttons in the dock edit the text in the mode they are shown in", async () => {
  const app = await bootedApp();
  for (const id of ["removeLastChar", "insertSpace", "manualAddLetter"]) {
    const modes = taggedModes(app.evaluate(`document.getElementById(${JSON.stringify(id)})`));
    assert.ok(modes.length > 0, `#${id} is shown in no mode`);
    for (const mode of modes) {
      const probe = await appReadyToType(mode);
      probe.evaluate(`document.getElementById(${JSON.stringify(id)})`).dispatchEvent({ type: "click" });
      assert.notEqual(probe.evaluate("state.transcript"), "AB", `#${id} does nothing in ${mode} mode`);
    }
  }
});

// Live regions, the phone menu, the toast

test("the announcer is a polite live region, present and not hidden at load", async () => {
  const app = await bootedApp();
  const announcer = app.evaluate("document.getElementById('announcer')");

  assert.ok(announcer, "the announcer must exist");
  assert.equal(announcer.hidden, false, "hidden would take it out of the accessibility tree");
  const live = announcer.getAttribute("aria-live");
  const role = announcer.getAttribute("role");
  assert.ok(live === "polite" || (live === null && role === "status"), `not a polite live region: aria-live=${live} role=${role}`);
  assert.notEqual(live, "assertive", "a transcript confirmation must not interrupt speech");
});

test("a spoken confirmation lands in that live region", async () => {
  const app = await bootedApp();
  app.get("announce")("A eklendi");
  assert.equal(app.evaluate("document.getElementById('announcer').textContent"), "A eklendi");
});

test("the More button targets a popover menu that holds the secondary screens", async () => {
  const app = await bootedApp();
  const invokers = [...elementsWith(app, "[popovertarget]")];
  assert.equal(invokers.length, 1, "the topbar has one popover invoker");

  const [invoker] = invokers;
  assert.equal(invoker.tagName, "BUTTON", "the invoker must be a button");
  assert.ok(invoker.getAttribute("aria-label"), "an icon-only button needs a name");
  const menu = app.evaluate(`document.getElementById(${JSON.stringify(invoker.getAttribute("popovertarget"))})`);
  assert.ok(menu, "popovertarget must name an element that exists");
  assert.equal(menu.hasAttribute("popover"), true, "without the popover attribute the button opens nothing");

  const screens = [...menu.querySelectorAll('[data-ui="mode-tab"]')].map((tab) => tab.dataset.mode);
  // Model Test is not among them: it is a developer tool, linked from the
  // project page.
  assert.deepEqual(screens.sort(), ["project", "qr"]);
});

test("choosing a screen from the open menu closes the menu and opens the screen", async () => {
  const app = await bootedApp();
  const menu = app.evaluate("document.getElementById('moreMenu')");
  menu.showPopover();
  assert.equal(menu.matches(":popover-open"), true, "precondition");

  menu.querySelector('[data-mode="project"]').dispatchEvent({ type: "click" });

  assert.equal(menu.matches(":popover-open"), false);
  assert.equal(app.evaluate("state.mode"), "project");
});

test("the toast and its undo action are hidden until something is confirmed", async () => {
  const app = await bootedApp();

  assert.equal(app.evaluate("els.toast.hidden"), true, "an empty toast must not show at load");
  assert.equal(app.evaluate("els.toastAction.hidden"), true);

  app.evaluate('state.transcript = "MERHABA";');
  app.get("clearTranscript")();
  assert.equal(app.evaluate("els.toast.hidden"), false, "a confirmation shows it");
});
