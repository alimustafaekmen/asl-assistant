// Models load when something first needs them, not when the page opens.
//
// The letter model alone is 12.6 MB, and a visitor who only reads the project
// page or scans the QR code never runs it. These tests replace the two loaders
// with counters, so they observe what the app decides to load rather than
// ONNX Runtime itself, which only a browser can run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

/**
 * The app with counted model loaders and no network.
 *
 * A loader that succeeds also publishes a session, as the real one does, so
 * code that checks for a session sees one.
 *
 * @param {string} [hash] What the address bar would hold.
 */
function appWithCountedLoaders(hash = "") {
  const app = loadWebApp();
  app.evaluate(`
    globalThis.__loads = { letter: 0, word: 0 };
    loadLetterModel = async () => {
      __loads.letter += 1;
      letterSession = { inputNames: ["input"], outputNames: ["label", "probabilities"] };
      return true;
    };
    loadWordModel = async () => {
      __loads.word += 1;
      wordSession = { inputNames: ["input", "mask"], outputNames: ["output"] };
      return true;
    };
    warmupLetterModel = async () => {};
    warmupWordModel = async () => {};
    globalThis.location = { hash: ${JSON.stringify(hash)}, hostname: "localhost", protocol: "http:", pathname: "/" };
    globalThis.history = { replaceState() {} };
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    globalThis.requestAnimationFrame = () => 0;
    globalThis.kjua = () => new HTMLElement();
    globalThis.console = { ...console, log() {}, warn() {} };
  `);
  return app;
}

/** Copy the counters out of the vm realm so they compare as plain objects. */
const loads = (app) => ({ ...app.evaluate("__loads") });

test("opening the app downloads no model, whichever route it opens on", async () => {
  // A bare URL opens letter mode; there is no separate landing screen.
  for (const hash of ["", "#letter", "#word", "#coach", "#test", "#project", "#qr"]) {
    const app = appWithCountedLoaders(hash);
    await app.get("init")();
    assert.deepEqual(loads(app), { letter: 0, word: 0 }, hash || "bare URL");
  }
});

test("switching modes with the camera off downloads no model", () => {
  const app = appWithCountedLoaders();
  const setMode = app.get("setMode");

  for (const mode of ["letter", "word", "coach", "test", "project", "qr"]) setMode(mode);

  assert.deepEqual(loads(app), { letter: 0, word: 0 });
});

test("with the camera on, a live mode loads what it runs and nothing else", () => {
  // The coach is covered by its own test below: what it loads depends on
  // whether it is on letters or words.
  const expected = {
    project: { letter: 0, word: 0 },
    test: { letter: 0, word: 0 },
    qr: { letter: 0, word: 0 },
    letter: { letter: 1, word: 0 },
    word: { letter: 0, word: 1 },
  };
  for (const [mode, counts] of Object.entries(expected)) {
    const app = appWithCountedLoaders();
    app.evaluate("state.cameraOn = true");
    app.get("setMode")(mode);
    assert.deepEqual(loads(app), counts, mode);
  }
});

test("a model asked for twice is downloaded once", async () => {
  const app = appWithCountedLoaders();
  const ensureLetterModel = app.get("ensureLetterModel");
  const ensureWordModel = app.get("ensureWordModel");

  // Two callers while the download is in flight, then one after it landed.
  const ready = await Promise.all([ensureLetterModel(), ensureLetterModel()]);
  await ensureLetterModel();
  await Promise.all([ensureWordModel(), ensureWordModel()]);
  await ensureWordModel();

  assert.deepEqual(loads(app), { letter: 1, word: 1 });
  assert.deepEqual([...ready], [true, true]);
});

test("a failed download is tried again by the next need", async () => {
  const app = appWithCountedLoaders();
  app.evaluate("loadLetterModel = async () => { __loads.letter += 1; return false; }");
  const ensureLetterModel = app.get("ensureLetterModel");

  assert.equal(await ensureLetterModel(), false);
  assert.equal(await ensureLetterModel(), false);
  assert.equal(loads(app).letter, 2);
});

test("a live frame waits for the letter model and never downloads it", async () => {
  const app = appWithCountedLoaders();
  app.evaluate(`
    state.cameraOn = true;
    state.mode = "letter";
    latestMediaPipeResult = {
      rightHandLandmarks: Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i * 0.01, y: 0.6 - i * 0.01, z: 0 })),
      leftHandLandmarks: null,
      poseLandmarks: null,
      faceLandmarks: null,
      handednessDebug: [],
      timestamp: 0,
    };
    globalThis.__predicted = 0;
    predictLetter = async () => { __predicted += 1; return null; };
  `);
  const realInference = app.get("realInference");

  // The frame loop runs every 120 ms; a load started from here would be
  // retried on every frame after a failure.
  await realInference(0);
  assert.deepEqual(loads(app), { letter: 0, word: 0 });
  assert.equal(app.evaluate("__predicted"), 0);

  // Once something that needs the model has loaded it, frames reach it.
  await app.get("ensureLetterModel")();
  await realInference(1);
  assert.equal(app.evaluate("__predicted"), 1);
});

test("a Model Test run and a word recording load their model first", async () => {
  const app = appWithCountedLoaders();
  // Each stand-in records whether its session existed when it was called.
  app.evaluate(`
    globalThis.__calls = [];
    predictLetter = async () => { __calls.push(["letter", !!letterSession]); return { label: "A", confidence: 1, alternatives: [] }; };
    renderModelTestResult = () => {};
    wait = async () => {};
  `);

  app.evaluate('state.modelTestSample = { task: "letter", features: new Float32Array(93) }');
  await app.get("runModelTestSample")();
  assert.deepEqual(loads(app), { letter: 1, word: 0 });

  // A recording loads the word model before its countdown starts.
  app.evaluate(`
    state.cameraOn = true;
    state.mode = "word";
    mpRunning = true;
    poseLandmarker = {};
    faceLandmarker = {};
  `);
  await app.get("startWordRecording")();
  assert.deepEqual(loads(app), { letter: 1, word: 1 });
  assert.equal(app.evaluate("state.wordState"), "RECORDING");

  assert.deepEqual(Array.from(app.evaluate("__calls"), (call) => [...call]), [["letter", true]]);
});

test("a granted camera loads the models its mode runs; a refused one loads none", async () => {
  const startCamera = async (mode, granted) => {
    const app = appWithCountedLoaders();
    app.evaluate(`
      globalThis.navigator = {
        mediaDevices: {
          getUserMedia: async () => {
            if (!${granted}) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
            return { getTracks: () => [] };
          },
        },
      };
      els.cameraStatus.lastChild = { textContent: "" };
      els.video.play = async () => {};
      startMediaPipe = async () => {};
      console.error = () => {};
    `);
    app.get("setMode")(mode);
    await app.get("toggleCamera")();
    return loads(app);
  };

  assert.deepEqual(await startCamera("letter", true), { letter: 1, word: 0 });
  assert.deepEqual(await startCamera("word", true), { letter: 0, word: 1 });
  assert.deepEqual(await startCamera("letter", false), { letter: 0, word: 0 });
});

test("the coach on letters downloads only the letter model, and words bring the word model", async () => {
  // A letter session never runs the word model, and it is 1.8 MB of hosting
  // credit; it loads when the coach turns to words.
  const app = appWithCountedLoaders();
  app.evaluate(`
    globalThis.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } };
    els.cameraStatus.lastChild = { textContent: "" };
    els.video.play = async () => {};
    startMediaPipe = async () => {};
  `);
  app.get("setMode")("coach");
  assert.equal(app.evaluate("state.coachTargetType"), "letter", "precondition: the coach starts on letters");

  await app.get("toggleCamera")();
  assert.deepEqual(loads(app), { letter: 1, word: 0 }, "a camera start on letters");

  app.get("setMode")("letter");
  app.get("setMode")("coach");
  assert.deepEqual(loads(app), { letter: 1, word: 0 }, "coming back to the coach on letters");

  // This app is not booted, so its buttons are not bound: the command the
  // "Kelimeler" button runs is called instead.
  app.get("setCoachTargetType")("word");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(loads(app), { letter: 1, word: 1 }, "turning to words with the camera on");
});
