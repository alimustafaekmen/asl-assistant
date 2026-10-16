// Shared browser runtime: mutable application state, the DOM registry, the
// overlay canvas context, and the word recording buffers.
//
// Every other script reads and writes these globals, so this file owns them and
// must load right after config.js. It only builds the initial values; it starts
// nothing and binds no events. Bootstrapping stays in core/app.js.
//
// The DOM registry is resolved at load time, which is safe because index.html
// declares its scripts at the end of <body>.

// ---------------------------------------------------------------------------
// Shared application types
//
// The app runs as classic scripts in one global scope, so these typedefs are
// visible to every module. They live here because runtime state is where their
// meaning is fixed; other files reference them instead of redefining them.
// ---------------------------------------------------------------------------

/**
 * A screen the app can route to. The value is also the URL hash.
 *
 * @typedef {"letter" | "word" | "coach" | "project" | "test" | "qr"} AppMode
 */

/**
 * Word recording state machine. Transitions run in this order and return to
 * IDLE on retry, mode change, or the camera stopping.
 *
 * @typedef {"IDLE" | "COUNTDOWN" | "RECORDING" | "PROCESSING" | "RESULT"} WordState
 */

/** @typedef {"letter" | "word"} CoachTargetType */

/** @typedef {"learn" | "practice" | "quiz"} CoachFlow */

/** Which published model a Model Test fixture runs against. @typedef {"letter" | "word"} ModelTask */

/** Modes the QR demo link can deep-link into. @typedef {"letter" | "word" | "test"} QrTarget */

/**
 * One ranked label from a model, as shown in the top-3 list.
 *
 * @typedef {Object} PredictionCandidate
 * @property {string} label
 * @property {number} confidence Probability in [0, 1].
 */

/**
 * A model result. Letter and word adapters return the same shape, and "no
 * prediction" is expressed as null rather than an empty result.
 *
 * @typedef {Object} PredictionResult
 * @property {string} label
 * @property {number} confidence Probability in [0, 1].
 * @property {PredictionCandidate[]} alternatives Ranked candidates, best first.
 */

/**
 * The advice shown under a finished word recording. It never appends anything
 * on its own; canAppend only enables the user's accept action.
 *
 * @typedef {Object} WordResultAssessment
 * @property {ConfidenceLevel} level Drives the guide's colour state.
 * @property {string} decision Short Turkish verdict shown to the user.
 * @property {string} action Turkish next-step sentence shown to the user.
 * @property {boolean} canAppend Whether the result may be accepted into the transcript.
 */

/**
 * Optional reference video links, in the same JSON shape the desktop prototype
 * uses. Missing entries fall back to a generated search URL.
 *
 * @typedef {Object} ReferenceVideoLinks
 * @property {string} alphabet_video
 * @property {Record<string, string>} words
 */

/**
 * Mutable application state shared by every module.
 *
 * fpsStart and the transcript debounce fields are absent until first written;
 * they are declared optional so this typedef matches the real object rather
 * than an idealised one.
 *
 * @typedef {Object} AppState
 * @property {AppMode} mode
 * @property {boolean} cameraOn
 * @property {MediaStream | null} stream
 * @property {string} transcript
 * @property {string} prediction Current top label, or "?" when there is none.
 * @property {number} confidence
 * @property {PredictionCandidate[]} top3
 * @property {number} frameCount
 * @property {WordState} wordState
 * @property {number} wordFrames Accepted frames in the current recording.
 * @property {string[]} wordQualityWarnings
 * @property {WordResultAssessment | null} wordResultAssessment
 * @property {string} coachTarget A single letter or a whole word.
 * @property {CoachTargetType} coachTargetType
 * @property {CoachFlow} coachFlow
 * @property {string} coachFeedback
 * @property {number} coachStep
 * @property {number} coachGoal
 * @property {number} quizTotal
 * @property {number} quizScore
 * @property {number} lastTick Letter inference throttle timestamp.
 * @property {number} fpsFrames
 * @property {number} fps
 * @property {boolean} debug
 * @property {ModelTask} modelTestTask
 * @property {ModelTestSample | null} modelTestSample
 * @property {ModelTestManifest | null} modelTestManifest
 * @property {QrTarget} qrTarget
 * @property {number} [fpsStart] Start of the current FPS measurement window.
 * @property {string} [lastTranscriptAppendKey] Debounce key of the last append.
 * @property {number} [lastTranscriptAppendTs] Timestamp of the last append.
 */

/**
 * Narrow an unvalidated value to something whose properties can be read.
 *
 * Arrays and class instances pass, exactly as a bare typeof check does; this
 * only establishes that property access is safe, never that the shape is right.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * Find the first HTML element matching a selector.
 *
 * @param {string} selector
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement | null}
 */
function queryElement(selector, root) {
  const element = (root || document).querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

/**
 * Find the HTML elements matching a selector.
 *
 * querySelectorAll resolves to Element, which carries neither dataset nor
 * hidden -- the two properties nearly every caller here reads. Every selector
 * the app uses targets HTML elements, so anything else is dropped rather than
 * handed to a caller that would read properties it does not have.
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
 * Whether a key event belongs to the focused element rather than to the page.
 *
 * The app's shortcuts would otherwise fight the user. Typing into a <select>
 * performs type-ahead; Space over a focused button was cancelled before it
 * could activate it; Enter must follow a focused link, open a focused
 * <summary>, and reach an element that acts as a button (the reference image).
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
 * Find every element carrying a stable UI hook.
 *
 * A hook is a data-ui attribute that exists only so the scripts can find the
 * element. Nothing styles it, so renaming a CSS class cannot detach behaviour,
 * and dropping the hook while editing the markup is a visible edit.
 *
 * @param {string} name Hook name, without the attribute syntax.
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement[]} Empty when the hook is absent.
 */
function queryAllUi(name, root) {
  return queryElements(`[data-ui="${name}"]`, root);
}

/**
 * Find the one element carrying a stable UI hook.
 *
 * @param {string} name Hook name, without the attribute syntax.
 * @param {ParentNode} [root] Search root; defaults to the document.
 * @returns {HTMLElement | null} Null when the hook is absent.
 */
function queryUi(name, root) {
  return queryElement(`[data-ui="${name}"]`, root);
}

/**
 * Resolve a DOM element the app cannot run without.
 *
 * Every id here is pinned by a contract test against index.html, so a failure
 * means the markup and the script disagree. Reporting that at startup is far
 * easier to act on than the null dereference it would otherwise cause later,
 * halfway through a camera session.
 *
 * The expected constructor is checked rather than asserted, so a field also
 * carries its real element type.
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
 * Resolve an optional DOM element, keeping its real element type.
 *
 * Used for controls whose absence the app already tolerates. A wrong element
 * type is reported as absent, which is how every caller already guards.
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
  stream: null,
  transcript: "",
  prediction: "?",
  confidence: 0,
  top3: [],
  frameCount: 0,
  wordState: "IDLE",
  wordFrames: 0,
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
  lastTick: performance.now(),
  fpsFrames: 0,
  fps: 0,
  debug: false,
  modelTestTask: "letter",
  modelTestSample: null,
  modelTestManifest: null,
  qrTarget: "letter",
};

const els = {
  video: requireElement("cameraVideo", HTMLVideoElement),
  canvas: requireElement("overlayCanvas", HTMLCanvasElement),
  cameraStage: requireElement("cameraStage"),
  cameraEmpty: requireElement("cameraEmpty"),
  cameraStatus: requireElement("cameraStatus"),
  controlBar: requireElement("controlBar"),
  cameraToggle: document.getElementById("cameraToggle"),
  recordWord: optionalElement("recordWord", HTMLButtonElement),
  retryWord: optionalElement("retryWord", HTMLButtonElement),
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
  wordStateHint: requireElement("wordStateHint"),
  wordResultGuide: document.getElementById("wordResultGuide"),
  wordResultDecision: document.getElementById("wordResultDecision"),
  wordResultAction: document.getElementById("wordResultAction"),
  coachCard: requireElement("coachCard"),
  coachTarget: requireElement("coachTarget", HTMLSelectElement),
  coachTargetBig: requireElement("coachTargetBig"),
  coachHint: requireElement("coachHint"),
  coachScore: requireElement("coachScore"),
  coachProgress: requireElement("coachProgress"),
  referenceImage: requireElement("referenceImage", HTMLImageElement),
  referenceBody: requireElement("referenceBody"),
  toggleReference: requireElement("toggleReference"),
  referenceThumbs: document.getElementById("referenceThumbs"),
  offlineTest: requireElement("offlineTest"),
  manualAddLetter: document.getElementById("manualAddLetter"),
  insertSpace: document.getElementById("insertSpace"),
  removeLastChar: document.getElementById("removeLastChar"),
  coachLettersOnly: document.getElementById("coachLettersOnly"),
  coachWordsOnly: document.getElementById("coachWordsOnly"),
  coachStart: document.getElementById("coachStart"),
  coachCheck: document.getElementById("coachCheck"),
  coachNextTarget: document.getElementById("coachNextTarget"),
  coachVideoLink: optionalElement("coachVideoLink", HTMLAnchorElement),
  coachFlowTitle: document.getElementById("coachFlowTitle"),
  coachFlowText: document.getElementById("coachFlowText"),
  coachModeLabel: document.getElementById("coachModeLabel"),
  coachNextActionTitle: document.getElementById("coachNextActionTitle"),
  coachNextActionText: document.getElementById("coachNextActionText"),
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
  modelTestScreen: document.getElementById("modelTestScreen"),
  qrScreen: document.getElementById("qrScreen"),
  workspaceMain: queryUi("workspace"),
  appShell: queryUi("app-shell"),
  themeToggle: document.getElementById("themeToggle"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toastText"),
  toastAction: document.getElementById("toastAction"),
  announcer: document.getElementById("announcer"),
  wordQualityPills: document.getElementById("wordQualityPills"),
  wordDemoList: document.getElementById("wordDemoList"),
  wordRiskList: document.getElementById("wordRiskList"),
  wordConfusionList: document.getElementById("wordConfusionList"),
  showDemoFlow: document.getElementById("showDemoFlow"),
  showTechSummary: document.getElementById("showTechSummary"),
  demoFlowSection: document.getElementById("demoFlowSection"),
  techSummarySection: document.getElementById("techSummarySection"),
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
  qrCanvas: document.getElementById("qrCanvas"),
  qrDemoUrl: document.getElementById("qrDemoUrl"),
  qrOpenDemo: optionalElement("qrOpenDemo", HTMLAnchorElement),
  qrCopyDemo: document.getElementById("qrCopyDemo"),
  qrStatus: document.getElementById("qrStatus"),
};

const ctx = els.canvas.getContext("2d");
if (!ctx) {
  throw new Error("Overlay canvas 2D context alinamadi.");
}

// Word recording buffers consumed by realInference(). frameBuffer holds the
// compact model input; normalizedFrameBuffer keeps the normalized frames so
// features can be rebuilt at sequence level when the recording completes.
/** @type {Frame321D | null} */
let previousFrame = null;
/** @type {WordFeatures168[]} */
let frameBuffer = [];
/** @type {Frame321D[]} */
let normalizedFrameBuffer = [];

// Optional reference links use the same JSON shape as the desktop prototype.
// If the web copy is absent, the UI falls back to a target-specific search URL.
/** @type {ReferenceVideoLinks} */
let referenceVideoLinks = { alphabet_video: "", words: {} };
