// What a reader sees before the page has been translated.
//
// The markup is authored in Turkish and translated near the end of the body,
// so a browser could paint the Turkish while the strings download. A page
// for an English reader is marked as waiting for its translation before the
// first paint (the stylesheet keeps it hidden while marked), and the mark is
// taken off once the translation has run, or has failed. A translation that
// could not run leaves the Turkish markup, and <html lang> then says so.
//
// The faults these tests kill:
// - an English reader's first frame not marked, so the Turkish shows until
//   the strings arrive;
// - a Turkish reader's first frame marked, hiding a page that needs no
//   translation;
// - the mark left on after the translation, or after a translation that
//   failed, so the page stays hidden until the stylesheet's fail-safe;
// - strings that never loaded leaving lang="en" on a Turkish page, so a
//   screen reader reads Turkish with an English voice, and the start-up
//   failure written in Turkish under it, or kept hidden, when even the
//   translation step never loaded.
//
// Storage, the browser's languages and the network (a script that never
// loaded) are faked; the markup and the scripts are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadBeforeStylesheets, loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };
const ENGLISH = ["en-US", "en"];
const PENDING = "data-i18n-pending";
const STRINGS_SCRIPTS = [
  "js/core/i18n.js",
  "js/i18n/shell.js",
  "js/i18n/letter.js",
  "js/i18n/word.js",
  "js/i18n/coach.js",
  "js/i18n/info.js",
];

const root = (page) => page.evaluate("document.documentElement");

test("an English reader's first frame waits for the translation; a Turkish reader's does not", () => {
  assert.equal(root(loadBeforeStylesheets({ languages: ENGLISH })).hasAttribute(PENDING), true);
  assert.equal(root(loadBeforeStylesheets({ savedLanguage: "en", languages: ["tr-TR"] })).hasAttribute(PENDING), true);
  assert.equal(root(loadBeforeStylesheets({ languages: ["tr-TR", "tr"] })).hasAttribute(PENDING), false);
  assert.equal(root(loadBeforeStylesheets({ savedLanguage: "tr", languages: ENGLISH })).hasAttribute(PENDING), false);
});

test("the wait ends once the page is translated, before init() runs", () => {
  const app = loadWebApp({ languages: ENGLISH, globals: { console: quietConsole } });
  assert.equal(root(app).getAttribute("lang"), "en");
  assert.equal(app.evaluate('document.getElementById("skipLink").textContent'), "Skip to content");
  assert.equal(root(app).hasAttribute(PENDING), false);
});

test("strings that never loaded leave a page that is shown and says it is Turkish", async () => {
  const app = loadWebApp({
    boot: true,
    languages: ENGLISH,
    unloadedScripts: STRINGS_SCRIPTS,
    globals: { console: quietConsole },
  });
  const settled = app.ready.catch(() => {});
  // Read before init() has failed: this is js/core/i18n-boot.js's doing.
  assert.equal(root(app).hasAttribute(PENDING), false, "the page is not left hidden");
  assert.equal(root(app).getAttribute("lang"), "tr", "the Turkish markup is named Turkish");
  assert.equal(app.evaluate('document.getElementById("skipLink").textContent'), "İçeriğe geç", "precondition");

  await settled;
  const notice = app.evaluate('document.getElementById("startupError")');
  assert.equal(notice.hidden, false, "precondition: start-up failed and says so");
  assert.match(notice.textContent, /^Uygulama başlatılamadı/);
  assert.equal(root(app).getAttribute("lang"), "tr", "and the Turkish failure is named Turkish too");
});

test("a start-up failure without the strings or the translation step names its Turkish and shows it", async () => {
  const app = loadWebApp({
    boot: true,
    languages: ENGLISH,
    unloadedScripts: [...STRINGS_SCRIPTS, "js/core/i18n-boot.js"],
    globals: { console: quietConsole },
  });
  const settled = app.ready.catch(() => {});
  assert.equal(root(app).getAttribute("lang"), "en", "precondition: nothing has corrected the language yet");

  await settled;
  assert.match(app.evaluate('document.getElementById("startupError").textContent'), /^Uygulama başlatılamadı/);
  assert.equal(root(app).getAttribute("lang"), "tr");
  assert.equal(root(app).hasAttribute(PENDING), false, "the failure is shown, not hidden until the fail-safe");
});
