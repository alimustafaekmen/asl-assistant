// What a page load does before anything slow has answered, and what it asks
// the network for.
//
// The address decides the screen, and the render loop drives live inference,
// so neither may wait for the Model Test fixture list: on a slow connection a
// deep link to #word would show the letter screen, and a camera started then
// would never be read. The local fixture manifest exists only in an ignored
// local folder, so even on a development server it is asked for only when
// the Model Test screen opens, where it is used.
//
// The faults these kill: init() awaiting the manifest before it applies the
// route or starts the render loop, and a local manifest fetched on every page
// load. fetch is the boundary faked here; everything else is the real app.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const PUBLISHED = "/data/model-test-samples/manifest.json";
const LOCAL = "/data/model-test-samples/local/manifest.json";
const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/** A response for bytes from the deployed folder, or a 404. */
function fromDisk(path) {
  try {
    const body = readFileSync(join(WEB_DIR, path), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
}

/**
 * fetch() over the deployed folder, with `overrides` answering some paths
 * (a function per path), and a log of every path asked for.
 */
function network(overrides = {}) {
  const requested = [];
  const fetch = (input) => {
    const path = new URL(String(input), "https://asl-assistant.pages.dev/").pathname;
    requested.push(path);
    return path in overrides ? overrides[path]() : Promise.resolve(fromDisk(path));
  };
  return { fetch, requested };
}

/**
 * Open Model Test the way a developer does, as it has no tab: through the
 * address, which the page follows on hashchange.
 */
function openModelTest(app) {
  app.get("location").hash = "#test";
  app.windowHandler("hashchange")({ type: "hashchange" });
}

// A development server, the only host the local fixture folder can be served
// from; tests/web/model-test-local-host.test.js covers the published site.
function pageAt(hash, net) {
  return loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      fetch: net.fetch,
      location: new URL(`http://localhost:8080/${hash}`),
    },
  });
}

test("a deep link opens its screen and starts the render loop while the fixture list is still loading", async () => {
  // The fixture manifest never answers, as on a stalled connection.
  const app = pageAt("#word", network({ [PUBLISHED]: () => new Promise(() => {}) }));
  await flush();

  assert.equal(app.evaluate("state.mode"), "word", "the address chose word mode");
  assert.equal(app.evaluate("els.appShell.dataset.mode"), "word", "and the word screen is shown");
  assert.equal(app.pendingFrames(), 1, "the render loop is running");
});

test("a page load does not ask for the local fixture manifest; the Model Test screen does", async () => {
  const net = network();
  const app = pageAt("", net);
  await app.ready;
  assert.ok(net.requested.includes(PUBLISHED), "precondition: the published manifest was read");
  assert.equal(net.requested.includes(LOCAL), false, "the local manifest is not asked for outside Model Test");

  openModelTest(app);
  await flush();
  assert.equal(net.requested.filter((path) => path === LOCAL).length, 1, "opening Model Test asks for it once");
});

const localManifest = {
  schema_version: "asl-model-test-manifest-v1",
  words: [{ id: "word-all-01", label: "all", title: "Kelime all", path: "./data/model-test-samples/local/word-all-01.json" }],
};
const answer = (body) => () => Promise.resolve({ ok: true, status: 200, json: async () => body });

/** The ids the Model Test word dropdown offers. */
function offeredWordIds(app) {
  app.get("setModelTestTask")("word");
  return Array.from(app.evaluate("els.modelTestSampleSelect.options"), (option) => option.dataset.sampleId);
}

test("the Model Test screen offers the local word fixtures once it opens", async () => {
  const net = network({ [LOCAL]: answer(localManifest) });
  const app = pageAt("", net);
  await app.ready;
  openModelTest(app);
  await flush();

  const ids = offeredWordIds(app);
  assert.ok(ids.includes("word-all-01"), "the local fixture is listed");
  assert.ok(ids.includes("word-give-smoke"), "beside the published one");
});

test("a deep link to Model Test offers the local word fixtures too", async () => {
  const net = network({ [LOCAL]: answer(localManifest) });
  const app = pageAt("#test", net);
  await app.ready;
  await flush();

  assert.equal(app.evaluate("state.mode"), "test");
  const ids = offeredWordIds(app);
  assert.ok(ids.includes("word-all-01"));
  assert.equal(ids.filter((id) => id === "word-give-smoke").length, 1, "the published fixture is listed once");
});
