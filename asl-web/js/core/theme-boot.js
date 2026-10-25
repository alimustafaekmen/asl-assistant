// Applies the theme before the first paint, so a dark-preferring visitor never
// sees a light frame. Loaded in <head> as an external file because the CSP
// allows no inline script. Runs before core/runtime.js: no DOM registry, no state.

/** @typedef {"light" | "dark"} ThemeName */

/**
 * Blocked storage reads as no choice.
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
 * Throws if matchMedia does; the caller decides what that means.
 *
 * @returns {ThemeName}
 */
function systemTheme() {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Only a "system" theme follows later system changes. The authored meta colours
 * are kept in data-scheme-colour, so no colour value lives in JavaScript.
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

// A failure here must not end the page parse; init() resolves the theme again.
try {
  const saved = savedTheme();
  paintTheme(saved ?? systemTheme(), saved ? "user" : "system");
} catch (err) {
  console.warn("Could not apply the theme before first paint:", err);
}
