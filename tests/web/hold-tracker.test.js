// The hold detector: a letter counts when it is held, not when a button is pressed.
//
// The coach scores a letter by watching the learner hold it, so the detector
// decides what one success is. It is fed the smoothed prediction and a time
// in milliseconds, and its contract is about time: the target held steadily
// for the hold time succeeds, once; a short dip in confidence pauses the hold
// instead of punishing it; a different letter or a lost hand starts it over;
// and after a success the same pose counts again only after it is released.
// None of that may depend on how often it is asked, because inference runs
// at a different rate on every device.
//
// The detector is pure, so the test calls it with plain numbers; the timings
// are passed in, so the contract does not move when CONFIG is tuned.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const TIMINGS = { holdMs: 1000, minConfidence: 0.65, graceMs: 240, releaseMs: 400 };
const TICK = 120;

/** A fresh tracker and a way to feed it one observation of the target "L". */
function tracker(timings = TIMINGS) {
  const app = loadWebApp();
  const hold = app.get("createHoldTracker")(timings);
  /** @param {number} now @param {{label?: string, confidence?: number, handPresent?: boolean}} [seen] */
  const see = (now, { label = "L", confidence = 0.8, handPresent = true } = {}) => {
    // Copied out of the vm realm so the fields compare as plain values.
    const { phase, progress, heldLabel } = hold.update({ label, confidence, handPresent }, "L", now);
    return { phase, progress, heldLabel };
  };
  return { hold, see };
}

/** Feed the target on a fixed tick from `from` to `to` inclusive; return every status. */
function holdSteadily(see, from, to, step = TICK, seen = {}) {
  const statuses = [];
  for (let now = from; now <= to; now += step) statuses.push({ now, ...see(now, seen) });
  return statuses;
}

test("a target held steadily succeeds once the hold time has passed, not before", () => {
  const { see } = tracker();

  const statuses = holdSteadily(see, 0, 1080);
  const at = (now) => statuses.find((status) => status.now === now);

  assert.equal(at(0).phase, "holding");
  assert.equal(at(960).phase, "holding", "960 ms is short of the 1000 ms hold");
  assert.ok(at(960).progress > 0.9 && at(960).progress < 1, `progress at 960 ms: ${at(960).progress}`);
  assert.equal(at(1080).phase, "done");
  assert.equal(at(1080).progress, 1);
  assert.equal(at(1080).heldLabel, "L");
  assert.equal(statuses.filter((status) => status.phase === "done").length, 1);
});

test("the hold takes the same time at any update rate", () => {
  // 60 Hz frames, the 120 ms letter inference tick, and a slow 8 Hz device.
  for (const step of [16, TICK, 125]) {
    const { see } = tracker();
    const statuses = holdSteadily(see, 0, 3000, step);
    const done = statuses.find((status) => status.phase === "done");
    assert.ok(done, `no success at a ${step} ms step`);
    assert.ok(
      done.now >= TIMINGS.holdMs && done.now < TIMINGS.holdMs + step,
      `at a ${step} ms step the hold completed at ${done.now} ms`,
    );
  }
});

test("a hold needs the target at or above the minimum confidence", () => {
  const { see } = tracker();

  const statuses = holdSteadily(see, 0, 3000, TICK, { confidence: TIMINGS.minConfidence - 0.01 });

  assert.ok(statuses.every((status) => status.phase === "idle" && status.progress === 0));
  assert.equal(see(3120, { confidence: TIMINGS.minConfidence }).phase, "holding");
});

test("a different letter starts the hold over at once", () => {
  const { see } = tracker();
  holdSteadily(see, 0, 600);

  const other = see(720, { label: "K", confidence: 0.9 });
  assert.equal(other.phase, "idle");
  assert.equal(other.progress, 0);
  assert.equal(other.heldLabel, null);

  // The full hold time is needed again from the next sight of the target.
  const again = holdSteadily(see, 840, 2000);
  const done = again.find((status) => status.phase === "done");
  assert.equal(done.now, 840 + 1080);
});

test("one tick below the minimum within the grace pauses the hold; a longer dip starts it over", () => {
  const dip = { confidence: TIMINGS.minConfidence - 0.1 };

  // One low tick: the progress made before it is kept, not lost.
  const short = tracker();
  holdSteadily(short.see, 0, 360);
  const before = short.see(360);
  const during = short.see(480, dip);
  const after = short.see(600);
  assert.equal(during.phase, "holding", "a dip inside the grace is still a hold");
  assert.ok(after.progress > 0, "the hold kept its progress across the dip");
  assert.equal(after.progress, before.progress, "the dip itself did not count as holding");

  // Two low ticks: longer than the grace, so the hold starts again.
  const long = tracker();
  holdSteadily(long.see, 0, 360);
  long.see(480, dip);
  long.see(600, dip);
  const restarted = long.see(720);
  assert.equal(restarted.phase, "holding");
  assert.equal(restarted.progress, 0, "a dip longer than the grace loses the progress");
});

test("a lost hand starts the hold over at once, with no grace", () => {
  const { see } = tracker();
  holdSteadily(see, 0, 360);

  const lost = see(480, { handPresent: false });
  assert.equal(lost.phase, "idle");
  assert.equal(lost.progress, 0);

  const back = see(600);
  assert.equal(back.progress, 0, "the hand coming back within the grace does not resume the hold");
});

test("after a success the same pose stays blocked until it is released", () => {
  const { see } = tracker();
  holdSteadily(see, 0, 1080);

  // Holding on never counts a second time.
  const held = holdSteadily(see, 1200, 4000);
  assert.ok(held.every((status) => status.phase === "blocked"), "a held pose counted again");
  assert.ok(held.every((status) => status.progress === 1));

  // A low-confidence sight of the target is not a release either.
  assert.equal(see(4120, { confidence: 0.3 }).phase, "blocked");

  // A different letter for less than the release time, then the target: still blocked.
  see(4240, { label: "K" });
  see(4360, { label: "K" });
  assert.equal(see(4480).phase, "blocked", "360 ms away is not a release");

  // A different letter for the release time releases it; a new hold may begin.
  see(4600, { label: "K" });
  see(4720, { label: "K" });
  see(4840, { label: "K" });
  const released = see(5080, { label: "K" });
  assert.equal(released.phase, "idle", "480 ms away is a release");
  const again = holdSteadily(see, 5200, 7000);
  assert.equal(again.filter((status) => status.phase === "done").length, 1, "the next hold counts once");
});

test("a lost hand releases a completed hold at once", () => {
  const { see } = tracker();
  holdSteadily(see, 0, 1080);
  assert.equal(see(1200).phase, "blocked");

  assert.equal(see(1320, { handPresent: false }).phase, "idle");
  const again = holdSteadily(see, 1440, 3000);
  assert.equal(again.find((status) => status.phase === "done").now, 1440 + 1080);
});

test("reset forgets a hold in progress and a completed one", () => {
  const { hold, see } = tracker();
  holdSteadily(see, 0, 600);
  hold.reset();
  assert.equal(see(720).progress, 0, "a hold in progress is forgotten");

  holdSteadily(see, 840, 1920);
  assert.equal(see(2040).phase, "blocked");
  hold.reset();
  assert.equal(see(2160).phase, "holding", "a completed hold no longer blocks");
});
