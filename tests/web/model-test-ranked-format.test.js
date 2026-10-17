// Model Test writes its ranked percentages the Turkish way, as the rest of
// the interface does.
//
// The confidence above the list reads "%7,6" and the letter screen's ranked
// list "%8"; Model Test's list wrote "8%". The fault this kills is that one
// list using the English order. ONNX Runtime is faked at its boundary.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { MANIFEST } from "./helpers/model-test-panel.mjs";

test("Model Test's ranked percentages put the sign first", async () => {
  const app = await appWithFakeOrt({ boot: true });
  const sample = MANIFEST.letters.find((item) => item.id === "letter-a");
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf(sample.expected_label)}`);

  await app.get("loadAndRunPreferredModelTestSample")("letter");

  const shown = JSON.parse(
    app.evaluate(
      `JSON.stringify([...document.querySelectorAll("#modelTestTop3List .top3-row")].map((row) => row.lastChild.textContent))`,
    ),
  );
  assert.ok(shown.length > 0, "precondition: the ranked list has rows");
  for (const value of shown) assert.match(value, /^%\d+$/, `a ranked percentage reads "${value}"`);
});
