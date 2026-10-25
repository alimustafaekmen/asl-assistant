// The overlay canvas is left alone while nothing is on it.
//
// Clearing a canvas marks it changed, so a render loop that clears an empty
// overlay on every animation frame makes the browser composite a new frame at
// the display rate while a visitor only reads the page. The overlay is
// drawn while frames are live (the camera or the demo), cleared once when they
// stop, and then not touched until frames come back.
//
// Drawing is the browser boundary: the context's clearRect and arc calls are
// counted. The booted letter screen runs its own render loop; the camera,
// MediaPipe and ONNX Runtime are faked by helpers/coach-app.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp } from "./helpers/coach-app.mjs";

/** The booted letter screen with the overlay's clears and dots counted. */
async function countedLetterScreen() {
  const coach = await coachApp({
    hash: "#letter",
    // The overlay reads its colours from the stylesheet; there is none here.
    globals: { getComputedStyle: () => ({ getPropertyValue: () => "" }) },
  });
  const counts = { clears: 0, dots: 0 };
  const ctx = coach.app.evaluate("ctx");
  ctx.clearRect = () => void (counts.clears += 1);
  ctx.arc = () => void (counts.dots += 1);
  /** Counts since the previous call. */
  const take = () => {
    const taken = { ...counts };
    counts.clears = 0;
    counts.dots = 0;
    return taken;
  };
  return { coach, take };
}

test("the idle letter screen does not redraw the overlay", async () => {
  const { coach, take } = await countedLetterScreen();
  await coach.play(20 * 16);
  assert.equal(coach.app.pendingFrames(), 1, "precondition: the render loop is running");
  assert.ok(take().clears <= 1, "an empty overlay is not cleared on every frame");
});

test("the camera draws the hand on every frame and the stop clears it once", async () => {
  const { coach, take } = await countedLetterScreen();
  await coach.startCamera();
  await coach.play(10 * 16);
  const live = take();
  assert.ok(live.dots > 0, "the hand is drawn while the camera is on");
  assert.ok(live.clears >= 10, "each live frame starts from a clean overlay");

  coach.app.get("stopCamera")();
  await coach.play(20 * 16);
  const after = take();
  assert.equal(after.dots, 0, "nothing is drawn once the camera is off");
  assert.equal(after.clears, 1, "the last hand is cleared once, then the overlay is left alone");
});
