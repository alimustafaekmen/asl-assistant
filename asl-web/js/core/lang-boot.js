// Language resolution before the first paint.
//
// index.html loads this file in <head>, next to theme-boot.js and for the
// same reason: a classic script the parser meets there runs before anything
// is painted, so <html lang> already names the language the page will be
// shown in. Screen readers pick their voice from it, and core/i18n.js reads
// it as the current language when it translates the parsed body. It is a
// file of its own, not part of theme-boot.js, because the two choices are
// independent and each is tested on its own; both are fetched in parallel
// while the head is parsed.
//
// Like theme-boot.js, it writes only to <html> and reads no DOM registry and
// no state.

/** @typedef {"tr" | "en"} Language */

/**
 * The languages the interface is written in. The first is the language of
 * the authored markup, the fallback for a missing translation.
 *
 * @type {readonly Language[]}
 */
const LANGUAGES = ["tr", "en"];

/** Where the visitor's own choice is kept. */
const LANGUAGE_STORAGE_KEY = "asl-lang";

/**
 * A language tag such as "tr-TR" or "EN", as one of ours, or null.
 *
 * Only the primary subtag counts: any regional English is English.
 *
 * @param {unknown} tag
 * @returns {Language | null}
 */
function languageFromTag(tag) {
  const primary = String(tag ?? "").trim().toLowerCase().split(/[-_]/, 1)[0];
  return primary === "tr" || primary === "en" ? primary : null;
}

/**
 * The language the visitor chose on this site before, or null.
 *
 * Storage can be unavailable or blocked, and an old or hand-edited value can
 * be anything; both read as no choice.
 *
 * @returns {Language | null}
 */
function savedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === "tr" || saved === "en" ? saved : null;
  } catch {
    return null;
  }
}

/**
 * The first of the browser's preferred languages that we have, or null.
 *
 * navigator.languages is the visitor's ordered list; navigator.language is
 * the only one older browsers give. A preference for a language we do not
 * have is skipped, so "de, tr" reads as Turkish.
 *
 * @returns {Language | null}
 */
function browserLanguage() {
  try {
    const nav = /** @type {{languages?: readonly string[], language?: string} | undefined} */ (
      typeof navigator === "undefined" ? undefined : navigator
    );
    const preferred = [...(Array.isArray(nav?.languages) ? nav.languages : []), nav?.language];
    for (const tag of preferred) {
      const language = languageFromTag(tag);
      if (language) return language;
    }
  } catch {
    // A browser that throws here has told us nothing.
  }
  return null;
}

/**
 * The language to show: the visitor's choice, else the browser's, else
 * English, the language a visitor who reads neither is likelier to read.
 *
 * @returns {Language}
 */
function resolveLanguage() {
  return savedLanguage() ?? browserLanguage() ?? "en";
}

// Best effort: a failure here must not end the parse of the page. The
// authored lang="tr" then stands, and the page stays Turkish.
//
// Any other language is translated only at the end of the body, and the
// browser paints the Turkish markup it has parsed while it waits for the
// strings. data-i18n-pending keeps the body hidden until i18n-boot.js has
// translated it (css/base.css, which also shows it after a few seconds in
// case the translation never runs).
try {
  const language = resolveLanguage();
  document.documentElement.setAttribute("lang", language);
  if (language !== "tr") document.documentElement.setAttribute("data-i18n-pending", "");
} catch (err) {
  console.warn("Could not resolve the language before first paint:", err);
}
