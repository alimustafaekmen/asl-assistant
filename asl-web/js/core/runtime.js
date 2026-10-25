// Shared state, the DOM registry, the overlay context and the word recording
// buffers, plus the app-wide typedefs. Loads right after config.js and starts
// nothing; the registry resolves at load time because the scripts sit at the
// end of <body>.

/**
 * A screen the app can route to. The value is also the URL hash.
 *
 * @typedef {"letter" | "word" | "coach" | "project" | "test" | "qr"} AppMode
 */

/**
 * Returns to IDLE on retry, mode change, or the camera stopping.
 *
 * @typedef {"IDLE" | "COUNTDOWN" | "RECORDING" | "PROCESSING" | "RESULT"} WordState
 */

/**
 * Why the last recording went back to IDLE early; kept until the next one starts.
 * "download-failed" means the word model never loaded, so recording never began.
 *
 * @typedef {"timeout" | "download-failed" | "hidden" | "cancelled"} WordEnd
 */

/**
 * A recording quality warning code; prediction.js holds the user-facing text.
 *
 * @typedef {"pose" | "face" | "hand" | "few-frames" | "slow" | "still"} WordQualityCode
 */

/**
 * Landmark groups in the latest result while a word is counted down and recorded.
 *
 * @typedef {Object} WordFraming
 * @property {boolean} hand
 * @property {boolean} face
 * @property {boolean} pose The shoulders.
 */

/** @typedef {"letter" | "word"} CoachTargetType */

/** @typedef {"learn" | "practice" | "quiz"} CoachFlow */

/**
 * "miss": another letter or an unreadable hand has shown for a while; a hold may
 * still start. "staying": the learner chose to stay on the target after a success.
 *
 * @typedef {"camera-off" | "no-hand" | "watching" | "holding" | "miss" | "success" | "staying"} CoachPhase
 */

/**
 * @typedef {Object} CoachAttempt
 * @property {CoachPhase} phase
 * @property {number} holdProgress How full the hold is, in [0, 1].
 * @property {boolean} targetCounted A quiz question scores once however often it is held.
 * @property {string | null} missLetter The letter a miss names, "?" for an unreadable hand.
 * @property {boolean} advancing The next target comes up on its own after a success.
 * @property {boolean} hintOpen Whether the hint for this target has been opened.
 */

/**
 * "done": every letter was added or skipped and the stage offers the camera.
 *
 * @typedef {"off" | "loading" | "playing" | "done"} DemoPhase
 */

/** Which published model a Model Test fixture runs against. @typedef {"letter" | "word"} ModelTask */

/** Modes the QR demo link can deep-link into. @typedef {"letter" | "word" | "test"} QrTarget */

/**
 * @typedef {Object} PredictionCandidate
 * @property {string} label
 * @property {number} confidence Probability in [0, 1].
 */

/**
 * Letter and word adapters return the same shape; no prediction is null.
 *
 * @typedef {Object} PredictionResult
 * @property {string} label
 * @property {number} confidence Probability in [0, 1].
 * @property {PredictionCandidate[]} alternatives Ranked candidates, best first.
 */

/**
 * canAppend only enables the user's accept action; nothing is appended on its own.
 *
 * @typedef {Object} WordResultAssessment
 * @property {ConfidenceLevel} level Drives the guide's colour state.
 * @property {string} decision Short Turkish verdict shown to the user.
 * @property {string} action Turkish next-step sentence shown to the user.
 * @property {boolean} canAppend Whether the result may be accepted into the transcript.
 */

/**
 * Same JSON shape as the desktop prototype; missing entries fall back to a search URL.
 *
 * @typedef {Object} ReferenceVideoLinks
 * @property {string} alphabet_video
 * @property {Record<string, string>} words
 */

/**
 * One word's card on its reference page, from data/word_reference.json.
 * @typedef {Object} WordCard
 * @property {string} label The word as the model names it, e.g. "thankyou".
 * @property {number} card 1-based position, also the number printed on the card.
 * @property {number} page 1-based reference page.
 * @property {[number, number, number, number]} rect x, y, width, height as fractions of the page.
 * @property {string} title The display form, e.g. "thank you".
 * @property {string} gloss The Turkish gloss; shown only once reviewed.
 */

/**
 * @typedef {Object} WordReference
 * @property {[number, number]} pageSize Page image size in pixels.
 * @property {boolean} glossReviewed Whether a signer has reviewed the glosses.
 * @property {WordCard[]} cards Every card, in card order.
 */

/**
 * The optional fields are absent until first written.
 *
 * @typedef {Object} AppState
 * @property {AppMode} mode
 * @property {boolean} cameraOn
 * @property {DemoPhase} demo The camera-free demo; it never runs beside the camera.
 * @property {MediaStream | null} stream
 * @property {string} transcript
 * @property {string} prediction Current top label, or "?" when there is none.
 * @property {number} confidence
 * @property {PredictionCandidate[]} top3
 * @property {number} frameCount
 * @property {WordState} wordState
 * @property {number} wordFrames Accepted frames in the current recording.
 * @property {WordEnd | null} wordEnd Why the last recording ended early; null otherwise.
 * @property {WordFraming | null} wordFraming What the camera showed in the latest countdown or recording frame.
 * @property {WordQualityCode[]} wordQualityWarnings Quality warnings of the last finished recording.
 * @property {WordResultAssessment | null} wordResultAssessment
 * @property {string} coachTarget A single letter or a whole word.
 * @property {CoachTargetType} coachTargetType
 * @property {CoachFlow} coachFlow
 * @property {string} coachFeedback
 * @property {number} coachStep
 * @property {number} coachGoal
 * @property {number} quizTotal
 * @property {number} quizScore
 * @property {CoachAttempt} coach The attempt at the current coach target letter.
 * @property {number} lastTick When a letter context last ran inference; the render loop's throttle.
 * @property {number} fpsFrames
 * @property {number} fps
 * @property {boolean} debug
 * @property {ModelTask} modelTestTask
 * @property {ModelTestSample | null} modelTestSample
 * @property {ModelTestManifest | null} modelTestManifest
 * @property {ModelTestBatch | null} modelTestBatch The latest run over every sample, or null.
 * @property {QrTarget} qrTarget
 * @property {number} [fpsStart] Start of the current FPS measurement window.
 * @property {string} [lastTranscriptAppendKey] Debounce key of the last append.
 * @property {number} [lastTranscriptAppendTs] Timestamp of the last append.
 */

/**
 * Establishes only that property access is safe, never that the shape is right.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * Whether the camera or the playing demo is publishing frames to the live pipeline.
 *
 * @returns {boolean}
 */
function framesLive() {
  return state.cameraOn || state.demo === "playing";
}

/**
 * Adds a pinned CDN script. The browser runs it only if its bytes match the
 * integrity hash, which needs a CORS request.
 *
 * @param {{src: string, integrity: string}} script
 * @returns {Promise<void>} Settles when the script has run or failed to load.
 */
function loadCdnScript({ src, integrity }) {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = src;
    element.integrity = integrity;
    element.crossOrigin = "anonymous";
    element.addEventListener("load", () => resolve());
    element.addEventListener("error", () => {
      element.remove();
      reject(new Error(`could not load ${src}`));
    });
    document.head.appendChild(element);
  });
}

/**
 * @param {string} selector
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement | null}
 */
function queryElement(selector, root) {
  const element = (root || document).querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

/**
 * Drops anything that is not an HTMLElement, so callers can read dataset and hidden.
 *
 * @param {string} selector
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement[]}
 */
function queryElements(selector, root) {
  const scope = root || document;
  return Array.from(scope.querySelectorAll(selector)).filter(
    (node) => node instanceof HTMLElement,
  );
}

/**
 * Whether a key event belongs to the focused element, so page shortcuts must
 * leave it alone (type-ahead, Space on a button, Enter on a link or summary).
 *
 * @param {EventTarget | null} target The event's target.
 * @returns {boolean} True when the focused element handles these keys itself.
 */
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A", "SUMMARY"].includes(target.tagName)) return true;
  return target.getAttribute("role") === "button";
}

/**
 * data-ui hooks exist only for scripts, so renaming a CSS class cannot detach behaviour.
 *
 * @param {string} name Hook name, without the attribute syntax.
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement[]} Empty when the hook is absent.
 */
function queryAllUi(name, root) {
  return queryElements(`[data-ui="${name}"]`, root);
}

/**
 * @param {string} name Hook name, without the attribute syntax.
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement | null} Null when the hook is absent.
 */
function queryUi(name, root) {
  return queryElement(`[data-ui="${name}"]`, root);
}

/**
 * A missing required element means the markup and the script disagree; failing
 * at startup beats a null dereference halfway through a camera session.
 *
 * @template {typeof HTMLElement} T
 * @param {string} id
 * @param {T} [type] Expected element constructor; defaults to any element.
 * @returns {InstanceType<T>}
 * @throws {Error} When the element is missing or is not of the expected type.
 */
function requireElement(id, type) {
  const expected = type || HTMLElement;
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Gerekli DOM elemani bulunamadi: #${id}`);
  }
  if (!(element instanceof expected)) {
    throw new Error(`#${id} beklenen turde degil: ${expected.name}`);
  }
  return /** @type {InstanceType<T>} */ (element);
}

/**
 * A wrong element type reads as absent, which every caller already guards.
 *
 * @template {typeof HTMLElement} T
 * @param {string} id
 * @param {T} type Expected element constructor.
 * @returns {InstanceType<T> | null}
 */
function optionalElement(id, type) {
  const element = document.getElementById(id);
  return element instanceof type ? /** @type {InstanceType<T>} */ (element) : null;
}

/** @type {AppState} */
const state = {
  mode: "letter",
  cameraOn: false,
  demo: "off",
  stream: null,
  transcript: "",
  prediction: "?",
  confidence: 0,
  top3: [],
  frameCount: 0,
  wordState: "IDLE",
  wordFrames: 0,
  wordEnd: null,
  wordFraming: null,
  wordQualityWarnings: [],
  wordResultAssessment: null,
  coachTarget: "A",
  coachTargetType: "letter",
  coachFlow: "learn",
  coachFeedback: "",
  coachStep: 0,
  coachGoal: 5,
  quizTotal: 5,
  quizScore: 0,
  coach: { phase: "camera-off", holdProgress: 0, targetCounted: false, missLetter: null, advancing: false, hintOpen: false },
  lastTick: performance.now(),
  fpsFrames: 0,
  fps: 0,
  debug: false,
  modelTestTask: "letter",
  modelTestSample: null,
  modelTestManifest: null,
  modelTestBatch: null,
  qrTarget: "letter",
};

const els = {
  video: requireElement("cameraVideo", HTMLVideoElement),
  canvas: requireElement("overlayCanvas", HTMLCanvasElement),
  cameraStage: requireElement("cameraStage"),
  // Optional: without it the plate does not switch corners (plate-side.js).
  resultPlate: document.getElementById("resultPlate"),
  cameraEmpty: requireElement("cameraEmpty"),
  // The empty stage's first-visit content and the problem that replaces it.
  cameraIntro: document.getElementById("cameraIntro"),
  cameraProblem: document.getElementById("cameraProblem"),
  cameraProblemTitle: document.getElementById("cameraProblemTitle"),
  cameraProblemText: document.getElementById("cameraProblemText"),
  cameraRetry: document.getElementById("cameraRetry"),
  cameraNoCamera: document.getElementById("cameraNoCamera"),
  cameraHelpSteps: document.getElementById("cameraHelpSteps"),
  cameraStatus: requireElement("cameraStatus"),
  controlBar: requireElement("controlBar"),
  cameraToggle: document.getElementById("cameraToggle"),
  // Optional: without the panel the demo still plays.
  demoPanel: document.getElementById("demoPanel"),
  demoWord: document.getElementById("demoWord"),
  demoCount: document.getElementById("demoCount"),
  demoText: document.getElementById("demoText"),
  demoSkip: optionalElement("demoSkip", HTMLButtonElement),
  demoStop: optionalElement("demoStop", HTMLButtonElement),
  demoCamera: optionalElement("demoCamera", HTMLButtonElement),
  recordWord: optionalElement("recordWord", HTMLButtonElement),
  retryWord: optionalElement("retryWord", HTMLButtonElement),
  cancelWord: optionalElement("cancelWord", HTMLButtonElement),
  appendWordResult: optionalElement("appendWordResult", HTMLButtonElement),
  actionVideoLink: optionalElement("actionVideoLink", HTMLAnchorElement),
  speakText: document.getElementById("speakText"),
  clearText: document.getElementById("clearText"),
  copyText: requireElement("copyText"),
  primaryPrediction: requireElement("primaryPrediction"),
  confidenceText: requireElement("confidenceText"),
  confidenceRing: requireElement("confidenceRing"),
  confidenceMessage: requireElement("confidenceMessage"),
  feedbackBar: document.getElementById("feedbackBar"),
  decisionLabel: requireElement("decisionLabel"),
  top3List: requireElement("top3List"),
  transcriptText: requireElement("transcriptText"),
  modeBadge: requireElement("modeBadge"),
  resultKind: requireElement("resultKind"),
  latencyBadge: requireElement("latencyBadge"),
  fpsLabel: requireElement("fpsLabel"),
  wordStateCard: requireElement("wordStateCard"),
  wordStateLabel: requireElement("wordStateLabel"),
  frameProgress: requireElement("frameProgress"),
  wordProgress: document.getElementById("wordProgress"),
  wordHudStep: document.getElementById("wordHudStep"),
  wordHudPercent: document.getElementById("wordHudPercent"),
  wordStateHint: requireElement("wordStateHint"),
  wordResultGuide: document.getElementById("wordResultGuide"),
  wordResultDecision: document.getElementById("wordResultDecision"),
  wordResultAction: document.getElementById("wordResultAction"),
  // The tile, verdict, grid and study cards are the coach screen itself, so
  // they are required; the rest is optional.
  coachStudy: requireElement("coachStudy"),
  coachTargetTile: requireElement("coachTargetTile"),
  coachTargetGlyph: requireElement("coachTargetGlyph"),
  coachVerdict: requireElement("coachVerdict"),
  coachGrid: requireElement("coachGrid"),
  coachTarget: requireElement("coachTarget", HTMLSelectElement),
  coachHint: requireElement("coachHint"),
  coachScore: requireElement("coachScore"),
  coachProgress: requireElement("coachProgress"),
  referenceImage: requireElement("referenceImage", HTMLImageElement),
  referenceBody: requireElement("referenceBody"),
  toggleReference: requireElement("toggleReference"),
  referenceThumbs: document.getElementById("referenceThumbs"),
  manualAddLetter: document.getElementById("manualAddLetter"),
  insertSpace: document.getElementById("insertSpace"),
  removeLastChar: document.getElementById("removeLastChar"),
  coachLettersOnly: document.getElementById("coachLettersOnly"),
  coachWordsOnly: document.getElementById("coachWordsOnly"),
  coachFlowGroup: document.getElementById("coachFlowGroup"),
  coachContentGroup: document.getElementById("coachContentGroup"),
  coachLetterPicker: document.getElementById("coachLetterPicker"),
  coachWordPicker: document.getElementById("coachWordPicker"),
  coachDone: document.getElementById("coachDone"),
  coachGridNote: document.getElementById("coachGridNote"),
  coachStorageNote: document.getElementById("coachStorageNote"),
  coachReset: document.getElementById("coachReset"),
  coachReference: document.getElementById("coachReference"),
  coachAdvance: document.getElementById("coachAdvance"),
  coachAdvanceBar: document.getElementById("coachAdvanceBar"),
  coachStay: document.getElementById("coachStay"),
  coachSession: document.getElementById("coachSession"),
  coachSessionButton: document.getElementById("coachSessionButton"),
  coachSessionLabel: document.getElementById("coachSessionLabel"),
  coachSessionFlow: document.getElementById("coachSessionFlow"),
  coachSheetClose: document.getElementById("coachSheetClose"),
  coachNextTarget: document.getElementById("coachNextTarget"),
  coachHintButton: document.getElementById("coachHintButton"),
  coachRepeat: document.getElementById("coachRepeat"),
  coachNext: document.getElementById("coachNext"),
  coachCheck: document.getElementById("coachCheck"),
  referenceKicker: document.getElementById("referenceKicker"),
  referenceTitle: document.getElementById("referenceTitle"),
  referenceNote: document.getElementById("referenceNote"),
  referenceVideoLink: optionalElement("referenceVideoLink", HTMLAnchorElement),
  countdown: requireElement("countdown"),
  debugPanel: requireElement("debugPanel"),
  debugMode: requireElement("debugMode"),
  debugConfidence: requireElement("debugConfidence"),
  debugFrames: requireElement("debugFrames"),
  debugLatency: requireElement("debugLatency"),
  projectScreen: document.getElementById("projectScreen"),
  projectNumbers: document.getElementById("projectNumbers"),
  modelTestScreen: document.getElementById("modelTestScreen"),
  qrScreen: document.getElementById("qrScreen"),
  workspaceMain: queryUi("workspace"),
  appShell: queryUi("app-shell"),
  themeToggle: document.getElementById("themeToggle"),
  languageSwitch: document.getElementById("languageSwitch"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toastText"),
  toastAction: document.getElementById("toastAction"),
  announcer: document.getElementById("announcer"),
  wordQualityPills: document.getElementById("wordQualityPills"),
  wordDemoCard: document.getElementById("wordDemoCard"),
  wordDemoCount: document.getElementById("wordDemoCount"),
  wordDemoList: document.getElementById("wordDemoList"),
  wordConfusionList: document.getElementById("wordConfusionList"),
  wordLibrarySearch: optionalElement("wordLibrarySearch", HTMLInputElement),
  wordLibraryGroups: document.getElementById("wordLibraryGroups"),
  wordLibraryEmpty: document.getElementById("wordLibraryEmpty"),
  modelTestSampleStatus: document.getElementById("modelTestSampleStatus"),
  modelTestSampleFile: document.getElementById("modelTestSampleFile"),
  modelTestFileName: document.getElementById("modelTestFileName"),
  loadDemoLetter: document.getElementById("loadDemoLetter"),
  loadDemoWord: document.getElementById("loadDemoWord"),
  modelTestDropZone: document.getElementById("modelTestDropZone"),
  modelTestDomainHelp: document.getElementById("modelTestDomainHelp"),
  modelTestSampleSelect: optionalElement("modelTestSampleSelect", HTMLSelectElement),
  loadSelectedModelTestSample: optionalElement("loadSelectedModelTestSample", HTMLButtonElement),
  runModelTestSample: optionalElement("runModelTestSample", HTMLButtonElement),
  modelTestProcessSteps: document.getElementById("modelTestProcessSteps"),
  modelTestMatchBadge: document.getElementById("modelTestMatchBadge"),
  modelTestExpectedLabel: document.getElementById("modelTestExpectedLabel"),
  modelTestPredictedLabel: document.getElementById("modelTestPredictedLabel"),
  modelTestConfidence: document.getElementById("modelTestConfidence"),
  modelTestLatency: document.getElementById("modelTestLatency"),
  modelTestTop3List: document.getElementById("modelTestTop3List"),
  modelTestResultNote: document.getElementById("modelTestResultNote"),
  modelTestTaskLabel: document.getElementById("modelTestTaskLabel"),
  modelTestSourceLabel: document.getElementById("modelTestSourceLabel"),
  modelTestSchemaLabel: document.getElementById("modelTestSchemaLabel"),
  modelTestShapeLabel: document.getElementById("modelTestShapeLabel"),
  modelTestMaskLabel: document.getElementById("modelTestMaskLabel"),
  modelTestBatch: document.getElementById("modelTestBatch"),
  runModelTestBatch: document.getElementById("runModelTestBatch"),
  modelTestBatchHint: document.getElementById("modelTestBatchHint"),
  modelTestNoteLetter: document.getElementById("modelTestNoteLetter"),
  modelTestNoteWord: document.getElementById("modelTestNoteWord"),
  modelTestSummary: document.getElementById("modelTestSummary"),
  modelTestRows: document.getElementById("modelTestRows"),
  qrCanvas: document.getElementById("qrCanvas"),
  qrDemoUrl: document.getElementById("qrDemoUrl"),
  qrOpenDemo: optionalElement("qrOpenDemo", HTMLAnchorElement),
  qrCopyDemo: document.getElementById("qrCopyDemo"),
  qrShare: document.getElementById("qrShare"),
  qrStatus: document.getElementById("qrStatus"),
};

const ctx = els.canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get the overlay canvas 2D context.");
}

// normalizedFrameBuffer keeps normalized frames so the word features can be
// rebuilt at sequence level when the recording completes.
/** @type {Frame321D | null} */
let previousFrame = null;
/** @type {WordFeatures168[]} */
let frameBuffer = [];
/** @type {Frame321D[]} */
let normalizedFrameBuffer = [];

/** @type {ReferenceVideoLinks} */
let referenceVideoLinks = { alphabet_video: "", words: {} };

// Null until the optional data file has loaded.
/** @type {WordReference | null} */
let wordReference = null;
