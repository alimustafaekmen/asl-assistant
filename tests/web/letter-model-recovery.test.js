// One failed letter-model run costs one frame, not the rest of the session.
//
// The label-only path exists for exports whose probability output the app
// cannot read; it reports every letter at full confidence, because it has
// nothing else to say. A run that throws once (a WASM hiccup, a run during
// warmup) is not that: the model still returns its probabilities on the next
// frame, and the stage must show them. The fault this kills is a single
// thrown run switching the session to label-only for good, so that a letter
// the model gives 55 % is shown at 100 % and clears the append threshold.
//
// A frame goes in through the app's render loop with a hand in view; ONNX
// Runtime is replaced only at its boundary, by a session that throws on one
// chosen run and answers every other run with real probabilities.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";

const LABEL_FILE = JSON.parse(readFileSync(join(WEB_DIR, "data", "letter_labels.json"), "utf8"));
const CLASSES = Object.keys(LABEL_FILE).length;
const labelAt = (index) => Object.keys(LABEL_FILE).find((letter) => LABEL_FILE[letter] === index);
const BEST = 9;

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
 * The booted app with the camera on and a hand in view, whose letter session
 * throws on run number `failingRun` (1 is the load-time warmup) and otherwise
 * returns class BEST at 55 %.
 */
async function appWhoseRunFails(failingRun) {
  let runs = 0;
  let realm;
  const app = loadWebApp({
    boot: true,
    globals: {
      console: { ...console, log() {}, warn() {}, error() {} },
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
            run: async () => {
              runs += 1;
              if (runs === failingRun) throw new Error("a transient runtime error");
              const probabilities = new realm.Float32Array(CLASSES).fill(0.45 / (CLASSES - 1));
              probabilities[BEST] = 0.55;
              return { label: { data: BigInt64Array.of(BigInt(BEST)) }, probabilities: { data: probabilities, dims: [1, CLASSES] } };
            },
          }),
        },
      },
    },
  });
  realm = { Float32Array: app.evaluate("Float32Array") };
  await app.ready;
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
  return app;
}

/** Play one render frame; letters are classified at most every 120 ms. */
async function classifyOneFrame(app, time) {
  assert.equal(app.runFrame(time), 1, "the render loop must be running");
  await flush();
}

const rowCount = (app) => app.evaluate("els.top3List.children.length");

for (const [when, failingRun] of [
  ["a live frame", 2],
  ["the warmup", 1],
]) {
  test(`after one thrown run in ${when}, later frames show the model's own confidence`, async () => {
    const app = await appWhoseRunFails(failingRun);
    for (const time of [1000, 2000, 3000]) await classifyOneFrame(app, time);

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), labelAt(BEST));
    assert.equal(app.evaluate("els.confidenceText.textContent"), "%55", "the model said 55 %, not 100 %");
    assert.equal(rowCount(app), 3, "the ranked list comes from the probabilities again");
  });
}
