// The camera-free demo plays a recorded hand through the live letter pipeline.
//
// A visitor without a camera watches the letter screen read a recorded hand.
// The demo is only a frame source: it publishes the recorded landmarks where
// the camera's frames go, and the render loop, the overlay, live inference,
// the smoother and the plate do the rest, unchanged. What these tests pin:
//
// - the published frame is the recorded right hand, held with a small
//   wobble, about 20 times a second, with increasing timestamps;
// - the recording is a square image, so the letter model gets the features
//   of that hand with aspect 1, whatever size the hidden camera video last
//   reported (a camera session before the demo leaves one behind);
// - the plate shows the letter the model read;
// - the overlay draws the hand as a square, unstretched and smaller than the
//   stage, since there is no video behind it, centred across the stage and
//   in the room the demo's card and the plate leave over it;
// - the recording and the letter model load on first use, and neither the
//   camera nor MediaPipe is asked for.
//
// The faults these kill: the demo reading the video's aspect (a squeezed
// hand), the inference gate left on the camera alone (nothing is read), the
// overlay mapping the square onto the whole stage (a stretched hand) or
// drawing it under the card or the plate, an unseeded wobble, and a demo that
// fetches its recording at page load, opens the camera or downloads
// MediaPipe.

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoApp, demoRecording } from "./helpers/demo-app.mjs";

const RECORDING = demoRecording("FLY");

test("the demo publishes the recorded right hand, held, about 20 times a second", async () => {
  const demo = await demoApp();
  await demo.start();

  assert.equal(demo.publishedLetter(), "F", "the first letter's hand is published");
  const frame = demo.app.evaluate("latestMediaPipeResult");
  assert.equal(frame.leftHandLandmarks, null, "only the right hand");
  assert.equal(frame.rightHandLandmarks.length, 1, "one hand");

  const stamps = [];
  const hands = [];
  for (let i = 0; i < 40; i++) {
    await demo.play(25, 25);
    const latest = demo.app.evaluate("latestMediaPipeResult");
    if (stamps.at(-1) !== latest.timestamp) {
      stamps.push(latest.timestamp);
      hands.push(demo.publishedHand());
    }
  }
  assert.ok(stamps.length >= 18 && stamps.length <= 22, `about 20 frames in a second, got ${stamps.length}`);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] > stamps[i - 1], "timestamps increase");

  // Held, not frozen: the points move a little from frame to frame, and never
  // far from the recording.
  const recorded = RECORDING.letters[0].landmarks;
  let moved = false;
  for (const hand of hands) {
    for (let p = 0; p < 21; p++) {
      assert.ok(Math.abs(hand[p][0] - recorded[p][0]) < 0.005, "x stays within half a percent of the frame");
      assert.ok(Math.abs(hand[p][1] - recorded[p][1]) < 0.005, "y stays within half a percent of the frame");
      if (hand[p][0] !== hands[0][p][0] || hand[p][1] !== hands[0][p][1]) moved = true;
    }
  }
  assert.ok(moved, "the hand wobbles a little, as a held hand does");
});

test("the wobble is the same on every run", async () => {
  const runs = [];
  for (let run = 0; run < 2; run++) {
    const demo = await demoApp();
    await demo.start();
    const hands = [];
    for (let i = 0; i < 5; i++) {
      await demo.play(50, 50);
      hands.push(demo.publishedHand());
    }
    runs.push(hands);
  }
  assert.deepEqual(runs[0], runs[1]);
});

test("the letter model gets the recorded hand's features with aspect 1, not the hidden video's", async () => {
  const demo = await demoApp();
  // A camera session before the demo leaves the video reporting its size.
  demo.app.evaluate("els.video.videoWidth = 1280; els.video.videoHeight = 720;");
  await demo.start();
  const feeds = () => demo.app.evaluate("__ort.feeds").filter((feed) => !feed.input.data.every((value) => value === 0));
  assert.equal(feeds().length, 0, "precondition: nothing has been read yet");

  // One step past the letter throttle: the demo publishes its frames, then
  // one browser frame reads the latest of them. Nothing is published after
  // it, so latestMediaPipeResult below is the frame that was read.
  await demo.play(130, 130);
  const fed = feeds();
  assert.equal(fed.length, 1, "the demo frame reaches the letter model once");
  const input = Array.from(fed[0].input.data);
  assert.equal(input.length, 93);

  const featuresAt = (aspect) =>
    demo.app.evaluate(`(() => {
      resetLetterLandmarkSmoother();
      return Array.from(computeLetterFeatures(landmarksTo321D(latestMediaPipeResult), ${aspect}));
    })()`);
  const square = featuresAt(1);
  const video = featuresAt(1280 / 720);
  const worst = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
  assert.ok(worst(input, square) < 1e-6, `the input is the square-frame features (off by ${worst(input, square)})`);
  assert.ok(worst(input, video) > 1e-3, "control: the video's aspect would have given other features");
});

test("the plate shows the letter the model reads from the recorded hand", async () => {
  const demo = await demoApp();
  await demo.start();
  await demo.play(600);
  assert.equal(demo.plate(), "F");
});

test("the overlay draws the hand letterboxed, unstretched and smaller than the stage", async () => {
  const demo = await demoApp();
  demo.app.evaluate("globalThis.__arcs = []; ctx.arc = (x, y) => __arcs.push([x, y]);");
  await demo.start();
  demo.app.evaluate("__arcs.length = 0");
  demo.app.runFrame(demo.clock.now);

  const frame = demo.publishedHand();
  // Each point is drawn twice, a halo and a core, at the same place.
  const arcs = demo.app.evaluate("__arcs.slice()");
  assert.equal(arcs.length, 42, "the 21 points of one hand, halo and core");
  const drawn = arcs.slice(21);

  // The stage is 800 by 600. A square image shown whole and centred maps
  // (0.5, 0.5) to the middle and scales both axes by the same side; the
  // overlay mirrors x, as it does for the camera.
  const scales = { x: [], y: [] };
  frame.forEach(([x, y], i) => {
    if (Math.abs(x - 0.5) > 0.05) scales.x.push((400 - drawn[i][0]) / (x - 0.5));
    if (Math.abs(y - 0.5) > 0.05) scales.y.push((drawn[i][1] - 300) / (y - 0.5));
  });
  const side = scales.x[0];
  for (const s of [...scales.x, ...scales.y]) {
    assert.ok(Math.abs(s - side) < 0.5, `both axes share one scale: ${s} against ${side}`);
  }
  assert.ok(side <= 0.8 * 600, `the square (${side}px) leaves room around the hand`);
  assert.ok(side >= 0.4 * 600, `the square (${side}px) is still a hand-sized picture`);
});

test("the recording and the letter model load on first use, and no camera or MediaPipe is asked for", async () => {
  const demo = await demoApp();
  assert.equal(demo.demoRequests.length, 0, "the page load does not fetch the recording");
  assert.equal(demo.app.evaluate("__ort.created"), 0, "the page load does not load the letter model");

  await demo.start();
  await demo.play(400);
  assert.equal(demo.demoRequests.length, 1, "the first start fetches the recording");
  assert.equal(demo.app.evaluate("__ort.created"), 1, "and loads the letter model");
  assert.equal(demo.camera.requests, 0, "the camera is never asked for");
  assert.equal(demo.camera.imports, 0, "MediaPipe is never downloaded");

  demo.click(demo.byId("demoStop"));
  await demo.start();
  assert.equal(demo.demoRequests.length, 1, "a second start reuses the recording");
  assert.equal(demo.publishedLetter(), "F");
});

/**
 * The square the overlay drew the published hand in, solved from two of its
 * points: the overlay maps a point to (width - (x0 + x * side), y0 + y * side).
 */
function drawnSquare(demo, width) {
  const hand = demo.publishedHand();
  const drawn = demo.app.evaluate("__arcs.slice(21)");
  let a = 0;
  let b = 0;
  for (let i = 0; i < hand.length; i++) {
    if (hand[i][1] < hand[a][1]) a = i;
    if (hand[i][1] > hand[b][1]) b = i;
  }
  const side = (drawn[b][1] - drawn[a][1]) / (hand[b][1] - hand[a][1]);
  const y0 = drawn[a][1] - hand[a][1] * side;
  const x0 = width - drawn[a][0] - hand[a][0] * side;
  return { x0, y0, side };
}

test("the hand is drawn in the room the demo's card and the plate leave on the stage", async () => {
  const demo = await demoApp();
  demo.app.evaluate("globalThis.__arcs = []; ctx.arc = (x, y) => __arcs.push([x, y]);");
  await demo.start();
  // Layout is the browser's. On an upright phone the card lies over the top
  // of the stage and the plate over its bottom; the stage is 800 by 600.
  demo.app.evaluate(`
    els.demoPanel.getBoundingClientRect = () => ({ left: 12, right: 788, top: 12, bottom: 200, width: 776, height: 188 });
    els.resultPlate.getBoundingClientRect = () => ({ left: 12, right: 788, top: 520, bottom: 588, width: 776, height: 68 });
    __arcs.length = 0;
  `);
  demo.app.runFrame(demo.clock.now);
  const square = drawnSquare(demo, 800);
  assert.ok(square.y0 >= 200 - 0.5, `the square starts below the card (at ${square.y0})`);
  assert.ok(square.y0 + square.side <= 520 + 0.5, `and ends above the plate (at ${square.y0 + square.side})`);
  assert.ok(square.side >= 0.4 * 600, `as large as that room allows (${square.side}px)`);
  assert.ok(Math.abs(square.x0 + square.side / 2 - 400) < 0.5, "centred across the stage");

  // Beside the stage, as on a phone held sideways, the plate takes no room.
  demo.app.evaluate(`
    els.resultPlate.getBoundingClientRect = () => ({ left: 812, right: 1100, top: 72, bottom: 190, width: 288, height: 118 });
    __arcs.length = 0;
  `);
  demo.app.runFrame(demo.clock.now);
  const beside = drawnSquare(demo, 800);
  assert.ok(beside.y0 >= 200 - 0.5, "still below the card");
  assert.ok(beside.y0 + beside.side > 520 + 1, `and free to use the stage's bottom (to ${beside.y0 + beside.side})`);
});
