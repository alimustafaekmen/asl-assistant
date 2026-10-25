// Where a screen reader and a keyboard land when the route changes.
//
// The faults these tests kill:
// - every route keeps the one static document title, so a history list, a
//   tab strip and a screen reader cannot tell the screens apart;
// - the information screens (#test, #qr, #project) have no h1, so heading
//   navigation finds no start of the screen;
// - after a route change by the visitor, focus stays on a control that may
//   no longer be visible (a menu item, the project page's link to Model
//   Test) or falls to the page, instead of moving to the new screen's
//   heading; and on the first load it must not move at all;
// - the stage's way to watch the camera-free example hides behind the demo
//   it starts, so a keyboard press must take focus to that demo;
// - a skip link to #main is an unknown route: followed as a link, it would
//   throw the visitor out of coach or word mode into letter mode.
//
// The page is the real index.html. The address bar is a URL object; a link
// the page does not cancel is followed as the browser follows it: the hash
// changes and hashchange fires.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const MODES = ["letter", "coach", "word", "test", "project", "qr"];
const TITLES = {
  letter: "Harf tanıma · ASL Assistant",
  coach: "Koç · ASL Assistant",
  word: "Kelime (deneysel) · ASL Assistant",
  test: "Modeli kamerasız deneyin · ASL Assistant",
  project: "Nasıl çalışır · ASL Assistant",
  qr: "Telefonda açın · ASL Assistant",
};

/**
 * The app on `hash`, loaded but not started, with every element's focus()
 * recorded; start() runs the page's own init().
 */
function pageOn(hash = "") {
  const location = new URL(`https://asl-assistant.pages.dev/${hash}`);
  const history = {
    replaceState(_state, _title, url) {
      if (url !== undefined && url !== null) location.href = new URL(String(url), location.href).href;
    },
    pushState() {},
  };
  const app = loadWebApp({ globals: { location, history, console: quietConsole, kjua: () => ({}) } });
  app.evaluate(`
    globalThis.__focused = [];
    const realFocus = Element.prototype.focus;
    Element.prototype.focus = function (options) {
      __focused.push({ element: this, preventScroll: options?.preventScroll === true });
      return realFocus.call(this, options);
    };
  `);
  return {
    app,
    location,
    start: () => app.get("init")(),
    focused: () => app.evaluate("__focused"),
    /** Follow a link as the browser does unless the page cancels the click. */
    followLink(link) {
      const followed = link.dispatchEvent({ type: "click", detail: 1, target: link });
      if (followed) {
        location.hash = link.getAttribute("href");
        app.windowHandler("hashchange")?.();
      }
      return followed;
    },
  };
}

/** Click the tab a visitor would press for `mode`. */
function clickTab(app, mode) {
  const tab = app
    .evaluate('Array.from(document.querySelectorAll("[data-ui=mode-tab]"))')
    .find((candidate) => candidate.dataset.mode === mode);
  assert.ok(tab, `the page has a tab for ${mode}`);
  tab.dispatchEvent({ type: "click", detail: 0, target: tab });
}

/**
 * Open `mode` as a visitor does. Model Test has no tab since it became a
 * developer tool (owner decision 2026-10-18); the project page links to it.
 * Focus moves recorded before the last step are dropped, so what is left is
 * the move the route change itself made.
 */
function openRoute(page, mode) {
  if (mode !== "test") return clickTab(page.app, mode);
  clickTab(page.app, "project");
  const link = page.app.evaluate(`document.querySelector('#projectScreen a[href="#test"]')`);
  assert.ok(link, "the project page links to Model Test");
  page.app.evaluate("__focused.length = 0");
  page.followLink(link);
}

/** Whether an element would be shown on `mode`: no hidden ancestor, no other mode's tag. */
function shownOn(element, mode) {
  for (let at = element; at && at.localName !== "html"; at = at.parentNode) {
    if (at.hasAttribute?.("hidden")) return false;
    const tags = ["letter", "coach", "word"].filter((m) => at.classList?.contains(`${m}-only`));
    if (at.classList?.contains("mode-only") && !tags.includes(mode)) return false;
  }
  return true;
}

/** The h1 elements a visitor would meet on the current screen. */
function headingsOn(app, mode) {
  return [...app.evaluate('document.querySelectorAll("h1")')].filter((h1) => shownOn(h1, mode));
}

for (const mode of MODES) {
  test(`#${mode} has one h1, and the document title names it`, async () => {
    const page = pageOn("#letter");
    await page.start();

    openRoute(page, mode);

    const headings = headingsOn(page.app, mode);
    assert.equal(headings.length, 1, `#${mode} shows exactly one h1`);
    assert.equal(page.app.evaluate("document.title"), TITLES[mode]);
    assert.equal(`${headings[0].textContent.trim()} · ASL Assistant`, TITLES[mode], "the title is the h1 and the app name");
  });
}

test("a route opened from the address bar has its title from the start", async () => {
  const page = pageOn("#coach");
  await page.start();

  assert.equal(page.app.evaluate("document.title"), TITLES.coach);
});

test("a route change by the visitor moves focus to the new screen's h1", async () => {
  const page = pageOn("#letter");
  await page.start();

  for (const mode of ["test", "coach", "qr", "letter"]) {
    page.app.evaluate("__focused.length = 0");
    openRoute(page, mode);
    const [heading] = headingsOn(page.app, mode);
    const focused = page.focused();
    assert.equal(focused.length, 1, `one focus move after opening #${mode}`);
    assert.equal(focused[0].element, heading, `focus lands on the #${mode} h1`);
    assert.equal(focused[0].preventScroll, true, "without scrolling the page to it");
    assert.equal(heading.getAttribute("tabindex"), "-1", "the h1 takes focus from script only");
  }
});

test("the stage's way to watch the example takes keyboard focus to the demo it starts", async () => {
  const page = pageOn("#letter");
  await page.start();

  const go = page.app.evaluate('document.querySelector("#cameraIntro [data-trigger=demo]")');
  assert.ok(go, "the first-visit stage offers the camera-free example");
  page.app.evaluate("__focused.length = 0");
  go.dispatchEvent({ type: "click", detail: 0, target: go });

  const panel = page.app.evaluate('document.getElementById("demoPanel")');
  assert.equal(panel.hidden, false, "the demo is on the stage");
  assert.equal(page.focused().at(-1)?.element, panel, "focus follows the visitor to it");
  assert.equal(page.focused().at(-1)?.preventScroll, true, "without scrolling the page");
});

test("the first load does not move focus", async () => {
  for (const hash of ["", "#word", "#test"]) {
    const page = pageOn(hash);
    await page.start();
    assert.equal(page.focused().length, 0, `no focus move on loading ${hash || "the bare address"}`);
  }
});

test("the skip link keeps the mode and the address, and moves focus to the main content", async () => {
  const page = pageOn("#coach");
  await page.start();
  assert.equal(page.app.evaluate("state.mode"), "coach", "precondition");

  const skip = page.app.evaluate('document.querySelector("a[href=\'#main\']")');
  assert.ok(skip, "the page has a skip link to the main content");
  const main = page.app.evaluate("document.getElementById('main')");
  assert.ok(main, "the skip link's target exists");
  assert.equal(main.localName, "main");

  const followed = page.followLink(skip);

  assert.equal(followed, false, "the link is handled by the page, not followed as a route");
  assert.equal(page.app.evaluate("state.mode"), "coach");
  assert.equal(page.location.hash, "#coach");
  assert.equal(page.focused().at(-1)?.element, main);
  assert.equal(main.getAttribute("tabindex"), "-1");
});

test("the page has one banner, one main, the mode navigation and the details aside", async () => {
  const page = pageOn("#letter");
  await page.start();
  const count = (selector) => page.app.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

  assert.equal(count("header"), 1);
  assert.equal(count("main"), 1);
  assert.equal(count('nav[aria-label="Mod"]'), 1);
  assert.equal(count("aside"), 1);
  // A labelled section is a region landmark, so a labelled workspace inside
  // <main> would repeat main as a second, unhelpful one.
  const workspace = page.app.evaluate('document.querySelector("[data-ui=workspace]")');
  assert.equal(workspace.getAttribute("aria-label"), null, "the workspace is not a second main landmark");
});
