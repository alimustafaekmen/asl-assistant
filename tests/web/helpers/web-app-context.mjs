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
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  getContext() {
    return {};
  }

  addEventListener() {}

  removeEventListener() {}

  setAttribute() {}

  appendChild() {}

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

function stubElement() {
  return new StubElement();
}

function createSandbox() {
  const context = vm.createContext({
    console,
    performance: { now: () => 0 },
    document: {
      body: stubElement(),
      getElementById: () => stubElement(),
      createElement: () => stubElement(),
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
    },
  });
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
 */
export function loadWebApp() {
  const context = createSandbox();
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
  };
}
