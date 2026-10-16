// The coach screen with a camera, a hand and a letter model under the test's hand.
//
// The coach decides what counts from what the live pipeline publishes over
// time, so a coach test plays time forward: the app's own render loop and
// MediaPipe frame loop run on queued animation frames, MediaPipe's hand task
// reports the hand the test chose, and ONNX Runtime answers the letter the
// test chose at the confidence it chose. The clock, the timers, the camera,
// the MediaPipe CDN import, ONNX Runtime and storage are the boundaries
// faked here; everything between them is the app's own code, from the
// camera start button through feature extraction and smoothing to the
// coach's verdict.
//
// play(ms) advances the clock in 16 ms browser frames. Each frame first runs
// the timers that fell due, then every queued animation frame callback once,
// then lets the promise work they started finish.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WEB_DIR, loadWebApp } from "./web-app-context.mjs";

const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));

/** Letter labels in the model's output order, from the deployed label map. */
export const LETTER_LABELS = Object.entries(readJson("data/letter_labels.json"))
  .sort(([, a], [, b]) => a - b)
  .map(([letter]) => letter);

const WORD_LABEL_COUNT = Object.keys(readJson("data/word_labels.json")).length;

/** The browser frame length the clock moves by. */
export const FRAME_MS = 16;

/** Let pending promise continuations run. */
export const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A hand of 21 landmarks, wrist at the bottom, fingers fanned upwards. */
function handLandmarks() {
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

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** localStorage backed by a Map, empty unless seeded. */
export function memoryStorage(seed = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (items.has(String(key)) ? items.get(String(key)) : null),
    setItem: (key, value) => void items.set(String(key), String(value)),
    removeItem: (key) => void items.delete(String(key)),
    clear: () => items.clear(),
  };
}

/**
 * The booted app on a route, with every boundary of a camera session faked.
 *
 * @param {{
 *   hash?: string,
 *   storage?: unknown,
 *   globals?: Record<string, unknown>,
 * }} [options] `storage` replaces localStorage (a throwing one, a seeded
 *   one); `globals` replaces any other host API, fetch included.
 */
export async function coachApp(options = {}) {
  const clock = { now: 1000 };
  /** @type {Map<number, {at: number, run: () => void}>} */
  const timers = new Map();
  let nextTimer = 1;

  // What the camera sees and what the letter model answers for it.
  const scene = { hand: true, letter: "A", confidence: 0.9 };
  const ortCalls = { created: [], letterRuns: 0, wordRuns: 0 };
  const tracks = [];
  const storage = options.storage ?? memoryStorage();
  // The app tells output shapes apart with instanceof, so what a session
  // hands back is built from the app's own realm, as ONNX Runtime's is.
  const realm = { Float32Array, BigInt64Array };

  const letterSession = {
    inputNames: ["input"],
    outputNames: ["label", "probabilities"],
    async run(feeds) {
      const warmup = feeds.input.data.every((value) => value === 0);
      if (!warmup) ortCalls.letterRuns += 1;
      const index = Math.max(0, LETTER_LABELS.indexOf(scene.letter));
      const rest = (1 - scene.confidence) / (LETTER_LABELS.length - 1);
      const probabilities = new realm.Float32Array(LETTER_LABELS.length).fill(rest);
      probabilities[index] = scene.confidence;
      return {
        label: { data: new realm.BigInt64Array([BigInt(index)]) },
        probabilities: { data: probabilities, dims: [1, LETTER_LABELS.length] },
      };
    },
  };
  const wordSession = {
    inputNames: ["input", "mask"],
    outputNames: ["logits"],
    async run() {
      ortCalls.wordRuns += 1;
      const logits = new realm.Float32Array(WORD_LABEL_COUNT);
      logits[0] = 8;
      return { logits: { data: logits } };
    },
  };

  const handTask = {
    detectForVideo() {
      return scene.hand
        ? { landmarks: [handLandmarks()], handednesses: [[{ categoryName: "Right", score: 0.95 }]] }
        : { landmarks: [], handednesses: [] };
    },
    close() {},
  };
  const emptyTask = (face) => ({
    detectForVideo: () => (face ? { faceLandmarks: [] } : { landmarks: [] }),
    close() {},
  });
  const vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => handTask },
    PoseLandmarker: { createFromOptions: async () => emptyTask(false) },
    FaceLandmarker: { createFromOptions: async () => emptyTask(true) },
  };

  const location = new URL(`https://asl-assistant.netlify.app/${options.hash ?? "#coach"}`);
  const app = loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      performance: { now: () => clock.now },
      setTimeout: (run, ms = 0) => {
        const id = nextTimer++;
        timers.set(id, { at: clock.now + Number(ms || 0), run });
        return id;
      },
      clearTimeout: (id) => void timers.delete(id),
      localStorage: storage,
      location,
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const track = {
              kind: "video",
              stops: 0,
              stop() {
                this.stops += 1;
              },
              addEventListener() {},
              removeEventListener() {},
            };
            tracks.push(track);
            return { getTracks: () => [track], getVideoTracks: () => [track] };
          },
        },
      },
      ort: {
        env: { wasm: {} },
        Tensor: class {
          constructor(type, data, dims) {
            Object.assign(this, { type, data, dims });
          }
        },
        InferenceSession: {
          create: async (model) => {
            const isWord = String(model).includes("word");
            ortCalls.created.push(isWord ? "word" : "letter");
            return isWord ? wordSession : letterSession;
          },
        },
      },
      ...options.globals,
    },
  });
  realm.Float32Array = app.evaluate("Float32Array");
  realm.BigInt64Array = app.evaluate("BigInt64Array");
  // The CDN import is the MediaPipe boundary; the video element's playback
  // and size are the camera's.
  app.evaluate("globalThis").__vision = vision;
  app.evaluate(`
    _importTasksVision = async () => __vision;
    els.video.play = async () => {};
    els.video.readyState = 4;
    els.video.videoWidth = 640;
    els.video.videoHeight = 480;
    els.canvas.getBoundingClientRect = () => ({ width: 640, height: 480 });
  `);
  await app.ready;

  /** Run every timer due by now, earliest first. */
  const runDueTimers = () => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= clock.now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) return;
      timers.delete(due[0]);
      due[1].run();
    }
  };

  /** Play `ms` of browser frames. */
  const play = async (ms, step = FRAME_MS) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + step);
      runDueTimers();
      app.runFrame(clock.now);
      await flush();
    }
  };

  /** Move the clock without any frame, as a hidden page or a still screen does. */
  const wait = async (ms) => {
    clock.now += ms;
    runDueTimers();
    await flush();
  };

  /** Click an element the way a pointer does. */
  const click = (element) => element.dispatchEvent({ type: "click", detail: 1 });

  /** Press a key on the page (no focused control), as the keyboard does. */
  const press = (key, target = app.makeTarget({ tagName: "DIV" })) => {
    let prevented = 0;
    app.windowHandler("keydown")({
      key,
      code: key === " " ? "Space" : key.length === 1 ? `Key${key.toUpperCase()}` : key,
      target,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: () => (prevented += 1),
    });
    return prevented;
  };

  /** Start the camera with the screen's own start button on the stage. */
  const startCamera = async () => {
    click(app.evaluate(`document.querySelector('[data-trigger="camera"]')`));
    await flush(20);
  };

  return {
    app,
    clock,
    scene,
    ortCalls,
    storage,
    tracks,
    timers,
    play,
    wait,
    click,
    press,
    startCamera,
    /** The camera shows `letter` and the model answers it at `confidence`. */
    show(letter, confidence = 0.9) {
      Object.assign(scene, { hand: true, letter, confidence });
    },
    /** The camera shows no hand. */
    hideHand() {
      scene.hand = false;
    },
    /** Text of an element by id. */
    text: (id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`)?.textContent ?? null,
    el: (id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`),
  };
}
