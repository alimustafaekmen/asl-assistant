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
 * `winner` gets the only large logit, so the result is confident. A test that
 * needs a weaker result passes `winnerLogit`, a number or a function read at
 * every run, so it can depend on the calibration the app has loaded by then.
 * `runnerUp` gives a second label a logit of its own, read the same way, for
 * a result whose top two are close.
 * When `maskDtype` is given, the session rejects any other mask element type,
 * the way an export that wants that type does. After `hold()` a run does not
 * finish until the test calls `release()`, so the app can be stopped or moved
 * while the model is still computing.
 *
 * @param {{winner?: string, maskDtype?: string, winnerLogit?: number | (() => number), runnerUp?: {label: string, logit: number | (() => number)}}} [options]
 */
export function fakeOrt({ winner = "book", maskDtype, winnerLogit = 10, runnerUp = null } = {}) {
  const runs = [];
  /** @type {Promise<void> | null} */
  let gate = null;
  let open = () => {};
  const session = {
    inputNames: ["input", "mask"],
    outputNames: ["output"],
    async run(feeds) {
      if (maskDtype && feeds.mask && feeds.mask.type !== maskDtype) {
        throw new Error(`mask must be ${maskDtype}`);
      }
      runs.push(feeds);
      if (gate) await gate;
      const logits = new Float32Array(LABEL_COUNT);
      logits[WORD_LABELS[winner]] = typeof winnerLogit === "function" ? winnerLogit() : winnerLogit;
      if (runnerUp) {
        logits[WORD_LABELS[runnerUp.label]] = typeof runnerUp.logit === "function" ? runnerUp.logit() : runnerUp.logit;
      }
      return { output: { data: logits } };
    },
  };
  const ort = {
    Tensor: FakeTensor,
    env: { wasm: {} },
    InferenceSession: { create: async () => session },
  };
  return {
    ort,
    runs,
    hold() {
      gate = new Promise((resolve) => (open = resolve));
    },
    release() {
      gate = null;
      open();
    },
  };
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

/** Let pending promise continuations run. */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * A clock the test moves by hand, for setTimeout and clearTimeout.
 *
 * `advance(ms)` runs every timer that falls due within `ms`, in order, and
 * lets the promise work each one triggers finish before the next runs. Time
 * never moves on its own, so a countdown stops exactly where the test says.
 */
export function fakeTimers() {
  let now = 0;
  let nextId = 1;
  /** @type {Map<number, {at: number, run: () => void}>} */
  const pending = new Map();
  return {
    setTimeout(run, ms = 0) {
      const id = nextId++;
      pending.set(id, { at: now + Number(ms), run });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** Timers waiting to fire. */
    get pending() {
      return pending.size;
    },
    /** @param {number} ms */
    async advance(ms) {
      const target = now + ms;
      await settle();
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        pending.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
        await settle();
      }
      now = target;
    },
  };
}

/**
 * The app in word mode with the camera on and MediaPipe running.
 *
 * The camera and the MediaPipe tasks are not started for real: their state is
 * set the way a successful start leaves it. By default the countdown has zero
 * steps, so a recording starts without waiting on a timer.
 *
 * With `fakeTimers` the countdown keeps its real length and runs on a clock
 * the test advances (`timers.advance(ms)`). With `boot` the app runs its own
 * init() first, so its buttons are bound and `app.ready` settles when the
 * start-up reads are done; the network is then the harness's default fetch.
 * `languages` are the browser's preferred languages, as loadWebApp() takes
 * them; Turkish when left out.
 *
 * @param {{winner?: string, maskDtype?: string, winnerLogit?: number | (() => number), runnerUp?: {label: string, logit: number | (() => number)}, fakeTimers?: boolean, boot?: boolean, languages?: readonly string[]}} [options]
 */
export function wordModeApp(options = {}) {
  const { ort, runs, hold, release } = fakeOrt(options);
  const timers = options.fakeTimers ? fakeTimers() : null;
  const globals = { ort, localStorage: fakeStorage(), console: quietConsole };
  if (!options.boot) globals.fetch = fakeFetch;
  if (timers) {
    globals.setTimeout = timers.setTimeout;
    globals.clearTimeout = timers.clearTimeout;
  }
  const app = loadWebApp({ boot: options.boot === true, globals, languages: options.languages });
  app.evaluate(`
    globalThis.__clock = 0;
    globalThis.performance = { now: () => __clock };
    ${timers ? "" : "CONFIG.COUNTDOWN_SECONDS = 0;"}
    state.mode = "word";
    state.cameraOn = true;
    mpRunning = true;
    poseLandmarker = { close() {} };
    faceLandmarker = { close() {} };
  `);
  return { app, runs, timers, hold, release };
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
 * Feed `count` MediaPipe frames through live inference, starting at frame
 * index `from`. Resolves when the last one has been handled, which includes
 * the model run when the frame completes a recording.
 *
 * @param {ReturnType<typeof loadWebApp>} app
 * @param {number} from
 * @param {number} count
 */
export async function feedFrames(app, from, count) {
  const realInference = app.get("realInference");
  for (let t = from; t < from + count; t++) {
    app.evaluate(`__clock += 50;`);
    app.evaluate(`latestMediaPipeResult = ${JSON.stringify(mediaPipeFrame(t))};`);
    await realInference(app.evaluate("__clock"));
  }
}

/**
 * Press record, then feed a full recording through live inference.
 *
 * Resolves once the app has left the recording, normally in RESULT. With
 * `timers` (from a `fakeTimers` app) the countdown is run out on that clock
 * first.
 *
 * @param {ReturnType<typeof loadWebApp>} app
 * @param {{timers?: ReturnType<typeof fakeTimers> | null}} [options]
 */
export async function recordWord(app, { timers = null } = {}) {
  const starting = app.get("startWordRecording")();
  if (timers) await timers.advance(app.evaluate("CONFIG.COUNTDOWN_SECONDS") * 720);
  await starting;
  await feedFrames(app, 0, RECORDING_FRAMES);
}
