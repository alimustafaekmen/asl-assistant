// The coach remembers progress on this device, as a convenience only.
//
// Progress is kept under one localStorage key: per letter, how often it was
// shown correctly, with a hint and skipped, and the study flow last used.
// It holds nothing personal and no time. The page must work fully without
// it: storage that is corrupt, of another version, or that throws, gives a
// fresh start in memory and a line saying progress cannot be kept.
//
// Storage is the boundary faked here (helpers/coach-app.mjs takes the one a
// test gives it); everything else is the booted app.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coachApp, flush, memoryStorage } from "./helpers/coach-app.mjs";
import { WEB_DIR } from "./helpers/web-app-context.mjs";

const KEY = "asl-coach-v1";
const ORDER = JSON.parse(readFileSync(join(WEB_DIR, "data", "letter_curriculum.json"), "utf8")).suggested_order;
const SAVED_NOTE = "İlerlemeniz yalnızca bu cihazda saklanır, kimseyle paylaşılmaz.";
const UNSAVED_NOTE = "İlerleme bu tarayıcıda saklanamıyor; sayfayı kapatınca sıfırlanır.";

/** The coach opened on a device whose storage is `storage`, data loaded. */
async function coachOn(storage) {
  const coach = await coachApp({ hash: "#coach", storage });
  await flush();
  return coach;
}

/** What the storage holds under the coach's key, parsed. */
const stored = (storage) => JSON.parse(storage.getItem(KEY));

/** Hold the current target until it counts, then take the hand away. */
async function holdTarget(coach) {
  coach.show(coach.app.evaluate("state.coachTarget"), 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 600);
  coach.hideHand();
  await coach.play(200);
}

test("a counted hold is remembered once, under the coach's key, with nothing else", async () => {
  const storage = memoryStorage();
  const coach = await coachOn(storage);
  await coach.startCamera();
  const target = coach.app.evaluate("state.coachTarget");

  coach.show(target, 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 2000);

  assert.deepEqual(stored(storage), { v: 1, flow: "learn", letters: { [target]: { ok: 1, hint: 0, skip: 0 } } });
  assert.deepEqual([...storage.items.keys()], [KEY], "the coach wrote under another key too");
});

test("moving on from a target that was not shown counts as a skip", async () => {
  const storage = memoryStorage();
  const coach = await coachOn(storage);
  const target = coach.app.evaluate("state.coachTarget");

  coach.click(coach.el("coachNextTarget"));

  assert.deepEqual(stored(storage).letters[target], { ok: 0, hint: 0, skip: 1 });
});

test("a later visit restores the flow and learns from the first letter not yet shown", async () => {
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ v: 1, flow: "practice", letters: { [ORDER[0]]: { ok: 2, hint: 0, skip: 0 } } }),
  });
  const coach = await coachOn(storage);
  assert.equal(coach.app.evaluate("state.coachFlow"), "practice");
  assert.equal(coach.text("coachFlowTitle"), "Pratik");

  coach.click(coach.app.evaluate(`document.querySelector('[data-coach-flow="learn"]')`));
  assert.equal(stored(storage).flow, "learn", "the flow chosen is remembered");

  const again = await coachOn(storage);
  assert.equal(again.text("coachTargetBig"), ORDER[1], "the letter already shown is not taught first again");
});

for (const [kind, raw] of [
  ["unparseable JSON", "{not json"],
  ["another version", JSON.stringify({ v: 2, flow: "quiz", letters: { L: { ok: 1, hint: 0, skip: 0 } } })],
  ["unknown letters and counts", JSON.stringify({ v: 1, flow: "nope", letters: { J: { ok: 3 }, L: { ok: "x" } } })],
]) {
  test(`stored progress of ${kind} gives a fresh start without an error`, async () => {
    const storage = memoryStorage({ [KEY]: raw });
    const coach = await coachOn(storage);

    assert.equal(coach.app.evaluate("state.mode"), "coach");
    assert.equal(coach.app.evaluate("state.coachFlow"), "learn");
    assert.equal(coach.text("coachTargetBig"), ORDER[0]);
  });
}

test("a stored count that is not a number does not mark a letter as shown", async () => {
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ v: 1, flow: "learn", letters: { [ORDER[0]]: { ok: "1", hint: 0, skip: 0 } } }),
  });
  const coach = await coachOn(storage);

  assert.equal(coach.text("coachTargetBig"), ORDER[0]);
});

test("storage that throws keeps progress in memory and says it cannot be kept", async () => {
  const refusing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const coach = await coachOn(refusing);
  assert.ok(coach.text("coachFlowText").endsWith(UNSAVED_NOTE), coach.text("coachFlowText"));

  await coach.startCamera();
  const first = coach.app.evaluate("state.coachTarget");
  await holdTarget(coach);
  await coach.play(coach.app.evaluate("CONFIG.COACH_ADVANCE_MS") + 100);

  assert.equal(coach.text("decisionLabel"), "Bekleniyor", "the coach is waiting on the next target");
  assert.notEqual(coach.app.evaluate("state.coachTarget"), first, "the coach worked on without storage");
});

test("where storage works, the coach says progress stays on this device", async () => {
  const coach = await coachOn(memoryStorage());
  assert.ok(coach.text("coachFlowText").endsWith(SAVED_NOTE), coach.text("coachFlowText"));
});

test("resetting progress offers an undo that brings it back", async () => {
  const before = { v: 1, flow: "learn", letters: { B: { ok: 1, hint: 0, skip: 0 }, L: { ok: 0, hint: 1, skip: 2 } } };
  const storage = memoryStorage({ [KEY]: JSON.stringify(before) });
  const coach = await coachOn(storage);

  coach.app.get("resetCoachProgress")();

  assert.deepEqual(stored(storage).letters, {});
  assert.equal(coach.el("toast").hidden, false);
  assert.equal(coach.text("toastText"), "İlerleme sıfırlandı");
  assert.equal(coach.text("toastAction"), "Geri al");

  // The toast binds its action as onclick, which the harness's dispatch
  // does not run; a browser click would.
  coach.app.evaluate("els.toastAction.onclick()");

  assert.deepEqual(stored(storage), before);
});
