// Drive a whole word recording through the app with fake runtimes.
//
// Only the system boundaries are replaced: ONNX Runtime (a session that records
// every feed it receives), the network (fetch serves the real data files from
// disk), localStorage, and the MediaPipe results the camera would publish. The
// recording itself runs through the app's own code: startWordRecording(), then
// realInference() once per frame until the 45-frame buffer is full.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WEB_DIR, loadWebApp } from "./web-app-context.mjs";

const WORD_LABELS = JSON.parse(readFileSync(join(WEB_DIR, "data", "word_labels.json"), "utf8"));
const LABEL_COUNT = Object.keys(WORD_LABELS).length;

/** Frames in one recording, and the hand's x step between two of them. */
export const RECORDING_FRAMES = 45;
export const HAND_STEP_X = 0.01;

/** The shoulders every synthetic frame shares: midpoint x 0.5, width 0.2. */
export const SHOULDER_MID_X = 0.5;
export const SHOULDER_WIDTH = 0.2;

/** Where the wrist is, in raw image x, in recording frame `t`. */
export const wristX = (t) => 0.4 + HAND_STEP_X * t;

/** A tensor as ONNX Runtime Web would build it. */
class FakeTensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

/**
 * A fake ONNX Runtime whose word session records its feeds.
 *
 * `winner` gets the only large logit, so the result is confident. When
 * `maskDtype` is given, the session rejects any other mask element type, the
 * way an export that wants that type does.
 *
 * @param {{winner?: string, maskDtype?: string}} [options]
 */
export function fakeOrt({ winner = "book", maskDtype } = {}) {
  const runs = [];
  const session = {
    inputNames: ["input", "mask"],
    outputNames: ["output"],
    async run(feeds) {
      if (maskDtype && feeds.mask && feeds.mask.type !== maskDtype) {
        throw new Error(`mask must be ${maskDtype}`);
      }
      runs.push(feeds);
      const logits = new Float32Array(LABEL_COUNT);
      logits[WORD_LABELS[winner]] = 10;
      return { output: { data: logits } };
    },
  };
  const ort = {
    Tensor: FakeTensor,
    env: { wasm: {} },
    InferenceSession: { create: async () => session },
  };
  return { ort, runs };
}

/** fetch() serving the app's data files from disk. */
async function fakeFetch(url) {
  const relPath = String(url).replace(/^\.\//, "");
  try {
    const body = readFileSync(join(WEB_DIR, relPath), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
}

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/**
 * The app in word mode with the camera on and MediaPipe running.
 *
 * The camera and the MediaPipe tasks are not started for real: their state is
 * set the way a successful start leaves it. The countdown has zero steps, so a
 * recording starts without waiting on a timer.
 *
 * @param {{winner?: string, maskDtype?: string}} [options]
 */
export function wordModeApp(options = {}) {
  const { ort, runs } = fakeOrt(options);
  const app = loadWebApp({
    globals: { ort, fetch: fakeFetch, localStorage: fakeStorage(), console: quietConsole },
  });
  app.evaluate(`
    globalThis.__clock = 0;
    globalThis.performance = { now: () => __clock };
    CONFIG.COUNTDOWN_SECONDS = 0;
    state.mode = "word";
    state.cameraOn = true;
    mpRunning = true;
    poseLandmarker = { close() {} };
    faceLandmarker = { close() {} };
  `);
  return { app, runs };
}

/**
 * One MediaPipe frame: a right hand, both shoulders, and a face.
 *
 * The hand moves right by HAND_STEP_X per frame and nothing else moves, so a
 * frame's position in the recording can be read back from its wrist x.
 *
 * @param {number} t Frame index within the recording.
 */
export function mediaPipeFrame(t) {
  const hand = Array.from({ length: 21 }, (_, i) => ({
    x: wristX(t) + 0.004 * i,
    y: 0.5 + 0.01 * i,
    z: -0.01,
  }));
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, z: -0.1 }));
  pose[11] = { x: SHOULDER_MID_X + SHOULDER_WIDTH / 2, y: 0.8, z: -0.1 };
  pose[12] = { x: SHOULDER_MID_X - SHOULDER_WIDTH / 2, y: 0.8, z: -0.1 };
  const face = Array.from({ length: 478 }, (_, i) => ({ x: 0.45 + 0.0002 * i, y: 0.3, z: -0.02 }));
  return {
    rightHandLandmarks: [hand],
    leftHandLandmarks: null,
    handednessDebug: [],
    poseLandmarks: pose,
    faceLandmarks: face,
    timestamp: t,
  };
}

/**
 * Press record, then feed a full recording through live inference.
 *
 * Resolves once the app has left the recording, normally in RESULT.
 *
 * @param {ReturnType<typeof loadWebApp>} app
 */
export async function recordWord(app) {
  await app.get("startWordRecording")();
  const realInference = app.get("realInference");
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    app.evaluate(`__clock += 50;`);
    app.evaluate(`latestMediaPipeResult = ${JSON.stringify(mediaPipeFrame(t))};`);
    await realInference(app.evaluate("__clock"));
  }
}
