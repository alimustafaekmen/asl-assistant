// The reference panel and the viewer in English, and a switch while they
// are on screen.
//
// The faults these tests kill:
// - Turkish left in the reference panel of an English visitor on the
//   letter, word or coach screen, in its text, its image's alt text or its
//   page buttons' tooltips;
// - Turkish left in the viewer, on the letter chart, a word page or a word's
//   card, in its title, tools, zoom readout and the names a screen reader
//   speaks; a zoom written "%150" on an English page;
// - a Turkish gloss beside an English word for an English visitor, once the
//   glosses are reviewed;
// - a panel or an open viewer that keeps the old language after a switch.
//
// The network (the data files, served from disk), ONNX Runtime, MediaPipe's
// results and the browser's languages are faked at their boundaries; the
// dialog's showModal() and close() are stubs, because the harness has no top
// layer.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { RECORDING_FRAMES, feedFrames, wordModeApp } from "./helpers/word-recording.mjs";

const ENGLISH = ["en-US", "en"];
const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

const read = (app, expression) => app.evaluate(expression);
const byId = (app, id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`);
const text = (app, id) => byId(app, id).textContent;
const attr = (app, id, name) => byId(app, id).getAttribute(name);
const click = (app, id) => byId(app, id).dispatchEvent({ type: "click", detail: 1 });

/** Turkish anywhere in a part of the page, hidden parts included. */
function turkishIn(app, selector) {
  return turkishLeft(read(app, `document.querySelector(${JSON.stringify(selector)})`), { includeHidden: true }).map(
    ({ text: found, where, element }) => `${element} ${where}: ${found}`,
  );
}

/** Make the viewer's dialog a stub that records nothing but its open state. */
function stubDialog(app) {
  app.evaluate(`
    const dialog = document.getElementById("lightbox");
    dialog.showModal = () => dialog.setAttribute("open", "");
    dialog.close = () => dialog.removeAttribute("open");
  `);
}

/** The app booted on `hash`, as a browser preferring `languages`. */
async function bootedApp(hash, languages = ENGLISH, fetch = undefined) {
  const app = loadWebApp({
    boot: true,
    languages,
    globals: {
      console: quietConsole,
      location: new URL(`https://asl-assistant.pages.dev/${hash}`),
      kjua: () => ({}),
      ...(fetch ? { fetch } : {}),
    },
  });
  await app.ready;
  stubDialog(app);
  return app;
}

/** A word app whose model answers "water", with the reference data loaded. */
async function waterApp(languages = ENGLISH) {
  const { app } = wordModeApp({ winner: "water", languages });
  await app.get("loadWordReference")();
  stubDialog(app);
  app.get("bindReferenceLightbox")();
  return app;
}

test("an English visitor's reference panel on the letter screen is English", async () => {
  const app = await bootedApp("#letter");

  assert.deepEqual(turkishIn(app, ".app-reference"), []);
  assert.equal(text(app, "referenceKicker"), "Letter reference");
  assert.equal(text(app, "referenceTitle"), "ASL letter cards");
  assert.equal(text(app, "referenceNote"), "If letters get mixed up, compare your hand shape with the reference image.");
  assert.equal(attr(app, "referenceImage", "alt"), "ASL letter reference chart");
  assert.equal(text(app, "toggleReference"), "Show");
  click(app, "toggleReference");
  assert.equal(text(app, "toggleReference"), "Hide");
  assert.equal(text(app, "referenceOpen"), "Enlarge");
  assert.equal(text(app, "referenceVideoLink"), "Video guide");
  assert.deepEqual([...read(app, "I18N_PROBLEMS.missing")], []);
});

test("an English visitor's reference panel on the word and coach screens is English", async () => {
  const word = await bootedApp("#word");
  click(word, "toggleReference");
  assert.deepEqual(turkishIn(word, ".app-reference"), []);
  assert.equal(text(word, "referenceKicker"), "Word reference");
  assert.equal(text(word, "referenceTitle"), "50 word reference cards");
  assert.equal(attr(word, "referenceImage", "alt"), "ASL word reference page 1");
  assert.equal(attr(word, "referenceThumbs", "aria-label"), "Word reference pages");
  const thumbs = [...read(word, '[...document.querySelectorAll("#referenceThumbs button")].map((b) => b.getAttribute("title"))')];
  assert.deepEqual(thumbs, [1, 2, 3, 4, 5].map((n) => `Word reference page ${n}`));
  read(word, '[...document.querySelectorAll("#referenceThumbs button")][2]').dispatchEvent({ type: "click" });
  assert.equal(attr(word, "referenceImage", "alt"), "ASL word reference page 3");

  const coach = await bootedApp("#coach");
  assert.deepEqual(turkishIn(coach, ".app-reference"), []);
  assert.equal(text(coach, "referenceKicker"), "Coach reference");
  assert.match(text(coach, "referenceTitle"), /^Target letter: [A-Z]$/);
  assert.equal(text(coach, "referenceNote"), "If you cannot make the target, look at the reference image or the video guide.");
});

test("an English word result shows its card in English", async () => {
  const app = await waterApp();
  await app.get("startWordRecording")();
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(read(app, "state.prediction"), "water");

  assert.deepEqual(turkishIn(app, ".app-reference"), []);
  assert.equal(text(app, "referenceTitle"), "water");
  assert.equal(byId(app, "referenceCardImage").alt, "Reference card for the sign water");
});

test("the English viewer names its letter chart, pages, card and zoom in English", async () => {
  const app = await waterApp();
  const open = app.get("openReferenceViewer");

  open({ kind: "letter" });
  assert.deepEqual(turkishIn(app, "#lightbox"), [], "the letter chart");
  assert.equal(text(app, "lightboxTitle"), "ASL letter chart");
  assert.equal(attr(app, "lightboxTitle", "lang"), "en");
  assert.equal(attr(app, "lightboxImage", "alt"), "ASL letter reference chart");
  app.get("closeReferenceViewer")();

  open({ kind: "page", index: 1 });
  assert.deepEqual(turkishIn(app, "#lightbox"), [], "a word page");
  assert.equal(text(app, "lightboxTitle"), "Word page 2 of 5");
  assert.equal(attr(app, "lightboxImage", "alt"), "Word page 2 of 5");
  assert.equal(text(app, "lightboxZoom"), "Fit");
  assert.equal(attr(app, "lightboxZoom", "aria-label"), "Zoomed to fit");
  for (let i = 0; i < 4; i++) click(app, "lightboxZoomIn");
  assert.equal(text(app, "lightboxZoom"), "150%");
  assert.equal(attr(app, "lightboxZoom", "aria-label"), "Zoom 150%, tap to fit");
  assert.deepEqual(turkishIn(app, "#lightbox"), [], "zoomed in");
  app.get("closeReferenceViewer")();

  open({ kind: "card", label: "water" });
  assert.deepEqual(turkishIn(app, "#lightbox"), [], "a word's card");
  assert.equal(text(app, "lightboxTitle"), "water");
  assert.equal(text(app, "lightboxMode"), "Whole page");
  click(app, "lightboxMode");
  assert.equal(text(app, "lightboxMode"), "Card only");
  assert.equal(text(app, "lightboxTitle"), "Word page 5 of 5");
  assert.deepEqual([...read(app, "I18N_PROBLEMS.missing")], []);
});

test("a switch redraws the panel and the open viewer, and back again", async () => {
  const app = await waterApp(["tr-TR", "tr"]);
  app.get("setReferenceOpen")(true);
  app.get("openReferenceViewer")({ kind: "page", index: 1 });
  click(app, "lightboxZoomIn");
  const turkish = () =>
    [text(app, "referenceKicker"), text(app, "referenceTitle"), text(app, "toggleReference"), text(app, "lightboxTitle"), text(app, "lightboxZoom")];
  assert.deepEqual(turkish(), ["Kelime referansı", "50 kelime referans kartı", "Gizle", "Kelime sayfası 2 / 5", "%50"]);

  app.get("setLanguage")("en");
  assert.deepEqual(turkishIn(app, ".app-reference"), []);
  assert.deepEqual(turkishIn(app, "#lightbox"), []);
  assert.equal(text(app, "referenceKicker"), "Word reference");
  assert.equal(text(app, "referenceTitle"), "50 word reference cards");
  assert.equal(text(app, "toggleReference"), "Hide");
  assert.equal(text(app, "lightboxTitle"), "Word page 2 of 5");
  assert.equal(attr(app, "lightboxTitle", "lang"), "en");
  assert.equal(text(app, "lightboxZoom"), "50%", "the zoom is kept");
  assert.equal(read(app, 'document.getElementById("lightbox").hasAttribute("open")'), true, "the viewer stays open");

  app.get("setLanguage")("tr");
  assert.deepEqual(turkish(), ["Kelime referansı", "50 kelime referans kartı", "Gizle", "Kelime sayfası 2 / 5", "%50"]);
  assert.equal(attr(app, "lightboxTitle", "lang"), "tr");
});

test("a reviewed Turkish gloss is shown to a Turkish visitor and not to an English one", async () => {
  const reference = JSON.parse(readFileSync(join(WEB_DIR, "data/word_reference.json"), "utf8"));
  const reviewed = async (input) => {
    const url = new URL(String(input), "https://asl-assistant.pages.dev/");
    if (url.pathname === "/data/word_reference.json") {
      const body = { ...reference, gloss_reviewed: true };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    try {
      const bytes = readFileSync(join(WEB_DIR, decodeURIComponent(url.pathname)));
      return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString("utf8")), text: async () => bytes.toString("utf8") };
    } catch {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
  };
  const entryGloss = (app) => read(app, `document.querySelector('#wordLibraryGroups [data-word="bird"] .word-entry__gloss')`);

  const turkish = await bootedApp("#word", ["tr-TR", "tr"], reviewed);
  assert.equal(entryGloss(turkish).textContent, " (kuş)");
  turkish.get("openReferenceViewer")({ kind: "card", label: "bird" });
  assert.equal(text(turkish, "lightboxTitle"), "bird (kuş)");

  const english = await bootedApp("#word", ENGLISH, reviewed);
  assert.equal(entryGloss(english), null);
  english.get("openReferenceViewer")({ kind: "card", label: "bird" });
  assert.equal(text(english, "lightboxTitle"), "bird");
  assert.equal(byId(english, "lightboxCardImage").alt, "Reference card for the sign bird");
});
