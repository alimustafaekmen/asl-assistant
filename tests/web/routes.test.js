// Every route opens its own screen.
//
// The six routes are #letter, #word, #coach, #test, #project and #qr, and an
// unknown hash opens letter mode. What a route must leave on the page is the
// contract the stylesheet relies on: the shell's data-mode (the mode-only
// controls are hidden from it), exactly one information screen (or none), and
// the camera workspace out of the way on the three information screens.
// Switching mode also has to start the letter smoother from nothing, so a
// letter held up before the switch cannot show after it.
//
// Every route but #test has a tab. Model Test is a developer tool: a visitor
// never meets it, and the project page links to it, so it is opened here by
// following that link.
//
// The page is the real index.html booted through init(). The address bar is a
// URL object with a recording history; the clicks are the tabs' own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const MODES = ["letter", "word", "coach", "test", "project", "qr"];
/** The routes the visitor reaches by a tab. */
const TABBED = MODES.filter((mode) => mode !== "test");
/** The information screen each of those routes shows; the others show none. */
const SCREEN_OF = { test: "modelTestScreen", project: "projectScreen", qr: "qrScreen" };
const SCREENS = Object.values(SCREEN_OF);

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/**
 * The app booted on `hash`, with the address bar and its history under the
 * test's eye.
 *
 * @param {string} [hash]
 */
async function bootedOn(hash = "") {
  const location = new URL(`https://asl-assistant.pages.dev/${hash}`);
  /** @type {{method: string, url: string}[]} */
  const writes = [];
  const record = (method) => (_state, _title, url) => {
    writes.push({ method, url: String(url) });
    if (url !== undefined && url !== null) location.href = new URL(String(url), location.href).href;
  };
  const history = { replaceState: record("replaceState"), pushState: record("pushState") };
  const app = loadWebApp({ boot: true, globals: { location, history, console: quietConsole } });
  await app.ready;
  return { app, location, writes };
}

/** Click the tab a user would press for `mode`. */
function clickTab(app, mode) {
  const tabs = app.evaluate('Array.from(document.querySelectorAll("[data-ui=mode-tab]"))');
  const tab = tabs.find((candidate) => candidate.dataset.mode === mode);
  assert.ok(tab, `the page has a tab for ${mode}`);
  tab.dispatchEvent({ type: "click" });
}

/**
 * Follow the project page's link to Model Test, as the browser follows a
 * link the page does not cancel: the hash changes and hashchange fires.
 */
function followModelTestLink(app, location) {
  const link = app.evaluate(`document.querySelector('#projectScreen a[href="#test"]')`);
  assert.ok(link, "the project page links to Model Test");
  assert.equal(link.dispatchEvent({ type: "click", detail: 1, target: link }), true, "the page lets the link be followed");
  location.hash = link.getAttribute("href");
  app.windowHandler("hashchange")({ type: "hashchange" });
}

/** Open `mode` as a visitor does: its tab, or for Model Test the project page's link. */
function open(app, location, mode) {
  if (TABBED.includes(mode)) return clickTab(app, mode);
  clickTab(app, "project");
  followModelTestLink(app, location);
}

const panes = (app) => app.evaluate('Array.from(document.querySelectorAll("[data-ui=workspace-pane]"))');
const screenHidden = (app, id) => app.evaluate(`document.getElementById("${id}").hidden`);
const shellMode = (app) => app.evaluate('document.querySelector("[data-ui=app-shell]").dataset.mode');

/** Everything a route leaves visible on the page, checked against the route. */
function assertScreenFor(app, mode, context) {
  assert.equal(shellMode(app), mode, `${context}: the shell names the mode`);
  assert.equal(app.evaluate("state.mode"), mode, `${context}: the app is in the mode`);

  const info = mode in SCREEN_OF;
  for (const id of SCREENS) {
    const shouldShow = id === SCREEN_OF[mode];
    assert.equal(screenHidden(app, id), !shouldShow, `${context}: ${id} ${shouldShow ? "shown" : "hidden"}`);
  }

  const workspace = panes(app);
  assert.ok(workspace.length >= 2, "the page has the camera column and the side panel");
  for (const pane of workspace) {
    assert.equal(pane.hidden, info, `${context}: a workspace pane is ${info ? "hidden" : "shown"}`);
  }

  const current = app
    .evaluate('Array.from(document.querySelectorAll("[data-ui=mode-tab]"))')
    .filter((tab) => tab.getAttribute("aria-current") !== null);
  assert.deepEqual(
    Array.from(current, (tab) => `${tab.dataset.mode}=${tab.getAttribute("aria-current")}`),
    TABBED.includes(mode) ? [`${mode}=page`] : [],
    `${context}: only the active tab is marked as the current page, and none on a route without one`,
  );
}

test("a tab opens its route from any other route", async () => {
  const { app, location } = await bootedOn();
  for (const from of MODES) {
    for (const to of MODES) {
      open(app, location, from);
      open(app, location, to);
      assertScreenFor(app, to, `${from} -> ${to}`);
    }
  }
});

test("Model Test has no tab; the project page's link opens it and leaves the address to the browser", async () => {
  const { app, location, writes } = await bootedOn("#letter");
  const tabs = app.evaluate('Array.from(document.querySelectorAll("[data-ui=mode-tab]"))');
  assert.equal(tabs.filter((tab) => tab.dataset.mode === "test").length, 0, "no tab for Model Test");

  clickTab(app, "project");
  writes.length = 0;
  followModelTestLink(app, location);
  assertScreenFor(app, "test", "the project page's link");
  assert.equal(location.hash, "#test");
  assert.deepEqual(writes, [], "the link moved the address; writing it again would loop");
});

test("an address opens its route on load", async () => {
  for (const mode of MODES) {
    const { app } = await bootedOn(`#${mode}`);
    assertScreenFor(app, mode, `opened on #${mode}`);
  }
});

test("an unknown address opens letter mode", async () => {
  for (const hash of ["#bogus", "#home", "#word-extra"]) {
    const { app } = await bootedOn(hash);
    assertScreenFor(app, "letter", `opened on ${hash}`);
  }
});

test("a tab writes its route to the address without adding history", async () => {
  const { app, location, writes } = await bootedOn("#letter");
  for (const mode of TABBED.filter((m) => m !== "letter")) {
    writes.length = 0;
    clickTab(app, mode);
    assert.equal(location.hash, `#${mode}`, `the address names ${mode}`);
    assert.deepEqual(
      writes.map(({ method, url }) => [method, url]),
      [["replaceState", `#${mode}`]],
      `${mode}: the address is replaced, so Back does not walk through every tab`,
    );
  }
});

test("a tab for the route already in the address leaves the address alone", async () => {
  const { app, writes } = await bootedOn("#word");
  clickTab(app, "word");
  assert.deepEqual(writes, []);
});

test("a hashchange to #qr opens the QR screen and leaves the address to the browser", async () => {
  const { app, location, writes } = await bootedOn("#letter");
  location.hash = "#qr";

  const onHashChange = app.windowHandler("hashchange");
  assert.equal(typeof onHashChange, "function", "the page listens for hashchange");
  onHashChange({ type: "hashchange" });

  assertScreenFor(app, "qr", "hashchange to #qr");
  assert.deepEqual(writes, [], "the address already changed; writing it again would loop");
});

test("a hashchange to an unknown address falls back to letter mode", async () => {
  const { app, location } = await bootedOn("#project");
  location.hash = "#nothing-here";

  app.windowHandler("hashchange")({ type: "hashchange" });

  assertScreenFor(app, "letter", "hashchange to an unknown hash");
});

test("an unknown mode name falls back to letter mode", async () => {
  const { app } = await bootedOn("#word");
  app.get("setMode")("bogus");
  assertScreenFor(app, "letter", "setMode('bogus')");
});

test("returning from an information screen brings the camera workspace back", async () => {
  const { app } = await bootedOn("#qr");
  assertScreenFor(app, "qr", "start");
  clickTab(app, "letter");
  assertScreenFor(app, "letter", "after leaving the QR screen");
});

test("changing mode starts the letter smoother from nothing", async () => {
  for (const away of ["word", "test"]) {
    const { app, location } = await bootedOn("#letter");
    const smooth = app.get("smoothLetterPrediction");
    const raw = (label) => ({ label, confidence: 0.9, alternatives: [] });

    for (let i = 0; i < 5; i++) smooth(raw("A"));
    assert.equal(smooth(raw("A")).label, "A", "precondition: A is what the window shows");

    open(app, location, away);
    clickTab(app, "letter");

    const shown = smooth(raw("B"));
    assert.equal(shown.label, "B", `after ${away}, the old letter is not carried over`);
    assert.equal(shown.confidence, 0.9, `after ${away}, the window holds only the new frame`);
  }
});
