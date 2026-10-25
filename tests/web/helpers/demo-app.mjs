// The booted app with the camera-free letter demo's boundaries under the
// test's hand.
//
// The demo plays a recorded hand through the live letter pipeline, so what a
// test fakes here are only the things the app does not own: the network (the
// recording file), the clock and its timers, ONNX Runtime, the camera and the
// MediaPipe CDN import. Everything between them is the app's own code.
//
// The model is the fake from fake-ort.mjs with one rule added: it answers the
// letter of the recorded pose nearest to the features it is given, computed
// once from the recording by the app's own feature code. A frame of the
// recorded F is therefore read as F, and a frame the app built differently is
// read as whichever pose it happens to be nearest.
//
// Time moves only when the test moves it. play() advances the clock in small
// steps; at each step the timers that fall due fire in order, then one browser
// frame runs, as in a page where the demo's timer and the render loop share
// one clock.

import { FAKE_ORT_SOURCE, LETTER_LABELS, jsonResponse, routeFetch } from "./fake-ort.mjs";
import { flush } from "./fake-camera.mjs";
import { loadWebApp } from "./web-app-context.mjs";

export { flush };

/** The recording's address, as the app asks for it. */
export const DEMO_FILE = "demo-letters.json";

/**
 * A 21-point hand in a square image. `spread` fans the fingers and `curl`
 * shortens the last three, so each letter of the test recording has its own
 * shape. Coordinates are MediaPipe's: x and y in 0..1, z small.
 *
 * @param {number} spread
 * @param {number} curl
 * @returns {number[][]}
 */
function handPose(spread, curl) {
  const points = [[0.5, 0.86, 0]];
  for (let finger = 0; finger < 5; finger++) {
    const angle = (-0.6 + finger * 0.3) * spread;
    for (let joint = 1; joint <= 4; joint++) {
      const length = joint * (finger === 0 ? 0.08 : 0.11) * (finger >= 2 ? curl : 1);
      points.push([
        Number((0.5 + Math.sin(angle) * length).toFixed(4)),
        Number((0.86 - Math.cos(angle) * length).toFixed(4)),
        Number((-0.01 * joint).toFixed(4)),
      ]);
    }
  }
  return points;
}

const POSES = { F: handPose(1, 0.45), L: handPose(1.7, 0.35), Y: handPose(0.55, 1), A: handPose(0.3, 0.3) };

/**
 * A recording in the published shape (schema asl-demo-letters-v1): one entry
 * per letter of `word`, in order.
 *
 * @param {string} [word]
 */
export function demoRecording(word = "FLY") {
  return {
    schema: "asl-demo-letters-v1",
    word,
    source: "test",
    extractor: "test",
    letters: [...word].map((letter) => ({ letter, handedness: "Right", landmarks: POSES[letter] })),
  };
}

/**
 * Timers on the test's clock. advance() fires every timer that falls due, in
 * order of due time, and leaves the clock at the end of the span.
 *
 * @param {{now: number}} clock
 */
function fakeTimers(clock) {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimeout(fn, ms = 0, ...args) {
      const id = nextId++;
      timers.set(id, { at: clock.now + Math.max(0, Number(ms) || 0), fn, args });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        let next = null;
        for (const entry of timers) {
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        }
        if (!next) break;
        timers.delete(next[0]);
        clock.now = Math.max(clock.now, next[1].at);
        next[1].fn(...next[1].args);
      }
      clock.now = end;
    },
  };
}

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/**
 * The booted app on #letter with the demo's boundaries faked.
 *
 * `respond(path)` answers the recording request; by default it serves
 * `recording`. Each request for the file is recorded in `demoRequests`.
 * `languages` are the browser's preferred languages, as loadWebApp() takes
 * them; the page is Turkish without them.
 *
 * @param {{recording?: object, respond?: (path: string) => unknown, hash?: string, languages?: readonly string[]}} [options]
 */
export async function demoApp({ recording = demoRecording(), respond, hash = "#letter", languages } = {}) {
  const clock = { now: 1000 };
  const timers = fakeTimers(clock);
  const camera = { requests: 0, imports: 0 };
  const tracks = [];
  const location = new URL(`https://asl-assistant.pages.dev/${hash}`);
  const app = loadWebApp({
    boot: true,
    ...(languages ? { languages } : {}),
    globals: {
      console: quietConsole,
      location,
      history: {
        replaceState(_state, _title, url) {
          if (url !== undefined && url !== null) location.href = new URL(String(url), location.href).href;
        },
        pushState() {},
      },
      performance: { now: () => clock.now },
      __advanceClock: (ms) => {
        clock.now += ms;
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            camera.requests += 1;
            const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {}, removeEventListener() {} };
            tracks.push(track);
            return { getTracks: () => [track] };
          },
        },
      },
      kjua: () => ({}),
      // The overlay reads its colours from the stylesheet; there is none here.
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
      __camera: camera,
    },
  });
  await app.ready;
  app.evaluate(FAKE_ORT_SOURCE);
  app.evaluate(`
    // The MediaPipe CDN import is a boundary: it is counted and never answers.
    _importTasksVision = () => { __camera.imports += 1; return new Promise(() => {}); };
    // A started camera's video is ready at once; its frames are never read.
    els.video.play = async () => {};
    els.cameraStatus.lastChild = { textContent: "Hazır" };
    // Layout is the browser's; the overlay needs a box to draw in.
    els.canvas.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 });
  `);

  const demoRequests = [];
  routeFetch(app, (path) => {
    if (!path.includes(DEMO_FILE)) return undefined;
    demoRequests.push(path);
    return respond ? respond(path) : jsonResponse(recording);
  });

  // The fake model reads a pose as the recorded letter nearest to it.
  if (Array.isArray(recording?.letters)) {
    app.evaluate(`(() => {
      const labels = ${JSON.stringify(LETTER_LABELS)};
      const letters = ${JSON.stringify(recording.letters.filter((entry) => Array.isArray(entry?.landmarks)))};
      const poses = letters.map((entry) => {
        resetLetterLandmarkSmoother();
        const hand = entry.landmarks.map(([x, y, z]) => ({ x, y, z }));
        const features = computeLetterFeatures(landmarksTo321D({ rightHandLandmarks: [hand] }), 1);
        return { index: labels.indexOf(entry.letter), features: Array.from(features) };
      });
      resetLetterLandmarkSmoother();
      __ort.answer = (input) => {
        let best = poses[0];
        let bestDistance = Infinity;
        for (const pose of poses) {
          let distance = 0;
          for (let i = 0; i < pose.features.length; i++) distance += (pose.features[i] - input[i]) ** 2;
          if (distance < bestDistance) { bestDistance = distance; best = pose; }
        }
        return best ? best.index : 0;
      };
    })()`);
  }

  const byId = (id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`);
  const page = app.makeTarget({ tagName: "DIV" });

  /** Advance the clock by `ms`, firing timers and running a browser frame every `step` ms. */
  const play = async (ms, step = 40) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      timers.advance(Math.min(step, ms - elapsed));
      app.runFrame(clock.now);
      await flush();
    }
  };

  /** The hand the demo published last, as [x, y, z] points, or null. */
  const publishedHand = () => {
    const frame = app.evaluate("latestMediaPipeResult");
    const hand = frame?.rightHandLandmarks?.[0];
    // Built in this realm, so a deep comparison sees plain arrays.
    return hand ? Array.from(hand, (point) => [point.x, point.y, point.z]) : null;
  };

  /** Which recorded letter the published hand is, within `tolerance`; null for none. */
  const publishedLetter = (tolerance = 0.01) => {
    const hand = publishedHand();
    if (!hand) return null;
    for (const entry of recording.letters ?? []) {
      const worst = Math.max(...entry.landmarks.map((point, i) => Math.max(Math.abs(point[0] - hand[i][0]), Math.abs(point[1] - hand[i][1]))));
      if (worst <= tolerance) return entry.letter;
    }
    return "?";
  };

  return {
    app,
    clock,
    timers,
    camera,
    tracks,
    location,
    demoRequests,
    byId,
    play,
    publishedHand,
    publishedLetter,
    /** Start the demo through the app's command and let the file and the model load. */
    async start() {
      const started = app.get("startDemo")();
      await flush(30);
      return started;
    },
    /** Press a key on the page, as the window's keydown handler sees it. */
    press(key, code = key === " " ? "Space" : key) {
      let prevented = false;
      app.windowHandler("keydown")({
        key,
        code,
        target: page,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
    /** Click an element with a pointer. */
    click(element) {
      element.dispatchEvent({ type: "click", detail: 1 });
    },
    transcript: () => app.evaluate("state.transcript"),
    plate: () => byId("primaryPrediction").textContent,
    pendingTimers: () => timers.timers.size,
  };
}
