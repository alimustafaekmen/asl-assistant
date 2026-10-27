// A failure that lasts is reported, not repeated on every frame.
//
// Letter frames are classified about eight times a second. When the model
// run keeps throwing, or its output keeps being unreadable, a frame that logs
// its warning again, from the adapter and once more from the inference loop,
// writes two lines a frame, about a thousand a minute. That buries everything
// else in the console a person would open to find out why the letters
// stopped. The fault this file kills is that flood. The first failing
// frame must still be reported with its reason, and a frame that works must
// re-arm the report, so a new failure later is seen at once.
//
// Frames go in through the render loop with a hand in view; the console and
// ONNX Runtime are replaced at their boundaries.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";

const FRAMES = 300;
// A bound well above the first report of each cause, and far below one line
// a frame: at most one line per twenty failing frames, whatever the causes.
const MOST_LINES = FRAMES / 20;
const RUN_ERROR = "the model run failed in the test";

/** A hand of 21 landmarks, wrist at the bottom, fingers fanned upwards. */
function hand() {
  const landmarks = [{ x: 0.5, y: 0.85, z: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    for (let joint = 1; joint <= 4; joint++) {
      landmarks.push({ x: 0.4 + finger * 0.05 + joint * 0.004 * finger, y: 0.8 - joint * 0.1 - finger * 0.01, z: -0.01 * joint });
    }
  }
  return landmarks;
}

/**
 * The booted app with the letter model loaded, the camera on and a hand in
 * view, and a console that records its warnings and errors. `setup` runs in
 * the app's realm after the fake ORT is installed and before the model loads.
 * The lines logged while loading are dropped, so `lines` holds what the
 * frames logged.
 *
 * @param {string} setup
 */
async function letterApp(setup) {
  /** @type {{level: string, text: string}[]} */
  const lines = [];
  const record = (level) => (...args) => lines.push({ level, text: args.map(String).join(" ") });
  const fakeConsole = { ...console, log() {}, info() {}, debug() {}, warn: record("warn"), error: record("error") };
  const app = await appWithFakeOrt({ boot: true, globals: { console: fakeConsole } });
  app.evaluate(setup);
  assert.equal(await app.get("ensureLetterModel")(), true);
  app.evaluate(`
    state.cameraOn = true;
    latestMediaPipeResult = {
      rightHandLandmarks: ${JSON.stringify(hand())},
      leftHandLandmarks: null,
      poseLandmarks: null,
      faceLandmarks: null,
      timestamp: 1,
    };
  `);
  lines.length = 0;
  let time = 1000;
  /** Play `count` letter frames, each one classified. */
  const play = async (count) => {
    for (let i = 0; i < count; i++) {
      assert.equal(app.runFrame(time), 1, "the render loop must be running");
      time += 200;
      await flush();
    }
  };
  return { app, lines, play };
}

const runs = (app) => app.evaluate("__ort.runs");

test("a model run that keeps failing is reported with its reason, then not on every frame", async () => {
  const { app, lines, play } = await letterApp(`__ort.failRun = () => true;`);

  await play(1);
  assert.ok(
    lines.some(({ text }) => text.includes(RUN_ERROR)),
    "the first failing frame must say why it failed",
  );

  await play(FRAMES - 1);
  assert.equal(runs(app), FRAMES, "every frame must still try the model");
  assert.ok(lines.length <= MOST_LINES, `${lines.length} lines for ${FRAMES} failing frames`);
});

test("an output read as the label alone is reported, then not on every frame", async () => {
  const V = LETTER_LABELS.indexOf("V");
  const { app, lines, play } = await letterApp(`
    __ort.chosen = ${V};
    __ort.letterProbabilities = () => "unreadable";
  `);

  await play(1);
  assert.ok(lines.length > 0, "the first frame read as the label alone must be reported");

  await play(FRAMES - 1);
  assert.ok(lines.length <= MOST_LINES, `${lines.length} lines for ${FRAMES} label-only frames`);
  // The frames themselves still work: the label is shown, as the only result.
  assert.equal(app.evaluate("els.primaryPrediction.textContent"), "V");
  assert.equal(app.evaluate("els.confidenceText.textContent"), "%100");
});

for (const [why, setup] of [
  ["names no class", `__ort.chosen = 99; __ort.letterProbabilities = () => "unreadable";`],
  [
    "run throws",
    // Each frame runs twice: the full run, whose probabilities are
    // unreadable, and the label-only run, which throws.
    `__ort.letterProbabilities = () => "unreadable"; __ort.failRun = (n) => n % 2 === 0;`,
  ],
]) {
  test(`a label-only fallback that ${why} on every frame is reported, then not on every frame`, async () => {
    const { lines, play } = await letterApp(setup);

    await play(1);
    assert.ok(lines.length > 0, "the first failing frame must be reported");

    await play(FRAMES - 1);
    assert.ok(lines.length <= MOST_LINES, `${lines.length} lines for ${FRAMES} failing frames`);
  });
}

test("a frame that works re-arms the report, so the next failure is seen at once", async () => {
  // Frames 1 to 5 fail, frame 6 works, frames 7 to 9 fail again.
  const { app, lines, play } = await letterApp(`__ort.failRun = (n) => n !== 6;`);

  await play(1);
  const firstFailure = lines.map(({ text }) => text);
  await play(4);
  const firstRun = lines.length;
  assert.equal(
    lines.filter(({ text }) => text.includes(RUN_ERROR)).length,
    1,
    "five failing frames in a row report the failure once",
  );

  await play(1);
  assert.equal(lines.length, firstRun, "a frame that works logs no warning");
  assert.notEqual(app.evaluate("els.primaryPrediction.textContent"), "?", "the working frame is shown");

  await play(1);
  assert.equal(
    lines.filter(({ text }) => text.includes(RUN_ERROR)).length,
    2,
    "the first failure after a working frame is reported again",
  );
  assert.deepEqual(
    lines.slice(firstRun).map(({ text }) => text),
    firstFailure,
    "it is reported as the first failure was, by every part that reported that one",
  );

  await play(2);
  assert.equal(lines.filter(({ text }) => text.includes(RUN_ERROR)).length, 2);
});
