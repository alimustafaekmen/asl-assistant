// The Model Test run button keeps the wording the page gives it.
//
// The markup labels it "Seçili örneği yeniden çalıştır", in the sentence case
// the rest of the interface uses. A script that rewrites it once a sample has
// loaded, in title case ("Seçili Örneği Tekrar Çalıştır", "Model Çalışıyor"),
// changes the button's words and casing under the visitor. The fault this
// kills is any label that drifts from the markup's. ONNX Runtime is
// faked at its boundary and holds the run so the busy label can be read.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { MANIFEST, text } from "./helpers/model-test-panel.mjs";
import { parsedIndexHtml } from "./helpers/web-app-context.mjs";

/** The button's text as index.html writes it. */
function markupLabel() {
  const find = (nodes) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.attrs.some(([name, value]) => name === "id" && value === "runModelTestSample")) {
        return node.children.filter((child) => child.type === "text").map((child) => child.text).join("").trim();
      }
      const inner = find(node.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return find(parsedIndexHtml().children);
}

test("the run button reads as the markup has it, before, during and after a run", async () => {
  const label = markupLabel();
  assert.equal(label, "Seçili örneği yeniden çalıştır", "precondition: the markup's label");
  const app = await appWithFakeOrt({ boot: true });
  const sample = MANIFEST.letters.find((item) => item.id === "letter-a");
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf(sample.expected_label)}`);

  await app.get("loadPreferredModelTestSample")("letter");
  assert.equal(text(app, "runModelTestSample"), label, "after a sample loads");

  await app.get("runModelTestSample")();
  app.evaluate("__ort.holdRuns()");
  const running = app.get("runModelTestSample")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(text(app, "runModelTestSample"), "Model çalışıyor", "while the model runs");
  app.evaluate("__ort.releaseRuns()");
  await running;
  assert.equal(text(app, "runModelTestSample"), label, "after the run");
});
