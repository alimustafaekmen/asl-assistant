// The word screen's side cards: what to try first, and the 50 words.
//
// Both cards are built from the published evaluation data, so the tests
// serve that data through the fetch boundary, change it there, and read what
// the booted app shows. The document is the real index.html. The viewer
// dialog is faked as reference-viewer.test.js fakes it, because the harness
// has no top layer: showModal() and close() record their calls, and so does
// focus() on the controls a test watches.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };
const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));
const STATS = readJson("data/per_word_stats.json");
const PAIRS = readJson("data/confusion_pairs.json");
const WORDS = Object.keys(readJson("data/word_labels.json"));

/**
 * fetch() serving asl-web/ from disk, with some data files replaced.
 *
 * @param {Record<string, unknown>} replaced Bodies by file name under data/.
 */
function diskFetchWith(replaced) {
  return async (input) => {
    const url = new URL(String(input), "https://asl-assistant.netlify.app/");
    const name = url.pathname.split("/").at(-1);
    if (url.pathname.startsWith("/data/") && name in replaced) {
      const body = replaced[name];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    try {
      const bytes = readFileSync(join(WEB_DIR, decodeURIComponent(url.pathname)));
      return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString("utf8")), text: async () => bytes.toString("utf8") };
    } catch {
      return { ok: false, status: 404, json: async () => { throw new SyntaxError("not found"); }, text: async () => "" };
    }
  };
}

/** The app booted in word mode, with the viewer dialog faked. */
async function bootedApp(replaced = {}) {
  const app = loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      location: new URL("https://asl-assistant.netlify.app/#word"),
      fetch: diskFetchWith(replaced),
    },
  });
  await app.ready;
  app.evaluate(`
    globalThis.__calls = [];
    const dialog = document.getElementById("lightbox");
    dialog.showModal = () => { __calls.push("showModal"); dialog.setAttribute("open", ""); };
    dialog.close = () => { __calls.push("close"); dialog.removeAttribute("open"); };
  `);
  return app;
}

// Through JSON, because an array made inside the app's context is not an
// array of this one.
const read = (app, expression) => JSON.parse(app.evaluate(`JSON.stringify(${expression})`));
const chipWords = (app, listId) =>
  read(app, `[...document.getElementById("${listId}").querySelectorAll("button")].map((b) => b.dataset.word)`);
const pairWords = (app) =>
  read(
    app,
    `[...document.getElementById("wordConfusionList").children].map((li) => [...li.querySelectorAll("button")].map((b) => b.dataset.word))`,
  );
const entry = (app, word) => `document.querySelector('#wordLibraryGroups [data-word="${word}"]')`;
/** The words the library shows now, ignoring the hidden ones. */
const shownWords = (app) =>
  read(
    app,
    `[...document.getElementById("wordLibraryGroups").querySelectorAll("[data-word]")]
      .filter((b) => !b.parentElement.hidden && !b.closest("section").hidden)
      .map((b) => b.dataset.word)`,
  );
const search = (app, text) => {
  app.evaluate(`document.getElementById("wordLibrarySearch").value = ${JSON.stringify(text)};`);
  app.evaluate('document.getElementById("wordLibrarySearch")').dispatchEvent({ type: "input" });
};
const emptyMessageShown = (app) => !app.evaluate('document.getElementById("wordLibraryEmpty").hidden');

test("the side panel has no model card and no offline test button", async () => {
  const app = await bootedApp();

  assert.equal(app.evaluate('document.getElementById("offlineTest")'), null);
  assert.equal(app.evaluate('document.querySelector(".model-card")'), null);
});

test("the first card offers the easiest words of per_word_stats.json, best recognised first", async () => {
  const expected = Object.entries(STATS)
    .filter(([, stat]) => stat.difficulty === "easy")
    .sort(([, a], [, b]) => b.accuracy - a.accuracy)
    .slice(0, 10)
    .map(([word]) => word);
  const app = await bootedApp();

  assert.deepEqual(chipWords(app, "wordDemoList"), expected);
  assert.equal(app.evaluate('document.getElementById("wordDemoCount").textContent'), "10 kolay kelime");
  assert.equal(app.evaluate('document.getElementById("wordDemoCard").hidden'), false);
});

test("changing per_word_stats.json changes the words the first card offers", async () => {
  const stats = {
    all: { accuracy: 0.99, f1: 0.9, difficulty: "easy", sample_count: 10 },
    hello: { accuracy: 0.5, f1: 0.5, difficulty: "easy", sample_count: 10 },
    water: { accuracy: 0.97, f1: 0.97, difficulty: "hard", sample_count: 10 },
    yes: { accuracy: 0.7, f1: 0.7, difficulty: "easy", sample_count: 10 },
  };
  const app = await bootedApp({ "per_word_stats.json": stats });

  assert.deepEqual(chipWords(app, "wordDemoList"), ["all", "yes", "hello"], "only the easy ones, by accuracy");
  assert.equal(app.evaluate('document.getElementById("wordDemoCount").textContent'), "3 kolay kelime");
});

test("each confused pair is shown once whichever way it was confused, the most confused first", async () => {
  const pairs = [
    { word_a: "listen", word_b: "hear", count: 23 },
    { word_a: "can", word_b: "yes", count: 22 },
    { word_a: "open", word_b: "book", count: 20 },
    { word_a: "yes", word_b: "can", count: 11 },
    { word_a: "sleep", word_b: "sleepy", count: 9 },
    { word_a: "who", word_b: "bird", count: 8 },
    { word_a: "go", word_b: "dog", count: 7 },
  ];
  const app = await bootedApp({ "confusion_pairs.json": pairs });

  assert.deepEqual(pairWords(app), [
    ["can", "yes"],
    ["listen", "hear"],
    ["open", "book"],
    ["sleep", "sleepy"],
    ["who", "bird"],
  ]);
});

test("the published pairs are listed five at most, none of them twice", async () => {
  const app = await bootedApp();
  const shown = pairWords(app);

  assert.equal(shown.length, Math.min(5, PAIRS.length));
  const keys = shown.map((pair) => [...pair].sort().join("|"));
  assert.equal(new Set(keys).size, keys.length);
});

test("a word chip opens that word's card in the viewer and gets focus back when it closes", async () => {
  const app = await bootedApp();
  const word = chipWords(app, "wordDemoList")[0];
  const chip = app.evaluate(`document.querySelector('#wordDemoList [data-word="${word}"]')`);
  app.evaluate(`document.querySelector('#wordDemoList [data-word="${word}"]').focus = () => __calls.push("focus:chip");`);

  chip.dispatchEvent({ type: "click", detail: 1 });
  assert.equal(app.evaluate('document.getElementById("lightboxTitle").textContent'), word);
  assert.equal(app.evaluate('document.getElementById("lightboxCard").hidden'), false, "the card, not a page");

  app.evaluate('document.getElementById("lightbox")').dispatchEvent({ type: "cancel", preventDefault() {} });
  assert.deepEqual(read(app, "__calls"), ["showModal", "close", "focus:chip"]);
});

test("a word in the 50-word list opens its own card too", async () => {
  const app = await bootedApp();

  app.evaluate(entry(app, "donkey")).dispatchEvent({ type: "click", detail: 1 });

  assert.equal(app.evaluate('document.getElementById("lightboxTitle").textContent'), "donkey");
});

test("the list holds each of the 50 words once, under its group", async () => {
  const app = await bootedApp();
  const listed = read(app, '[...document.querySelectorAll("#wordLibraryGroups [data-word]")].map((b) => b.dataset.word)');

  assert.equal(listed.length, WORDS.length);
  assert.deepEqual([...listed].sort(), [...WORDS].sort());
  assert.deepEqual(read(app, '[...document.querySelectorAll("#wordLibraryGroups h3")].map((h) => h.textContent)'), [
    "Günlük",
    "Duygu / durum",
    "Hayvan",
    "Aile / insan",
    "Diğer",
  ]);
});

test("each word shows its difficulty in words and its test accuracy as a Turkish percentage", async () => {
  const app = await bootedApp();
  const labels = { easy: "kolay", medium: "orta", hard: "zor" };

  for (const word of WORDS) {
    const stat = STATS[word];
    const hint = app.evaluate(`${entry(app, word)}.querySelector(".word-entry__hint").textContent`);
    assert.equal(hint, `${labels[stat.difficulty]} · %${Math.round(stat.accuracy * 100)}`, word);
  }
  assert.equal(app.evaluate(`${entry(app, "all")}.querySelector(".word-entry__hint").textContent`), "zor · %44");
});

test("the search filters as you type, ignores case, and says so when nothing matches", async () => {
  const app = await bootedApp();
  assert.equal(shownWords(app).length, 50);
  assert.equal(emptyMessageShown(app), false);

  search(app, "do");
  assert.deepEqual(shownWords(app), ["dog", "donkey"]);
  assert.deepEqual(
    read(app, '[...document.querySelectorAll("#wordLibraryGroups section")].filter((s) => !s.hidden).map((s) => s.querySelector("h3").textContent)'),
    ["Hayvan"],
    "a group with no match is hidden",
  );

  search(app, "  DONK ");
  assert.deepEqual(shownWords(app), ["donkey"]);

  search(app, "xyz");
  assert.deepEqual(shownWords(app), []);
  assert.equal(emptyMessageShown(app), true);
  assert.equal(app.evaluate('document.getElementById("wordLibraryEmpty").textContent'), "Bu adla bir kelime yok.");

  search(app, "");
  assert.equal(shownWords(app).length, 50);
  assert.equal(emptyMessageShown(app), false);
});

test("Turkish glosses stay hidden and unsearchable until a signer has reviewed them", async () => {
  const unreviewed = await bootedApp();
  assert.equal(unreviewed.evaluate(`${entry(unreviewed, "bird")}.querySelector(".word-entry__gloss")`), null);
  search(unreviewed, "kuş");
  assert.deepEqual(shownWords(unreviewed), []);

  const reference = readJson("data/word_reference.json");
  const reviewed = await bootedApp({ "word_reference.json": { ...reference, gloss_reviewed: true } });
  assert.equal(reviewed.evaluate(`${entry(reviewed, "bird")}.querySelector(".word-entry__gloss").textContent`), " (kuş)");
  // Turkish case rules: "KUŞ" lowers to "kuş", and "I" to "ı".
  search(reviewed, "KUŞ");
  assert.deepEqual(shownWords(reviewed), ["bird"]);
});

test("a word reads as its card names it, not as the model's label", async () => {
  // The model's label "thankyou" is the card titled "thank you"; the chip
  // and the list entry show the title and still open that word's card.
  const app = await bootedApp({ "per_word_stats.json": { ...STATS, thankyou: { ...STATS.thankyou, difficulty: "easy", accuracy: 0.999 } } });
  const chip = 'document.querySelector(\'#wordDemoList [data-word="thankyou"]\')';
  assert.equal(read(app, `${chip}.textContent`), "thank you");
  assert.equal(read(app, `${entry(app, "thankyou")}.querySelector(".word-entry__name").textContent`), "thank you");

  // Searching for the name the visitor sees finds the word.
  app.evaluate(`
    const field = document.getElementById("wordLibrarySearch");
    field.value = "thank you";
    field.dispatchEvent({ type: "input" });
  `);
  assert.equal(read(app, `${entry(app, "thankyou")}.closest("[hidden]") === null`), true);
});
