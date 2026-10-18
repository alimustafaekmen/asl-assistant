// The camera-free letter demo: a recorded hand played through the live
// letter pipeline.
//
// A visitor without a camera, or whose camera is blocked (an in-app browser),
// watches the letter screen read letters from a recorded hand. The demo is
// only a frame source: it publishes the recorded landmarks to
// latestMediaPipeResult, where the camera's frames go, and the render loop,
// the overlay, realInference(), the smoother and the plate run unchanged.
// Neither the camera nor MediaPipe is started; the letter model loads as it
// does for the camera.
//
// Consent stays the user's. Each letter is held until the user adds it (Space
// or Ekle) or skips it; then the hand leaves the frame for a moment, as a
// signer's does, so the smoother starts the next letter from nothing. Only an
// add of the letter on the stage moves the demo on: the plate still shows the
// last letter until the model has read the next pose, and adding that stale
// letter must not count for the new one.
//
// The recording (data/demo-letters.json) holds landmarks of square
// photographs, so every frame says aspect 1, and the overlay draws the square
// in the stage's clear middle: the hidden video's size must not reach the
// features, and there is no video to cover.
//
// One frame loop at most: every start stops the previous demo first, and
// stopDemo() is the one way out, used by the stop button, a camera start,
// every mode or route change, and a hidden page.

/**
 * One letter of the demo recording: the letter and the right hand that signs it.
 *
 * @typedef {Object} DemoLetter
 * @property {string} letter One of the 24 static letters.
 * @property {LandmarkList} landmarks 21 points in a square image, x and y in 0..1.
 */

/**
 * The demo recording, validated: a word and one hand per letter, in order.
 *
 * @typedef {Object} DemoRecording
 * @property {string} word
 * @property {DemoLetter[]} letters
 */

/**
 * How a start ended: playing, refused (the recording could not be used), or
 * cancelled by whatever stopped it while it loaded.
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
 * How far a held hand wobbles, as a fraction of the frame: the whole hand
 * drifts by up to DEMO_DRIFT and each point trembles by up to DEMO_TREMOR.
 * Together they stay well under half a percent, which the letter model reads
 * through unchanged.
 */
const DEMO_DRIFT = 0.0015;
const DEMO_TREMOR = 0.0005;
const DEMO_SEED = 0x5eed;
/**
 * The recorded square's side as a share of the stage's height, at most. The
 * photographs are cropped tight to the hand, which would fill the stage edge
 * to edge.
 */
const DEMO_FRAME_SCALE = 0.7;
/**
 * The least side, as a share of the stage's height. On a short phone the
 * demo's card and the plate leave little between them; below this the hand
 * would be too small to read, so it overlaps them a little instead.
 */
const DEMO_FRAME_MIN = 0.3;
/** Room kept between the square and whatever lies over the stage, in CSS pixels. */
const DEMO_FRAME_GAP = 12;

/**
 * The demo's words, in Turkish, addressing the visitor as siz. Ekle and Space
 * name the button and the key the visitor sees in the action bar; "Boşluk" is
 * avoided because the button of that name inserts a space.
 *
 * @type {Record<"loading" | "playing" | "done" | "loadFailed" | "modelLoading" | "modelFailed", string>}
 */
const DEMO_COPY = {
  loading: "Örnek hazırlanıyor…",
  playing: "Okunan harfi metne eklemek için Ekle'ye dokunun ya da Space tuşuna basın.",
  done: "Örnek tamamlandı. Şimdi kamerayı açıp kendi elinizle deneyin.",
  loadFailed: "Örnek yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.",
  modelLoading: "Harf tanıma hazırlanıyor…",
  modelFailed: "Harf tanıma yüklenemedi. Bağlantınızı kontrol edip örneği yeniden başlatın.",
};

/** @type {Record<Exclude<DemoPhase, "off">, string>} */
const DEMO_BADGE = {
  loading: "Örnek hazırlanıyor",
  playing: "Örnek oynatılıyor",
  done: "Örnek bitti",
};

/** The one shared load; see loadDemoRecording(). @type {Promise<DemoRecording | null> | null} */
let _demoRecordingLoad = null;
/** The recording being played, or null before the first one has loaded. @type {DemoRecording | null} */
let _demoRecording = null;
/** The pending frame timer, or null when no loop runs. @type {number | null} */
let _demoTimer = null;
// stopDemo() bumps it; a start that finds it changed after an await was
// cancelled and leaves everything to whatever is current.
let _demoGeneration = 0;
/** The letter on the stage, or about to come up after the gap. */
let _demoIndex = 0;
/** No-hand frames still to publish before the next letter. */
let _demoGapFrames = 0;
let _demoTimestamp = 0;
/** @type {() => number} */
let _demoNoise = () => 0.5;

/**
 * A small seeded generator (mulberry32), so the wobble is the same on every
 * run and a demo can be reproduced frame for frame.
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
 * Read 21 [x, y, z] points as a landmark list.
 *
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
 * Validate a fetched recording against schema asl-demo-letters-v1.
 *
 * Refused whole when anything is off, so a wrong shape never reaches the
 * overlay or the model: the word must be static letters (A to Y without J or
 * Z), and each letter of it needs its own right hand, in order.
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
 * Fetch and validate the recording, the first time a demo starts.
 *
 * Every caller shares one load. A failed one is forgotten, so the next start
 * asks again instead of inheriting the failure for the rest of the visit.
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
 * Start the demo on the letter screen.
 *
 * The camera is released first, since a demo never runs beside it, and a demo
 * already running is stopped, so a restart leaves one loop. The recording and
 * the letter model load side by side; frames start once the recording is in,
 * and are dropped by live inference until the model is ready, as the
 * camera's are. A model that cannot load leaves the hand playing and says
 * so, as a camera without its models does.
 *
 * @returns {Promise<DemoStartOutcome>} Never rejects; a failure is reported on the stage.
 */
async function startDemo() {
  if (state.cameraOn || _cameraStartAttempt) stopCamera();
  // The switch itself stops a running demo, as every mode change does.
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
  setMessage(DEMO_COPY.loading, "maybe");
  renderDemoPanel();

  const modelReady = ensureLetterModel();
  const recording = await loadDemoRecording();
  if (cancelled()) return "cancelled";
  if (!recording) {
    stopDemo();
    reportProblem(DEMO_COPY.loadFailed);
    return "failed";
  }

  _demoRecording = recording;
  _demoIndex = 0;
  _demoGapFrames = 0;
  _demoTimestamp = 0;
  _demoNoise = _seededRandom(DEMO_SEED);
  state.demo = "playing";
  renderDemoPanel();
  announce(DEMO_COPY.playing);
  if (!letterSession) setMessage(DEMO_COPY.modelLoading, "maybe");
  _publishDemoFrame();

  if (!(await modelReady) && !cancelled()) reportProblem(DEMO_COPY.modelFailed);
  return "playing";
}

/**
 * Stop the demo and put the stage back at rest.
 *
 * The one way out: it cancels a start still loading, ends the frame loop and
 * takes the recorded hand off the stage. Without a demo it does nothing, so
 * the camera's frame and stage are never touched.
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
  els.latencyBadge.textContent = "Hazır";
  renderDemoPanel();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  els.cameraStage.dataset.state = "idle";
}

/**
 * Move on once the user has added the letter on the stage. Called by the add
 * itself, so the demo never decides that a letter was taken.
 *
 * @param {string} letter The letter that was added.
 * @returns {void}
 */
function noteDemoLetterAdded(letter) {
  const current = _demoRecording?.letters[_demoIndex];
  if (current && current.letter === letter) _advanceDemo();
}

/**
 * Move on without adding the letter on the stage.
 *
 * @returns {void}
 */
function skipDemoLetter() {
  _advanceDemo();
}

/**
 * Take the hand out of frame and line up the next letter. Once per letter: an
 * add while the hand is already away repeats a letter in the text, as in live
 * signing, but does not skip one here.
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
 * The recorded hand as it is held in this frame: the whole hand drifts a
 * little and each point trembles a little less.
 *
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
 * Publish one frame and schedule the next: the letter on the stage, or no
 * hand during a gap. After the last gap the demo is done and the loop ends.
 *
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
  // MediaPipe's own timestamps never repeat, and a word recording skips a
  // repeated one; a clock that stands still must not make one here.
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
 * Every letter has been added or skipped: no more frames, and the stage
 * offers the camera. The plate is cleared with the hand, so the last letter
 * cannot be added again from an empty stage.
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
  announce(DEMO_COPY.done);
}

/**
 * Where the recorded square is drawn on the stage, as a drawing transform
 * only: the landmarks the model reads are not touched.
 *
 * The square is centred across the stage and, between the demo's card above
 * and the plate below (each counted only where it lies over the stage), in
 * the room they leave; it is at most DEMO_FRAME_SCALE of the stage's height
 * and never wider than the stage. Layout reads only: nothing is written.
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
 * Show the demo's panel for the current phase: the word with the letter on
 * the stage marked, how far it has got, what to do, and the actions that
 * apply. Render only.
 *
 * @returns {void}
 */
function renderDemoPanel() {
  const on = state.demo !== "off";
  // The stage's own data, for the stylesheet: which phase the demo is in.
  if (on) els.cameraStage.dataset.demo = state.demo;
  else els.cameraStage.removeAttribute("data-demo");
  // There is no camera to close while the demo plays; its stop takes that place.
  if (els.cameraToggle) els.cameraToggle.hidden = on;
  if (els.demoStop) {
    els.demoStop.hidden = !on;
    els.demoStop.textContent = state.demo === "done" ? "Kapatın" : "Durdurun";
  }
  const panel = els.demoPanel;
  if (panel) panel.hidden = !on;
  if (state.demo === "off") return;
  els.latencyBadge.textContent = DEMO_BADGE[state.demo];

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
  if (els.demoText) els.demoText.textContent = DEMO_COPY[state.demo];
  if (els.demoSkip) els.demoSkip.hidden = state.demo !== "playing";
  if (els.demoCamera) els.demoCamera.hidden = state.demo !== "done";
}
