// Find Turkish text left on a page that should read in English.
//
// A translation is done when an English reader meets no Turkish: no text,
// and no name a screen reader speaks or a tooltip shows. This walks a part of
// the page the way that reader meets it and reports what still reads as
// Turkish: a letter only Turkish uses (ç ğ ı ö ş ü İ), or a common Turkish
// word that has none.
//
// It is one self-contained function, so the browser checks can send its
// source into a page (`(${turkishLeft})(root, options)`) and the node tests
// can call it on the harness document; both find the same things.
//
// Text that is meant to stay Turkish is marked as such in the markup, with
// lang="tr" (the language switch, a Turkish proper name), and is skipped with
// everything inside it. Anything else that is legitimately not translated is
// named in `allow`, by its exact text or a pattern, so each exception is
// visible in the test that makes it.

/**
 * @typedef {Object} TurkishFinding
 * @property {string} text The Turkish text, with its white space collapsed.
 * @property {string} where "text", or the attribute it was found in.
 * @property {string} element The element, as tag#id.class.
 */

/**
 * Turkish text under `root`, in document order.
 *
 * @param {Element} root
 * @param {{
 *   allow?: Array<string | RegExp>,
 *   includeHidden?: boolean,
 *   rendered?: boolean,
 * }} [options]
 *   `allow` exempts text equal to a string or matching a pattern.
 *   `includeHidden` also walks elements with the hidden attribute, which are
 *   skipped by default because a screen shows them only in some state.
 *   `rendered` (browser only) skips what the browser does not render, such
 *   as another mode's controls, by checkVisibility().
 * @returns {TurkishFinding[]}
 */
export function turkishLeft(root, options = {}) {
  const allow = options.allow ?? [];
  const includeHidden = options.includeHidden === true;
  const rendered = options.rendered === true;
  const LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
  // Frequent Turkish words with no Turkish letter, matched as whole words.
  // None of them is an English word the interface uses.
  const WORDS = [
    "ve", "bir", "bu", "ile", "veya", "ama", "da", "de", "gibi", "daha", "sonra",
    "kadar", "olarak", "yok", "harf", "harfi", "harfler", "harfleri", "kelime",
    "kelimeler", "kelimeyi", "metin", "metne", "metni", "kamera", "yeniden",
    "ekle", "sil", "atla", "tekrar", "sonraki", "referans", "hedef", "kapat",
    "tema", "koyu", "durum", "bekleniyor", "deneysel", "deneyin", "izleyin",
    "kolay", "orta", "zor", "grup", "geri",
  ];
  const WORD_PATTERN = new RegExp(`(^|[^\\p{L}])(${WORDS.join("|")})(?=$|[^\\p{L}])`, "iu");
  const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "aria-description", "aria-valuetext"];
  const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

  const collapse = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const isAllowed = (text) => allow.some((rule) => (typeof rule === "string" ? rule === text : rule.test(text)));
  const isTurkish = (text) => text !== "" && !isAllowed(text) && (LETTERS.test(text) || WORD_PATTERN.test(text));
  const describe = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    const id = element.getAttribute("id");
    const classes = String(element.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2);
    return `${tag}${id ? `#${id}` : ""}${classes.map((name) => `.${name}`).join("")}`;
  };

  /** @type {TurkishFinding[]} */
  const findings = [];
  const walk = (element) => {
    if (SKIPPED_TAGS.has(String(element.tagName || "").toUpperCase())) return;
    if (!includeHidden && element.hasAttribute("hidden")) return;
    const lang = element.getAttribute("lang");
    if (lang && lang.toLowerCase().startsWith("tr")) return;
    // The content of a closed <details> is not rendered; its summary is.
    if (rendered && typeof element.checkVisibility === "function" && !element.checkVisibility()) return;
    for (const attribute of ATTRIBUTES) {
      const value = collapse(element.getAttribute(attribute));
      if (isTurkish(value)) findings.push({ text: value, where: attribute, element: describe(element) });
    }
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) {
        const text = collapse(node.textContent);
        if (isTurkish(text)) findings.push({ text, where: "text", element: describe(element) });
      } else if (node.nodeType === 1) {
        walk(node);
      }
    }
  };
  walk(root);
  return findings;
}
