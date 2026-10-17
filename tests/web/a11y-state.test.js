// State that assistive technology must be told, not only shown.
//
// A CSS class or a label alone shows the selected mode, an open panel or a
// pressed toggle to the eye, but a screen reader does not announce it. These
// tests read the ARIA attributes the scripts write.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

function loadApp() {
  return loadWebApp({
    globals: {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { hash: "#letter" },
      history: { replaceState() {} },
    },
  });
}

// Give a stub element real attribute storage.
const withAttributes = `(element) => {
  element.attrs = {};
  element.setAttribute = (name, value) => { element.attrs[name] = String(value); };
  element.removeAttribute = (name) => { delete element.attrs[name]; };
  element.getAttribute = (name) => element.attrs[name] ?? null;
  return element;
}`;

test("the selected mode tab is marked as the current page", () => {
  const app = loadApp();
  app.evaluate(`
    const attrs = ${withAttributes};
    globalThis.__tabs = ["letter", "coach", "word", "test"].map((mode) => {
      const tab = attrs(new HTMLElement());
      tab.dataset.mode = mode;
      return tab;
    });
    const realQueryAll = document.querySelectorAll;
    document.querySelectorAll = (selector) =>
      selector === '[data-ui="mode-tab"]' ? __tabs : realQueryAll(selector);
  `);

  app.get("setMode")("coach");
  const current = () => app.evaluate("__tabs.map((tab) => tab.getAttribute('aria-current'))");
  assert.deepStrictEqual([...current()], [null, "page", null, null]);

  app.get("setMode")("test");
  assert.deepStrictEqual([...current()], [null, null, null, "page"]);
});

test("the reference toggle says whether its panel is open", () => {
  const app = loadApp();
  app.evaluate(`
    const attrs = ${withAttributes};
    attrs(els.toggleReference);
    els.referenceBody.hidden = true;
  `);

  app.get("toggleReference")();
  assert.equal(app.evaluate("els.referenceBody.hidden"), false);
  assert.equal(app.evaluate("els.toggleReference.getAttribute('aria-expanded')"), "true");

  app.get("toggleReference")();
  assert.equal(app.evaluate("els.referenceBody.hidden"), true);
  assert.equal(app.evaluate("els.toggleReference.getAttribute('aria-expanded')"), "false");
});

test("the theme button says whether the dark theme is on", () => {
  const app = loadApp();
  app.evaluate(`
    const attrs = ${withAttributes};
    attrs(els.themeToggle);
    els.appShell.dataset.theme = "light";
  `);

  app.get("toggleTheme")();
  assert.equal(app.evaluate("els.appShell.dataset.theme"), "dark");
  assert.equal(app.evaluate("els.themeToggle.getAttribute('aria-pressed')"), "true");

  app.get("toggleTheme")();
  assert.equal(app.evaluate("els.themeToggle.getAttribute('aria-pressed')"), "false");
});

test("a theme restored from storage is reflected on the theme button", () => {
  const app = loadWebApp({
    globals: { localStorage: { getItem: () => "dark", setItem() {}, removeItem() {} } },
  });
  app.evaluate(`
    const attrs = ${withAttributes};
    attrs(els.themeToggle);
    els.appShell.dataset.theme = "light";
  `);

  app.get("restoreTheme")();
  assert.equal(app.evaluate("els.appShell.dataset.theme"), "dark");
  assert.equal(app.evaluate("els.themeToggle.getAttribute('aria-pressed')"), "true");
});

test("with nothing stored, the theme follows the system preference", () => {
  for (const prefersDark of [true, false]) {
    const app = loadWebApp({
      globals: {
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        matchMedia: (query) => ({
          matches: query === "(prefers-color-scheme: dark)" && prefersDark,
        }),
      },
    });
    app.evaluate(`
      const attrs = ${withAttributes};
      attrs(els.themeToggle);
      els.appShell.dataset.theme = "light";
    `);

    app.get("restoreTheme")();
    const expected = prefersDark ? "dark" : "light";
    assert.equal(app.evaluate("els.appShell.dataset.theme"), expected);
    assert.equal(app.evaluate("document.body.dataset.theme"), expected);
    assert.equal(app.evaluate("els.themeToggle.getAttribute('aria-pressed')"), String(prefersDark));
  }
});
