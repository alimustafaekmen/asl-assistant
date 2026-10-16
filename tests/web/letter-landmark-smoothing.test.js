// The letter landmark smoother starts over when the sign it smooths is gone.
//
// Letter features are computed from an exponential moving average of the
// hand's landmarks, which steadies a held sign. When the hand leaves the
// frame, the camera stops, or the user changes mode, the previous pose is no
// longer the sign being made: the next hand must reach the model as itself,
// not blended with the old one. The fault this kills is a smoother that keeps
// the last hand across those breaks, so the first letters of a new sign are
// computed from a pose partly made of the old sign.
//
// Frames go in through the app's render loop with MediaPipe's output set as
// the camera publishes it; ONNX Runtime is replaced at its boundary by a
// session that records the 93 features it is given.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

/** A right hand of 21 landmarks; different offsets and spreads are different signs. */
const hand = (dx, spread) =>
  Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + dx + spread * (i % 5) * 0.01, y: 0.5 + 0.012 * i, z: -0.01 }));
const SIGN_A = hand(0, 1);
const SIGN_B = hand(0.3, 3);

/** The booted app in letter mode with the camera on and a model that records its input. */
async function letterApp() {
  const fed = [];
  const app = loadWebApp({
    boot: true,
    globals: {
      console: { ...console, log() {}, warn() {}, error() {} },
      navigator: {},
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
              // The word model, which a mode switch loads, shares this fake;
              // only the letter model's 93 features are of interest here.
              if (feeds.input.data.length === 93) fed.push(Array.from(feeds.input.data));
              return { label: { data: BigInt64Array.of(0n) }, probabilities: { data: new Array(24).fill(1 / 24) } };
            },
          }),
        },
      },
    },
  });
  await app.ready;
  assert.equal(await app.get("ensureLetterModel")(), true);
  app.evaluate("state.cameraOn = true;");
  let time = 0;
  /** Publish one MediaPipe frame (a hand, or none) and play one render frame. */
  const show = async (landmarks) => {
    app.evaluate(`latestMediaPipeResult = ${JSON.stringify({
      rightHandLandmarks: landmarks ? [landmarks] : null,
      leftHandLandmarks: null,
      poseLandmarks: null,
      faceLandmarks: null,
      handednessDebug: [],
      timestamp: time,
    })};`);
    time += 1000;
    assert.equal(app.runFrame(time), 1, "the render loop must be running");
    await flush();
  };
  return { app, fed, show };
}

/** The features a sign B reaches the model with when it is the first hand seen. */
async function freshFeaturesOfB() {
  const { fed, show } = await letterApp();
  await show(SIGN_B);
  return fed.at(-1);
}

const maxDifference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

const BREAKS = {
  "the hand leaves the frame": async ({ show }) => {
    await show(null);
  },
  "the camera stops and starts again": async ({ app }) => {
    app.get("stopCamera")();
    app.evaluate("state.cameraOn = true;");
  },
  "the user switches mode and back": async ({ app }) => {
    openTab(app, "word");
    openTab(app, "letter");
  },
};

for (const [name, breakSign] of Object.entries(BREAKS)) {
  test(`after ${name}, the next sign reaches the model unblended`, async () => {
    const fresh = await freshFeaturesOfB();
    const ctx = await letterApp();
    await ctx.show(SIGN_A);
    await ctx.show(SIGN_A);
    await breakSign(ctx);
    const before = ctx.fed.length;
    await ctx.show(SIGN_B);
    assert.equal(ctx.fed.length, before + 1, "sign B was classified");

    const after = ctx.fed.at(-1);
    assert.equal(after.length, 93);
    assert.ok(maxDifference(fresh, after) < 1e-6, `sign B must not carry sign A (max difference ${maxDifference(fresh, after).toFixed(4)})`);
  });
}

test("a held sign is still smoothed between frames", async () => {
  // The control: without a break the smoother does blend, which is what the
  // tests above rely on to see a missing reset.
  const fresh = await freshFeaturesOfB();
  const ctx = await letterApp();
  await ctx.show(SIGN_A);
  await ctx.show(SIGN_B);
  assert.ok(maxDifference(fresh, ctx.fed.at(-1)) > 0.01, "a hand right after another is blended with it");
});
