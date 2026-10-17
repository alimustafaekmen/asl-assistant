// ONNX Runtime's WASM files come from the version of the script that runs.
//
// index.html loads ort.min.js from a pinned CDN version, with SRI. Each model
// adapter then tells ORT where to fetch its worker and WASM binaries from. If
// that directory names another version, the JavaScript and the WASM it loads
// disagree, which fails in the browser only, at the first model load. The
// fault this kills is one adapter's path moving to another version (or
// losing it) while the script tag stays where it is.
//
// The expected directory is read from the parsed index.html, the document the
// app boots against; ORT is faked at its boundary and records the path it was
// given when each session was created.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { parsedIndexHtml } from "./helpers/web-app-context.mjs";

/** Every element of the parsed document, in document order. */
function* elements(nodes) {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    yield node;
    yield* elements(node.children);
  }
}

/** The directory of the ONNX Runtime script index.html loads, with its trailing slash. */
function ortScriptDirectory() {
  const sources = [];
  for (const element of elements(parsedIndexHtml().children)) {
    if (element.name !== "script") continue;
    const src = element.attrs.find(([name]) => name === "src")?.[1];
    if (src !== undefined && new URL(src, "https://example.test/").pathname.endsWith("/ort.min.js")) {
      sources.push(src);
    }
  }
  assert.equal(sources.length, 1, "index.html must load ort.min.js exactly once");
  const url = new URL(sources[0]);
  return url.origin + url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
}

for (const [model, ensure] of [
  ["letter", "ensureLetterModel"],
  ["word", "ensureWordModel"],
]) {
  test(`the ${model} model points ORT at the directory index.html loads ort.min.js from`, async () => {
    const app = await appWithFakeOrt({ boot: true });

    assert.equal(await app.get(ensure)(), true, `the ${model} model must load`);

    const seen = Array.from(app.evaluate("__ort.wasmPaths"));
    assert.ok(seen.length > 0, "a session must have been created");
    for (const wasmPaths of seen) assert.equal(wasmPaths, ortScriptDirectory());
  });
}
