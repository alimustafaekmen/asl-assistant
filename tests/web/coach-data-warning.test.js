// A coach teaching file that cannot be read names itself in the console.
//
// The coach goes on without a teaching file that fails (coach-data-loading
// covers what the learner then sees). The fault these tests kill is a file
// that fails in silence: the look-alike reasons and cues are gone and
// nothing says why. A failed read of either file must leave a warning
// naming it, while the coach falls back as usual.
//
// The network is the boundary faked here; everything else is the booted
// app, driven through its own tabs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coachApp, flush } from "./helpers/coach-app.mjs";
import { jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { WEB_DIR } from "./helpers/web-app-context.mjs";

const CURRICULUM = "letter_curriculum.json";
const CONFUSION = "letter_confusion.json";
const curriculum = JSON.parse(readFileSync(join(WEB_DIR, "data", CURRICULUM), "utf8"));

const quiet = { ...console, log() {}, info() {}, error() {} };

/** A response whose body is not JSON, as a truncated or hand-broken file gives. */
const malformed = () => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse("{ not json"),
  text: async () => "{ not json",
});

const FAILURES = {
  "malformed JSON": malformed,
  "an HTTP error": () => jsonResponse({}, 404),
  "JSON of another schema": () => jsonResponse({ schema_version: "something-else" }),
};

/** The coach opened with `file` answered by `respond`, and every warning as text. */
async function coachWithBroken(file, respond) {
  const warnings = [];
  const coach = await coachApp({
    hash: "#letter",
    globals: { console: { ...quiet, warn: (...args) => warnings.push(args.map(String).join(" ")) } },
  });
  routeFetch(coach.app, (path) => (path.includes(file) ? respond() : undefined));
  coach.click(coach.app.evaluate(`document.querySelector('[data-ui="mode-tab"][data-mode="coach"]')`));
  await flush();
  return { coach, warnings };
}

for (const [kind, respond] of Object.entries(FAILURES)) {
  test(`look-alike data that gives ${kind} is reported once, and the cues still show`, async () => {
    const { coach, warnings } = await coachWithBroken(CONFUSION, respond);

    assert.equal(warnings.filter((line) => line.includes(CONFUSION)).length, 1, `warnings: ${JSON.stringify(warnings)}`);
    const first = curriculum.suggested_order[0];
    assert.equal(coach.text("coachTargetGlyph"), first, "the teaching order still applies");
    assert.equal(coach.text("coachHint"), curriculum.letters.find((entry) => entry.letter === first).cue_tr);
  });

  test(`teaching order data that gives ${kind} is reported naming the file`, async () => {
    const { coach, warnings } = await coachWithBroken(CURRICULUM, respond);

    assert.equal(warnings.filter((line) => line.includes(CURRICULUM)).length, 1, `warnings: ${JSON.stringify(warnings)}`);
    assert.equal(coach.text("coachTargetGlyph"), "A", "the coach falls back to the alphabet");
  });
}

test("readable teaching data leaves no warning", async () => {
  const { warnings } = await coachWithBroken("no-such-file.json", () => undefined);

  assert.deepEqual(warnings.filter((line) => line.includes(CURRICULUM) || line.includes(CONFUSION)), []);
});
