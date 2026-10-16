// The letter model sees a hand's shape, whatever shape the camera frame has.
//
// The letter model was trained on landmarks from square photographs, where x
// and y are fractions of the same length. MediaPipe gives x as a fraction of
// the frame's width and y of its height, so in a 1280 by 720 camera frame a
// hand comes out squeezed sideways, and in a portrait phone frame stretched.
// Measured on real MediaPipe output, that alone took the letter model from 98
// to 89 % on held-out photographs placed in a 16:9 frame. The features the
// model receives must therefore be the ones Python computes for the same hand
// in a square frame.
//
// A frame goes in through the app's render loop with the video's own size, as
// the camera reports it. ONNX Runtime is replaced only at its boundary, so the
// test can read the tensor the app feeds it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const GOLDEN = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "feature-golden.json"), "utf8"));
const CASES = {
  right: GOLDEN.letter.cases.find((entry) => entry.name === "open_palm_right"),
  left: GOLDEN.letter.cases.find((entry) => entry.name === "fist_left_alone"),
};
const TOLERANCE = GOLDEN.tolerance;

/**
 * The golden hand, drawn in a square frame of side `side` pixels, as MediaPipe
 * would report it in a `width` by `height` frame with the square centred.
 */
function handInFrame(width, height, side, values) {
  const edge = Math.min(width, height);
  const left = (width - edge) / 2;
  const top = (height - edge) / 2;
  const landmarks = [];
  for (let i = 0; i < 63; i += 3) {
    landmarks.push({
      x: (left + values[i] * edge) / width,
      y: (top + values[i + 1] * edge) / height,
      // MediaPipe's z is on the scale of x.
      z: (values[i + 2] * edge) / width,
    });
  }
  return landmarks;
}

/** The booted app with its camera on, a video of the given size, and a model that records its input. */
async function appWithVideo(width, height, side) {
  const fed = [];
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
              fed.push(Array.from(feeds.input.data));
              return { probabilities: { data: new Float32Array(24).fill(1 / 24), dims: [1, 24] } };
            },
          }),
        },
      },
    },
  });
  await app.ready;
  assert.equal(await app.get("ensureLetterModel")(), true);
  app.evaluate(`
    state.cameraOn = true;
    els.video.videoWidth = ${width};
    els.video.videoHeight = ${height};
    latestMediaPipeResult = {
      rightHandLandmarks: ${side === "right" ? JSON.stringify(handInFrame(width, height, side, CASES.right.right)) : "null"},
      leftHandLandmarks: ${side === "left" ? JSON.stringify(handInFrame(width, height, side, CASES.left.left)) : "null"},
      poseLandmarks: null,
      faceLandmarks: null,
      timestamp: 1,
    };
  `);
  const warmups = fed.length;
  assert.equal(app.runFrame(1000), 1, "the render loop must be running");
  await flush();
  // A run whose output is not read as probabilities is asked again for the
  // label alone, with the same features; either run shows what the model got.
  assert.ok(fed.length > warmups, "the frame must reach the model");
  return fed.at(-1);
}

function assertSameFeatures(actual, expected, label) {
  const worst = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])));
  assert.ok(worst <= TOLERANCE, `${label}: the features differ from the square-frame ones by up to ${worst}`);
}

for (const [width, height, label] of [
  [1280, 720, "a 16:9 laptop camera"],
  [720, 1280, "a portrait phone camera"],
  [640, 480, "a 4:3 camera"],
  [720, 720, "a square camera"],
]) {
  for (const side of ["right", "left"]) {
    test(`${label} gives the model the ${side} hand's square-frame features`, async () => {
      assertSameFeatures(await appWithVideo(width, height, side), CASES[side].expect, `${label}, ${side} hand`);
    });
  }
}
