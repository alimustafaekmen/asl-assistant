// A hand tracker that stops working must not leave its last hand behind.
//
// MediaPipe's detectForVideo throws when its runtime breaks under it, most
// often a lost GPU context, and then keeps throwing. The fault these tests
// kill is the frozen hand: the last frame that worked stays published, so
// the badge keeps saying a hand is there, letter inference keeps scoring a
// perfectly still hand, and the coach can count a hold nobody is making. A
// failed frame has to reach the app as a frame in which nothing was found,
// and one warning per frame (sixty a second) must not bury the console.
//
// The camera, the MediaPipe import and ONNX Runtime are faked by
// helpers/coach-app.mjs; the hand task it hands out is wrapped here so it can
// start and stop throwing, as a broken runtime does. Everything else is the
// booted app, driven through its own controls.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FRAME_MS, coachApp } from "./helpers/coach-app.mjs";

const quiet = { ...console, log() {}, info() {}, error() {} };

/**
 * The booted app on `hash` whose hand task throws while `broken.on` is set.
 * Every console.warn is kept, as text, in `warnings`.
 */
async function appWithBreakableTracker(hash) {
  const warnings = [];
  const coach = await coachApp({
    hash,
    globals: { console: { ...quiet, warn: (...args) => warnings.push(args.map(String).join(" ")) } },
  });
  const broken = { on: false };
  const vision = coach.app.evaluate("__vision");
  const create = vision.HandLandmarker.createFromOptions;
  vision.HandLandmarker.createFromOptions = async (...args) => {
    const task = await create(...args);
    return {
      detectForVideo(...frame) {
        if (broken.on) throw new Error("WebGL context lost");
        return task.detectForVideo(...frame);
      },
      close: () => task.close(),
    };
  };
  return { ...coach, broken, warnings };
}

/** Whether the frame the camera module last published has a hand in it. */
const publishedHand = (coach) =>
  coach.app.evaluate("Boolean(latestMediaPipeResult?.rightHandLandmarks || latestMediaPipeResult?.leftHandLandmarks)");

/** The badge refreshes once a second; this is long enough for two refreshes. */
const BADGE_MS = 2100;

test("a tracker that keeps failing leaves no hand behind", async () => {
  const coach = await appWithBreakableTracker("#letter");
  await coach.startCamera();
  coach.show("L", 0.9);
  await coach.play(BADGE_MS);
  assert.equal(coach.text("latencyBadge"), "El algılandı", "precondition: the hand is tracked");
  assert.equal(publishedHand(coach), true, "precondition: the hand is published");

  coach.broken.on = true;
  await coach.play(BADGE_MS);

  assert.equal(publishedHand(coach), false, "the last good hand is still published after the tracker broke");
  assert.equal(coach.text("latencyBadge"), "El aranıyor", "the badge still says a hand is detected");
});

test("a tracker that recovers tracks the hand again", async () => {
  const coach = await appWithBreakableTracker("#letter");
  await coach.startCamera();
  coach.show("L", 0.9);
  coach.broken.on = true;
  await coach.play(BADGE_MS);
  assert.equal(publishedHand(coach), false, "precondition: nothing is tracked while it fails");

  coach.broken.on = false;
  await coach.play(BADGE_MS);

  assert.equal(publishedHand(coach), true, "a failure kept the hand away after detection recovered");
  assert.equal(coach.text("latencyBadge"), "El algılandı");
});

test("a coach hold cannot be completed on the frame a broken tracker left behind", async () => {
  const coach = await appWithBreakableTracker("#coach");
  coach.click(coach.app.evaluate(`document.querySelector('[data-coach-flow="practice"]')`));
  const select = coach.el("coachTarget");
  select.value = "L";
  select.dispatchEvent({ type: "change" });
  assert.equal(coach.app.evaluate("state.coachTarget"), "L", "precondition: the target is chosen");
  await coach.startCamera();
  const holdMs = coach.app.evaluate("CONFIG.COACH_HOLD_MS");

  // A hold has begun, well short of its time, when the tracker breaks.
  coach.show("L", 0.9);
  await coach.play(300);
  assert.equal(Number(coach.text("coachScore").split("/")[0]), 0, "precondition: nothing counted yet");
  coach.broken.on = true;
  await coach.play(holdMs * 3);

  assert.equal(Number(coach.text("coachScore").split("/")[0]), 0, "a frozen frame completed the hold");
  assert.equal(coach.app.evaluate("state.coachStep"), 0);
});

test("a tracker failing on every frame is reported, not once per frame", async () => {
  const coach = await appWithBreakableTracker("#letter");
  await coach.startCamera();
  coach.show("L", 0.9);
  await coach.play(500);
  const before = coach.warnings.length;

  coach.broken.on = true;
  await coach.play(600 * FRAME_MS);
  const duringFailure = coach.warnings.slice(before);

  assert.ok(duringFailure.length >= 1, "the failure was never reported");
  assert.match(duringFailure[0], /WebGL context lost/, "the first report carries the error");
  assert.ok(duringFailure.length <= 5, `600 failed frames gave ${duringFailure.length} warnings`);

  // A tracker that recovers and breaks again is reported again.
  coach.broken.on = false;
  await coach.play(500);
  const afterRecovery = coach.warnings.length;
  coach.broken.on = true;
  await coach.play(5 * FRAME_MS);
  assert.ok(coach.warnings.length > afterRecovery, "a new failure after a recovery went unreported");
});
