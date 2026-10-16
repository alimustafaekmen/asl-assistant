// How often the live pipeline asks the letter model, on every letter screen.
//
// Letter results are smoothed over a five-frame window, so what the window
// spans depends on how often the model runs. Letter mode runs it at most once
// every 120 ms, so the window is about 600 ms of signing. The coach target
// letter is a letter context too, and must get the same window; a word
// context collects frames, so it must run on every frame.
//
// The first test plays the app's own render loop with the fake camera, hand
// and model, and counts the model runs ONNX Runtime receives. The second
// asks the render loop's decision directly, for the contexts that cannot be
// told apart by a model run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp } from "./helpers/coach-app.mjs";

const PLAYED_MS = 1200;
const LETTER_TICK_MS = 120;

/** Model runs over PLAYED_MS of a hand in view, on the screen of `hash`. */
async function letterRunsOn(hash) {
  const coach = await coachApp({ hash });
  await coach.startCamera();
  assert.equal(coach.app.evaluate("state.cameraOn"), true, "precondition: the camera started");
  coach.show("L", 0.9);
  await coach.play(100);
  const before = coach.ortCalls.letterRuns;
  await coach.play(PLAYED_MS);
  return coach.ortCalls.letterRuns - before;
}

test("a coach target letter is classified on the letter tick, not on every frame", async () => {
  const letterScreen = await letterRunsOn("#letter");
  const coachScreen = await letterRunsOn("#coach");

  const most = Math.ceil(PLAYED_MS / LETTER_TICK_MS);
  assert.ok(letterScreen >= most - 2 && letterScreen <= most, `letter screen: ${letterScreen} runs`);
  assert.ok(coachScreen <= most, `the coach ran the letter model ${coachScreen} times in ${PLAYED_MS} ms`);
  assert.ok(Math.abs(coachScreen - letterScreen) <= 1, `coach ${coachScreen}, letter screen ${letterScreen}`);
});

test("the render loop runs letter contexts on the tick and word contexts every frame", async () => {
  const coach = await coachApp({ hash: "#coach" });
  const { app } = coach;
  const isInferenceDue = app.get("isInferenceDue");
  const due = (mode, target, sinceLastTick) => {
    app.evaluate(`state.mode = ${JSON.stringify(mode)}; state.coachTarget = ${JSON.stringify(target)}; state.lastTick = 5000;`);
    return isInferenceDue(5000 + sinceLastTick);
  };

  assert.equal(due("coach", "L", 60), false, "a coach letter 60 ms after the last tick");
  assert.equal(due("coach", "L", 130), true, "a coach letter 130 ms after the last tick");
  assert.equal(due("letter", "L", 60), false);
  assert.equal(due("letter", "L", 130), true);
  assert.equal(due("coach", "water", 16), true, "a coach word target runs every frame");
  assert.equal(due("word", "L", 16), true, "word mode runs every frame");
});
