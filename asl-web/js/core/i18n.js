// Interface strings in Turkish and English, and the switch between them.
//
// Each part of the interface keeps its strings in its own file under
// js/i18n/, both languages side by side, and registers them here when it
// loads. Markup names its strings with data attributes; scripts look them up
// with t(). The authored markup is Turkish and stays the fallback: a visitor
// whose language is not resolved, or a string nobody translated, sees the
// Turkish text, never a key.
//
// index.html loads this file and the strings at the end of the body, before
// the CDN scripts, and js/core/i18n-boot.js translates the page there: a
// visitor reading English sees English as soon as the body is parsed, not
// after ONNX Runtime has downloaded. Like the strings files, this file only
// declares; it starts nothing.

/**
 * A translated string. An object is a count-dependent string, picked by
 * the `count` parameter: English says "1 letter" and "2 letters", where
 * Turkish needs one form.
 *
 * @typedef {string | {one: string, other: string}} I18nValue
 */

/** @typedef {Record<string, string | number>} I18nParams */

/**
 * Every registered string, per language.
 *
 * @type {Record<Language, Record<string, I18nValue>>}
 */
const I18N_STRINGS = { tr: {}, en: {} };

/** The areas registered so far, in load order. @type {string[]} */
const I18N_AREAS = [];

/**
 * The attributes the markup can name a string for, each as
 * data-i18n-<attribute>="key". `lang` is there for text whose language
 * follows the interface's, such as the transcript placeholder.
 */
const I18N_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "content", "lang"];

/**
 * Lookups that found no string, as "language:key", and registrations that
 * were refused. A missing English string falls back to Turkish on the page,
 * so the tests read this list to make it loud.
 */
const I18N_PROBLEMS = {
  /** @type {Set<string>} */
  missing: new Set(),
  /** @type {string[]} */
  refused: [],
};

/** Called after every language change, in registration order. @type {Set<(language: Language, previous: Language) => void>} */
const _languageListeners = new Set();

/**
 * Add an area's strings in both languages.
 *
 * Every key starts with the area's name and a dot, so two areas can never
 * write the same key, and a key says which file holds it. A key outside the
 * area or registered twice is refused and recorded, not thrown: one bad
 * string must not cost the area all of its others.
 *
 * @param {string} area
 * @param {Partial<Record<Language, Record<string, I18nValue>>>} table
 * @returns {void}
 */
function registerStrings(area, table) {
  if (!I18N_AREAS.includes(area)) I18N_AREAS.push(area);
  for (const language of LANGUAGES) {
    for (const [key, value] of Object.entries(table[language] ?? {})) {
      if (!key.startsWith(`${area}.`)) {
        I18N_PROBLEMS.refused.push(`${language}:${key}: outside the ${area} area`);
      } else if (Object.prototype.hasOwnProperty.call(I18N_STRINGS[language], key)) {
        I18N_PROBLEMS.refused.push(`${language}:${key}: registered twice`);
      } else {
        I18N_STRINGS[language][key] = value;
      }
    }
  }
}

/**
 * The language the page is shown in.
 *
 * <html lang> is the one record of it: lang-boot.js writes it before the
 * first paint and setLanguage() on every change. Anything else there, such
 * as the authored "tr" when lang-boot.js could not load, is Turkish.
 *
 * @returns {Language}
 */
function currentLanguage() {
  return document.documentElement.getAttribute("lang") === "en" ? "en" : "tr";
}

/**
 * A string in one language with its parameters filled in, or null when that
 * language has no such key.
 *
 * {name} is replaced by params.name. A placeholder without a parameter is
 * left as it is, so the mistake shows instead of reading as a sentence.
 *
 * @param {Language} language
 * @param {string} key
 * @param {I18nParams | null} [params]
 * @returns {string | null}
 */
function translateIn(language, key, params) {
  if (!Object.prototype.hasOwnProperty.call(I18N_STRINGS[language], key)) return null;
  const value = I18N_STRINGS[language][key];
  const text = typeof value === "string" ? value : Number(params?.count) === 1 ? value.one : value.other;
  return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
  );
}

/**
 * Record a lookup that found nothing, and say so once per key.
 *
 * @param {Language} language
 * @param {string} key
 * @returns {void}
 */
function noteMissingString(language, key) {
  const id = `${language}:${key}`;
  if (I18N_PROBLEMS.missing.has(id)) return;
  I18N_PROBLEMS.missing.add(id);
  console.warn(`No ${language} string for "${key}"`);
}

/**
 * A string in `language`, falling back to Turkish, or null when neither has
 * it. Each miss is recorded.
 *
 * @param {Language} language
 * @param {string} key
 * @param {I18nParams | null} [params]
 * @returns {string | null}
 */
function translateWithFallback(language, key, params) {
  const text = translateIn(language, key, params);
  if (text !== null) return text;
  noteMissingString(language, key);
  if (language === "tr") return null;
  const turkish = translateIn("tr", key, params);
  if (turkish === null) noteMissingString("tr", key);
  return turkish;
}

/**
 * The string for `key` in the current language.
 *
 * A key the current language lacks gives the Turkish string; one nobody
 * registered gives an empty string, never the key itself.
 *
 * @param {string} key
 * @param {I18nParams | null} [params]
 * @returns {string}
 */
function t(key, params) {
  return translateWithFallback(currentLanguage(), key, params) ?? "";
}

/**
 * The parameters an element's strings are filled with, from
 * data-i18n-params (JSON), or null.
 *
 * @param {Element} element
 * @returns {I18nParams | null}
 */
function i18nParams(element) {
  const raw = element.getAttribute("data-i18n-params");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Text compared for sameness: runs of white space count as one space, so
 * the line breaks of the authored markup do not matter.
 *
 * @param {string | null | undefined} text
 * @returns {string}
 */
function i18nComparable(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Show a string as an element's text and keep it there across language
 * changes.
 *
 * The element carries the key (and the parameters), so translatePage()
 * rewrites it on the next change like authored markup. A script that later
 * writes the element's text some other way takes it over: the change sees
 * text that is not this string and leaves it to that script.
 *
 * @param {Element | null | undefined} element
 * @param {string} key
 * @param {I18nParams | null} [params]
 * @returns {void}
 */
function setText(element, key, params) {
  if (!element) return;
  element.setAttribute("data-i18n", key);
  if (params) element.setAttribute("data-i18n-params", JSON.stringify(params));
  else element.removeAttribute("data-i18n-params");
  element.textContent = t(key, params);
}

/**
 * Show a string as an element's attribute and keep it there across language
 * changes; setText() for attributes.
 *
 * Parameters are shared by every string an element names.
 *
 * @param {Element | null | undefined} element
 * @param {string} attribute One of I18N_ATTRIBUTES.
 * @param {string} key
 * @param {I18nParams | null} [params]
 * @returns {void}
 */
function setAttrText(element, attribute, key, params) {
  if (!element) return;
  element.setAttribute(`data-i18n-${attribute}`, key);
  if (params) element.setAttribute("data-i18n-params", JSON.stringify(params));
  element.setAttribute(attribute, t(key, params));
}

/**
 * Write the current language into every element that names a string.
 *
 * data-i18n sets the text, data-i18n-html the markup of a string that holds
 * some (only strings from the strings files, never anything a visitor
 * typed), and data-i18n-<attribute> an attribute. An element is rewritten
 * only while it still shows the string in `previous`, the language the page
 * was in: text a script has written since is that script's to change, on
 * the language change it is told about.
 *
 * @param {Language} previous
 * @param {ParentNode} [root]
 * @returns {void}
 */
function translatePage(previous, root = document) {
  const language = currentLanguage();
  const selector = ["[data-i18n]", "[data-i18n-html]", ...I18N_ATTRIBUTES.map((name) => `[data-i18n-${name}]`)].join(",");
  /** @param {string} key @param {I18nParams | null} params */
  const before = (key, params) => translateIn(previous, key, params);
  for (const element of Array.from(root.querySelectorAll(selector))) {
    const params = i18nParams(element);
    const textKey = element.getAttribute("data-i18n");
    if (textKey) {
      const was = before(textKey, params);
      const text = translateWithFallback(language, textKey, params);
      if (text !== null && (was === null || i18nComparable(element.textContent) === i18nComparable(was))) {
        element.textContent = text;
      }
    }
    const htmlKey = element.getAttribute("data-i18n-html");
    if (htmlKey) {
      const was = before(htmlKey, params);
      const markup = translateWithFallback(language, htmlKey, params);
      const shown = was === null ? null : i18nComparable(was.replace(/<[^>]*>/g, ""));
      if (markup !== null && (shown === null || i18nComparable(element.textContent) === shown)) {
        element.innerHTML = markup;
      }
    }
    for (const attribute of I18N_ATTRIBUTES) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (!key) continue;
      const was = before(key, params);
      const value = translateWithFallback(language, key, params);
      if (value !== null && (was === null || i18nComparable(element.getAttribute(attribute)) === i18nComparable(was))) {
        element.setAttribute(attribute, value);
      }
    }
  }
}

/**
 * Call `listener` after every language change, once the markup has been
 * translated, so it can redraw what its module drew from state: a list it
 * built, a status it wrote. Returns the function that stops the calls.
 *
 * @param {(language: Language, previous: Language) => void} listener
 * @returns {() => void}
 */
function onLanguageChange(listener) {
  _languageListeners.add(listener);
  return () => {
    _languageListeners.delete(listener);
  };
}

/**
 * Show the page in `language` and remember the choice.
 *
 * Nothing reloads and nothing restarts: <html lang> changes, the marked
 * markup is rewritten, and each listener redraws its part. A listener that
 * throws is reported and the others still run. Choosing the language already
 * shown still saves it, as the visitor's own choice.
 *
 * @param {Language} language
 * @returns {void}
 */
function setLanguage(language) {
  if (!LANGUAGES.includes(language)) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
  const previous = currentLanguage();
  if (previous === language) return;
  document.documentElement.setAttribute("lang", language);
  translatePage(previous);
  for (const listener of Array.from(_languageListeners)) {
    try {
      listener(language, previous);
    } catch (err) {
      console.error("A language change listener failed:", err);
    }
  }
}
