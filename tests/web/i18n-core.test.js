// The strings registry, lookup and the language switch (js/core/i18n.js).
//
// The faults these tests kill:
// - a key registered in one language and not the other (read from the loaded
//   registry, so every area file is covered as soon as it registers);
// - a key outside its area, or registered twice, silently overwriting
//   another area's string;
// - markup naming a key nobody registered, or an authored Turkish text that
//   drifted from the Turkish string, so switching back shows other words;
// - a missing English string showing a raw key or nothing, instead of the
//   Turkish one, and passing unnoticed;
// - {name} parameters or the English plural forms not filled in;
// - a switch that does not persist, does not move <html lang>, does not
//   reach the markup or the listeners, or stops at a listener that throws;
// - the switch overwriting text a script wrote since the markup was shown.
//
// Storage and the browser's languages are faked; the registry, the markup
// and the switch are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const AREAS = ["shell", "letter", "word", "coach", "info"];
const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "content", "lang"];

/** A booted app; `options` are loadWebApp()'s. */
async function bootedApp(options = {}) {
  const app = loadWebApp({ boot: true, ...options, globals: { console: quietConsole, ...options.globals } });
  await app.ready;
  return app;
}

/** Every element of the live document that names a string, with its keys. */
function markedElements(app) {
  const selector = ["[data-i18n]", "[data-i18n-html]", ...ATTRIBUTES.map((name) => `[data-i18n-${name}]`)].join(",");
  return app.evaluate("document").querySelectorAll(selector);
}

/** The keys an element names, as [kind, key]. */
function namedKeys(element) {
  const pairs = [];
  for (const kind of ["data-i18n", "data-i18n-html", ...ATTRIBUTES.map((name) => `data-i18n-${name}`)]) {
    const key = element.getAttribute(kind);
    if (key) pairs.push([kind, key]);
  }
  return pairs;
}

const collapse = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

test("every area registers, and every key exists in both languages", () => {
  const app = loadWebApp();
  const strings = app.get("I18N_STRINGS");

  assert.deepEqual([...app.get("I18N_AREAS")], AREAS, "each area file registers once, in load order");
  const turkish = Object.keys(strings.tr).sort();
  const english = Object.keys(strings.en).sort();
  assert.deepEqual(turkish.filter((key) => !(key in strings.en)), [], "Turkish keys with no English string");
  assert.deepEqual(english.filter((key) => !(key in strings.tr)), [], "English keys with no Turkish string");
  assert.deepEqual([...app.get("I18N_PROBLEMS").refused], [], "refused registrations");
  for (const key of turkish) {
    assert.ok(AREAS.some((area) => key.startsWith(`${area}.`)), `${key} names no area`);
  }
});

test("a key outside its area, or registered twice, is refused and recorded", () => {
  const app = loadWebApp({ globals: { console: quietConsole } });
  const before = app.evaluate('t("shell.skipLink")');
  app.get("registerStrings")("word", { tr: { "shell.extra": "Başka" }, en: { "shell.extra": "Other" } });
  app.get("registerStrings")("shell", { tr: { "shell.skipLink": "İkinci" } });

  assert.equal(app.evaluate('t("shell.extra")'), "", "another area cannot add to the shell");
  assert.equal(app.evaluate('t("shell.skipLink")'), before, "the first registration stands");
  assert.deepEqual([...app.get("I18N_PROBLEMS").refused], [
    "tr:shell.extra: outside the word area",
    "en:shell.extra: outside the word area",
    "tr:shell.skipLink: registered twice",
  ]);
});

test("every key the markup names is registered in both languages", () => {
  const app = loadWebApp();
  const strings = app.get("I18N_STRINGS");
  const missing = [];
  for (const element of markedElements(app)) {
    for (const [kind, key] of namedKeys(element)) {
      for (const language of ["tr", "en"]) {
        if (!(key in strings[language])) missing.push(`${language}: ${kind}="${key}"`);
      }
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(markedElements(app).length > 10, "the shell marks its strings");
});

test("the authored Turkish of every marked element is its Turkish string", () => {
  // Switching back to Turkish writes the registered strings, so an authored
  // text that differs would change under a visitor who switched twice.
  const app = loadWebApp();
  const t = app.get("t");
  const drift = [];
  for (const element of markedElements(app)) {
    for (const [kind, key] of namedKeys(element)) {
      const params = element.getAttribute("data-i18n-params");
      const string = t(key, params ? JSON.parse(params) : null);
      const shown =
        kind === "data-i18n" || kind === "data-i18n-html"
          ? element.textContent
          : element.getAttribute(kind.slice("data-i18n-".length));
      const expected = kind === "data-i18n-html" ? string.replace(/<[^>]*>/g, "") : string;
      if (collapse(shown) !== collapse(expected)) drift.push(`${key}: markup "${collapse(shown)}", string "${collapse(expected)}"`);
    }
  }
  assert.deepEqual(drift, []);
});

test("t() fills parameters and English plurals, and falls back to Turkish loudly", () => {
  const app = loadWebApp({ languages: ["en-US"] });
  const registerStrings = app.get("registerStrings");
  const t = app.get("t");
  registerStrings("fixture", {
    tr: { "fixture.count": "{count} harf", "fixture.only": "Yalnızca Türkçe", "fixture.named": "{a} ve {b}" },
    en: { "fixture.count": { one: "{count} letter", other: "{count} letters" }, "fixture.named": "{a} and {b}" },
  });

  assert.equal(t("fixture.count", { count: 1 }), "1 letter");
  assert.equal(t("fixture.count", { count: 3 }), "3 letters");
  assert.equal(t("fixture.named", { a: "A", b: "B" }), "A and B");
  assert.equal(t("fixture.named", { a: "A" }), "A and {b}", "a missing parameter shows");
  assert.equal(t("fixture.only"), "Yalnızca Türkçe", "a missing English string falls back to Turkish");
  assert.ok(app.get("I18N_PROBLEMS").missing.has("en:fixture.only"), "and the miss is recorded");
  assert.equal(t("fixture.nowhere"), "", "a key nobody registered is never shown");
  assert.ok(app.get("I18N_PROBLEMS").missing.has("tr:fixture.nowhere"));

  app.get("setLanguage")("tr");
  assert.equal(t("fixture.count", { count: 3 }), "3 harf");
});

test("an English visitor's page is translated before init() runs, with no lookup missing", async () => {
  const app = await bootedApp({ languages: ["en-US", "en"] });

  assert.equal(app.evaluate('document.documentElement.getAttribute("lang")'), "en");
  assert.equal(app.evaluate('document.getElementById("skipLink").textContent'), app.evaluate('I18N_STRINGS.en["shell.skipLink"]'));
  assert.deepEqual([...app.get("I18N_PROBLEMS").missing], []);
});

test("setLanguage() saves the choice, moves <html lang> and rewrites the markup both ways", async () => {
  const app = await bootedApp();
  const skip = () => app.evaluate('document.getElementById("skipLink").textContent');
  const more = () => app.evaluate('document.querySelector("[popovertarget]").getAttribute("aria-label")');
  const authored = { skip: skip(), more: more() };

  app.get("setLanguage")("en");
  assert.equal(app.evaluate('document.documentElement.getAttribute("lang")'), "en");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "en");
  assert.equal(skip(), "Skip to content");
  assert.equal(more(), "More");

  app.get("setLanguage")("tr");
  assert.equal(app.evaluate('document.documentElement.getAttribute("lang")'), "tr");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), "tr");
  assert.deepEqual({ skip: skip(), more: more() }, authored);
});

test("a language that is not ours changes nothing", async () => {
  const app = await bootedApp();
  app.get("setLanguage")("de");

  assert.equal(app.evaluate('document.documentElement.getAttribute("lang")'), "tr");
  assert.equal(app.evaluate('localStorage.getItem("asl-lang")'), null);
});

test("with storage blocked the switch still happens, for this visit", async () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {},
  };
  const app = await bootedApp({ globals: { localStorage: blocked } });
  app.get("setLanguage")("en");

  assert.equal(app.evaluate('document.documentElement.getAttribute("lang")'), "en");
  assert.equal(app.evaluate('document.getElementById("skipLink").textContent'), "Skip to content");
});

test("listeners hear every change once, after the markup, and one that throws stops none", async () => {
  const app = await bootedApp({ globals: { console: { ...quietConsole, error() {} } } });
  const heard = [];
  app.get("onLanguageChange")(() => {
    throw new Error("a broken listener");
  });
  const stop = app.get("onLanguageChange")((language, previous) => {
    heard.push([language, previous, app.evaluate('document.getElementById("skipLink").textContent')]);
  });

  app.get("setLanguage")("en");
  app.get("setLanguage")("en");
  app.get("setLanguage")("tr");
  stop();
  app.get("setLanguage")("en");

  assert.deepEqual(heard, [
    ["en", "tr", "Skip to content"],
    ["tr", "en", "İçeriğe geç"],
  ]);
});

test("a switch leaves alone text a script wrote over a marked element", async () => {
  const app = await bootedApp();
  app.evaluate('document.getElementById("skipLink").textContent = "Yazılmış"');
  app.get("setLanguage")("en");

  assert.equal(app.evaluate('document.getElementById("skipLink").textContent'), "Yazılmış");
});

test("setText() binds an element to its string, parameters included, across changes", async () => {
  const app = await bootedApp();
  app.get("registerStrings")("fixture", { tr: { "fixture.n": "{n} kare" }, en: { "fixture.n": "{n} frames" } });
  const element = app.evaluate('document.getElementById("debugFrames")');
  app.get("setText")(element, "fixture.n", { n: 7 });
  assert.equal(element.textContent, "7 kare");

  app.get("setLanguage")("en");
  assert.equal(element.textContent, "7 frames");

  app.get("setAttrText")(element, "title", "fixture.n", { n: 7 });
  assert.equal(element.getAttribute("title"), "7 frames");
  app.get("setLanguage")("tr");
  assert.equal(element.getAttribute("title"), "7 kare");
  assert.equal(element.textContent, "7 kare");
});
