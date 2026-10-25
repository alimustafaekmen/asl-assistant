// The project page ("How it works") in English, and the switch while it is open.
//
// The faults these tests kill:
// - a sentence, heading, credit or hidden "opens in a new tab" note of the
//   page left in Turkish for an English reader;
// - the model card's figures written the Turkish way on an English page
//   ("%81", "1,5 MB") or the English way on a Turkish one;
// - a switch while the figures are shown that leaves the filled sentences in
//   the old language, or empties their figures, and a switch back that does
//   not give the same Turkish page.
//
// fetch (for the card), the browser's languages and ONNX Runtime are faked at
// their boundaries; the markup and the scripts are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FAKE_ORT_SOURCE, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const ENGLISH = ["en-US", "en"];

/** A card whose figures differ from the shipped one, with a decimal to format. */
const CARD = {
  schema_version: "model-card-v1",
  letter: { classes: 21, accuracy_held_out: 0.8123, size_bytes_gzip: 3 * 1048576 },
  word: { classes: 47, accuracy: 0.076, size_bytes: 1.5 * 1048576, test_signers: 7 },
};

/** The app booted in `languages`, on the project page, with its figures filled. */
async function projectPage(languages) {
  const app = loadWebApp({ boot: true, languages, globals: { console: quietConsole } });
  await app.ready;
  app.evaluate(FAKE_ORT_SOURCE);
  let asked = 0;
  routeFetch(app, (path) => {
    if (!path.includes("model-card.json")) return undefined;
    asked += 1;
    return jsonResponse(CARD);
  });
  app.get("setMode")("project");
  for (let turn = 0; turn < 200 && asked === 0; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.evaluate('document.getElementById("projectNumbers").hidden'), false, "the figures were not filled");
  return app;
}

const screen = (app) => app.evaluate('document.getElementById("projectScreen")');
const numbersText = (app) =>
  app.evaluate('document.getElementById("projectNumbers").textContent').replace(/\s+/g, " ").trim();
const figures = (app) =>
  Object.fromEntries(
    Array.from(app.evaluate('document.querySelectorAll("[data-card]")'), (element) => [
      element.getAttribute("data-card"),
      element.textContent,
    ]),
  );
// "SIL" is the font licence's name, which the Turkish word list also holds.
const ALLOW = ["· SIL OFL 1.1"];
const missing = (app) => [...app.get("I18N_PROBLEMS").missing];

test("an English reader gets the whole project page in English, figures included", async () => {
  const app = await projectPage(ENGLISH);

  assert.deepEqual(turkishLeft(screen(app), { includeHidden: true, allow: ALLOW }), []);
  assert.deepEqual(figures(app), {
    "letter.accuracy_held_out": "81%",
    "word.accuracy": "7.6%",
    "letter.classes": "21",
    "word.classes": "47",
    "letter.size_bytes_gzip": "3 MB",
    "word.size_bytes": "1.5 MB",
  });
  assert.match(numbersText(app), /Letters: 81% correct on held-out test data\./);
  assert.match(numbersText(app), /choose from 21 letters and 47 words\./);
  assert.deepEqual(missing(app), []);
});

test("a switch while the figures are shown rewrites the page and refills them, both ways", async () => {
  const app = await projectPage(["tr-TR", "tr"]);
  const turkish = numbersText(app);
  assert.match(turkish, /Harf: ayrılmış test verisinde %81 doğru\./);
  assert.equal(figures(app)["word.accuracy"], "%7,6");

  app.get("setLanguage")("en");
  assert.deepEqual(turkishLeft(screen(app), { includeHidden: true, allow: ALLOW }), []);
  assert.equal(figures(app)["word.accuracy"], "7.6%");
  assert.equal(figures(app)["word.size_bytes"], "1.5 MB");
  assert.match(numbersText(app), /Words: 7\.6% correct on recordings of people the model never saw\./);

  app.get("setLanguage")("tr");
  assert.equal(numbersText(app), turkish, "switching back must give the same Turkish page");
  assert.equal(figures(app)["word.size_bytes"], "1,5 MB");
  assert.deepEqual(missing(app), []);
});
