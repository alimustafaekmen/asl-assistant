// A coach session: which letters it asks, in what order, and how it ends.
//
// Every test drives the booted app through its own buttons, with the fake
// camera, hand and letter model of helpers/coach-app.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp } from "./helpers/coach-app.mjs";

const flowButton = (coach, flow) =>
  coach.app.evaluate(`document.querySelector('[data-coach-flow="${flow}"]')`);

/** The data-state of every progress cell, "" where it has none. */
const cellStates = (coach) =>
  coach.el("coachProgress").children.map((cell) => cell.dataset.state ?? "");

// Progress cells -----------------------------------------------------------------

test("the progress cells mark the current and the done targets in the attribute the stylesheet reads", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(flowButton(coach, "practice"));
  await coach.startCamera();

  const atStart = cellStates(coach);
  assert.ok(atStart.length > 1, "precondition: the session has cells");
  assert.equal(atStart[0], "active", "the first cell is the current target");
  assert.ok(atStart.slice(1).every((value) => value === ""), `later cells: ${atStart.slice(1)}`);

  const target = coach.app.evaluate("state.coachTarget");
  coach.show(target, 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 600);

  assert.equal(cellStates(coach)[0], "hit", "a counted target is marked done");
  // The stylesheet has no rule for these classes.
  for (const cell of coach.el("coachProgress").children) {
    assert.ok(!["done", "current"].includes(cell.className), `class ${cell.className}`);
  }
});
