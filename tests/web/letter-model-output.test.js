// What the letter caption shows for what the model returned.
//
// The letter graph's probability output reaches the app in several shapes,
// depending on the export and on the ONNX Runtime Web version: a ZipMap
// sequence (an array holding one Map), a single Map, or a plain tensor whose
// data is a Float32Array. Whatever the shape, the person looking at the stage
// must see the most probable letter, the ranked list must run from most to
// least probable, and the letter must be the one the model's own label file
// names for that class index.
//
// A frame goes in through the app's render loop, as the camera would drive it:
// MediaPipe's output is a hand of 21 landmarks, the landmarks become the 93
// letter features, and the features go to the model. ONNX Runtime is the only
// thing replaced, and only at its boundary: the session it hands back returns
// the probabilities. The label file is the real one, served from disk.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const LABEL_FILE = JSON.parse(readFileSync(join(WEB_DIR, "data", "letter_labels.json"), "utf8"));
const CLASSES = Object.keys(LABEL_FILE).length;
/** The model's label for a class index, read from the shipped label file. */
const labelAt = (index) => Object.keys(LABEL_FILE).find((letter) => LABEL_FILE[letter] === index);

// K is class 9, because the alphabet skips J: a label read one class off shows
// a different letter. The runners-up sit away from the start of the list on
// purpose, so a list sorted the wrong way round, or not at all, shows a class
// that is not among the three most probable.
const BEST = { index: 9, probability: 0.55 };
const SECOND = { index: 11, probability: 0.25 };
const THIRD = { index: 1, probability: 0.1 };
const RESIDUE = (1 - BEST.probability - SECOND.probability - THIRD.probability) / (CLASSES - 3);

/** A full probability vector with the three chosen classes standing out. */
function probabilityVector() {
  const probabilities = new Array(CLASSES).fill(RESIDUE);
  for (const { index, probability } of [BEST, SECOND, THIRD]) probabilities[index] = probability;
  return probabilities;
}

// The app runs in its own JavaScript realm, as a page does. The adapter tells
// the shapes apart with instanceof, so what a session hands back must be built
// from that realm's Map and Float32Array, as ONNX Runtime's output is.

/** The three shapes the probability output arrives in. */
const SHAPES = {
  "an array holding one Map (ZipMap)": (p, realm) => [
    new realm.Map(p.map((value, index) => [BigInt(index), value])),
  ],
  "a single Map": (p, realm) => new realm.Map(p.map((value, index) => [index, value])),
  "a tensor with a Float32Array": (p, realm) => ({
    data: realm.Float32Array.from(p),
    dims: [1, CLASSES],
  }),
};

/** A hand of 21 landmarks, wrist at the bottom, fingers fanned upwards. */
function hand() {
  const landmarks = [{ x: 0.5, y: 0.85, z: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    for (let joint = 1; joint <= 4; joint++) {
      landmarks.push({
        x: 0.4 + finger * 0.05 + joint * 0.004 * finger,
        y: 0.8 - joint * 0.1 - finger * 0.01,
        z: -0.01 * joint,
      });
    }
  }
  return landmarks;
}

/**
 * The booted app with a camera that is on, a hand in view, and an ONNX Runtime
 * whose session answers every run with `outputs`. The model has been loaded, as
 * a camera start does, unless `modelLoaded` is false: a frame never asks for it.
 *
 * @param {(call: number, realm: {Map: MapConstructor, Float32Array: Float32ArrayConstructor}) => Record<string, unknown>} outputs
 *   Named session outputs for the nth run (the first run is the load-time
 *   warmup), built from the app's own Map and Float32Array.
 * @param {{modelLoaded?: boolean}} [options]
 */
async function appSeeingAHand(outputs, { modelLoaded = true } = {}) {
  /** Tensors the app fed to the model, in order. */
  const fed = [];
  let realm;
  const app = loadWebApp({
    boot: true,
    globals: {
      console: { ...console, log() {}, warn() {} },
      ort: {
        env: { wasm: {} },
        Tensor: class {
          constructor(type, data, dims) {
            Object.assign(this, { type, data, dims });
          }
        },
        InferenceSession: {
          create: async () => ({
            inputNames: ["input"],
            outputNames: ["label", "probabilities"],
            run: async (feeds) => {
              fed.push(feeds.input);
              return outputs(fed.length, realm);
            },
          }),
        },
      },
    },
  });
  realm = { Map: app.evaluate("Map"), Float32Array: app.evaluate("Float32Array") };
  await app.ready;
  if (modelLoaded) assert.equal(await app.get("ensureLetterModel")(), true);
  // The camera has been started and MediaPipe has published a frame.
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
  return { app, fed };
}

/**
 * Play one render frame and wait. Letters are classified at most every 120 ms,
 * so a second frame needs a later `time`.
 */
async function classifyOneFrame(app, time = 1000) {
  assert.equal(app.runFrame(time), 1, "the render loop must be running");
  await flush();
}

/** The ranked rows on screen as [letter, percent text]. */
function rankedRows(app) {
  // Through JSON, so the rows are arrays of this realm and compare by value.
  return JSON.parse(
    app.evaluate(
      `JSON.stringify(Array.from(els.top3List.children, (row) => [row.children[1].textContent, row.children[3].textContent]))`,
    ),
  );
}

for (const [shape, wrap] of Object.entries(SHAPES)) {
  test(`${shape} shows the most probable letter, ranked highest first`, async () => {
    const { app, fed } = await appSeeingAHand((_call, realm) => ({
      label: { data: BigInt64Array.of(0n) },
      probabilities: wrap(probabilityVector(), realm),
    }));

    await classifyOneFrame(app);

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), labelAt(BEST.index));
    assert.equal(app.evaluate("els.confidenceText.textContent"), "%55");
    assert.deepEqual(rankedRows(app), [
      [labelAt(BEST.index), "%55"],
      [labelAt(SECOND.index), "%25"],
      [labelAt(THIRD.index), "%10"],
    ]);
    // What the model was given is the app's own 93 letter features of the hand,
    // not the warmup's zeros.
    const frame = fed.at(-1);
    assert.deepEqual(Array.from(frame.dims), [1, 93]);
    assert.equal(frame.data.length, 93);
    assert.ok(
      frame.data.some((value) => value !== 0),
      "the hand's features must reach the model",
    );
  });
}

test("the caption is the label file's name for the class, not the class's neighbour", async () => {
  // The best class moves along the whole alphabet; every letter must read
  // back as its own.
  for (const index of [0, 8, 9, 10, 23]) {
    const probabilities = new Array(CLASSES).fill(0.01);
    probabilities[index] = 0.77;
    const { app } = await appSeeingAHand((_call, realm) => ({
      probabilities: [new realm.Map(probabilities.map((value, i) => [i, value]))],
    }));

    await classifyOneFrame(app);

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), labelAt(index), `class ${index}`);
  }
});

test("an output the app cannot read falls back to the label alone, at full confidence", async () => {
  // The label output is the only one left to read: the app shows that letter
  // and says nothing about runners-up it never saw.
  const { app } = await appSeeingAHand(() => ({
    label: { data: BigInt64Array.of(BigInt(BEST.index)) },
    probabilities: "unreadable",
  }));

  await classifyOneFrame(app);

  assert.equal(app.evaluate("els.primaryPrediction.textContent"), labelAt(BEST.index));
  assert.deepEqual(rankedRows(app), [[labelAt(BEST.index), "%100"]]);
});

test("a frame that arrives before the model has loaded is dropped, the next one is classified", async () => {
  const { app, fed } = await appSeeingAHand(
    (_call, realm) => ({ probabilities: [new realm.Map([[BEST.index, 0.9]])] }),
    { modelLoaded: false },
  );

  await classifyOneFrame(app);
  assert.equal(fed.length, 0, "a frame must not start a model download or run a model");
  assert.equal(app.evaluate("els.primaryPrediction.textContent"), "?");

  assert.equal(await app.get("ensureLetterModel")(), true);
  assert.equal(fed.length, 1, "the warmup runs once, with zeros");
  assert.ok(fed[0].data.every((value) => value === 0));
  await classifyOneFrame(app, 2000);

  assert.equal(fed.length, 2);
  assert.equal(app.evaluate("els.primaryPrediction.textContent"), labelAt(BEST.index));
});
