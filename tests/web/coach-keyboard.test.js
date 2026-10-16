// The coach's keys: Space for what the coach offers next, Escape to stay.
//
// Space does in the coach what it does on the letter screen, take the result
// on offer: after a success it moves on, and during a miss in learning or
// practice it opens the hint. Where the coach offers nothing, and in a quiz,
// where hints are not allowed, it keeps its default action. There are no
// single-letter keys (WCAG 2.1.4), and a key typed at a focused control is
// that control's. Keys go in through the keydown handler the app binds on
// window, with the fake camera, hand and model of helpers/coach-app.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp, flush } from "./helpers/coach-app.mjs";

const KEY = "asl-coach-v1";

/** The coach in `flow`, camera on, with `target` chosen (or the flow's own). */
async function coachIn(flow, target = null) {
  const coach = await coachApp({ hash: "#coach" });
  await flush();
  coach.click(coach.app.evaluate(`document.querySelector('[data-coach-flow="${flow}"]')`));
  if (target) {
    const select = coach.el("coachTarget");
    select.value = target;
    select.dispatchEvent({ type: "change" });
  }
  await coach.startCamera();
  return coach;
}

const targetOf = (coach) => coach.app.evaluate("state.coachTarget");

/** Hold the target until it counts, then take the hand away. */
async function succeed(coach) {
  // Room for the smoothing window to let go of a letter shown before.
  coach.show(targetOf(coach), 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 900);
  assert.equal(coach.text("decisionLabel"), "Doğru!", "precondition: the hold counted");
  coach.hideHand();
  await coach.play(100);
}

/** Show a letter other than the target until the coach calls a miss. */
async function miss(coach) {
  coach.show(targetOf(coach) === "W" ? "K" : "W", 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_MISS_MS") + 300);
  assert.equal(coach.text("decisionLabel"), "Henüz olmadı", "precondition: the miss is shown");
}

test("Space after a success moves on at once", async () => {
  const coach = await coachIn("learn", "L");
  await succeed(coach);

  assert.equal(coach.press(" "), 1, "Space would scroll the page");

  assert.notEqual(targetOf(coach), "L");
  assert.equal(coach.text("primaryPrediction"), "?");
});

test("Space during a miss in practice opens the hint, and the hint is remembered", async () => {
  const coach = await coachIn("practice", "L");
  await miss(coach);
  assert.equal(coach.el("referenceBody").hidden, true, "precondition: the reference is closed");

  assert.equal(coach.press(" "), 1);

  assert.equal(coach.el("referenceBody").hidden, false, "the hint opens the reference");
  assert.ok(coach.text("coachHint").startsWith("İpucu: L."), coach.text("coachHint"));
  assert.equal(JSON.parse(coach.storage.getItem(KEY)).letters.L.hint, 1);
  assert.equal(targetOf(coach), "L", "the hint does not move on");
});

test("Space during a miss in the quiz does nothing: the quiz has no hints", async () => {
  const coach = await coachIn("quiz");
  const target = targetOf(coach);
  await miss(coach);

  assert.equal(coach.press(" "), 0, "Space keeps its default action where it does nothing");

  assert.equal(coach.el("referenceBody").hidden, true);
  assert.equal(targetOf(coach), target);
});

test("Space keeps its default action where the coach offers nothing", async () => {
  const coach = await coachIn("learn", "L");
  coach.show("L", 0.9);
  await coach.play(500);

  assert.equal(coach.press(" "), 0);
  assert.equal(targetOf(coach), "L");
});

test("letter keys do nothing in the coach", async () => {
  const coach = await coachIn("practice", "L");
  await miss(coach);
  for (const key of ["h", "s", "c", "m"]) assert.equal(coach.press(key), 0, key);
  assert.equal(coach.el("referenceBody").hidden, true);

  await succeed(coach);
  for (const key of ["h", "s", "c", "m"]) assert.equal(coach.press(key), 0, key);
  assert.equal(targetOf(coach), "L");
});

test("Space on a focused button is left to the button", async () => {
  const coach = await coachIn("learn", "L");
  await succeed(coach);

  assert.equal(coach.press(" ", coach.app.makeTarget({ tagName: "BUTTON" })), 0);
  assert.equal(targetOf(coach), "L");
});
