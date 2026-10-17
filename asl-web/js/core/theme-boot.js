// Theme resolution before the first paint.
//
// index.html loads this file in <head>, before its stylesheets: a classic
// script the parser meets there runs before the page can be painted, so the
// first frame is already in the visitor's theme. Resolved later, in init()
// after the CDN runtime has downloaded, a visitor who prefers dark would see
// the light page first. It is an external same-origin file because the CSP
// allows script-src 'self' and no inline script; a hash would have to be
// kept in step with the code by hand.
//
// This is the one script besides core/app.js that acts while it loads, and
// all it does is write the theme onto <html>. It runs before
// core/runtime.js, so it reads no DOM registry and no state. app.js uses the
// same three functions for the theme button and for a system change.

/** @typedef {"light" | "dark"} ThemeName */

/**
 * The theme the visitor chose on this page before, or null.
 *
 * Storage can be unavailable or blocked; that reads as no choice.
 *
 * @returns {ThemeName | null}
 */
function savedTheme() {
  try {
    const saved = localStorage.getItem("asl-theme");
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

/**
 * The system's colour scheme.
 *
 * Throws if matchMedia does; the caller decides what that means.
 *
 * @returns {ThemeName}
 */
function systemTheme() {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Write a theme onto <html> and point the browser toolbar at it.
 *
 * The stylesheets key the dark tokens on the root element. `source` records
 * whether the visitor chose the theme ("user") or it follows the system
 * ("system"); only the latter changes when the system does.
 *
 * Each theme-color meta carries one scheme's colour under a media query, so
 * with no choice the browser picks the right one without any script. After
 * a choice both show the chosen scheme's colour; the authored colours are
 * kept on the metas, so no colour value lives in JavaScript.
 *
 * @param {ThemeName} theme
 * @param {"user" | "system"} source
 * @returns {void}
 */
function paintTheme(theme, source) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeSource = source;
  const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
  for (const meta of metas) {
    if (!meta.hasAttribute("data-scheme-colour")) {
      meta.setAttribute("data-scheme-colour", meta.getAttribute("content") || "");
    }
  }
  const chosen = metas.find((meta) => (meta.getAttribute("media") || "").includes(theme));
  for (const meta of metas) {
    const own = meta.getAttribute("data-scheme-colour") || "";
    const colour = source === "user" && chosen ? chosen.getAttribute("data-scheme-colour") || own : own;
    meta.setAttribute("content", colour);
  }
}

// Best effort: a failure here must not end the parse of the page. init()
// resolves the theme again and reports a start-up failure if it cannot.
try {
  const saved = savedTheme();
  paintTheme(saved ?? systemTheme(), saved ? "user" : "system");
} catch (err) {
  console.warn("Could not apply the theme before first paint:", err);
}
