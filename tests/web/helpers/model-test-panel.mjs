// Reading and driving the Model Test panel from a test.
//
// These are the panel's own entry points and the text its elements show, the
// same things a visitor sees; nothing here replaces an app function.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LETTER_LABELS } from "./fake-ort.mjs";
import { WEB_DIR } from "./web-app-context.mjs";

export const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));

/** The bundled manifest as it is on disk. */
export const MANIFEST = readJson("data/model-test-samples/manifest.json");

/** The bundled letter fixture whose reference label is `label`. */
export const letterItem = (label) => MANIFEST.letters.find((item) => item.expected_label === label);

/** What an element of the panel shows. */
export const text = (app, id) => app.evaluate(`document.getElementById("${id}").textContent`);

/** The match marker of the verdict badge: "yes", "no" or "unknown". */
export const match = (app) => app.evaluate('document.getElementById("modelTestMatchBadge").dataset.match');

/** The text of each row of the ranked list. */
export const rankedRows = (app) =>
  Array.from(app.evaluate("Array.from(els.modelTestTop3List.children, (row) => row.textContent)"));

/** A File-like object, as the file picker and the drop target hand one over. */
export const file = (name, body) => ({
  name,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export const letterVector = (length = 93) => Array.from({ length }, (_, i) => (i + 1) / 100);
export const wordVector = (length = 45 * 168) => Array.from({ length }, (_, i) => ((i % 97) + 1) / 100);
/** A mask with `realFrames` true entries first, then padding. */
export const mask = (realFrames, length = 45) => Array.from({ length }, (_, i) => i < realFrames);

/** Load a bundled letter fixture, make the fake model answer `label`, press Run. */
export async function runBundledLetter(app, label) {
  const item = letterItem(label);
  app.evaluate(`__ort.chosen = ${LETTER_LABELS.indexOf(label)}`);
  await app.get("loadModelTestSampleFromUrl")(item.path, item.title);
  await app.get("runModelTestSample")();
}

/**
 * The batch state as plain data. It is read through JSON so a test compares it
 * with its own objects: values from the app's realm have other prototypes.
 * A number that is not finite (a failed row's time) comes back as null.
 */
export const batchOf = (app) => JSON.parse(app.evaluate("JSON.stringify(state.modelTestBatch)"));

/** The batch's summary line as the panel shows it. */
export const summaryText = (app) => text(app, "modelTestSummary");

/** Each shown batch row as its cells' text, with the row's own markers. */
export const shownRows = (app) =>
  JSON.parse(
    app.evaluate(
      `JSON.stringify(Array.from(els.modelTestRows.children, (row) => ({
        cells: Array.from(row.children, (cell) => cell.textContent),
        verdict: row.dataset.verdict,
        local: row.dataset.local,
      })))`,
    ),
  );

/** Make the fake model answer these class indices, in the order of its real runs. */
export const answerPlan = (app, indices) =>
  app.evaluate(`__ort.plan = ${JSON.stringify(indices)}; __ort.answer = (input, n) => __ort.plan[n - 1];`);

/** The class index each bundled letter fixture expects, in manifest order. */
export const expectedLetterIndices = () => MANIFEST.letters.map((item) => LETTER_LABELS.indexOf(item.expected_label));
