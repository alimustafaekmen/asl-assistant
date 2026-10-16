// The theme: a choice the user makes once and expects to find again.
//
// The page follows the system's light or dark preference until the visitor
// presses the theme button; from then on their choice wins over the system,
// in either direction, and a reload keeps it. The shell and the page body are
// themed separately, and the button's pressed state is what a screen reader
// announces, so all three have to agree.
//
// The real app boots from index.html. Only the edges are faked: a storage that
// outlives a page load, and the system preference (matchMedia). A reload is a
// second loadWebApp() over the same storage; no test names the storage key.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

function persistentStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

/** The system preference as matchMedia reports it. */
function systemPrefers(scheme) {
  return (query) => ({
    media: String(query),
    matches: String(query).includes("prefers-color-scheme: dark") && scheme === "dark",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

/** One page load over a shared storage, under a system preference. */
async function openPage({ system = "light", storage = persistentStorage() } = {}) {
  const app = loadWebApp({
    boot: true,
    globals: { console: quietConsole, localStorage: storage, matchMedia: systemPrefers(system) },
  });
  await app.ready;
  return {
    app,
    storage,
    toggle: () => app.evaluate("els.themeToggle").dispatchEvent({ type: "click", detail: 0 }),
    /** What the shell, the body and the button say; they must agree. */
    seen: () => ({
      shell: app.evaluate("els.appShell.dataset.theme"),
      body: app.evaluate("document.body.dataset.theme"),
      pressed: app.evaluate('els.themeToggle.getAttribute("aria-pressed")'),
    }),
  };
}

const LIGHT = { shell: "light", body: "light", pressed: "false" };
const DARK = { shell: "dark", body: "dark", pressed: "true" };

test("a first visit follows a light system", async () => {
  assert.deepEqual((await openPage({ system: "light" })).seen(), LIGHT);
});

test("a first visit follows a dark system", async () => {
  assert.deepEqual((await openPage({ system: "dark" })).seen(), DARK);
});

test("the button flips shell, body and pressed state together, both ways", async () => {
  const page = await openPage({ system: "light" });

  page.toggle();
  assert.deepEqual(page.seen(), DARK);

  page.toggle();
  assert.deepEqual(page.seen(), LIGHT);
});

test("a dark choice is still dark after a reload", async () => {
  const first = await openPage({ system: "light" });
  first.toggle();

  const second = await openPage({ system: "light", storage: first.storage });

  assert.deepEqual(second.seen(), DARK);
});

test("a light choice beats a dark system after a reload", async () => {
  // Under a dark system the page opens dark; the visitor switches it to light.
  const first = await openPage({ system: "dark" });
  assert.deepEqual(first.seen(), DARK);
  first.toggle();
  assert.deepEqual(first.seen(), LIGHT);

  const second = await openPage({ system: "dark", storage: first.storage });

  assert.deepEqual(second.seen(), LIGHT);
});

test("a dark choice beats a light system after a reload", async () => {
  const first = await openPage({ system: "light" });
  first.toggle();

  const second = await openPage({ system: "light", storage: first.storage });
  assert.deepEqual(second.seen(), DARK);

  // And back: the latest choice is the one kept.
  second.toggle();
  const third = await openPage({ system: "dark", storage: first.storage });
  assert.deepEqual(third.seen(), LIGHT);
});

test("storage that refuses to save does not break the toggle", async () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem() {},
  };
  const page = await openPage({ system: "light", storage: blocked });

  page.toggle();

  assert.deepEqual(page.seen(), DARK);
});
