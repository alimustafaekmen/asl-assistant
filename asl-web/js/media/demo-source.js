// The camera-free letter demo: a recorded hand played through the live letter
// pipeline. It only publishes frames to latestMediaPipeResult; everything after
// that runs unchanged, and neither the camera nor MediaPipe starts.
//
// Only adding the letter on the stage moves the demo on: the plate still shows
// the previous letter until the model reads the next pose, and adding that
// stale letter must not count. The hand then leaves the frame for a moment so
// the smoother starts the next letter from nothing.
//
// The recording holds square photographs, so every frame says aspect 1: the
// hidden video's size must not reach the features.

/**
 * @typedef {Object} DemoLetter
 * @property {string} letter One of the 24 static letters.
 * @property {LandmarkList} landmarks 21 points in a square image, x and y in 0..1.
 */

/**
 * @typedef {Object} DemoRecording
 * @property {string} word
 * @property {DemoLetter[]} letters
 */

/**
 * "failed": the recording could not be used. "cancelled": stopped while loading.
 *
 * @typedef {"playing" | "failed" | "cancelled"} DemoStartOutcome
 */

const DEMO_RECORDING_URL = "./data/demo-letters.json";
const DEMO_RECORDING_SCHEMA = "asl-demo-letters-v1";
/** About 20 frames a second, a webcam's pace. */
const DEMO_FRAME_MS = 50;
/** How long the hand is out of frame after a letter is added or skipped. */
const DEMO_GAP_MS = 400;
/**
 * Hand drift and per-point tremor as a fraction of the frame; together well
 * under half a percent, which the letter model reads through unchanged.
 */
const DEMO_DRIFT = 0.0015;
const DEMO_TREMOR = 0.0005;
const DEMO_SEED = 0x5eed;
/** Square side as a share of stage height; the photos are cropped tight to the hand. */
const DEMO_FRAME_SCALE = 0.7;
/** Below this share of stage height the hand is too small to read, so it overlaps the card instead. */
const DEMO_FRAME_MIN = 0.3;
/** Room kept between the square and whatever lies over the stage, in CSS pixels. */
const DEMO_FRAME_GAP = 12;

/**
 * Keys into js/i18n/letter.js. The Turkish text names the key "Space", not
 * "Boşluk": the button called Boşluk inserts a space.
 *
 * @type {Record<"loading" | "playing" | "done" | "loadFailed" | "modelLoading" | "modelFailed", string>}
 */
const DEMO_COPY = {
  loading: "letter.demo.loading",
  playing: "letter.demo.playing",
  done: "letter.demo.done",
  loadFailed: "letter.demo.loadFailed",
  modelLoading: "letter.demo.modelLoading",
  modelFailed: "letter.demo.modelFailed",
};

/** The keys of the stage chip's text in each phase. @type {Record<Exclude<DemoPhase, "off">, string>} */
const DEMO_BADGE = {
  loading: "letter.demo.badge.loading",
  playing: "letter.demo.badge.playing",
  done: "letter.demo.badge.done",
};

/** The one shared load; see loadDemoRecording(). @type {Promise<DemoRecording | null> | null} */
let _demoRecordingLoad = null;
/** The recording being played, or null before the first one has loaded. @type {DemoRecording | null} */
let _demoRecording = null;
/** The pending frame timer, or null when no loop runs. @type {number | null} */
let _demoTimer = null;
// stopDemo() bumps it; a start that finds it changed after an await was cancelled.
let _demoGeneration = 0;
/** The letter on the stage, or about to come up after the gap. */
let _demoIndex = 0;
/** No-hand frames still to publish before the next letter. */
let _demoGapFrames = 0;
let _demoTimestamp = 0;
/** @type {() => number} */
let _demoNoise = () => 0.5;

/**
 * Seeded (mulberry32), so a demo is reproducible frame for frame.
 *
 * @param {number} seed
 * @returns {() => number} Uniform values in [0, 1).
 */
function _seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {unknown} value
 * @returns {LandmarkList | null} Null unless there are exactly 21 points of
 *   three finite numbers each.
 */
function _parseDemoHand(value) {
  if (!Array.isArray(value) || value.length !== 21) return null;
  /** @type {LandmarkList} */
  const hand = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 3) return null;
    const [x, y, z] = point;
    if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    hand.push({ x, y, z });
  }
  return hand;
}

/**
 * Refused whole when anything is off, so a wrong shape never reaches the
 * overlay or the model.
 *
 * @param {unknown} value Parsed JSON.
 * @returns {DemoRecording | null}
 */
function parseDemoRecording(value) {
  if (!isRecord(value) || value.schema !== DEMO_RECORDING_SCHEMA) return null;
  const word = value.word;
  if (typeof word !== "string" || !/^[A-IK-Y]{1,16}$/.test(word)) return null;
  const entries = value.letters;
  if (!Array.isArray(entries) || entries.length !== word.length) return null;
  /** @type {DemoLetter[]} */
  const letters = [];
  for (let i = 0; i < word.length; i++) {
    const entry = entries[i];
    if (!isRecord(entry) || entry.letter !== word[i] || entry.handedness !== "Right") return null;
    const landmarks = _parseDemoHand(entry.landmarks);
    if (!landmarks) return null;
    letters.push({ letter: word[i], landmarks });
  }
  return { word, letters };
}

/**
 * Every caller shares one load. A failed one is forgotten, so the next start
 * asks again.
 *
 * @returns {Promise<DemoRecording | null>} Null when it cannot be used. Never rejects.
 */
function loadDemoRecording() {
  if (!_demoRecordingLoad) {
    _demoRecordingLoad = _fetchDemoRecording().then((recording) => {
      if (!recording) _demoRecordingLoad = null;
      return recording;
    });
  }
  return _demoRecordingLoad;
}

/** @returns {Promise<DemoRecording | null>} */
async function _fetchDemoRecording() {
  try {
    const res = await fetch(DEMO_RECORDING_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const recording = parseDemoRecording(await res.json());
    if (!recording) console.warn("demo-letters.json is not an asl-demo-letters-v1 recording");
    return recording;
  } catch (err) {
    console.warn("The demo recording could not be loaded:", err);
    return null;
  }
}

/**
 * Frames start once the recording is in and are dropped by live inference
 * until the letter model is ready, as the camera's are.
 *
 * @returns {Promise<DemoStartOutcome>} Never rejects; a failure is reported on the stage.
 */
async function startDemo() {
  if (state.cameraOn || _cameraStartAttempt) stopCamera();
  // The switch itself stops a running demo.
  if (state.mode !== "letter") setMode("letter", { focus: true });
  stopDemo();
  const generation = _demoGeneration;
  const cancelled = () => generation !== _demoGeneration;

  state.demo = "loading";
  resetSmoother();
  resetLetterLandmarkSmoother();
  clearCameraProblem();
  els.cameraEmpty.hidden = true;
  els.cameraStage.dataset.camera = "demo";
  // A letter left on the plate by an earlier camera session is not the demo's.
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  setMessage(() => t(DEMO_COPY.loading), "maybe");
  renderDemoPanel();

  const modelReady = ensureLetterModel();
  const recording = await loadDemoRecording();
  if (cancelled()) return "cancelled";
  if (!recording) {
    stopDemo();
    reportProblem(() => t(DEMO_COPY.loadFailed));
    return "failed";
  }

  _demoRecording = recording;
  _demoIndex = 0;
  _demoGapFrames = 0;
  _demoTimestamp = 0;
  _demoNoise = _seededRandom(DEMO_SEED);
  state.demo = "playing";
  renderDemoPanel();
  announce(t(DEMO_COPY.playing));
  if (!letterSession) setMessage(() => t(DEMO_COPY.modelLoading), "maybe");
  _publishDemoFrame();

  if (!(await modelReady) && !cancelled()) reportProblem(() => t(DEMO_COPY.modelFailed));
  return "playing";
}

/**
 * The one way out of the demo. Without a demo it does nothing, so the camera's
 * frame and stage are never touched.
 *
 * @returns {void}
 */
function stopDemo() {
  _demoGeneration++;
  if (_demoTimer !== null) {
    clearTimeout(_demoTimer);
    _demoTimer = null;
  }
  if (state.demo === "off") return;
  state.demo = "off";
  latestMediaPipeResult = null;
  resetSmoother();
  resetLetterLandmarkSmoother();
  els.cameraEmpty.hidden = false;
  els.cameraStage.dataset.camera = "off";
  setText(els.latencyBadge, "shell.badge.ready");
  renderDemoPanel();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  els.cameraStage.dataset.state = "idle";
}

/**
 * Called by the add itself, so the demo never decides that a letter was taken.
 *
 * @param {string} letter The letter that was added.
 * @returns {void}
 */
function noteDemoLetterAdded(letter) {
  const current = _demoRecording?.letters[_demoIndex];
  if (current && current.letter === letter) _advanceDemo();
}

/**
 * @returns {void}
 */
function skipDemoLetter() {
  _advanceDemo();
}

/**
 * An add while the hand is already away repeats a letter in the text, as in
 * live signing, but does not skip one here.
 *
 * @returns {void}
 */
function _advanceDemo() {
  if (state.demo !== "playing" || _demoGapFrames > 0 || !_demoRecording) return;
  if (_demoIndex >= _demoRecording.letters.length) return;
  _demoIndex++;
  _demoGapFrames = Math.round(DEMO_GAP_MS / DEMO_FRAME_MS);
  renderDemoPanel();
}

/**
 * @param {LandmarkList} landmarks
 * @returns {LandmarkList}
 */
function _heldDemoHand(landmarks) {
  /** @param {number} amount */
  const wobble = (amount) => (_demoNoise() * 2 - 1) * amount;
  const dx = wobble(DEMO_DRIFT);
  const dy = wobble(DEMO_DRIFT);
  return landmarks.map((point) => ({
    x: point.x + dx + wobble(DEMO_TREMOR),
    y: point.y + dy + wobble(DEMO_TREMOR),
    z: point.z,
  }));
}

/**
 * @returns {void}
 */
function _publishDemoFrame() {
  _demoTimer = null;
  const recording = _demoRecording;
  if (state.demo !== "playing" || !recording) return;
  /** @type {LandmarkList | null} */
  let hand = null;
  if (_demoGapFrames > 0) {
    _demoGapFrames--;
  } else if (_demoIndex >= recording.letters.length) {
    _finishDemo();
    return;
  } else {
    hand = _heldDemoHand(recording.letters[_demoIndex].landmarks);
  }
  // A word recording skips a repeated timestamp, so a still clock must not make one.
  _demoTimestamp = Math.max(performance.now(), _demoTimestamp + 1);
  latestMediaPipeResult = {
    rightHandLandmarks: hand ? [hand] : null,
    leftHandLandmarks: null,
    handednessDebug: [],
    poseLandmarks: null,
    faceLandmarks: null,
    timestamp: _demoTimestamp,
    aspect: 1,
  };
  _demoTimer = window.setTimeout(_publishDemoFrame, DEMO_FRAME_MS);
}

/**
 * The plate is cleared with the hand, so the last letter cannot be added again
 * from an empty stage.
 *
 * @returns {void}
 */
function _finishDemo() {
  state.demo = "done";
  latestMediaPipeResult = null;
  resetSmoother();
  resetLetterLandmarkSmoother();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  els.cameraStage.dataset.state = "idle";
  renderDemoPanel();
  announce(t(DEMO_COPY.done));
}

/**
 * A drawing transform only: the landmarks the model reads are not touched. The
 * square sits in the room the demo card and the plate leave on the stage.
 *
 * @param {number} width Stage width in CSS pixels.
 * @param {number} height Stage height in CSS pixels.
 * @param {{left: number, top: number}} [origin] The stage's own box on the
 *   page, to bring the card and the plate into stage pixels.
 * @returns {VideoCoverRect}
 */
function demoFrameRect(width, height, origin = { left: 0, top: 0 }) {
  let top = 0;
  let bottom = height;
  for (const element of [els.demoPanel, els.resultPlate]) {
    if (!element || element.hidden) continue;
    const box = element.getBoundingClientRect();
    const boxTop = box.top - origin.top;
    const boxBottom = box.bottom - origin.top;
    const over =
      box.width > 0 && box.height > 0 &&
      box.right - origin.left > 0 && box.left - origin.left < width &&
      boxBottom > 0 && boxTop < height;
    if (!over) continue;
    // Above the middle, it takes room from the top; below, from the bottom.
    if (boxTop + boxBottom < height) top = Math.max(top, boxBottom);
    else bottom = Math.min(bottom, boxTop);
  }
  const room = Math.max(0, bottom - top - 2 * DEMO_FRAME_GAP);
  const fitted = Math.min(DEMO_FRAME_SCALE * height, room, width - 2 * DEMO_FRAME_GAP);
  const side = Math.max(Math.min(DEMO_FRAME_MIN * height, width), fitted);
  const y = Math.min(Math.max(0, top + DEMO_FRAME_GAP + (room - side) / 2), Math.max(0, height - side));
  return { x: (width - side) / 2, y, width: side, height: side };
}

/**
 * @returns {void}
 */
function renderDemoPanel() {
  const on = state.demo !== "off";
  if (on) els.cameraStage.dataset.demo = state.demo;
  else els.cameraStage.removeAttribute("data-demo");
  if (els.cameraToggle) els.cameraToggle.hidden = on;
  if (els.demoStop) {
    els.demoStop.hidden = !on;
    setText(els.demoStop, state.demo === "done" ? "letter.demo.close" : "letter.demo.stop");
  }
  const panel = els.demoPanel;
  if (panel) panel.hidden = !on;
  if (state.demo === "off") return;
  // Bound to their keys, so a language change rewrites the panel in place.
  setText(els.latencyBadge, DEMO_BADGE[state.demo]);

  const letters = state.demo === "loading" || !_demoRecording ? [] : _demoRecording.letters;
  if (els.demoWord) {
    els.demoWord.replaceChildren(
      ...letters.map((entry, i) => {
        const span = document.createElement("span");
        span.textContent = entry.letter;
        span.dataset.state = i < _demoIndex ? "done" : i === _demoIndex ? "current" : "next";
        return span;
      }),
    );
  }
  if (els.demoCount) {
    els.demoCount.textContent = letters.length ? `${Math.min(_demoIndex + 1, letters.length)}/${letters.length}` : "";
  }
  setText(els.demoText, DEMO_COPY[state.demo]);
  if (els.demoSkip) els.demoSkip.hidden = state.demo !== "playing";
  if (els.demoCamera) els.demoCamera.hidden = state.demo !== "done";
}
