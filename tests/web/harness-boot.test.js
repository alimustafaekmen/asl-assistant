// The harness starts the app the way the browser does.
//
// Every script runs in full, including the bootstrap call at the end of
// app.js, and the harness learns of that call through the global it goes
// through, not by reading the source. These tests pin the seam itself: a
// booted app has run the real init() against the default boundary fakes, and
// `app.ready` is the promise init() returned. They also pin what init() does
// in its order: the saved theme and transcript come back, the route in the
// address bar opens its mode, and the render loop is scheduled.

import assert from "node:assert/strict";
import { test } from "node:test";

import { deferred, flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/** Map-backed storage holding `items` before the first script runs. */
function storageWith(items) {
  const store = new Map(Object.entries(items));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  };
}

test("the bootstrap call is observed in the last script, without starting a test that did not ask", () => {
  const app = loadWebApp();

  assert.deepEqual(app.bootstrapScripts, ["js/core/app.js"]);
  assert.equal(app.ready, null);
  // Nothing started: no listener bound, no request sent, no frame queued.
  assert.equal(app.listenerCount(), 0);
  assert.deepEqual(app.requests, []);
  assert.equal(app.pendingFrames(), 0);
});

test("a booted app has run init() to the end against the default fakes", async () => {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });

  assert.ok(app.ready instanceof Promise, "boot must expose the init() promise");
  await app.ready;

  assert.equal(app.evaluate("_eventsBound"), true, "init() binds the page's events");
  assert.ok(app.windowHandler("keydown"), "the keyboard map is live after boot");
  // The fixture manifest and the word guidance data were read from disk.
  assert.ok(app.requests.includes("/data/model-test-samples/manifest.json"));
  assert.ok(app.requests.includes("/data/per_word_stats.json"));
  assert.ok(app.evaluate("state.modelTestManifest.letters.length") > 0);
  assert.ok(app.evaluate("Object.keys(perWordStats).length") > 0);
  // A bare address opens letter mode, and one frame of the loop is queued.
  assert.equal(app.evaluate("state.mode"), "letter");
  assert.equal(app.pendingFrames(), 1);
  assert.equal(app.runFrame(16), 1);
  assert.equal(app.pendingFrames(), 1, "the render loop schedules its next frame");
});

test("app.ready follows init()'s own promise: it waits for the last startup read", async () => {
  // Hold the word guidance data, the last thing init() waits for.
  const held = deferred();
  const app = loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      fetch: async (url) => {
        if (String(url).endsWith("per_word_stats.json")) await held.promise;
        return { ok: false, status: 404, json: async () => ({}) };
      },
    },
  });
  let settled = false;
  app.ready.then(() => {
    settled = true;
  });

  await flush();
  assert.equal(settled, false, "startup is still waiting on the held read");
  // The steps before that wait have already run.
  assert.equal(app.evaluate("state.mode"), "letter");

  held.resolve();
  await app.ready;
  assert.equal(settled, true);
});

test("startup restores the saved theme and transcript and opens the route in the address bar", async () => {
  const app = loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      localStorage: storageWith({ "asl-theme": "dark", "asl-web-transcript": "MERHABA" }),
      location: new URL("https://asl-assistant.netlify.app/#word"),
    },
  });
  await app.ready;

  assert.equal(app.evaluate("els.appShell.dataset.theme"), "dark");
  assert.equal(app.evaluate("state.transcript"), "MERHABA");
  assert.equal(app.evaluate("state.mode"), "word");
});

test("an unknown route in the address bar opens letter mode at startup", async () => {
  const app = loadWebApp({
    boot: true,
    globals: { console: quietConsole, location: new URL("https://asl-assistant.netlify.app/#home") },
  });
  await app.ready;

  assert.equal(app.evaluate("state.mode"), "letter");
});

test("the default fetch serves the deployed folder and nothing outside it", async () => {
  const app = loadWebApp();
  const fetch = app.get("fetch");

  const labels = await fetch("./data/letter_labels.json");
  assert.equal(labels.ok, true);
  assert.ok(Object.keys(await labels.json()).length >= 24);

  assert.equal((await fetch("./data/no-such-file.json")).status, 404);
  assert.equal((await fetch("../../outside.md")).status, 404, "a path cannot climb out of asl-web");
  assert.equal((await fetch("./data/..%2f..%2foutside.md")).status, 404, "nor through an encoded slash");
  await assert.rejects(fetch("https://cdn.jsdelivr.net/npm/x.js"), TypeError, "other origins are offline");
});

test("the default history moves the default location, as the browser's does", () => {
  const app = loadWebApp();

  app.get("setMode")("qr");

  assert.equal(app.evaluate("location.hash"), "#qr");
});
