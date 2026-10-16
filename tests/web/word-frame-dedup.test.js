// A word recording takes each MediaPipe result once.
//
// MediaPipe publishes its latest result from its own animation-frame loop,
// and the render loop runs word inference on every frame. When a frame brings
// no new result (the video was not ready, the detection was skipped or threw)
// the render loop reads the same result again. The fault this kills is that
// result being buffered a second time: the 45-frame window then fills with
// repeats, the recording is shorter in time than the user's sign, and the
// motion features see a hand that stood still.
//
// The recording runs through the app's own flow; only ONNX Runtime and the
// MediaPipe results are faked (helpers/word-recording.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { mediaPipeFrame, recordWord, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

/** Run live inference `times` times on MediaPipe frame `t`, as repeated render frames would. */
async function readFrame(app, t, times) {
  const realInference = app.get("realInference");
  app.evaluate(`latestMediaPipeResult = ${JSON.stringify(mediaPipeFrame(t))};`);
  for (let i = 0; i < times; i++) {
    app.evaluate("__clock += 16;");
    await realInference(app.evaluate("__clock"));
  }
}

async function recordingApp() {
  const ctx = wordModeApp({ winner: "book" });
  await ctx.app.get("startWordRecording")();
  assert.equal(ctx.app.evaluate("state.wordState"), "RECORDING", "precondition: recording");
  return ctx;
}

test("one MediaPipe result read on two render frames is recorded once", async () => {
  const { app } = await recordingApp();
  await readFrame(app, 0, 2);
  assert.equal(app.evaluate("state.wordFrames"), 1);

  await readFrame(app, 1, 3);
  assert.equal(app.evaluate("state.wordFrames"), 2, "a new result is recorded, its repeats are not");
});

test("a recording read twice per result sends the model the same window as one read once", async () => {
  const clean = wordModeApp({ winner: "book" });
  await recordWord(clean.app);
  const expected = Array.from(clean.runs.at(-1).input.data);

  const { app, runs } = await recordingApp();
  for (let t = 0; t < RECORDING_FRAMES; t++) await readFrame(app, t, 2);

  assert.equal(app.evaluate("state.wordState"), "RESULT");
  assert.equal(runs.filter((feeds) => feeds.mask).length, clean.runs.filter((feeds) => feeds.mask).length, "one model run for the recording");
  const sent = Array.from(runs.at(-1).input.data);
  assert.equal(sent.length, expected.length);
  assert.ok(
    sent.every((value, i) => Math.abs(value - expected[i]) < 1e-6),
    "the window holds 45 distinct frames in order, not repeats",
  );
});
