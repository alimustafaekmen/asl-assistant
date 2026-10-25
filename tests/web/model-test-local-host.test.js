// The local Model Test fixtures are asked for only on a development server.
//
// The local fixture folder is git-ignored and never deployed, so on the
// published site its manifest is always a 404, which the browser logs in the
// console of every visitor who opens Model Test. A development server on this
// computer is the only place the folder can exist.
//
// fetch and the page address are the boundaries faked here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const LOCAL_MANIFEST = "/data/model-test-samples/local/manifest.json";
const quietConsole = { ...console, log() {}, warn() {}, info() {} };

const localManifest = {
  schema_version: "asl-model-test-manifest-v1",
  words: [{ id: "word-all-01", label: "all", title: "Kelime all", path: "./data/model-test-samples/local/word-all-01.json" }],
};

/** fetch() over the deployed folder plus the local manifest, logging every path. */
function network() {
  const requested = [];
  const fetch = async (input) => {
    const path = new URL(String(input), "http://page.invalid/").pathname;
    requested.push(path);
    if (path === LOCAL_MANIFEST) return { ok: true, status: 200, json: async () => localManifest };
    try {
      const body = readFileSync(join(WEB_DIR, path), "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    } catch {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
  };
  return { fetch, requested };
}

/** Model Test opened by a deep link on `origin`. */
async function modelTestAt(origin) {
  const net = network();
  const app = loadWebApp({
    boot: true,
    globals: { console: quietConsole, fetch: net.fetch, location: new URL(`${origin}/#test`) },
  });
  await app.ready;
  await flush();
  assert.equal(app.evaluate("state.mode"), "test", "precondition: Model Test is open");
  app.get("setModelTestTask")("word");
  const offered = Array.from(app.evaluate("els.modelTestSampleSelect.options"), (option) => option.dataset.sampleId);
  return { requested: net.requested, offered };
}

test("the published site never asks for the local fixtures", async () => {
  const { requested, offered } = await modelTestAt("https://asl-assistant.pages.dev");

  assert.ok(requested.some((path) => path.endsWith("model-test-samples/manifest.json")), "precondition: the published manifest was read");
  assert.deepEqual(requested.filter((path) => path.includes("/local/")), []);
  assert.equal(offered.includes("word-all-01"), false);
});

for (const origin of ["http://localhost:8080", "http://127.0.0.1:8000", "http://[::1]:8000"]) {
  test(`a development server on ${origin} adds the local word fixtures`, async () => {
    const { requested, offered } = await modelTestAt(origin);

    assert.equal(requested.filter((path) => path === LOCAL_MANIFEST).length, 1);
    assert.ok(offered.includes("word-all-01"), "the local fixture is listed");
    assert.ok(offered.includes("word-give-smoke"), "beside the published one");
  });
}
