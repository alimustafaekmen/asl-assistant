// Load the browser app's classic scripts into a single Node vm context.
//
// The web app has no build step and no module system: index.html loads plain
// <script> files that share one global scope. A vm context reproduces that
// setup closely enough to exercise the pure helpers without a browser and
// without adding a dependency. It also reproduces the failure mode that matters
// most while modules are being split apart: declaring the same const/let in two
// scripts throws a SyntaxError here exactly as it would in the browser.
//
// Only module-level declarations are evaluated. app.js's bootstrap call and the
// debug API that follows it are cut off, because those drive the live DOM,
// camera, and model pipeline. The DOM stub below exists solely so the shared
// DOM registry can be constructed; no test asserts anything about it, and
// DOM-dependent behaviour is deliberately left to manual browser smoke tests.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WEB_DIR = join(PROJECT_ROOT, "asl-web");

// The single top-level bootstrap statement in the application script.
const BOOTSTRAP_CALL = /^init\(\);$/m;

/** Application script paths in index.html order, without the cache-busting query. */
export function webScriptPaths() {
  const html = readFileSync(join(WEB_DIR, "index.html"), "utf8");
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map((match) => match[1].split("?", 1)[0].replace(/^\.\//, ""))
    .filter((src) => src.startsWith("js/"));
}

// The DOM registry checks each element against its expected constructor. One
// stub class stands in for all of them: these tests never assert anything about
// the DOM, they only need module load to get past that check.
class StubElement {
  constructor(listenerLog = []) {
    this.listenerLog = listenerLog;
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    // Children are tracked so a test can show that re-rendering a list
    // replaces its rows instead of appending a second set.
    this.children = [];
    // A status pill ends in its label text node (#cameraStatus in the
    // markup), and stopping the camera writes through it. Without one, any
    // path that reaches stopCamera() throws on the stub, not in the app.
    this.lastChild = { textContent: "" };
    this._innerHTML = "";
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  // Assigning innerHTML replaces the subtree, which is how every list renderer
  // here clears its root before rebuilding it.
  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  getContext() {
    return {};
  }

  addEventListener(type) {
    this.listenerLog.push(`element:${type}`);
  }

  removeEventListener() {}

  // Every element can take focus; a test that watches it replaces this.
  focus() {}

  setAttribute() {}

  // Plain elements carry no role; a test that needs one passes getAttribute.
  getAttribute() {
    return null;
  }

  removeAttribute() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

const ELEMENT_CONSTRUCTORS = [
  "HTMLElement",
  "HTMLVideoElement",
  "HTMLCanvasElement",
  "HTMLSelectElement",
  "HTMLImageElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
];

function createSandbox(missingIds, wrongTypeIds) {
  // Every addEventListener call in this context, so a test can show that
  // binding twice does not leave two listeners behind.
  const listenerLog = [];
  // Window handlers are kept so a test can invoke one directly; the keyboard
  // shortcuts are only reachable that way.
  const windowHandlers = new Map();
  const stubElement = () => new StubElement(listenerLog);
  const context = vm.createContext({
    console,
    performance: { now: () => 0 },
    // Every browser has it; the theme reads the system preference through it.
    // A test that needs a preference passes its own through `globals`.
    matchMedia: () => ({ matches: false }),
    // window is globalThis here, so this is what window.addEventListener hits.
    addEventListener: (type, handler) => {
      listenerLog.push(`window:${type}`);
      windowHandlers.set(type, handler);
    },
    document: {
      body: stubElement(),
      getElementById: (id) => {
        if (missingIds.has(id)) return null;
        // A plain object is not an instance of any element constructor, which
        // is what the registry's type check is there to catch.
        if (wrongTypeIds.has(id)) return {};
        return stubElement();
      },
      createElement: () => stubElement(),
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
    },
  });
  context.__listenerLog = listenerLog;
  context.__windowHandlers = windowHandlers;
  for (const name of ELEMENT_CONSTRUCTORS) context[name] = StubElement;
  vm.runInContext("globalThis.window = globalThis;", context);
  return context;
}

/**
 * Evaluate every application script that index.html loads, in that order.
 *
 * Returns a reader for the shared global scope. Function declarations and
 * const/let bindings are both reachable, mirroring how the scripts see each
 * other at runtime.
 *
 * `missingIds` makes document.getElementById() return null for those ids, which
 * is what a redesign that drops an element looks like to the registry.
 * `wrongTypeIds` returns something that is not an element, which is what
 * retagging one looks like. They are the only way to reach the registry's two
 * failure paths from here, since one stub class satisfies every constructor.
 *
 * `globals` hands real host APIs to the scripts, for a test that needs one the
 * sandbox leaves out, such as the streams used to decompress a download.
 *
 * @param {{missingIds?: string[], wrongTypeIds?: string[], globals?: Record<string, unknown>}} [options]
 */
export function loadWebApp(options = {}) {
  const context = createSandbox(
    new Set(options.missingIds ?? []),
    new Set(options.wrongTypeIds ?? []),
  );
  Object.assign(context, options.globals ?? {});
  const scripts = webScriptPaths();
  const bootstrapScripts = [];

  for (const relPath of scripts) {
    const source = readFileSync(join(WEB_DIR, relPath), "utf8");
    const bootstrap = source.match(BOOTSTRAP_CALL);
    if (bootstrap) bootstrapScripts.push(relPath);
    const evaluated = bootstrap ? source.slice(0, bootstrap.index) : source;
    vm.runInContext(evaluated, context, { filename: relPath });
  }

  return {
    scripts,
    bootstrapScripts,
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
