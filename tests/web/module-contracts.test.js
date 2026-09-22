// Structural contracts for the classic-script browser app.
//
// Load order and a single shared global scope are runtime contracts here, not
// conventions. These tests fail fast when a module split leaves a declaration
// behind, reorders the scripts, or introduces a second bootstrap entry point.

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

let helper;
test.before(async () => {
  helper = await import("./helpers/web-app-context.mjs");
});

// Declarations at column 0 are the ones that reach the shared global scope.
const TOP_LEVEL_DECLARATION =
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function walkJsFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walkJsFiles(path));
    else if (path.endsWith(".js")) found.push(path);
  }
  return found.sort();
}

/** Map of every top-level declaration to the script that owns it. */
function declaredGlobals() {
  const owners = new Map();
  for (const relPath of helper.webScriptPaths()) {
    const source = readFileSync(join(helper.WEB_DIR, relPath), "utf8");
    for (const match of source.matchAll(TOP_LEVEL_DECLARATION)) {
      owners.set(match[1] || match[2], relPath);
    }
  }
  return owners;
}

test("every application script index.html loads evaluates cleanly in order", () => {
  const app = helper.loadWebApp();

  assert.ok(app.scripts.length > 0, "index.html must load application scripts");
  assert.ok(app.scripts.every((src) => src.startsWith("js/")));
});

test("exactly one script bootstraps the app, and it is the last one", () => {
  const app = helper.loadWebApp();

  assert.deepEqual(app.bootstrapScripts, ["js/core/app.js"]);
  assert.equal(app.scripts.at(-1), "js/core/app.js");
});

test("index.html loads every JavaScript file under asl-web/js", () => {
  const jsDir = join(helper.WEB_DIR, "js");
  const onDisk = walkJsFiles(jsDir).map((path) =>
    path.slice(helper.WEB_DIR.length + 1).split("\\").join("/"),
  );

  assert.deepEqual([...helper.webScriptPaths()].sort(), onDisk);
});

test("no global is declared by two different scripts", () => {
  const owners = new Map();

  for (const relPath of helper.webScriptPaths()) {
    const source = readFileSync(join(helper.WEB_DIR, relPath), "utf8");
    for (const match of source.matchAll(TOP_LEVEL_DECLARATION)) {
      const name = match[1] || match[2];
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(relPath);
    }
  }

  const duplicates = [...owners]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => `${name}: ${files.join(", ")}`);

  assert.deepEqual(duplicates, []);
});

test("the shared runtime contract is reachable from the global scope", () => {
  const app = helper.loadWebApp();

  for (const name of ["CONFIG", "LETTERS", "WORDS", "state", "els", "ctx"]) {
    assert.ok(app.has(name), `missing shared global: ${name}`);
  }
  assert.equal(app.get("LETTERS").length, 24);
  assert.equal(app.get("WORDS").length, 50);
});

test("every global a script declares is reachable from the shared scope", () => {
  const app = helper.loadWebApp();
  const unreachable = [...declaredGlobals()].filter(([name]) => !app.has(name));

  assert.deepEqual(unreachable.map(([name]) => name), []);
});

test("every cross-module call resolves after the scripts load", () => {
  // The modules have no imports: one file calls another's function purely
  // because both end up in the same global scope. This walks those call sites
  // and checks each target is actually there.
  const app = helper.loadWebApp();
  const declared = declaredGlobals();
  const unresolved = [];
  let callSites = 0;

  for (const relPath of helper.webScriptPaths()) {
    const source = readFileSync(join(helper.WEB_DIR, relPath), "utf8");
    for (const [name, owner] of declared) {
      if (owner === relPath) continue;
      const called = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\(`);
      if (!called.test(source)) continue;
      callSites += 1;
      if (!app.has(name)) unresolved.push(`${relPath} -> ${name} (declared in ${owner})`);
    }
  }

  assert.ok(callSites > 50, `expected many cross-module calls, found ${callSites}`);
  assert.deepEqual(unresolved, []);
});
