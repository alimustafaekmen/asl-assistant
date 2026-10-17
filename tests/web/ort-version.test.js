// ONNX Runtime's WASM files come from the version of the script that runs.
//
// index.html loads ONNX Runtime from a pinned CDN version, with SRI. Each model
// adapter then tells ORT where to fetch its worker and WASM binaries from. If
// that directory names another version, the JavaScript and the WASM it loads
// disagree, which fails in the browser only, at the first model load. The
// fault this kills is one adapter's path moving to another version (or
// losing it) while the script tag stays where it is.
//
// The bundle is the WebAssembly-only one, ort.wasm.min.js. Both models run on
// the "wasm" execution provider alone, and the full ort.min.js makes the
// browser fetch the WebGPU/WebNN build of the WASM instead: 4.2 MB on the wire
// where the plain build is 2.4 MB, measured from the CDN. The fault this also
// kills is a switch back to the full bundle, which adds that weight to every
// first camera start for nothing.
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
  const scripts = [];
  for (const element of elements(parsedIndexHtml().children)) {
    if (element.name !== "script") continue;
    const src = element.attrs.find(([name]) => name === "src")?.[1];
    if (src !== undefined && new URL(src, "https://example.test/").pathname.includes("/onnxruntime-web@")) {
      scripts.push({ src, integrity: element.attrs.find(([name]) => name === "integrity")?.[1] });
    }
  }
  assert.equal(scripts.length, 1, "index.html must load ONNX Runtime exactly once");
  const [{ src, integrity }] = scripts;
  const url = new URL(src);
  assert.ok(url.pathname.endsWith("/ort.wasm.min.js"), `index.html loads ${url.pathname}, not the WebAssembly-only bundle`);
  assert.match(integrity ?? "", /^sha384-/, "the ONNX Runtime script has no SRI hash");
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
