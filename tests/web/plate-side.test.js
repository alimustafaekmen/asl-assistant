// The laptop result plate steps aside from a hand, without flickering.
//
// On a laptop the plate lies over the bottom-left of the stage, and a hand
// raised to sign can land under it. It then moves to the bottom-right corner,
// but only after the hand has stayed over it for 500 ms with that corner free,
// and it comes home only after the bottom-left has been clear for 1000 ms;
// two moves are at least 2 s apart. Without the hold a hand at the plate's
// edge would make it jump every frame.
//
// The fakes are the boundaries only: the clock (the frame time), the camera's
// MediaPipe result, the video's size, the layout boxes the browser would
// report, and matchMedia. The decision itself is the app's.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

// The measured 1366x768 stage and a plate of the laptop size, bottom-left.
const STAGE = { width: 942, height: 591 };
const START = { left: 16, top: 439, right: 336, bottom: 575 };
const END = { left: 606, top: 439, right: 926, bottom: 575 };
const OVER_START = { left: 100, top: 380, right: 260, bottom: 560 };
const OVER_END = { left: 700, top: 380, right: 860, bottom: 560 };
const OVER_BOTH = { left: 100, top: 400, right: 860, bottom: 590 };
const ELSEWHERE = { left: 400, top: 100, right: 560, bottom: 300 };

/** Feed one box per 33 ms frame from `from` to `to` and return the state. */
function run(plateSideFor, current, { from, to, hand, frozen = false }) {
  let next = current;
  for (let now = from; now <= to; now += 33) {
    next = plateSideFor(next, { hand: typeof hand === "function" ? hand(now) : hand, start: START, end: END, now, frozen });
  }
  return next;
}

function pure() {
  const app = loadWebApp();
  return { plateSideFor: app.get("plateSideFor"), initial: app.evaluate("initialPlateSide()") };
}

test("a hand over the plate for half a second sends it to the other corner", () => {
  const { plateSideFor, initial } = pure();
  assert.equal(initial.side, "start");

  const moved = run(plateSideFor, initial, { from: 0, to: 540, hand: OVER_START });
  assert.equal(moved.side, "end");
});

test("a hand that only passes over the plate leaves it where it is", () => {
  const { plateSideFor, initial } = pure();

  // One frame, then a hand that keeps crossing the edge every 100 ms: each
  // stay is shorter than the hold, so the plate never moves.
  assert.equal(run(plateSideFor, initial, { from: 0, to: 0, hand: OVER_START }).side, "start");
  const flicker = run(plateSideFor, initial, {
    from: 0,
    to: 3000,
    hand: (now) => (Math.floor(now / 100) % 2 === 0 ? OVER_START : ELSEWHERE),
  });
  assert.equal(flicker.side, "start");
  // Just short of the hold.
  assert.equal(run(plateSideFor, initial, { from: 0, to: 460, hand: OVER_START }).side, "start");
});

test("a hand over both corners leaves the plate in place, as there is nowhere better", () => {
  const { plateSideFor, initial } = pure();

  assert.equal(run(plateSideFor, initial, { from: 0, to: 2000, hand: OVER_BOTH }).side, "start");
});

test("the plate comes home only after its corner has been clear for a second", () => {
  const { plateSideFor, initial } = pure();
  const moved = run(plateSideFor, initial, { from: 0, to: 540, hand: OVER_START });
  assert.equal(moved.side, "end");

  // The hand drops at 2.6 s, after the two-second spacing between moves.
  const soon = run(plateSideFor, moved, { from: 2600, to: 3500, hand: null });
  assert.equal(soon.side, "end", "900 ms clear is not yet enough");
  const later = run(plateSideFor, soon, { from: 3533, to: 3700, hand: null });
  assert.equal(later.side, "start");
});

test("two moves are at least two seconds apart", () => {
  const { plateSideFor, initial } = pure();
  const moved = run(plateSideFor, initial, { from: 0, to: 540, hand: OVER_START });

  // The hand goes straight to the new corner; the bottom-left is clear at
  // once, yet the plate stays until two seconds after its move.
  const early = run(plateSideFor, moved, { from: 573, to: 1900, hand: OVER_END });
  assert.equal(early.side, "end");
  const back = run(plateSideFor, early, { from: 1933, to: 2700, hand: OVER_END });
  assert.equal(back.side, "start");
});

test("while a word is being recorded the plate does not move", () => {
  const { plateSideFor, initial } = pure();

  assert.equal(run(plateSideFor, initial, { from: 0, to: 2000, hand: OVER_START, frozen: true }).side, "start");
});

test("a right hand low in the camera frame lands bottom-left on the mirrored stage", () => {
  const app = loadWebApp();
  const handBoxOnStage = app.get("handBoxOnStage");
  // MediaPipe reports the unmirrored frame; the visitor's right hand is on
  // the frame's right, so the mirror shows it on the left.
  const hand = [];
  for (let i = 0; i < 21; i += 1) hand.push({ x: 0.8 + (i % 5) * 0.03, y: 0.7 + Math.floor(i / 5) * 0.05, z: 0 });
  const result = { rightHandLandmarks: [hand], leftHandLandmarks: null };
  const box = handBoxOnStage(result, STAGE.width, STAGE.height, { videoWidth: 1280, videoHeight: 720 });

  // A 16:9 frame covers the 942x591 stage with its height: x is cropped by
  // about 54 px on each side, y is not.
  assert.ok(box.left > 0 && box.right < STAGE.width / 2, `box at x ${box.left}..${box.right}`);
  assert.ok(Math.abs(box.top - 0.7 * STAGE.height) < 1, `top ${box.top}`);
  assert.ok(Math.abs(box.bottom - 0.9 * STAGE.height) < 1, `bottom ${box.bottom}`);
  assert.equal(handBoxOnStage({ rightHandLandmarks: null, leftHandLandmarks: null }, 942, 591, null), null);
});

/** The app with the camera on, a laptop window and the layout boxes given. */
function liveApp({ laptop = true } = {}) {
  const app = loadWebApp({
    globals: {
      matchMedia: (query) => ({
        media: String(query),
        matches: laptop && /min-width:\s*64rem/.test(String(query)),
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }),
    },
  });
  app.evaluate(`(() => {
    state.cameraOn = true;
    els.video.videoWidth = 1280;
    els.video.videoHeight = 720;
    els.cameraStage.getBoundingClientRect = () => ({ left: 24, top: 81, right: 966, bottom: 672, width: 942, height: 591 });
    els.resultPlate.getBoundingClientRect = () => ({ left: 40, top: 520, right: 360, bottom: 656, width: 320, height: 136 });
  })()`);
  // A right hand low in the frame: bottom-left on the mirrored stage.
  const hand = [];
  for (let i = 0; i < 21; i += 1) hand.push({ x: 0.75 + (i % 5) * 0.03, y: 0.72 + Math.floor(i / 5) * 0.05, z: 0 });
  app.evaluate(`latestMediaPipeResult = ${JSON.stringify({ rightHandLandmarks: [hand], leftHandLandmarks: null })};`);
  return app;
}

function frames(app, from, to) {
  const update = app.get("updatePlateSide");
  for (let now = from; now <= to; now += 33) update(now);
}

test("on a laptop the live loop moves the plate off the hand, and a stop brings it home", () => {
  const app = liveApp();
  frames(app, 0, 600);
  assert.equal(app.evaluate("els.cameraStage.dataset.plateSide"), "end");

  app.get("stopCamera")();
  frames(app, 700, 800);
  assert.equal(app.evaluate("els.cameraStage.dataset.plateSide"), "start");
});

test("on a phone the plate stays where the layout puts it", () => {
  const app = liveApp({ laptop: false });
  frames(app, 0, 1500);
  assert.notEqual(app.evaluate("els.cameraStage.dataset.plateSide"), "end");
});
