// A small DOM built from the real index.html, for the vm harness.
//
// The harness used to hand out one blank stub for any id it was asked for, so
// markup and scripts could drift apart without a single node test noticing.
// This module parses the static document instead and gives the scripts the
// elements it actually holds: getElementById() returns null for an id the
// markup lacks, and every element starts with the markup's attributes,
// dataset, hidden, classList and text.
//
// It is a parse of HTML, not a match over it. The tokenizer reads tags,
// attributes (quoted, unquoted, valueless), comments, void elements, raw text
// (script, style), escapable raw text (textarea, title), <template> contents,
// and foreign content (svg, math) where `/>` closes an element. The tree
// builder applies the implied end tags the markup can rely on (p, li, dt, dd,
// option, optgroup, table cells and rows). It does not do layout, style,
// focus, or event propagation; those stay with a browser.
//
// Selectors are matched by a minimal engine covering what the scripts pass:
// type, #id, .class, [attr], [attr=value], :not(), :popover-open, and the
// descendant and child combinators, in comma-separated lists. Anything else
// throws, so a test can never pass on a selector the harness misread.

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const ESCAPABLE_RAW_TEXT_ELEMENTS = new Set(["textarea", "title"]);
const FOREIGN_ROOTS = new Set(["svg", "math"]);
// Start tags that close an open <p>, as the HTML parser does.
const CLOSES_P = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu",
  "nav", "ol", "p", "pre", "section", "summary", "table", "ul",
]);
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "\u00a9", middot: "\u00b7",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", rarr: "\u2192", larr: "\u2190", times: "\u00d7",
  bull: "\u2022", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
};

const isAsciiAlpha = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
const isSpace = (ch) => ch === " " || ch === "\n" || ch === "\t" || ch === "\f" || ch === "\r";

/** Decode character references; an unknown name is left as written. */
function decodeEntities(text) {
  if (!text.includes("&")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf("&", i);
    if (amp === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, amp);
    const semi = text.indexOf(";", amp);
    const body = semi === -1 ? "" : text.slice(amp + 1, semi);
    let decoded = null;
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      if (Number.isFinite(code)) decoded = String.fromCodePoint(code);
    } else if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code)) decoded = String.fromCodePoint(code);
    } else if (Object.hasOwn(NAMED_ENTITIES, body)) {
      decoded = NAMED_ENTITIES[body];
    }
    if (decoded === null) {
      out += "&";
      i = amp + 1;
    } else {
      out += decoded;
      i = semi + 1;
    }
  }
  return out;
}

/**
 * Split HTML into tokens: text, comment, start and end tags.
 *
 * @param {string} source
 * @returns {Array<{type: string, [key: string]: unknown}>}
 */
function tokenize(source) {
  const html = source.replace(/\r\n?/g, "\n");
  const tokens = [];
  let i = 0;
  let text = "";
  const flushText = () => {
    if (text) tokens.push({ type: "text", text: decodeEntities(text) });
    text = "";
  };
  // Raw text runs to the matching end tag, whatever it contains.
  // The end tag is found by comparing each "</" candidate, not by lowercasing
  // the document: lowercasing "İ" adds a code unit and would shift every index.
  const readRawText = (tag, escapable) => {
    let end = html.indexOf("</", i);
    while (end !== -1) {
      const after = html[end + tag.length + 2];
      const named = html.slice(end + 2, end + 2 + tag.length).toLowerCase() === tag;
      if (named && (after === undefined || after === ">" || after === "/" || isSpace(after))) break;
      end = html.indexOf("</", end + 2);
    }
    if (end === -1) end = html.length;
    const raw = html.slice(i, end);
    if (raw) tokens.push({ type: "text", text: escapable ? decodeEntities(raw) : raw, raw: !escapable });
    i = end;
  };

  while (i < html.length) {
    const ch = html[i];
    if (ch !== "<") {
      text += ch;
      i += 1;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      flushText();
      const end = html.indexOf("-->", i + 4);
      const close = end === -1 ? html.length : end;
      tokens.push({ type: "comment", text: html.slice(i + 4, close) });
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      // A doctype, CDATA or processing instruction: nothing the scripts read.
      flushText();
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const closing = html[i + 1] === "/";
    const nameStart = closing ? i + 2 : i + 1;
    if (!isAsciiAlpha(html[nameStart] ?? "")) {
      text += ch;
      i += 1;
      continue;
    }
    flushText();
    let j = nameStart;
    while (j < html.length && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j += 1;
    const rawName = html.slice(nameStart, j);
    /** @type {Array<[string, string]>} */
    const attrs = [];
    let selfClosing = false;
    while (j < html.length && html[j] !== ">") {
      if (isSpace(html[j])) {
        j += 1;
        continue;
      }
      if (html[j] === "/") {
        selfClosing = html[j + 1] === ">";
        j += 1;
        continue;
      }
      const attrStart = j;
      while (j < html.length && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") j += 1;
      if (j === attrStart) j += 1; // a stray "=" with no name
      const attrName = html.slice(attrStart, j);
      while (isSpace(html[j] ?? "")) j += 1;
      let value = "";
      if (html[j] === "=") {
        j += 1;
        while (isSpace(html[j] ?? "")) j += 1;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, j + 1);
          const close = end === -1 ? html.length : end;
          value = html.slice(j + 1, close);
          j = close + 1;
        } else {
          const valueStart = j;
          while (j < html.length && !isSpace(html[j]) && html[j] !== ">") j += 1;
          value = html.slice(valueStart, j);
        }
      }
      if (attrName && attrName !== "=") attrs.push([attrName, decodeEntities(value)]);
    }
    i = j + 1;
    if (closing) {
      tokens.push({ type: "end", name: rawName });
      continue;
    }
    tokens.push({ type: "start", name: rawName, attrs, selfClosing });
    const lowerName = rawName.toLowerCase();
    if (RAW_TEXT_ELEMENTS.has(lowerName)) readRawText(lowerName, false);
    else if (ESCAPABLE_RAW_TEXT_ELEMENTS.has(lowerName)) readRawText(lowerName, true);
  }
  flushText();
  return tokens;
}

/**
 * Parse HTML into a plain tree, without any DOM objects.
 *
 * `diagnostics` lists every end tag that closed nothing and every element
 * still open at the end, which in a browser would also have been repaired.
 *
 * @param {string} source
 * @returns {{children: ParsedNode[], diagnostics: string[]}}
 *
 * @typedef {{type: "text", text: string, raw?: boolean}
 *   | {type: "comment", text: string}
 *   | {type: "element", name: string, foreign: boolean, attrs: Array<[string, string]>,
 *      children: ParsedNode[], content?: ParsedNode[]}} ParsedNode
 */
export function parseHtml(source) {
  const root = { type: "root", name: "#root", children: [], foreign: false };
  const stack = [root];
  const diagnostics = [];
  const current = () => stack[stack.length - 1];
  // A <template>'s parsed children belong to its content, not to the tree.
  const childList = (node) => (node.content ? node.content : node.children);
  const popUntil = (predicate, stopAt = () => false) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stopAt(stack[k])) return false;
      if (predicate(stack[k])) {
        stack.length = k;
        return true;
      }
    }
    return false;
  };
  const isOpen = (name, stopAt) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stopAt?.(stack[k])) return false;
      if (stack[k].name === name) return true;
    }
    return false;
  };
  const scopeBoundary = (node) => ["button", "table", "template", "td", "th", "html"].includes(node.name) || node.foreign;

  for (const token of tokenize(source)) {
    const parent = current();
    if (token.type === "text") {
      childList(parent).push({ type: "text", text: token.text, raw: token.raw });
      continue;
    }
    if (token.type === "comment") {
      childList(parent).push({ type: "comment", text: token.text });
      continue;
    }
    const foreign = parent.foreign || FOREIGN_ROOTS.has(token.name.toLowerCase());
    const name = foreign ? token.name : token.name.toLowerCase();
    if (token.type === "end") {
      const closed = popUntil((node) => (node.foreign ? node.name === name : node.name === name.toLowerCase()));
      if (!closed) diagnostics.push(`end tag </${name}> closes nothing`);
      continue;
    }
    if (!foreign) {
      if (CLOSES_P.has(name) && isOpen("p", scopeBoundary)) popUntil((node) => node.name === "p");
      if (name === "li") popUntil((node) => node.name === "li", (node) => ["ul", "ol", "menu"].includes(node.name));
      if (name === "dt" || name === "dd") {
        popUntil((node) => node.name === "dt" || node.name === "dd", (node) => node.name === "dl");
      }
      if (name === "option" || name === "optgroup") {
        popUntil((node) => node.name === "option", (node) => node.name !== "option");
      }
      if (name === "optgroup") popUntil((node) => node.name === "optgroup", (node) => node.name !== "optgroup");
      if (name === "td" || name === "th") popUntil((node) => node.name === "td" || node.name === "th", (node) => node.name === "tr");
      if (name === "tr") popUntil((node) => node.name === "tr", (node) => ["table", "tbody", "thead", "tfoot"].includes(node.name));
    }
    const element = { type: "element", name, foreign, attrs: dedupeAttrs(token.attrs, foreign), children: [] };
    if (name === "template" && !foreign) element.content = [];
    childList(current()).push(element);
    const closesItself = foreign ? token.selfClosing : VOID_ELEMENTS.has(name);
    if (!closesItself) stack.push(element);
  }
  for (const open of stack.slice(1)) {
    if (!["html", "body", "head"].includes(open.name)) diagnostics.push(`<${open.name}> is never closed`);
  }
  return { children: root.children, diagnostics };
}

/** First occurrence of an attribute wins, as in the HTML parser. */
function dedupeAttrs(attrs, foreign) {
  const seen = new Set();
  const out = [];
  for (const [rawName, value] of attrs) {
    const name = foreign ? rawName : rawName.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push([name, value]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const IDENT_CHAR = (ch) => isAsciiAlpha(ch) || (ch >= "0" && ch <= "9") || ch === "-" || ch === "_";

class UnsupportedSelector extends Error {
  constructor(selector, reason) {
    super(`the harness does not support the selector ${JSON.stringify(selector)}: ${reason}`);
    this.name = "UnsupportedSelector";
  }
}

/**
 * Compile a selector list.
 *
 * @param {string} selector
 * @returns {Array<Array<{combinator: " " | ">" | null, compound: Compound}>>}
 *
 * @typedef {{tag: string | null, ids: string[], classes: string[],
 *   attrs: Array<{name: string, value: string | null}>, nots: ReturnType<typeof compileSelector>[],
 *   popoverOpen: boolean}} Compound
 */
function compileSelector(selector) {
  const source = String(selector);
  let i = 0;
  const fail = (reason) => {
    throw new UnsupportedSelector(source, reason);
  };
  const skipSpace = () => {
    let skipped = false;
    while (i < source.length && isSpace(source[i])) {
      i += 1;
      skipped = true;
    }
    return skipped;
  };
  const ident = () => {
    const start = i;
    while (i < source.length && IDENT_CHAR(source[i])) i += 1;
    if (i === start) fail(`expected a name at position ${start}`);
    return source.slice(start, i);
  };
  const compound = () => {
    /** @type {Compound} */
    const result = { tag: null, ids: [], classes: [], attrs: [], nots: [], popoverOpen: false };
    let any = false;
    if (source[i] === "*") {
      i += 1;
      any = true;
    } else if (isAsciiAlpha(source[i] ?? "")) {
      result.tag = ident().toLowerCase();
      any = true;
    }
    for (;;) {
      const ch = source[i];
      if (ch === "#") {
        i += 1;
        result.ids.push(ident());
      } else if (ch === ".") {
        i += 1;
        result.classes.push(ident());
      } else if (ch === "[") {
        i += 1;
        skipSpace();
        const name = ident().toLowerCase();
        skipSpace();
        let value = null;
        if (source[i] === "=") {
          i += 1;
          skipSpace();
          const quote = source[i];
          if (quote === '"' || quote === "'") {
            const end = source.indexOf(quote, i + 1);
            if (end === -1) fail("unterminated attribute value");
            value = source.slice(i + 1, end);
            i = end + 1;
          } else {
            value = ident();
          }
          skipSpace();
        } else if (source[i] !== "]") {
          fail(`attribute operator ${JSON.stringify(source.slice(i, i + 2))} is not implemented`);
        }
        if (source[i] !== "]") fail("expected ]");
        i += 1;
        result.attrs.push({ name, value });
      } else if (ch === ":") {
        i += 1;
        const pseudo = ident().toLowerCase();
        if (pseudo === "popover-open") {
          result.popoverOpen = true;
        } else if (pseudo === "not" && source[i] === "(") {
          const close = source.indexOf(")", i);
          if (close === -1) fail("unterminated :not(");
          result.nots.push(compileSelector(source.slice(i + 1, close)));
          i = close + 1;
        } else {
          fail(`:${pseudo} is not implemented`);
        }
      } else {
        break;
      }
      any = true;
    }
    if (!any) fail(`expected a selector at position ${i}`);
    return result;
  };

  const list = [];
  let complex = [];
  let combinator = null;
  skipSpace();
  while (i < source.length) {
    complex.push({ combinator, compound: compound() });
    combinator = null;
    const spaced = skipSpace();
    const ch = source[i];
    if (ch === undefined) break;
    if (ch === ",") {
      i += 1;
      skipSpace();
      list.push(complex);
      complex = [];
      combinator = null;
      continue;
    }
    if (ch === ">") {
      i += 1;
      skipSpace();
      combinator = ">";
      continue;
    }
    if (ch === "+" || ch === "~") fail(`the ${ch} combinator is not implemented`);
    if (!spaced) fail(`unexpected ${JSON.stringify(ch)} at position ${i}`);
    combinator = " ";
  }
  if (combinator !== null || complex.length === 0) fail("the selector ends without a compound");
  list.push(complex);
  return list;
}

const compiledSelectors = new Map();
function compiled(selector) {
  if (!compiledSelectors.has(selector)) compiledSelectors.set(selector, compileSelector(selector));
  return compiledSelectors.get(selector);
}

function matchesCompound(element, compound) {
  if (compound.tag !== null && element.localName?.toLowerCase() !== compound.tag) return false;
  for (const id of compound.ids) if (element.getAttribute("id") !== id) return false;
  for (const name of compound.classes) if (!element.classList.contains(name)) return false;
  for (const { name, value } of compound.attrs) {
    const actual = element.getAttribute(name);
    if (actual === null || (value !== null && actual !== value)) return false;
  }
  if (compound.popoverOpen && !element._popoverOpen) return false;
  for (const not of compound.nots) if (matchesList(element, not)) return false;
  return true;
}

/** Match a compound chain right to left, backtracking over descendant steps. */
function matchesComplex(element, complex, index = complex.length - 1) {
  if (!matchesCompound(element, complex[index].compound)) return false;
  if (index === 0) return true;
  const { combinator } = complex[index];
  let ancestor = element.parentElement;
  if (combinator === ">") return ancestor ? matchesComplex(ancestor, complex, index - 1) : false;
  while (ancestor) {
    if (matchesComplex(ancestor, complex, index - 1)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

function matchesList(element, list) {
  return list.some((complex) => matchesComplex(element, complex));
}

/** Whether `element` matches `selector`; throws for a selector the engine lacks. */
export function matchesSelector(element, selector) {
  return matchesList(element, compiled(selector));
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const camelFromData = (name) => name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
const dataFromCamel = (key) => `data-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
const escapeAttr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\u00a0/g, "&nbsp;");

/**
 * The first element at or below `root`, in document order, that `predicate`
 * accepts; every one when `all` is set. Template contents are not part of the
 * tree. Iterative, because every getElementById() walks the whole document.
 */
function collect(root, predicate, { includeRoot = false, all = true } = {}) {
  const found = [];
  const stack = includeRoot ? [root] : [...(root._childNodes ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!isElement(node)) continue;
    if (predicate(node)) {
      found.push(node);
      if (!all) break;
    }
    const children = node._childNodes;
    if (children) for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
  }
  return found;
}

/** Every element below `node` in document order. */
const descendants = (node) => collect(node, () => true);

const isElement = (node) => node !== null && typeof node === "object" && node.nodeType === 1;

/**
 * Build the node classes for one vm context.
 *
 * Each context gets its own classes, so `instanceof` in the scripts sees the
 * constructors installed in that context, and every element shares the
 * context's listener log.
 *
 * @param {{listenerLog: string[]}} options
 */
export function createDomClasses({ listenerLog }) {
  class StubNode {
    constructor() {
      this.parentNode = null;
    }

    get parentElement() {
      return isElement(this.parentNode) ? this.parentNode : null;
    }

    remove() {
      const siblings = this.parentNode?._childNodes;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }
  }

  class StubText extends StubNode {
    constructor(text) {
      super();
      this.nodeType = 3;
      this.nodeName = "#text";
      this.data = String(text);
    }

    get textContent() {
      return this.data;
    }

    set textContent(value) {
      this.data = String(value);
    }

    get nodeValue() {
      return this.data;
    }
  }

  class StubComment extends StubNode {
    constructor(text) {
      super();
      this.nodeType = 8;
      this.nodeName = "#comment";
      this.data = String(text);
    }

    get textContent() {
      return this.data;
    }
  }

  /** Holds children outside the tree: a <template>'s content. */
  class StubFragment extends StubNode {
    constructor() {
      super();
      this.nodeType = 11;
      this._childNodes = [];
    }

    get childNodes() {
      return [...this._childNodes];
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
      const list = compiled(selector);
      return [...descendants(this)].filter((element) => matchesList(element, list));
    }
  }

  /** What every element shares; HTML and SVG elements derive from it. */
  class StubElementBase extends StubNode {
    constructor(tagName, { foreign = false } = {}) {
      super();
      this.nodeType = 1;
      // tagName stays a plain property: tests hand-build targets by assigning it.
      this.tagName = tagName === undefined ? undefined : foreign ? tagName : String(tagName).toUpperCase();
      this.localName = tagName === undefined ? undefined : foreign ? tagName : String(tagName).toLowerCase();
      this._foreign = foreign;
      /** @type {Map<string, string>} */
      this._attrs = new Map();
      this._childNodes = [];
      this._popoverOpen = false;
      this.style = { setProperty() {} };
      const attrs = this._attrs;
      // dataset is a view of the data-* attributes, as DOMStringMap is.
      this.dataset = new Proxy(
        {},
        {
          get: (_, key) => (typeof key === "string" ? attrs.get(dataFromCamel(key)) : undefined),
          set: (_, key, value) => {
            attrs.set(dataFromCamel(String(key)), String(value));
            return true;
          },
          has: (_, key) => typeof key === "string" && attrs.has(dataFromCamel(key)),
          deleteProperty: (_, key) => {
            attrs.delete(dataFromCamel(String(key)));
            return true;
          },
          ownKeys: () => [...attrs.keys()].filter((name) => name.startsWith("data-")).map(camelFromData),
          getOwnPropertyDescriptor: (_, key) =>
            typeof key === "string" && attrs.has(dataFromCamel(key))
              ? { value: attrs.get(dataFromCamel(key)), writable: true, enumerable: true, configurable: true }
              : undefined,
        },
      );
      const element = this;
      const tokens = () => (attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
      const write = (list) => attrs.set("class", list.join(" "));
      this.classList = {
        get length() {
          return tokens().length;
        },
        get value() {
          return attrs.get("class") ?? "";
        },
        item: (index) => tokens()[index] ?? null,
        contains: (token) => tokens().includes(token),
        add: (...added) => write([...new Set([...tokens(), ...added])]),
        remove: (...removed) => write(tokens().filter((token) => !removed.includes(token))),
        toggle(token, force) {
          const has = tokens().includes(token);
          const want = force === undefined ? !has : Boolean(force);
          if (want && !has) element.classList.add(token);
          if (!want && has) element.classList.remove(token);
          return want;
        },
        replace(oldToken, newToken) {
          if (!tokens().includes(oldToken)) return false;
          write(tokens().map((token) => (token === oldToken ? newToken : token)));
          return true;
        },
        [Symbol.iterator]: () => tokens()[Symbol.iterator](),
        toString: () => attrs.get("class") ?? "",
      };
    }

    _name(name) {
      return this._foreign ? String(name) : String(name).toLowerCase();
    }

    getAttribute(name) {
      const value = this._attrs.get(this._name(name));
      return value === undefined ? null : value;
    }

    setAttribute(name, value) {
      this._attrs.set(this._name(name), String(value));
    }

    removeAttribute(name) {
      this._attrs.delete(this._name(name));
    }

    hasAttribute(name) {
      return this._attrs.has(this._name(name));
    }

    toggleAttribute(name, force) {
      const has = this.hasAttribute(name);
      const want = force === undefined ? !has : Boolean(force);
      if (want && !has) this.setAttribute(name, "");
      if (!want && has) this.removeAttribute(name);
      return want;
    }

    getAttributeNames() {
      return [...this._attrs.keys()];
    }

    get id() {
      return this._attrs.get("id") ?? "";
    }

    set id(value) {
      this._attrs.set("id", String(value));
    }

    get className() {
      return this._attrs.get("class") ?? "";
    }

    set className(value) {
      this._attrs.set("class", String(value));
    }

    get hidden() {
      return this._attrs.has("hidden");
    }

    set hidden(value) {
      if (value) this._attrs.set("hidden", "");
      else this._attrs.delete("hidden");
    }

    get disabled() {
      return this._attrs.has("disabled");
    }

    set disabled(value) {
      if (value) this._attrs.set("disabled", "");
      else this._attrs.delete("disabled");
    }

    get childNodes() {
      return [...this._childNodes];
    }

    // Anything a test appends counts as a child, as the old stub's list did;
    // only text and comment nodes are left out, as in the browser.
    get children() {
      return this._childNodes.filter((node) => !(node instanceof StubText || node instanceof StubComment));
    }

    get firstChild() {
      return this._childNodes[0] ?? null;
    }

    get lastChild() {
      return this._childNodes.at(-1) ?? null;
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    get lastElementChild() {
      return this.children.at(-1) ?? null;
    }

    get textContent() {
      return this._childNodes
        .filter((node) => !(node instanceof StubComment))
        .map((node) => (node && typeof node.textContent === "string" ? node.textContent : ""))
        .join("");
    }

    // Setting text replaces every child with one text node, as in the browser.
    set textContent(value) {
      this._replaceChildren(value === "" || value === null || value === undefined ? [] : [new StubText(value)]);
    }

    get innerHTML() {
      return this._childNodes.map(serialize).join("");
    }

    set innerHTML(value) {
      const { children } = parseHtml(String(value ?? ""));
      this._replaceChildren(children.map((node) => build(node)));
    }

    _replaceChildren(nodes) {
      for (const node of this._childNodes) if (node && typeof node === "object") node.parentNode = null;
      this._childNodes = [];
      for (const node of nodes) this.appendChild(node);
    }

    appendChild(child) {
      if (child instanceof StubFragment) {
        for (const node of child.childNodes) this.appendChild(node);
        return child;
      }
      if (child instanceof StubNode) child.remove();
      this._childNodes.push(child);
      if (child && typeof child === "object" && Object.isExtensible(child)) child.parentNode = this;
      return child;
    }

    append(...nodes) {
      for (const node of nodes) this.appendChild(typeof node === "string" ? new StubText(node) : node);
    }

    replaceChildren(...nodes) {
      this._replaceChildren(nodes.map((node) => (typeof node === "string" ? new StubText(node) : node)));
    }

    contains(node) {
      for (let at = node; at; at = at.parentNode) if (at === this) return true;
      return false;
    }

    matches(selector) {
      return matchesSelector(this, selector);
    }

    closest(selector) {
      const list = compiled(selector);
      for (let at = this; isElement(at); at = at.parentNode) if (matchesList(at, list)) return at;
      return null;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
      const list = compiled(selector);
      return [...descendants(this)].filter((element) => matchesList(element, list));
    }

    // Listeners are logged for the binding-count tests and kept so a test can
    // dispatch an event at this element. There is no capture or bubbling:
    // only the element's own listeners run.
    addEventListener(type, listener) {
      listenerLog.push(`element:${type}`);
      if (typeof listener !== "function") return;
      this._listeners ??= new Map();
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      const list = this._listeners.get(type);
      if (!list.includes(listener)) list.push(listener);
    }

    removeEventListener(type, listener) {
      const list = this._listeners?.get(type);
      if (list?.includes(listener)) list.splice(list.indexOf(listener), 1);
    }

    /**
     * Run this element's listeners for `event.type`, with `event.target`
     * defaulting to the element. Returns false when one called preventDefault().
     */
    dispatchEvent(event) {
      let prevented = false;
      const dispatched = Object.assign(Object.create(event), {
        target: event.target ?? this,
        currentTarget: this,
        preventDefault() {
          prevented = true;
          event.preventDefault?.();
        },
      });
      for (const listener of [...(this._listeners?.get(event.type) ?? [])]) listener.call(this, dispatched);
      return !prevented;
    }

    // Focus, scrolling and popovers have no layout here; only the popover's
    // open state is kept, because :popover-open selects on it.
    focus() {}

    blur() {}

    scrollIntoView() {}

    showPopover() {
      this._popoverOpen = true;
    }

    hidePopover() {
      this._popoverOpen = false;
    }

    togglePopover(force) {
      this._popoverOpen = force === undefined ? !this._popoverOpen : Boolean(force);
      return this._popoverOpen;
    }

    // Drawing is the browser's. A canvas hands back a context whose every
    // method does nothing, so a booted render loop or the QR fallback can run;
    // a test that watches the drawing replaces the methods it reads.
    getContext() {
      return noopContext2d();
    }

    // No layout here: every box is empty unless a test gives it a size.
    getBoundingClientRect() {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
  }

  // The DOM registry checks each element against its expected constructor,
  // so the tag decides the class, as it does in the browser. A test that
  // builds a target with `new HTMLElement()` gets an element with no tag.
  class StubElement extends StubElementBase {}
  class StubVideoElement extends StubElement {}
  class StubCanvasElement extends StubElement {}
  class StubSelectElement extends StubElement {
    get options() {
      return [...descendants(this)].filter((element) => element.localName === "option");
    }
  }
  class StubImageElement extends StubElement {}
  class StubAnchorElement extends StubElement {}
  class StubButtonElement extends StubElement {}
  class StubInputElement extends StubElement {}
  class StubTemplateElement extends StubElement {
    constructor(tagName) {
      super(tagName);
      this.content = new StubFragment();
    }
  }
  class StubSvgElement extends StubElementBase {
    constructor(tagName) {
      super(tagName, { foreign: true });
    }
  }

  const HTML_CLASSES = {
    video: StubVideoElement,
    canvas: StubCanvasElement,
    select: StubSelectElement,
    img: StubImageElement,
    a: StubAnchorElement,
    button: StubButtonElement,
    input: StubInputElement,
    template: StubTemplateElement,
  };

  /** A new element for a tag, of the class the browser would give it. */
  const createElement = (tagName) => {
    const name = String(tagName).toLowerCase();
    const ElementClass = HTML_CLASSES[name] ?? StubElement;
    return new ElementClass(name);
  };

  /** Turn a parsed node into a live stub node. */
  function build(parsed) {
    if (parsed.type === "text") {
      const text = new StubText(parsed.text);
      if (parsed.raw) text._raw = true;
      return text;
    }
    if (parsed.type === "comment") return new StubComment(parsed.text);
    const element = parsed.foreign ? new StubSvgElement(parsed.name) : createElement(parsed.name);
    for (const [name, value] of parsed.attrs) element._attrs.set(name, value);
    for (const child of parsed.children) element.appendChild(build(child));
    if (parsed.content) for (const child of parsed.content) element.content._childNodes.push(build(child));
    return element;
  }

  function serialize(node) {
    if (node instanceof StubText) return node._raw ? node.data : escapeText(node.data);
    if (node instanceof StubComment) return `<!--${node.data}-->`;
    if (!(node instanceof StubElementBase)) return "";
    const name = node.localName ?? "div";
    const attrs = [...node._attrs].map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("");
    if (!node._foreign && VOID_ELEMENTS.has(name)) return `<${name}${attrs}>`;
    const inner = node instanceof StubTemplateElement ? node.content._childNodes.map(serialize).join("") : node.innerHTML;
    return `<${name}${attrs}>${inner}</${name}>`;
  }

  return {
    constructors: {
      HTMLElement: StubElement,
      HTMLVideoElement: StubVideoElement,
      HTMLCanvasElement: StubCanvasElement,
      HTMLSelectElement: StubSelectElement,
      HTMLImageElement: StubImageElement,
      HTMLAnchorElement: StubAnchorElement,
      HTMLButtonElement: StubButtonElement,
      HTMLInputElement: StubInputElement,
      HTMLTemplateElement: StubTemplateElement,
      SVGElement: StubSvgElement,
      Element: StubElementBase,
      Node: StubNode,
      Text: StubText,
    },
    createElement,
    createTextNode: (text) => new StubText(text),
    build,
  };
}

/** A 2D context in which any method call is a no-op and properties are stored. */
function noopContext2d() {
  const noop = () => {};
  return new Proxy(
    {},
    { get: (target, key) => (key in target ? target[key] : typeof key === "string" ? noop : undefined) },
  );
}

/**
 * Build a document from parsed markup.
 *
 * @param {{children: ParsedNode[]}} parsed The result of parseHtml().
 * @param {ReturnType<typeof createDomClasses>} dom
 */
export function buildDocument(parsed, dom) {
  const root = dom.createElement("#document-root");
  for (const child of parsed.children) root.appendChild(dom.build(child));
  const documentElement = root.children.find((node) => node.localName === "html") ?? null;
  if (!documentElement) throw new Error("index.html has no <html> element");
  documentElement.remove();
  const body = documentElement.children.find((node) => node.localName === "body") ?? null;
  const head = documentElement.children.find((node) => node.localName === "head") ?? null;
  return { documentElement, head, body };
}

/** The first element of a tree, root included, that `predicate` accepts, or null. */
export function findElement(root, predicate) {
  return collect(root, predicate, { includeRoot: true, all: false })[0] ?? null;
}
