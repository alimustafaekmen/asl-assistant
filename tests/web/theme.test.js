// The theme a visitor sees first, and a system preference that changes.
//
// The faults these tests kill:
// - a dark-preference visitor gets a light first frame because nothing
//   resolves the theme before the stylesheets apply: restoreTheme() in init()
//   runs only after every script, the CDN runtime included, has loaded;
// - the page ignores the system switching between light and dark while it is
//   open, though the visitor never chose a theme;
// - the page follows the system after the visitor did choose (in either
//   order of storage and system, or with storage blocked);
// - the browser's toolbar colour (theme-color) stays on the system's scheme
//   after the visitor chose the other one.
//
// The system preference (matchMedia, with change listeners the test can
// fire) and the storage are faked; the document is the real index.html. The
// first-frame tests run only the scripts the page loads before its first
// stylesheet (loadBeforeStylesheets), which is the page a browser can paint.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadBeforeStylesheets, loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Storage holding `items`, kept across page loads. */
function storageWith(items = {}) {
  const store = new Map(Object.entries(items));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  };
}

/** Storage that refuses every read and write, as a blocked one does. */
const blockedStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {},
};

/**
 * A system colour scheme the test can switch, as the OS does.
 *
 * `legacy` gives the media query lists only addListener/removeListener, the
 * shape Safari before 14 hands out.
 *
 * @param {"light" | "dark"} initial
 * @param {{legacy?: boolean}} [options]
 */
function systemScheme(initial, { legacy = false } = {}) {
  let dark = initial === "dark";
  const lists = [];
  const matchMedia = (query) => {
    const media = String(query);
    const listeners = [];
    const list = {
      media,
      get matches() {
        if (media.includes("prefers-color-scheme: dark")) return dark;
        if (media.includes("prefers-color-scheme: light")) return !dark;
        return false;
      },
      onchange: null,
    };
    if (legacy) {
      list.addListener = (listener) => listeners.push(listener);
      list.removeListener = () => {};
    } else {
      list.addEventListener = (type, listener) => {
        if (type === "change") listeners.push(listener);
      };
      list.removeEventListener = () => {};
    }
    lists.push({ list, listeners });
    return list;
  };
  return {
    matchMedia,
    /** Switch the system scheme and tell every list that watches it. */
    turn(scheme) {
      dark = scheme === "dark";
      for (const { list, listeners } of lists) {
        for (const listener of listeners) listener({ type: "change", media: list.media, matches: list.matches });
      }
    },
  };
}

/** The theme-color metas: [media, content] per meta, in markup order. */
function themeColors(document) {
  return Array.from(document.querySelectorAll('meta[name="theme-color"]'), (meta) => [
    meta.getAttribute("media"),
    meta.getAttribute("content"),
  ]);
}

/** The colour the markup gives the browser toolbar under a scheme. */
function authoredColour(scheme) {
  const page = loadBeforeStylesheets({ globals: { localStorage: storageWith(), matchMedia: systemScheme("light").matchMedia } });
  const match = themeColors(page.document).find(([media]) => media === `(prefers-color-scheme: ${scheme})`);
  assert.ok(match, `the page has a theme-color meta for the ${scheme} scheme`);
  return match[1];
}

// The first frame -------------------------------------------------------------

test("a dark-preference visitor's first frame is dark, before any stylesheet applies", () => {
  const page = loadBeforeStylesheets({
    globals: { localStorage: storageWith(), matchMedia: systemScheme("dark").matchMedia },
  });

  assert.ok(page.scripts.length > 0, "a script must run before the stylesheets to decide the theme");
  assert.equal(page.document.documentElement.dataset.theme, "dark");
});

test("a light-preference visitor's first frame is light", () => {
  const page = loadBeforeStylesheets({
    globals: { localStorage: storageWith(), matchMedia: systemScheme("light").matchMedia },
  });

  assert.equal(page.document.documentElement.dataset.theme, "light");
});

test("a saved choice decides the first frame over the system preference, both ways", () => {
  const savedLight = loadBeforeStylesheets({
    globals: { localStorage: storageWith({ "asl-theme": "light" }), matchMedia: systemScheme("dark").matchMedia },
  });
  assert.equal(savedLight.document.documentElement.dataset.theme, "light");

  const savedDark = loadBeforeStylesheets({
    globals: { localStorage: storageWith({ "asl-theme": "dark" }), matchMedia: systemScheme("light").matchMedia },
  });
  assert.equal(savedDark.document.documentElement.dataset.theme, "dark");
});

test("with no choice, the toolbar colour is left to the authored per-scheme metas", () => {
  const page = loadBeforeStylesheets({
    globals: { localStorage: storageWith(), matchMedia: systemScheme("dark").matchMedia },
  });

  assert.deepEqual(themeColors(page.document), [
    ["(prefers-color-scheme: light)", authoredColour("light")],
    ["(prefers-color-scheme: dark)", authoredColour("dark")],
  ]);
  assert.notEqual(authoredColour("light"), authoredColour("dark"));
});

test("a saved choice paints the toolbar in the chosen scheme from the first frame", () => {
  const page = loadBeforeStylesheets({
    globals: { localStorage: storageWith({ "asl-theme": "dark" }), matchMedia: systemScheme("light").matchMedia },
  });

  for (const [media, content] of themeColors(page.document)) {
    assert.equal(content, authoredColour("dark"), `the ${media} meta shows the chosen dark colour`);
  }
});

test("blocked storage and a broken matchMedia do not stop the page from parsing", () => {
  // A script that throws here would end before the rest of the head; the app
  // resolves the theme again when it starts, and reports there.
  assert.doesNotThrow(() =>
    loadBeforeStylesheets({
      globals: {
        localStorage: blockedStorage,
        matchMedia() {
          throw new Error("matchMedia is unavailable");
        },
      },
    }),
  );
});

// While the page is open ---------------------------------------------------------

/** A booted page under a switchable system scheme. */
async function openPage({ system = "light", storage = storageWith(), legacy = false } = {}) {
  const scheme = systemScheme(system, { legacy });
  const app = loadWebApp({
    boot: true,
    globals: { console: quietConsole, localStorage: storage, matchMedia: scheme.matchMedia },
  });
  await app.ready;
  return {
    app,
    turn: scheme.turn,
    toggle: () => app.evaluate("els.themeToggle").dispatchEvent({ type: "click", detail: 0 }),
    /** What the root, the body, the shell and the button say; they must agree. */
    seen: () => ({
      root: app.evaluate("document.documentElement.dataset.theme"),
      body: app.evaluate("document.body.dataset.theme"),
      shell: app.evaluate("els.appShell.dataset.theme"),
      pressed: app.evaluate('els.themeToggle.getAttribute("aria-pressed")'),
    }),
    toolbar: () => themeColors(app.evaluate("document")),
  };
}

const LIGHT = { root: "light", body: "light", shell: "light", pressed: "false" };
const DARK = { root: "dark", body: "dark", shell: "dark", pressed: "true" };

test("with no choice, the page follows the system turning dark and back", async () => {
  const page = await openPage({ system: "light" });
  assert.deepEqual(page.seen(), LIGHT);

  page.turn("dark");
  assert.deepEqual(page.seen(), DARK);

  page.turn("light");
  assert.deepEqual(page.seen(), LIGHT);
});

test("a browser with only addListener on its media query lists is followed too", async () => {
  const page = await openPage({ system: "light", legacy: true });

  page.turn("dark");
  assert.deepEqual(page.seen(), DARK);
});

test("a saved choice is kept when the system changes", async () => {
  const page = await openPage({ system: "light", storage: storageWith({ "asl-theme": "light" }) });

  page.turn("dark");
  assert.deepEqual(page.seen(), LIGHT);
});

test("a choice made on the page is kept when the system changes, even with storage blocked", async () => {
  const page = await openPage({ system: "light", storage: blockedStorage });
  page.toggle();
  assert.deepEqual(page.seen(), DARK);

  page.turn("light");
  assert.deepEqual(page.seen(), DARK);
  page.turn("dark");
  page.turn("light");
  assert.deepEqual(page.seen(), DARK);
});

test("the toolbar colour follows the theme button", async () => {
  const page = await openPage({ system: "light" });
  const dark = authoredColour("dark");
  const light = authoredColour("light");

  page.toggle();
  assert.deepEqual(page.toolbar().map(([, content]) => content), [dark, dark]);

  page.toggle();
  assert.deepEqual(page.toolbar().map(([, content]) => content), [light, light]);
});
