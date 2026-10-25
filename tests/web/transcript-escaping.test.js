// A word the model names is shown in the transcript as text, never as markup.
//
// Word labels are data the app fetches, and an accepted word result is the
// one way a free-form string reaches the transcript. Here the label file
// served over the network names a word that looks like markup; the word is
// recorded, accepted and reloaded through the app's own code. Only the
// boundaries are faked: the network (the label file), ONNX Runtime, the
// MediaPipe results, and a storage that outlives one page load.
//
// The fault this kills is the transcript written into innerHTML without
// escaping: the label would become an <img> with an onerror handler.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";
import { fakeOrt, recordWord } from "./helpers/word-recording.mjs";

const HOSTILE = '<img src=x onerror="alert(1)">&amp;';
const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** The real label file with one word renamed to HOSTILE, at the same index. */
function hostileLabels() {
  const labels = JSON.parse(readFileSync(join(WEB_DIR, "data", "word_labels.json"), "utf8"));
  const renamed = {};
  for (const [word, index] of Object.entries(labels)) renamed[word === "book" ? HOSTILE : word] = index;
  return renamed;
}

/** fetch() serving the deployed folder from disk, with the hostile label file. */
async function networkWithHostileLabels(input) {
  const path = new URL(String(input), "https://asl-assistant.pages.dev/").pathname;
  if (path.endsWith("/data/word_labels.json")) {
    const body = JSON.stringify(hostileLabels());
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  }
  try {
    const body = readFileSync(join(WEB_DIR, decodeURIComponent(path)), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
}

function persistentStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

/** What the strip shows, without the decorative caret. */
const shown = (app) => app.evaluate("els.transcriptText.textContent").replace(/\|$/, "");

test("a word that looks like markup is shown as text, now and after a reload", async () => {
  const storage = persistentStorage();
  const { ort } = fakeOrt({ winner: "book" });
  const first = loadWebApp({
    boot: true,
    globals: { ort, fetch: networkWithHostileLabels, localStorage: storage, console: quietConsole },
  });
  await first.ready;
  first.evaluate('document.querySelector(\'button[data-mode="word"]\')').dispatchEvent({ type: "click", detail: 1 });
  // The state a successful camera start leaves; the countdown is skipped.
  first.evaluate(`
    globalThis.__clock = 0;
    globalThis.performance = { now: () => __clock };
    CONFIG.COUNTDOWN_SECONDS = 0;
    state.cameraOn = true;
    mpRunning = true;
    poseLandmarker = { close() {} };
    faceLandmarker = { close() {} };
  `);
  await recordWord(first);
  assert.equal(first.evaluate("state.prediction"), HOSTILE, "precondition: the model named the hostile word");
  first.evaluate("__clock += 1000;");
  first.evaluate("els.appendWordResult").dispatchEvent({ type: "click", detail: 0 });

  const second = loadWebApp({ boot: true, globals: { localStorage: storage, console: quietConsole } });
  await second.ready;
  for (const page of [first, second]) {
    assert.equal(shown(page), HOSTILE, "the characters are shown, not interpreted");
    assert.equal(page.evaluate('els.transcriptText.querySelector("img")'), null, "no element was created from the text");
    assert.equal(page.evaluate("els.transcriptText.children.length"), 1, "only the caret is markup");
  }
});
