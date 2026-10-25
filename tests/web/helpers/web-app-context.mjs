// Load the browser app's classic scripts into a single Node vm context.
//
// The web app has no build step and no module system: index.html loads plain
// <script> files that share one global scope. A vm context reproduces that
// setup closely enough to exercise the app without a browser and without
// adding a dependency. It also reproduces the failure a shared scope invites:
// declaring the same const/let in two scripts throws a SyntaxError here
// exactly as it would in the browser.
//
// Every script is evaluated in full, as the browser does, including the
// bootstrap call at the end of app.js. The harness does not look for that
// call in the source text: it watches the global the call goes through (see
// BOOTSTRAP_GLOBAL), so a comment or a reformat of that line changes nothing
// here. With `boot: true` the real init() runs against the default boundary
// fakes below and `app.ready` is its promise. Without it the call is observed
// and recorded but not carried out, which is the state most unit tests want:
// modules declared, nothing started.
//
// The document is built from the real index.html (static-dom.mjs): an id the
// markup lacks is not found, and each element starts with the markup's
// attributes and text and has the constructor its tag gives it. An event can
// be dispatched at one element, which runs that element's own listeners.
// There is no layout, style, focus order, capture or bubbling; those are left
// to a browser.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { buildDocument, createDomClasses, findElement, parseHtml } from "./static-dom.mjs";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WEB_DIR = join(PROJECT_ROOT, "asl-web");

// The global function the last script calls to start the app. Its call is the
// one statement in the scripts that has side effects at load; everything else
// only declares. The harness observes the call through this binding, never by
// reading the source.
const BOOTSTRAP_GLOBAL = "init";

/** @type {ReturnType<typeof parseHtml> | null} */
let parsedIndex = null;

/**
 * index.html as parsed markup, read once per test process.
 *
 * Each loadWebApp() builds its own live document from this, so one test's
 * DOM writes never reach another's.
 */
export function parsedIndexHtml() {
  parsedIndex ??= parseHtml(readFileSync(join(WEB_DIR, "index.html"), "utf8"));
  return parsedIndex;
}

/** Every parsed element of the static document, in document order. */
function* parsedElements(nodes) {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    yield node;
    yield* parsedElements(node.children);
  }
}

/** An attribute of a parsed element, or undefined. */
function parsedAttr(element, wanted) {
  return element.attrs.find(([name]) => name === wanted)?.[1];
}

/** The app script path a parsed element loads, or null for anything else. */
function appScriptPath(element) {
  if (element.name !== "script" || element.foreign) return null;
  const src = parsedAttr(element, "src");
  if (src === undefined) return null;
  const path = src.split("?", 1)[0].split("#", 1)[0];
  const relativePath = path.startsWith("./") ? path.slice(2) : path;
  return relativePath.startsWith("js/") ? relativePath : null;
}

/** Application script paths in index.html order, without the cache-busting query. */
export function webScriptPaths() {
  const paths = [];
  for (const element of parsedElements(parsedIndexHtml().children)) {
    const path = appScriptPath(element);
    if (path !== null) paths.push(path);
  }
  return paths;
}

/**
 * The app scripts index.html loads before its first stylesheet, in order.
 *
 * A classic script the parser meets before any stylesheet link runs before
 * the page can be painted with that stylesheet, so these are the scripts that
 * decide what the first frame looks like.
 */
export function scriptsBeforeStylesheets() {
  const paths = [];
  for (const element of parsedElements(parsedIndexHtml().children)) {
    const rel = (parsedAttr(element, "rel") ?? "").toLowerCase().split(/\s+/);
    if (element.name === "link" && rel.includes("stylesheet")) break;
    const path = appScriptPath(element);
    if (path !== null) paths.push(path);
  }
  return paths;
}

// Default boundary fakes. Each stands in for a host API at the edge of the app,
// never for an app module. A test replaces any of them through `globals`.

const CONTENT_TYPES = { ".json": "application/json", ".gz": "application/gzip", ".onnx": "application/octet-stream" };

/** A fetch Response for bytes read from disk, or a 404. */
function diskResponse(url, bytes) {
  const status = bytes ? 200 : 404;
  const body = bytes ?? Buffer.alloc(0);
  const extension = url.pathname.slice(url.pathname.lastIndexOf("."));
  return {
    ok: status === 200,
    status,
    url: url.href,
    headers: new Headers(bytes ? { "content-type": CONTENT_TYPES[extension] ?? "text/plain" } : {}),
    json: async () => JSON.parse(body.toString("utf8")),
    text: async () => body.toString("utf8"),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    // A stream only when asked for, as the gzip path reads the body that way.
    get body() {
      return new Response(body).body;
    },
  };
}

/**
 * fetch() serving the deployed folder from disk, the way the static host does.
 *
 * A same-origin path resolves against asl-web/; a missing file is a 404, and
 * nothing outside the folder is readable. Any other origin (the CDNs) fails as
 * a network error, so a test that needs one says so.
 *
 * @param {URL} location The page address the app resolves relative URLs against.
 */
function diskFetch(location) {
  const requests = [];
  const fetch = async (input) => {
    const url = new URL(String(input), location.href);
    requests.push(url.pathname + url.search);
    if (url.origin !== location.origin) throw new TypeError(`network unavailable in the harness: ${url.href}`);
    const path = join(WEB_DIR, decodeURIComponent(url.pathname));
    const inside = relative(WEB_DIR, path);
    if (inside.startsWith("..") || inside.split(sep).includes("..")) return diskResponse(url, null);
    try {
      return diskResponse(url, readFileSync(path));
    } catch {
      return diskResponse(url, null);
    }
  };
  return { fetch, requests };
}

/** localStorage backed by a Map, empty at load as for a first visit. */
function memoryStorage() {
  const items = new Map();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (items.has(String(key)) ? items.get(String(key)) : null),
    setItem: (key, value) => void items.set(String(key), String(value)),
    removeItem: (key) => void items.delete(String(key)),
    clear: () => items.clear(),
  };
}

/** requestAnimationFrame that queues; runFrame() plays one browser frame. */
function queuedAnimationFrames() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    requestAnimationFrame(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      pending.delete(id);
    },
    /** Run every callback queued at this moment once; returns how many ran. */
    runFrame(time = 0) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(time);
      return callbacks.length;
    },
  };
}

/** A media query list that never matches and accepts listeners. */
function matchMediaFake() {
  return (query) => ({
    media: String(query),
    matches: false,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

/** history that moves the fake location, as replaceState and pushState do. */
function historyFake(location) {
  const entries = [];
  const move = (url) => {
    if (url === undefined || url === null) return;
    location.href = new URL(String(url), location.href).href;
  };
  return {
    entries,
    get length() {
      return entries.length + 1;
    },
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      move(url);
    },
    pushState(state, _title, url) {
      entries.push(location.href);
      this.state = state;
      move(url);
    },
  };
}

const DEFAULT_PAGE_URL = "https://asl-assistant.pages.dev/";

/**
 * The browser's preferred languages when a test does not choose them.
 *
 * The page picks its language from these (after a saved choice), and the
 * suites assert the Turkish copy, so every page here is a Turkish browser's
 * unless a test says otherwise. Like the camera, the browser's languages are
 * a fact of the visitor's machine, so they are a boundary fake.
 */
export const DEFAULT_LANGUAGES = Object.freeze(["tr-TR", "tr"]);

/**
 * Give the page a browser locale and, if asked, a saved language choice.
 *
 * A test that hands in its own navigator for the camera or the clipboard
 * still gets the default languages, unless that navigator states its own.
 * The saved choice goes where the page keeps it, in localStorage, whichever
 * storage the test supplied; a storage that throws keeps nothing, as in a
 * browser that blocks it.
 *
 * @param {object} context
 * @param {{languages?: readonly string[], savedLanguage?: string}} options
 */
function applyLocale(context, { languages = DEFAULT_LANGUAGES, savedLanguage } = {}) {
  if (context.navigator === undefined || context.navigator === null) context.navigator = {};
  const nav = context.navigator;
  if (typeof nav === "object" && !("languages" in nav) && !("language" in nav) && Object.isExtensible(nav)) {
    nav.languages = Object.freeze([...languages]);
    if (languages.length > 0) nav.language = languages[0];
  }
  if (savedLanguage !== undefined) {
    try {
      context.localStorage.setItem("asl-lang", savedLanguage);
    } catch {
      // Blocked storage: nothing is saved.
    }
  }
}

function createSandbox(missingIds, wrongTypeIds) {
  // Every addEventListener call in this context, so a test can show that
  // binding twice does not leave two listeners behind.
  const listenerLog = [];
  // Window handlers are kept so a test can invoke one directly; the keyboard
  // shortcuts are only reachable that way.
  const windowHandlers = new Map();
  const location = new URL(DEFAULT_PAGE_URL);
  const network = diskFetch(location);
  const frames = queuedAnimationFrames();
  const context = vm.createContext({
    console,
    performance: { now: () => 0 },
    matchMedia: matchMediaFake(),
    fetch: network.fetch,
    localStorage: memoryStorage(),
    location,
    history: historyFake(location),
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    // Real timers, but unreferenced: a toast's 6 s auto-hide left pending at
    // the end of a file would otherwise hold the test process open that long.
    setTimeout: (fn, ms, ...rest) => {
      const timer = setTimeout(fn, ms, ...rest);
      timer.unref();
      return timer;
    },
    clearTimeout,
    URL,
    // window is globalThis here, so this is what window.addEventListener hits.
    addEventListener: (type, handler) => {
      listenerLog.push(`window:${type}`);
      windowHandlers.set(type, handler);
    },
    document: createDocument({ listenerLog, missingIds, wrongTypeIds }),
  });
  context.__listenerLog = listenerLog;
  context.__windowHandlers = windowHandlers;
  Object.assign(context, context.document.__constructors);
  delete context.document.__constructors;
  vm.runInContext("globalThis.window = globalThis;", context);
  return { context, network, frames };
}

/**
 * A live document built from index.html for one context.
 *
 * getElementById() finds an element only if the markup has its id, so a
 * required id the markup lost fails at load, as it does in the browser.
 * `missingIds` and `wrongTypeIds` still override it for the registry's
 * failure-path tests. The query methods are closures rather than methods,
 * because tests keep a reference to one and call it unbound.
 *
 * @param {{listenerLog: string[], missingIds: Set<string>, wrongTypeIds: Set<string>}} options
 */
function createDocument({ listenerLog, missingIds, wrongTypeIds }) {
  const dom = createDomClasses({ listenerLog });
  const { documentElement, head, body } = buildDocument(parsedIndexHtml(), dom);
  const matching = (selector) => [
    ...(documentElement.matches(selector) ? [documentElement] : []),
    ...documentElement.querySelectorAll(selector),
  ];
  // Document listeners run when a test dispatches at the document, as an
  // element's do. The page starts visible; a test that hides it sets
  // visibilityState and dispatches "visibilitychange", as the browser does.
  const listeners = new Map();
  return {
    documentElement,
    head,
    body,
    visibilityState: "visible",
    get hidden() {
      return this.visibilityState === "hidden";
    },
    addEventListener: (type, listener) => {
      listenerLog.push(`document:${type}`);
      if (typeof listener !== "function") return;
      if (!listeners.has(type)) listeners.set(type, []);
      const list = listeners.get(type);
      if (!list.includes(listener)) list.push(listener);
    },
    removeEventListener: (type, listener) => {
      const list = listeners.get(type);
      if (list?.includes(listener)) list.splice(list.indexOf(listener), 1);
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener.call(this, event);
      return true;
    },
    getElementById: (id) => {
      if (missingIds.has(id)) return null;
      // A plain object is not an instance of any element constructor, which
      // is what the registry's type check is there to catch.
      if (wrongTypeIds.has(id)) return {};
      const wanted = String(id);
      return findElement(documentElement, (element) => element._attrs.get("id") === wanted);
    },
    createElement: (tagName) => dom.createElement(tagName),
    createTextNode: (text) => dom.createTextNode(text),
    querySelector: (selector) => matching(selector)[0] ?? null,
    querySelectorAll: (selector) => matching(selector),
    __constructors: dom.constructors,
  };
}

/**
 * Watch the bootstrap global while the scripts load.
 *
 * A function declaration in a classic script defines a property on the global
 * object, and a bare call reads it back from there. In a vm context both go
 * through the sandbox object, so an accessor on it sees the script define
 * init() and sees the bootstrap read it to call it. During load the read hands
 * back a recorder; after load it hands back the real function, so a later
 * `init()` from a test is the app's own.
 */
function watchBootstrap(context, { boot, currentScript }) {
  let real;
  let loading = true;
  const watch = { calls: [], ready: null };
  const recorder = function (...args) {
    watch.calls.push(currentScript());
    // init() is async: a bootstrap that is observed but not carried out
    // still returns a promise, one that never settles, so a script may chain
    // on the call as it would on the real one.
    if (!boot) return new Promise(() => {});
    const result = real.apply(this, args);
    if (watch.ready === null) watch.ready = Promise.resolve(result);
    return result;
  };
  Object.defineProperty(context, BOOTSTRAP_GLOBAL, {
    configurable: true,
    enumerable: true,
    get: () => (real !== undefined && loading ? recorder : real),
    set: (value) => {
      real = value;
    },
  });
  return {
    watch,
    done() {
      loading = false;
    },
  };
}

/**
 * Evaluate every application script that index.html loads, in that order.
 *
 * Returns a reader for the shared global scope. Function declarations and
 * const/let bindings are both reachable, mirroring how the scripts see each
 * other at runtime.
 *
 * `boot` lets the bootstrap call at the end of app.js run the real init(), as
 * the browser does; `app.ready` is then the promise it returned. It is off by
 * default because most tests here drive one function of a module that has
 * been declared but not started, and several replace a command or a selector
 * before calling bindEvents() themselves (event-binding, a11y-state), which a
 * booted app has already done. Either way the bootstrap call itself is
 * observed: `bootstrapScripts` lists the scripts that made it, and loading
 * fails if none did.
 *
 * `missingIds` makes document.getElementById() return null for those ids, which
 * is what a redesign that drops an element looks like to the registry.
 * `wrongTypeIds` returns something that is not an element, which is what
 * retagging one looks like. Both reach the registry's two failure paths
 * without editing index.html; the document itself is the real markup, so an
 * id it lacks is already null and a retagged element already has the wrong
 * constructor.
 *
 * `unloadedScripts` lists scripts the page failed to fetch (a 404, a network
 * error, a deploy that left a file out). They are not evaluated, and the
 * scripts after them still run, as a browser runs them.
 *
 * `globals` replaces host APIs: the default boundary fakes (fetch from the
 * asl-web folder on disk, queued animation frames, Map-backed localStorage,
 * matchMedia, location and history on https://asl-assistant.pages.dev/), or
 * ones the sandbox leaves out, such as the streams used to decompress a
 * download. They are in place before the first script runs.
 *
 * `languages` are the browser's preferred languages (DEFAULT_LANGUAGES,
 * Turkish, when left out), and `savedLanguage` a language choice the visitor
 * saved on an earlier visit. `{languages: ["en-US", "en"]}` opens the page as
 * an English reader's browser does.
 *
 * @param {{
 *   boot?: boolean,
 *   missingIds?: string[],
 *   wrongTypeIds?: string[],
 *   unloadedScripts?: string[],
 *   globals?: Record<string, unknown>,
 *   languages?: readonly string[],
 *   savedLanguage?: string,
 * }} [options]
 */
export function loadWebApp(options = {}) {
  const { context, network, frames } = createSandbox(
    new Set(options.missingIds ?? []),
    new Set(options.wrongTypeIds ?? []),
  );
  Object.assign(context, options.globals ?? {});
  applyLocale(context, options);
  const scripts = webScriptPaths();
  let evaluating = null;
  const bootstrap = watchBootstrap(context, {
    boot: options.boot === true,
    currentScript: () => evaluating,
  });

  const unloaded = new Set(options.unloadedScripts ?? []);
  for (const relPath of unloaded) {
    if (!scripts.includes(relPath)) throw new Error(`index.html does not load ${relPath}`);
  }
  for (const relPath of scripts) {
    if (unloaded.has(relPath)) continue;
    evaluating = relPath;
    const source = readFileSync(join(WEB_DIR, relPath), "utf8");
    vm.runInContext(source, context, { filename: relPath });
  }
  evaluating = null;
  bootstrap.done();

  const bootstrapScripts = [...new Set(bootstrap.watch.calls)];
  if (bootstrapScripts.length === 0) {
    throw new Error(
      `no script called ${BOOTSTRAP_GLOBAL}() while loading; the harness cannot tell the app started`,
    );
  }

  return {
    scripts,
    bootstrapScripts,
    /**
     * The promise init() returned when `boot` is set; null otherwise. It
     * settles when startup has finished: the fixture manifest, the route,
     * and the word guidance data.
     *
     * @type {Promise<void> | null}
     */
    ready: bootstrap.watch.ready,
    /** Paths the default fetch was asked for, in order, with their query. */
    requests: network.requests,
    /** Play one browser frame of the default requestAnimationFrame queue. */
    runFrame: (time) => frames.runFrame(time),
    /** Callbacks waiting for the next frame in the default queue. */
    pendingFrames: () => frames.pending.size,
    /** Read a global by name; throws when the scripts never declared it. */
    get(name) {
      return vm.runInContext(name, context);
    },
    /** True when `name` resolves to anything other than undefined. */
    has(name) {
      return vm.runInContext(`typeof ${name} !== "undefined"`, context);
    },
    /** Evaluate an expression against the shared scope. */
    evaluate(expression) {
      return vm.runInContext(expression, context);
    },
    /** How many listeners the scripts have registered in this context so far. */
    listenerCount() {
      return vm.runInContext("__listenerLog.length", context);
    },
    /**
     * The handler bound to `window` for an event type, or undefined.
     *
     * @param {string} type
     */
    windowHandler(type) {
      return vm.runInContext("__windowHandlers", context).get(type);
    },
    /** Build a stub element standing in for an event target. */
    makeTarget(properties) {
      const element = vm.runInContext("new HTMLElement()", context);
      return Object.assign(element, properties);
    },
  };
}

/**
 * Run only the scripts index.html loads before its first stylesheet.
 *
 * This is the page as it stands when the browser could first paint it: the
 * document is the real markup, and no later script, init() included, has
 * run. A test reads what those scripts left on the document, such as the
 * theme the first frame is drawn in. The host APIs are the same default
 * fakes as loadWebApp()'s, and `globals` replaces them; `languages` and
 * `savedLanguage` are loadWebApp()'s. An exception a script throws
 * propagates, as it would end that script in the browser.
 *
 * @param {{globals?: Record<string, unknown>, languages?: readonly string[], savedLanguage?: string}} [options]
 */
export function loadBeforeStylesheets(options = {}) {
  const context = vm.createContext({
    console,
    matchMedia: matchMediaFake(),
    localStorage: memoryStorage(),
    location: new URL(DEFAULT_PAGE_URL),
    document: createDocument({ listenerLog: [], missingIds: new Set(), wrongTypeIds: new Set() }),
  });
  Object.assign(context, context.document.__constructors);
  delete context.document.__constructors;
  vm.runInContext("globalThis.window = globalThis;", context);
  Object.assign(context, options.globals ?? {});
  applyLocale(context, options);
  const scripts = scriptsBeforeStylesheets();
  for (const relPath of scripts) {
    vm.runInContext(readFileSync(join(WEB_DIR, relPath), "utf8"), context, { filename: relPath });
  }
  return {
    scripts,
    document: context.document,
    /** Evaluate an expression against the scripts' shared scope. */
    evaluate: (expression) => vm.runInContext(expression, context),
  };
}
