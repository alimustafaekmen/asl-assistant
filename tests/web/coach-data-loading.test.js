// The coach reads its teaching data when it is first opened, and works without it.
//
// letter_curriculum.json holds the teaching order and a written handshape cue
// for each letter; letter_confusion.json holds the groups of look-alike
// letters and what tells them apart. The coach is useless as a teacher
// without them, but must never wait for them or break when they fail: the
// order then falls back to the alphabet and the learner is told the cues
// could not be loaded.
//
// The network is the boundary faked here; everything else is the booted app,
// driven through its own tabs.

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
const cueOf = (letter) => curriculum.letters.find((entry) => entry.letter === letter).cue_tr;

const FAILED_LINE = "İpuçları yüklenemedi. Referans görseline bakabilirsiniz.";

const openTab = (coach, mode) =>
  coach.click(coach.app.evaluate(`document.querySelector('[data-ui="mode-tab"][data-mode="${mode}"]')`));

const isCoachData = (path) => path.includes(CURRICULUM) || path.includes(CONFUSION);

/** The app on the letter screen, with `route` in front of its fetch. */
async function letterScreenWith(route) {
  const coach = await coachApp({ hash: "#letter" });
  if (route) routeFetch(coach.app, route);
  return coach;
}

test("the teaching data is read on the first visit to the coach, once, and not at startup", async () => {
  const coach = await letterScreenWith(null);
  const reads = () => coach.app.requests.filter(isCoachData);
  assert.deepEqual(reads(), [], "the data was read before anyone opened the coach");

  openTab(coach, "coach");
  await flush();
  openTab(coach, "letter");
  openTab(coach, "coach");
  await flush();

  assert.deepEqual(reads().sort(), [`/data/${CONFUSION}`, `/data/${CURRICULUM}`]);
});

test("with the data, learning starts at the first letter of the teaching order and shows its cue", async () => {
  const coach = await letterScreenWith(null);

  openTab(coach, "coach");
  await flush();

  const first = curriculum.suggested_order[0];
  assert.equal(coach.app.evaluate("state.coachFlow"), "learn", "precondition: a first visit learns");
  assert.equal(coach.text("coachTargetGlyph"), first);
  assert.equal(coach.text("coachHint"), cueOf(first));

  coach.click(coach.el("coachNextTarget"));
  const second = curriculum.suggested_order[1];
  assert.equal(coach.text("coachTargetGlyph"), second, "the next target follows the teaching order");
  assert.equal(coach.text("coachHint"), cueOf(second));
});

test("when the data cannot be read, the coach still opens, in alphabetical order, and says so", async () => {
  const coach = await letterScreenWith((path) => (isCoachData(path) ? Promise.reject(new TypeError("offline")) : undefined));

  openTab(coach, "coach");
  await flush();

  assert.equal(coach.app.evaluate("state.mode"), "coach");
  assert.equal(coach.text("coachTargetGlyph"), "A");
  assert.equal(coach.text("coachHint"), FAILED_LINE);
  coach.click(coach.el("coachNextTarget"));
  assert.equal(coach.text("coachTargetGlyph"), "B", "the alphabet is the fallback order");

  // The camera and the hold work without the data.
  await coach.startCamera();
  coach.show("B", 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 600);
  assert.equal(coach.text("decisionLabel"), "Doğru!");
});

test("a file of another schema is not taught from", async () => {
  const coach = await letterScreenWith((path) =>
    path.includes(CURRICULUM)
      ? jsonResponse({ ...curriculum, schema_version: "letter-curriculum-v0" })
      : undefined,
  );

  openTab(coach, "coach");
  await flush();

  assert.equal(coach.text("coachTargetGlyph"), "A");
  assert.equal(coach.text("coachHint"), FAILED_LINE);
});

test("the coach does not wait for the data, and starts the teaching order when it arrives", async () => {
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  const coach = await letterScreenWith((path, passthrough) =>
    isCoachData(path) ? pending.then(passthrough) : undefined,
  );

  openTab(coach, "coach");
  await flush();
  assert.equal(coach.text("coachTargetGlyph"), "A", "the coach opened on the alphabet while the data loads");

  // Untouched, the target moves to the teaching order once the data is in.
  release();
  await flush();
  assert.equal(coach.text("coachTargetGlyph"), curriculum.suggested_order[0]);
});

test("data that arrives late does not move a target the learner already chose", async () => {
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  const coach = await letterScreenWith((path, passthrough) =>
    isCoachData(path) ? pending.then(passthrough) : undefined,
  );

  openTab(coach, "coach");
  await flush();
  const select = coach.el("coachTarget");
  select.value = "W";
  select.dispatchEvent({ type: "change" });

  release();
  await flush();

  assert.equal(coach.text("coachTargetGlyph"), "W");
  assert.equal(coach.text("coachHint"), cueOf("W"), "the cue arrives for the chosen target");
});
