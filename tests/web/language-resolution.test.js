// The language a visitor's first frame is in.
//
// The page resolves it before the stylesheets, in this order: the visitor's
// saved choice, then the browser's preferred languages, then English. The
// faults these tests kill:
// - the browser's preference overriding a choice the visitor made;
// - only navigator.language read, so a visitor whose first preference we do
//   not have, but whose second we do, gets the fallback;
// - a tag in capitals ("TR-tr") or written with an underscore ("tr_TR")
//   not read as its language;
// - navigator.language ignored where navigator.languages is missing;
// - a visitor who reads neither language getting Turkish instead of English;
// - blocked storage ending the script, or an unknown saved value obeyed;
// - the resolution moved after the stylesheets (or into init()), where the
//   first frame has already been painted with the authored lang="tr".
//
// Storage and the browser's languages are faked; the document is the real
// index.html, and only the scripts before its first stylesheet run
// (loadBeforeStylesheets): the page a browser can paint.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadBeforeStylesheets } from "./helpers/web-app-context.mjs";

/** Storage holding `items`. */
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
 * The <html lang> of the first frame.
 *
 * @param {{saved?: Record<string, string>, storage?: object, navigator?: object, languages?: string[]}} setup
 */
function firstFrameLanguage({ saved = {}, storage = storageWith(saved), navigator, languages } = {}) {
  const globals = { localStorage: storage, ...(navigator ? { navigator } : {}) };
  const page = loadBeforeStylesheets({ globals, ...(languages ? { languages } : {}) });
  return page.document.documentElement.getAttribute("lang");
}

test("a saved choice wins over the browser's languages, both ways", () => {
  assert.equal(firstFrameLanguage({ saved: { "asl-lang": "en" }, languages: ["tr-TR", "tr"] }), "en");
  assert.equal(firstFrameLanguage({ saved: { "asl-lang": "tr" }, languages: ["en-US", "en"] }), "tr");
});

test("without a choice, the first preferred language we have wins", () => {
  assert.equal(firstFrameLanguage({ languages: ["en-GB", "tr"] }), "en");
  assert.equal(firstFrameLanguage({ languages: ["tr-TR", "en-US"] }), "tr");
  assert.equal(firstFrameLanguage({ languages: ["de-DE", "tr", "en"] }), "tr", "a language we lack is skipped");
  assert.equal(firstFrameLanguage({ languages: ["fr", "EN-au"] }), "en", "the primary subtag decides, in any case");
});

test("a tag in capitals or with an underscore is still read by its primary subtag", () => {
  // Turkish, because English is also the fallback: a tag misread here falls
  // through to English and would pass unnoticed.
  assert.equal(firstFrameLanguage({ languages: ["fr", "TR-tr"] }), "tr", "the primary subtag decides, in any case");
  assert.equal(firstFrameLanguage({ languages: ["de", "tr_TR"] }), "tr", "an underscore separates it too");
  assert.equal(firstFrameLanguage({ navigator: { language: "TR" } }), "tr");
});

test("a browser that gives only navigator.language is read through it", () => {
  assert.equal(firstFrameLanguage({ navigator: { language: "tr-TR" } }), "tr");
  assert.equal(firstFrameLanguage({ navigator: { languages: [], language: "tr" } }), "tr");
});

test("a visitor whose languages we do not have gets English", () => {
  assert.equal(firstFrameLanguage({ languages: ["de-DE", "fr-FR"] }), "en");
  assert.equal(firstFrameLanguage({ navigator: { languages: [] } }), "en");
});

test("blocked storage reads as no choice and leaves the browser to decide", () => {
  assert.equal(firstFrameLanguage({ storage: blockedStorage, languages: ["tr-TR"] }), "tr");
  assert.equal(firstFrameLanguage({ storage: blockedStorage, languages: ["en-US"] }), "en");
});

test("a saved value that is not one of ours is ignored", () => {
  for (const value of ["de", "EN", "english", ""]) {
    assert.equal(
      firstFrameLanguage({ saved: { "asl-lang": value }, languages: ["tr-TR"] }),
      "tr",
      `a saved ${JSON.stringify(value)} must not decide`,
    );
  }
});
