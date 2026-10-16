// The app with every camera-start boundary under the test's hand.
//
// A camera start crosses five boundaries, each asynchronous: the permission
// prompt (getUserMedia), the first video frame (video.play), the MediaPipe CDN
// import, its WASM fileset, and one model download per task. A stop can land
// in any of those waits. This helper fakes each boundary so a test can hold
// one open, press Stop, and then let it finish, and it records what the app
// did with what it was given: which tasks it created and closed, which frames
// it scheduled, which tracks it stopped. Everything between the boundaries is
// the app's own code.
//
// Animation frames are queued rather than run. runFrame() plays one browser
// frame: every callback pending at that moment runs once, so two detection
// loops show up as two detections per frame.

import { loadWebApp } from "./web-app-context.mjs";

/** Let pending promise continuations run. */
export const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A promise and the two functions that settle it. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A media track that records its stops and can be ended by "the browser",
 * as a revoked permission, an unplugged camera, or another app does.
 */
function fakeTrack() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  return {
    kind: "video",
    readyState: "live",
    stops: 0,
    stop() {
      this.stops += 1;
      this.readyState = "ended";
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    /** End the track from outside the app. stop() never fires "ended". */
    end() {
      this.readyState = "ended";
      for (const listener of [...(listeners.get("ended") ?? [])]) listener({ type: "ended", target: this });
    },
  };
}

/**
 * @typedef {"hand" | "pose" | "face"} TaskKind
 *
 * @typedef {Object} Creation One createFromOptions call.
 * @property {TaskKind} kind
 * @property {{detections: number, closed: number}} task Counters of the task it yields.
 * @property {() => void} resolve Hand the task over.
 * @property {(error: unknown) => void} reject Fail the download.
 */

/**
 * @param {{
 *   mode?: string,
 *   hold?: Partial<Record<TaskKind | "import" | "wasm" | "play" | "onnx", boolean>>,
 * }} [options] `hold` keeps that boundary open until the test settles it;
 *   everything not held resolves at once.
 */
export function appWithFakeCamera(options = {}) {
  const hold = options.hold ?? {};
  /** @type {{tracks: ReturnType<typeof fakeTrack>[]}[]} */
  const streams = [];
  /** @type {Creation[]} */
  const creations = [];
  const frames = { nextId: 1, pending: new Map() };
  const imports = [];
  const wasmLoads = [];
  const plays = [];
  /** Every ONNX session the app asked for; each one fails, as offline. */
  const onnx = { sessions: 0, pending: [] };
  let clock = 0;

  /** @param {TaskKind} kind */
  const factory = (kind) => ({
    createFromOptions() {
      const gate = deferred();
      const counters = { detections: 0, closed: 0 };
      const task = {
        detectForVideo() {
          counters.detections += 1;
          return kind === "face" ? { faceLandmarks: [] } : { landmarks: [], handednesses: [] };
        },
        close() {
          counters.closed += 1;
        },
      };
      creations.push({ kind, task: counters, resolve: () => gate.resolve(task), reject: gate.reject });
      if (!hold[kind]) gate.resolve(task);
      return gate.promise;
    },
  });

  const vision = {
    FilesetResolver: {
      forVisionTasks() {
        const gate = deferred();
        wasmLoads.push(gate);
        if (!hold.wasm) gate.resolve({});
        return gate.promise;
      },
    },
    HandLandmarker: factory("hand"),
    PoseLandmarker: factory("pose"),
    FaceLandmarker: factory("face"),
  };

  const app = loadWebApp({
    globals: {
      console: { ...console, log() {}, warn() {}, error() {} },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const tracks = [fakeTrack()];
            streams.push({ tracks });
            return { getTracks: () => tracks, getVideoTracks: () => tracks };
          },
        },
      },
      requestAnimationFrame(callback) {
        const id = frames.nextId++;
        frames.pending.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.pending.delete(id);
      },
      // ONNX Runtime is a boundary too: a session created here is a model the
      // app started to load.
      ort: {
        env: {},
        InferenceSession: {
          create() {
            onnx.sessions += 1;
            const gate = deferred();
            onnx.pending.push(gate);
            if (!hold.onnx) gate.reject(new Error("no model in the test"));
            return gate.promise;
          },
        },
      },
      setTimeout,
      clearTimeout,
      // Switching screens writes the address bar, and the QR screen draws its
      // link with the kjua CDN script.
      URL,
      location: new URL("https://asl-assistant.netlify.app/#letter"),
      history: { replaceState() {} },
      kjua: () => ({}),
      __importVision() {
        const gate = deferred();
        imports.push(gate);
        if (!hold.import) gate.resolve(vision);
        return gate.promise;
      },
      __play() {
        const gate = deferred();
        plays.push(gate);
        if (!hold.play) gate.resolve();
        return gate.promise;
      },
      __now: () => (clock += 16),
    },
  });
  app.evaluate(`
    globalThis.performance = { now: () => __now() };
    // The CDN import is the MediaPipe runtime boundary.
    _importTasksVision = () => __importVision();
    els.video.play = () => __play();
    els.video.readyState = 4;
    els.video.videoWidth = 640;
    els.video.videoHeight = 480;
    els.cameraStatus.lastChild = { textContent: "Hazır" };
    // Layout and drawing are the browser's; the overlay only needs them to exist.
    els.canvas.getBoundingClientRect = () => ({ width: 640, height: 480 });
    ctx.setTransform = () => {};
    ctx.clearRect = () => {};
  `);
  app.get("state").mode = options.mode ?? "letter";

  /** @param {TaskKind} kind */
  const created = (kind) => creations.filter((c) => c.kind === kind);
  /** Tasks of a kind that were created and never closed. */
  const alive = (kind) => created(kind).filter((c) => c.task.closed === 0).length;
  /** Close calls a kind received in total. */
  const closes = (kind) => created(kind).reduce((sum, c) => sum + c.task.closed, 0);
  /** Detections of a kind across all of its tasks. */
  const detections = (kind) => created(kind).reduce((sum, c) => sum + c.task.detections, 0);

  /** Play one browser frame; returns how many callbacks ran. */
  const runFrame = () => {
    const callbacks = [...frames.pending.values()];
    frames.pending.clear();
    for (const callback of callbacks) callback(clock);
    return callbacks.length;
  };

  return {
    app,
    vision,
    streams,
    creations,
    created,
    alive,
    closes,
    detections,
    frames,
    imports,
    wasmLoads,
    plays,
    onnx,
    runFrame,
  };
}
