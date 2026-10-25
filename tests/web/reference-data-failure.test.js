// A reference data file that cannot be read says so in the console.
//
// asl_video_links.json and word_reference.json are optional: without them
// the video button opens a generated search and the word reference shows
// whole pages. The fault these tests kill is the silence around that
// fallback: a malformed file (a bad deploy, a hand edit) was swallowed by a
// catch that also hid every other error, so nobody could tell the published
// links or the word cards were gone. A failed read must leave one warning
// naming the file, and the same fallback as before.
//
// The network is the boundary faked here: fetch serves the deployed folder
// from disk, except for the file a test breaks. Everything else is the
// booted app.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const quiet = { ...console, log() {}, info() {}, error() {} };

/** fetch() serving asl-web/ from disk, with `broken` files answered by their text. */
function fetchWithBroken(broken) {
  return async (input) => {
    const path = new URL(String(input), "https://asl-assistant.pages.dev/").pathname;
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name in broken) return new Response(broken[name], { status: 200, headers: { "content-type": "application/json" } });
    try {
      return new Response(readFileSync(join(WEB_DIR, decodeURIComponent(path))), { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  };
}

/** The booted app on `hash` with `broken` files, and every console.warn as text. */
async function bootWith(hash, broken) {
  const warnings = [];
  const app = loadWebApp({
    boot: true,
    globals: {
      console: { ...quiet, warn: (...args) => warnings.push(args.map(String).join(" ")) },
      fetch: fetchWithBroken(broken),
      location: new URL(`https://asl-assistant.pages.dev/${hash}`),
    },
  });
  await app.ready;
  await flush();
  return { app, warnings };
}

const naming = (warnings, file) => warnings.filter((line) => line.includes(file));
const SEARCH_URL = "https://www.youtube.com/results?search_query=";

for (const [kind, body] of [["malformed JSON", "{ not json"], ["JSON that is not an object", "null"]]) {
  test(`video links that are ${kind} are reported once, and the video button searches`, async () => {
    const { app, warnings } = await bootWith("#letter", { "asl_video_links.json": body });

    assert.equal(naming(warnings, "asl_video_links.json").length, 1, `warnings: ${JSON.stringify(warnings)}`);
    const href = app.evaluate(`document.getElementById("referenceVideoLink").href`);
    assert.ok(href.startsWith(SEARCH_URL), `the video button lost its fallback: ${href}`);
  });
}

test("the published video links still load", async () => {
  const { app, warnings } = await bootWith("#letter", {});

  assert.deepEqual(naming(warnings, "asl_video_links.json"), []);
  const href = app.evaluate(`document.getElementById("referenceVideoLink").href`);
  assert.ok(!href.startsWith(SEARCH_URL), "precondition: the published alphabet video is linked");
});

for (const [kind, body] of [["malformed JSON", "{ not json"], ["JSON that is not an object", "null"]]) {
  test(`word reference data that is ${kind} is reported once, and whole pages are shown`, async () => {
    const { app, warnings } = await bootWith("#word", { "word_reference.json": body });

    assert.equal(naming(warnings, "word_reference.json").length, 1, `warnings: ${JSON.stringify(warnings)}`);
    assert.equal(app.evaluate(`document.getElementById("startupError").hidden`), true, "the app still started");
    assert.equal(app.evaluate(`document.getElementById("referenceCard").hidden`), true, "no word card without its data");
    assert.equal(app.evaluate(`document.getElementById("referenceThumbs").hidden`), false, "the page buttons are offered");
  });
}
