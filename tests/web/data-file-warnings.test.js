// A data file that does not arrive is named in the console, and the app goes
// on with the fallback it always had.
//
// Three files the models' output is read through are optional or have a
// built-in fallback: the word guidance data (confusion_pairs.json and
// per_word_stats.json) and the letter label map (letter_labels.json). Two
// faults this file kills:
//
// - A failed request read as data. A host can answer a missing file with a
//   JSON error body; without a status check that body became the label map,
//   and the letter model named its classes from {"error": "Not Found"}.
// - A failure that says nothing, or nothing useful. The guidance data fell
//   back to empty without a word, and the label map's warning dropped the
//   reason, so a deploy that left a file out looked like a model that had
//   simply become worse.
//
// fetch, the console and ONNX Runtime are replaced at their boundaries; every
// other file is served from the deployed folder on disk.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LETTER_LABELS, appWithFakeOrt, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const PAIR = JSON.parse(readFileSync(join(WEB_DIR, "data", "confusion_pairs.json"), "utf8"))[0];
const STATS = JSON.parse(readFileSync(join(WEB_DIR, "data", "per_word_stats.json"), "utf8"));
const STAT_WORD = Object.keys(STATS)[0];
const PARSE_ERROR = "Unexpected token '<', \"<!DOCTYPE \" is not valid JSON";

/** The two ways a file fails to arrive, as fetch would hand them over. */
const FAILURES = {
  // A missing file, answered with a JSON error body.
  "a 404": { response: () => jsonResponse({ error: "Not Found" }, 404), reason: "404" },
  // A 200 whose body is not JSON, such as an HTML page served in its place.
  "malformed JSON": {
    response: () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError(PARSE_ERROR);
      },
      text: async () => "<!DOCTYPE html>",
    }),
    reason: PARSE_ERROR,
  },
};

/** A console that keeps its warnings and errors as text. */
function recordingConsole() {
  /** @type {string[]} */
  const lines = [];
  const record = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  return { lines, console: { ...console, log() {}, info() {}, debug() {}, warn: record, error: record } };
}

/** Answer requests for `file` with `response()`; everything else comes from disk. */
function failing(app, file, response) {
  routeFetch(app, (path) => (path.split("?")[0].endsWith(`/${file}`) ? response() : undefined));
}

/** A close call between the two words of a published confusion pair. */
const closeCall = (pair) => [
  { label: pair.word_a, confidence: 0.4 },
  { label: pair.word_b, confidence: 0.35 },
];

for (const [failure, { response, reason }] of Object.entries(FAILURES)) {
  test(`confusion_pairs.json as ${failure} is one warning that names it, and no confusion feedback`, async () => {
    const { lines, console } = recordingConsole();
    const app = loadWebApp({ globals: { console } });
    failing(app, "confusion_pairs.json", response);

    assert.equal(await app.get("loadGatingData")(), true);

    const named = lines.filter((line) => line.includes("confusion_pairs.json"));
    assert.equal(named.length, 1, `warnings: ${JSON.stringify(lines)}`);
    assert.ok(named[0].includes(reason), `the warning must say why: ${named[0]}`);
    assert.equal(app.get("getConfusionFeedback")(...closeCall(PAIR)), null);
    // The other file still loaded.
    assert.equal(app.get("getWordDifficulty")(STAT_WORD), STATS[STAT_WORD].difficulty);
  });

  test(`per_word_stats.json as ${failure} is one warning that names it, and no difficulty`, async () => {
    const { lines, console } = recordingConsole();
    const app = loadWebApp({ globals: { console } });
    failing(app, "per_word_stats.json", response);

    assert.equal(await app.get("loadGatingData")(), true);

    const named = lines.filter((line) => line.includes("per_word_stats.json"));
    assert.equal(named.length, 1, `warnings: ${JSON.stringify(lines)}`);
    assert.ok(named[0].includes(reason), `the warning must say why: ${named[0]}`);
    assert.equal(app.get("getWordDifficulty")(STAT_WORD), "unknown");
    assert.notEqual(app.get("getConfusionFeedback")(...closeCall(PAIR)), null, "the pairs still loaded");
  });

  test(`letter_labels.json as ${failure} is one warning that names it, and the built-in letters`, async () => {
    const { lines, console } = recordingConsole();
    const app = await appWithFakeOrt({ globals: { console } });
    failing(app, "letter_labels.json", response);
    const V = LETTER_LABELS.indexOf("V");
    app.evaluate(`__ort.chosen = ${V};`);

    assert.equal(await app.get("ensureLetterModel")(), true);

    const named = lines.filter((line) => line.includes("letter_labels.json"));
    assert.equal(named.length, 1, `warnings: ${JSON.stringify(lines)}`);
    assert.ok(named[0].includes(reason), `the warning must say why: ${named[0]}`);
    // The model's class V is named V, from the built-in list.
    const result = await app.get("predictLetter")(new Float32Array(93).fill(0.5));
    assert.equal(result?.label, "V");
  });
}
