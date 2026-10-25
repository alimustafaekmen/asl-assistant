// Word recording flow: countdown, capture progress, quality readout, and the
// action bar buttons that drive it.
//
// The recording state machine is IDLE -> COUNTDOWN -> RECORDING -> PROCESSING
// -> RESULT. Frames are collected by live inference; this file owns what the
// user sees and which controls are available at each step.
//
// Every way into a new recording clears the motion buffers, because a
// previous sign left in them would be fed into the next 45-frame window.
// Mode changes, stopping the camera, and finishing inference clear them from
// their own call sites.
//
// A finished recording always ends in RESULT, also when the model produced
// nothing: that RESULT shows no word and offers nothing to accept, so the
// user sees that this recording, not the one before, failed.

/**
 * Which recording is current, and which recording the result on screen came
 * from (0: no result on screen).
 *
 * Each start takes the next number. A model run publishes its result only if
 * no newer recording has started meanwhile, and accepting a word requires the
 * result to be the current recording's. Without this, the previous word would
 * stay acceptable through the next recording and could be appended again if
 * that recording failed.
 */
let wordRecordingSerial = 0;
let wordResultSerial = 0;

/**
 * @returns {boolean} True when the result on screen belongs to the latest
 *   recording.
 */
function wordResultIsCurrent() {
  return wordResultSerial !== 0 && wordResultSerial === wordRecordingSerial;
}

/**
 * The string the user is told when a recording ends before it finished, by
 * reason.
 *
 * @type {Record<WordEnd, string>}
 */
const WORD_END_COPY = {
  timeout: "word.end.timeout",
  "download-failed": "word.end.downloadFailed",
  hidden: "word.end.hidden",
  cancelled: "word.end.cancelled",
};

/**
 * A string named by its key, with the parameters to fill it with. Parameters
 * given as a function are worked out each time the string is shown, so a
 * percentage inside them follows the language too.
 *
 * @typedef {Object} WordCopy
 * @property {string} key
 * @property {I18nParams | (() => I18nParams) | null} [params]
 */

/**
 * The strings this file last put on the message line and the feedback bar,
 * which prediction.js owns and writes as plain text. A language change says
 * each again in the new language while the element still shows it; once
 * something else has written there, the entry is dropped.
 *
 * @type {Map<Element, {copy: WordCopy, text: string}>}
 */
const _wordLinesShown = new Map();

/**
 * @param {WordCopy} copy
 * @returns {string} The string in the current language.
 */
function wordCopyText(copy) {
  const params = typeof copy.params === "function" ? copy.params() : copy.params;
  return t(copy.key, params ?? null);
}

/**
 * Show a string through another module's writer, and remember it for the
 * next language change.
 *
 * @param {Element | null | undefined} element What the writer writes to.
 * @param {WordCopy} copy
 * @param {(text: string) => void} write
 * @returns {void}
 */
function showWordLine(element, copy, write) {
  write(wordCopyText(copy));
  if (element) _wordLinesShown.set(element, { copy, text: element.textContent ?? "" });
}

/**
 * @param {string} key
 * @param {ConfidenceLevel} level
 * @returns {void}
 */
function showWordMessage(key, level) {
  showWordLine(els.confidenceMessage, { key }, (text) => setMessage(text, level));
}

/**
 * @param {string} key
 * @returns {void}
 */
function reportWordProblem(key) {
  showWordLine(els.confidenceMessage, { key }, (text) => reportProblem(text));
}

/**
 * @param {WordCopy} copy
 * @param {FeedbackKind} kind
 * @returns {void}
 */
function showWordFeedback(copy, kind) {
  showWordLine(els.feedbackBar, copy, (text) => showFeedback(text, kind));
}

/**
 * A percentage as the current language writes it: "%40" in Turkish, "40%"
 * in English.
 *
 * @param {number} percent
 * @returns {string}
 */
function formatWordPercent(percent) {
  return t("word.percent", { n: percent });
}

/**
 * Ranked words as "1. label %40 · 2. ...", with the percentages written the
 * current language's way.
 *
 * @param {PredictionCandidate[]} items Best first.
 * @param {number} [limit=3]
 * @returns {string}
 */
function formatWordCandidates(items, limit = 3) {
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.label} ${formatWordPercent(Math.round((item.confidence || 0) * 100))}`)
    .join(" · ");
}

/**
 * Redraw the word screen and the reference in the current language: what the
 * recording state shows, the reference panel, an open viewer, and the
 * messages this file wrote that are still on screen.
 *
 * Renders only: the recording, the camera and the transcript are left as
 * they are, and a message already announced is not announced again.
 *
 * @returns {void}
 */
function renderWordLanguage() {
  updateWordState();
  renderWordQualityPills();
  for (const [element, line] of Array.from(_wordLinesShown)) {
    if (element.textContent !== line.text) {
      _wordLinesShown.delete(element);
      continue;
    }
    element.textContent = wordCopyText(line.copy);
    line.text = element.textContent ?? "";
  }
  updateReferenceForMode();
  renderOpenViewer();
}

/**
 * True while a record press waits for the word model. A second press in that
 * wait would only wait on the same download and report its outcome again.
 */
let _wordModelWait = false;

/**
 * How many record presses have waited on the word model. A model status
 * report compares it across its own wait: if a press waited too, the press
 * reports the outcome in its own words, and a second report would talk over
 * it.
 */
let wordModelPresses = 0;

/**
 * Say why the last recording did not finish, and keep the reason in state.
 *
 * @param {WordEnd} reason
 * @returns {void}
 */
function reportWordEnd(reason) {
  state.wordEnd = reason;
  reportWordProblem(WORD_END_COPY[reason]);
}

/**
 * The clock of the recording in RECORDING: which recording it belongs to,
 * the render-loop time of its first tick, and the time of its last usable
 * frame (null until one arrives).
 *
 * Keyed by the recording serial, so a recording abandoned by a mode change or
 * a stop cannot lend its elapsed time to the next one. There is no timer: the
 * render loop calls live inference on every animation frame, whether or not
 * MediaPipe saw anyone, and it stops with the camera.
 *
 * @type {{recording: number, startedAt: number, lastUsableAt: number | null}}
 */
let wordRecordingClock = { recording: 0, startedAt: 0, lastUsableAt: null };

/**
 * End a recording that the camera is not filling.
 *
 * Called by live inference on every render tick while recording. The first
 * usable frame may take WORD_FIRST_FRAME_TIMEOUT_MS, a later gap
 * WORD_NO_HAND_TIMEOUT_MS, and the whole recording WORD_MAX_RECORDING_MS.
 *
 * @param {number} now Render loop timestamp in milliseconds.
 * @returns {void}
 */
function checkWordRecordingClock(now) {
  if (state.wordState !== "RECORDING") return;
  if (wordRecordingClock.recording !== wordRecordingSerial) {
    wordRecordingClock = { recording: wordRecordingSerial, startedAt: now, lastUsableAt: null };
    return;
  }
  const { startedAt, lastUsableAt } = wordRecordingClock;
  const starved =
    lastUsableAt === null
      ? now - startedAt >= CONFIG.WORD_FIRST_FRAME_TIMEOUT_MS
      : now - lastUsableAt >= CONFIG.WORD_NO_HAND_TIMEOUT_MS;
  if (starved || now - startedAt >= CONFIG.WORD_MAX_RECORDING_MS) endWordRecordingEarly("timeout");
}

/**
 * Note that the recording just accepted a frame.
 *
 * @param {number} now Render loop timestamp in milliseconds.
 * @returns {void}
 */
function noteUsableWordFrame(now) {
  if (wordRecordingClock.recording === wordRecordingSerial) wordRecordingClock.lastUsableAt = now;
}

/** Whether the page-visibility listener has been added; it is added once. */
let _wordPageWatched = false;

/**
 * Abandon a countdown or recording when the page goes to the background.
 *
 * A hidden page gets no animation frames, so the recording would freeze
 * half-filled and resume later with a gap the model never saw. Only the
 * recording ends; the camera is left as it is. The first recording adds the
 * listener, which ignores every other state.
 *
 * @returns {void}
 */
function watchPageVisibilityForWordRecording() {
  if (_wordPageWatched) return;
  _wordPageWatched = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") endWordRecordingEarly("hidden");
  });
}

/**
 * Abandon a countdown or recording before it finished, and say why.
 *
 * The state returns to IDLE and the frames are discarded: a half-filled
 * window must not reach the model or the next recording. The countdown and
 * the clock stop on their own, since both check the state and the recording
 * serial.
 *
 * @param {WordEnd} reason
 * @returns {void}
 */
function endWordRecordingEarly(reason) {
  if (state.wordState !== "COUNTDOWN" && state.wordState !== "RECORDING") return;
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  if (typeof resetWordRecordingStats === "function") resetWordRecordingStats();

  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordFraming = null;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  els.countdown.hidden = true;
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateWordState();
  // Last, so nothing redrawn above replaces the reason on the message line.
  reportWordEnd(reason);
}

/**
 * Cancel a countdown or a recording at the user's request, from the Vazgeç
 * button or Escape.
 *
 * PROCESSING cannot be cancelled: it is one model call, and its result is
 * discarded by the same checks that guard a mode change.
 *
 * @returns {void}
 */
function cancelWordRecording() {
  endWordRecordingEarly("cancelled");
}

/**
 * Act on a key in word mode. The caller has already left modified keys alone.
 *
 * Enter records, or records again from a result; Space accepts the result
 * through the same guard as the accept button; Escape cancels a countdown or
 * a recording, from anywhere. A focused button, link or field keeps Enter and
 * Space for itself. There are deliberately no single-letter keys.
 *
 * @param {{key: string, code?: string, preventDefault: () => void}} event
 * @param {boolean} fromControl Whether focus was on a button, link or field.
 * @returns {boolean} Whether the key was taken.
 */
function handleWordKey(event, fromControl) {
  if (event.key === "Escape") {
    if (state.wordState !== "COUNTDOWN" && state.wordState !== "RECORDING") return false;
    event.preventDefault();
    cancelWordRecording();
    els.recordWord?.focus();
    return true;
  }
  if (fromControl) return false;
  // A key is taken from the browser only when it does something here.
  if (event.code === "Space") {
    if (state.wordState !== "RESULT") return false;
    event.preventDefault();
    const assessment = wordResultAccepted ? null : assessWordResult();
    if (assessment && !assessment.canAppend) announce(t("word.announce.notClear"));
    else appendWordResultToTranscript();
    return true;
  }
  if (event.key === "Enter") {
    if (!state.cameraOn || (state.wordState !== "IDLE" && state.wordState !== "RESULT")) return false;
    event.preventDefault();
    if (state.wordState === "IDLE") startWordRecording();
    else retryWordRecording();
    return true;
  }
  return false;
}

/**
 * Start a word recording: check readiness, clear the buffers, count down, then
 * hand over to live inference.
 *
 * The countdown is asynchronous, so the mode, the camera, and the recording
 * state are rechecked at every step and again at the end. Aborting leaves the
 * state where the user put it rather than forcing RECORDING.
 *
 * @returns {Promise<void>} Resolves once recording starts, or once the attempt
 *   is abandoned.
 */
async function startWordRecording() {
  if (!state.cameraOn) {
    showWordMessage("word.message.cameraFirst", "low");
    return;
  }

  if (state.mode === "coach" && state.coachTarget.length === 1) {
    showWordMessage("word.message.coachPickWord", "maybe");
    return;
  }
  if (!canCaptureWordInCurrentMode()) setMode("word");
  // The word model loads before the countdown. Everything below reads state
  // after this wait, so a camera stopped or a second click made meanwhile is
  // still seen. The load is shared and forgets a failure, so the next press
  // downloads again: the user is asked to try again, never to reload.
  if (_wordModelWait) return;
  const cameraSession = state.stream;
  if (!wordSession) showWordMessage("word.message.downloading", "maybe");
  _wordModelWait = true;
  wordModelPresses += 1;
  let modelReady = false;
  try {
    modelReady = await ensureWordModel();
  } finally {
    _wordModelWait = false;
  }
  // A camera stopped or restarted meanwhile has already reset the screen, and
  // a user who left word mode has moved on: neither needs this outcome.
  if (!state.cameraOn || state.stream !== cameraSession || !canCaptureWordInCurrentMode()) return;
  if (!modelReady) {
    reportWordEnd("download-failed");
    return;
  }
  // camera.js declares these; a page that could not fetch it has no tracking
  // at all, so undeclared counts as not ready, never as ready.
  if (typeof mpRunning === "undefined" || !mpRunning) {
    showWordMessage("word.message.waitForTracking", "maybe");
    return;
  }
  if (
    typeof poseLandmarker === "undefined" ||
    typeof faceLandmarker === "undefined" ||
    !poseLandmarker ||
    !faceLandmarker
  ) {
    showWordMessage("word.message.facePoseNotReady", "low");
    return;
  }
  if (state.wordState !== "IDLE" && state.wordState !== "RESULT") return;

  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  if (typeof resetWordRecordingStats === "function") resetWordRecordingStats();

  watchPageVisibilityForWordRecording();
  wordRecordingSerial += 1;
  // The countdown below belongs to this recording. Without the serial, a
  // recording abandoned and replaced within one step would find the state
  // back in COUNTDOWN and keep counting into the new one.
  const recording = wordRecordingSerial;
  wordResultSerial = 0;
  wordResultAccepted = false;
  state.wordState = "COUNTDOWN";
  state.wordFrames = 0;
  state.wordEnd = null;
  state.wordFraming = null;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  // The previous word leaves the screen with its recording.
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateWordState();
  clearFeedback();

  // A superseded countdown leaves the count on screen to the newer
  // recording; one that was stopped, left or abandoned takes it down.
  /** @returns {boolean} */
  const countdownGoesOn = () => {
    if (recording !== wordRecordingSerial) return false;
    if (state.cameraOn && canCaptureWordInCurrentMode() && state.wordState === "COUNTDOWN") return true;
    els.countdown.hidden = true;
    return false;
  };

  for (let i = CONFIG.COUNTDOWN_SECONDS; i > 0; i -= 1) {
    if (!countdownGoesOn()) return;
    els.countdown.hidden = false;
    els.countdown.textContent = String(i);
    await wait(720);
  }

  if (!countdownGoesOn()) return;

  els.countdown.hidden = true;
  state.wordState = "RECORDING";
  els.cameraStage.dataset.state = "recording";
  updateWordState();
}

/**
 * Discard the current result and record again.
 *
 * @returns {void}
 */
function retryWordRecording() {
  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  if (typeof resetWordRecordingStats === "function") resetWordRecordingStats();
  clearFeedback();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateWordState();
  startWordRecording();
}

/**
 * @returns {boolean} True in word mode and for a multi-character coach target.
 */
function canCaptureWordInCurrentMode() {
  return state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);
}

/**
 * Redraw everything that reflects the recording state machine.
 *
 * @returns {void}
 */
function updateWordState() {
  /** @type {Record<string, string>} */
  const labels = {
    IDLE: "word.state.idle",
    COUNTDOWN: "word.state.countdown",
    RECORDING: "word.state.recording",
    PROCESSING: "word.state.processing",
    RESULT: "word.state.result",
  };
  if (labels[state.wordState]) setText(els.wordStateLabel, labels[state.wordState]);
  else els.wordStateLabel.textContent = state.wordState;
  // The stylesheet shows and hides the plate, the readout and the dock's
  // buttons from this attribute; data-state belongs to the letter screen's
  // confidence colours.
  const step = state.wordState.toLowerCase();
  els.cameraStage.dataset.wordStep = step;
  els.controlBar.dataset.wordStep = step;
  const percent = clampPercent((state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100);
  els.frameProgress.style.width = `${percent}%`;
  setText(els.wordHudPercent, "word.percent", { n: percent });
  setText(els.wordHudStep, state.wordState === "COUNTDOWN" ? "word.hud.getReady" : "word.hud.recording");
  // Exposed as a value, not a live region: a bar that spoke every frame would
  // drown everything else.
  els.wordProgress?.setAttribute("aria-valuenow", String(percent));
  updateWordRecordingHud();
  if (state.wordState === "PROCESSING") setText(els.wordStateHint, "word.hint.processing");
  if (state.wordState === "RESULT") {
    if (state.top3.length) setText(els.wordStateHint, "word.hint.result", { top: formatWordCandidates(state.top3) });
    else setText(els.wordStateHint, "word.hint.noResult");
  }
  if (state.wordState === "IDLE") {
    setText(els.wordStateHint, "word.hint.idle");
    updateWordQualityPills(false, false, false);
  }
  updateWordFlowSteps();
  renderWordResultGuide();
  // The record button is busy from the countdown to the result, so it is
  // redrawn with every step, not only on mode and camera changes.
  syncRecordButton();
  syncActionBar();
}

/**
 * Mark which of the three flow steps the recording has reached.
 *
 * @returns {void}
 */
function updateWordFlowSteps() {
  const steps = queryAllUi("word-step");
  const activeIndex =
    state.wordState === "RESULT" || state.wordState === "PROCESSING"
      ? 2
      : state.wordState === "COUNTDOWN" || state.wordState === "RECORDING"
        ? 1
        : 0;
  steps.forEach((step, index) => {
    step.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
  });
}

/**
 * The string of the hint for each landmark group the camera is missing, and
 * for more than one at a time.
 *
 * @type {Record<WordQualityPill | "several", string>}
 */
const WORD_FRAMING_HINTS = {
  hand: "word.framing.hand",
  face: "word.framing.face",
  pose: "word.framing.pose",
  several: "word.framing.several",
};

/** @type {WordQualityPill[]} */
const WORD_FRAMING_GROUPS = ["hand", "face", "pose"];

/**
 * Record what the latest MediaPipe result showed, and redraw the readout.
 *
 * Live inference calls this for every frame of a countdown or a recording,
 * before it drops a frame for having no hand, since that is the frame whose
 * readout matters most. It never touches the recording buffers, so what
 * reaches the model is unchanged.
 *
 * @param {MediaPipeFrameResult} result
 * @returns {void}
 */
function noteWordFraming(result) {
  if (state.wordState !== "COUNTDOWN" && state.wordState !== "RECORDING") return;
  state.wordFraming = {
    hand: Boolean(result.rightHandLandmarks || result.leftHandLandmarks),
    face: Boolean(result.faceLandmarks),
    pose: Boolean(result.poseLandmarks),
  };
  updateWordRecordingHud();
}

/**
 * Show the countdown or recording hint and the three quality pills.
 *
 * The hint names the missing landmark group, so a user whose frames are being
 * rejected can see which part to fix. Progress is a percentage of the window,
 * not a count of frames.
 *
 * @returns {void}
 */
function updateWordRecordingHud() {
  if (state.wordState !== "COUNTDOWN" && state.wordState !== "RECORDING") return;
  const framing = state.wordFraming;
  const missing = framing ? WORD_FRAMING_GROUPS.filter((group) => !framing[group]) : [];
  const framingHint =
    missing.length === 0 ? "" : missing.length === 1 ? WORD_FRAMING_HINTS[missing[0]] : WORD_FRAMING_HINTS.several;
  if (state.wordState === "COUNTDOWN") {
    setText(els.wordStateHint, framingHint || "word.hint.countdown");
  } else {
    const percent = clampPercent((state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100);
    setText(els.wordStateHint, "word.hint.recording", {
      percent: formatWordPercent(percent),
      hint: t(framingHint || "word.hint.keepGoing"),
    });
  }
  if (framing) updateWordQualityPills(framing.hand, framing.pose, framing.face);
}

/**
 * Which landmark group one quality pill reports, as its data-quality value.
 *
 * @typedef {"hand" | "face" | "pose"} WordQualityPill
 */

/**
 * Update the three landmark quality pills.
 *
 * Before the camera starts they show a neutral state: three crosses on a fresh
 * page would suggest a capture problem that does not exist yet.
 *
 * @param {boolean} handVisible
 * @param {boolean} poseVisible
 * @param {boolean} faceVisible
 * @returns {void}
 */
function updateWordQualityPills(handVisible, poseVisible, faceVisible) {
  _wordPillsShown = {
    visible: { hand: handVisible, face: faceVisible, pose: poseVisible },
    pending: state.wordState === "IDLE" && !state.cameraOn,
  };
  renderWordQualityPills();
}

/**
 * What the quality pills show, kept so a language change can draw them again
 * as they were. Null until they are first drawn: the authored pills stand
 * until then.
 *
 * @type {{visible: Record<WordQualityPill, boolean>, pending: boolean} | null}
 */
let _wordPillsShown = null;

/**
 * Draw the quality pills from what they show, in the current language.
 *
 * @returns {void}
 */
function renderWordQualityPills() {
  if (!_wordPillsShown || !els.wordQualityPills) return;
  const { visible, pending } = _wordPillsShown;
  queryElements("[data-quality]", els.wordQualityPills).forEach((pill) => {
    // One entry per WordQualityPill; a pill with any other data-quality is
    // left untouched.
    const group = pill.dataset.quality ?? "";
    if (group !== "hand" && group !== "face" && group !== "pose") return;
    if (pending) {
      pill.textContent = `${t(`word.pill.${group}`)} ·`;
      delete pill.dataset.ok; // Neither the ok nor the missing style applies.
    } else {
      pill.textContent = `${t(`word.pill.${group}`)} ${visible[group] ? "✓" : "✗"}`;
      pill.dataset.ok = visible[group] ? "true" : "false";
    }
  });
}

/**
 * Match the record button to what is currently possible.
 *
 * Word inference needs hand, pose, and face together, so the button stays
 * disabled while the optional MediaPipe tasks are still loading, and while a
 * recording is in flight.
 *
 * @returns {void}
 */
function syncRecordButton() {
  if (!els.recordWord) return;
  const coachLetterTarget = state.mode === "coach" && state.coachTarget.length === 1;
  const wordCapableMode =
    state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);

  // Undeclared means camera.js never loaded: nothing will track, so not ready.
  const mpReady = typeof mpRunning !== "undefined" && mpRunning;
  const poseReady = typeof poseLandmarker !== "undefined" && !!poseLandmarker;
  const faceReady = typeof faceLandmarker !== "undefined" && !!faceLandmarker;
  const wordPipelineReady = mpReady && poseReady && faceReady;
  const wordFlowBusy =
    state.wordState === "COUNTDOWN" ||
    state.wordState === "RECORDING" ||
    state.wordState === "PROCESSING";

  els.recordWord.hidden = state.mode === "letter";
  els.recordWord.disabled =
    coachLetterTarget ||
    wordFlowBusy ||
    (wordCapableMode && (!state.cameraOn || !wordPipelineReady));

  // The pose and face tasks start with the camera, so before it nothing is
  // loading: ask for the camera rather than claim progress.
  if (wordCapableMode && !state.cameraOn) {
    setButtonTitle(els.recordWord, "word.record.title.cameraOff");
    setButtonLabel(els.recordWord, "word.record.cameraOff");
  } else if (wordCapableMode && !wordPipelineReady) {
    setButtonTitle(els.recordWord, "word.record.title.loading");
    setButtonLabel(els.recordWord, state.mode === "coach" ? "word.record.coachLoading" : "word.record.loading");
  } else if (wordFlowBusy) {
    setButtonTitle(els.recordWord, "word.record.title.busy");
    setButtonLabel(els.recordWord, state.wordState === "PROCESSING" ? "word.record.processing" : "word.record.recording");
  } else {
    setButtonTitle(els.recordWord, null);
    setButtonLabel(
      els.recordWord,
      state.mode === "coach" ? "word.record.coach" : state.wordState === "RESULT" ? "word.record.again" : "word.record.start",
    );
  }
}

/**
 * Write a button's label without removing the key hint or icon beside it.
 *
 * A button that has a [data-label] child keeps everything else it holds; one
 * that has none has its whole text replaced.
 *
 * @param {HTMLElement} button
 * @param {string} key The label's string.
 * @returns {void}
 */
function setButtonLabel(button, key) {
  setText(button.querySelector("[data-label]") ?? button, key);
}

/**
 * Give a button its tooltip, or take it away.
 *
 * @param {HTMLElement} button
 * @param {string | null} key The tooltip's string; null for none.
 * @returns {void}
 */
function setButtonTitle(button, key) {
  if (key) {
    setAttrText(button, "title", key);
  } else {
    button.removeAttribute("data-i18n-title");
    button.setAttribute("title", "");
  }
}

/**
 * Match the action bar to the current mode and result.
 *
 * The accept action is enabled only for a finished word result the assessment
 * judged usable, which is what keeps a word out of the transcript until the
 * user chooses it.
 *
 * @returns {void}
 */
function syncActionBar() {
  setText(els.cameraToggle, state.cameraOn ? "letter.camera.turnOff" : "letter.camera.turnOn");
  const videoTarget =
    state.mode === "word"
      ? (state.prediction && state.prediction.length > 1 ? state.prediction : "")
      : state.coachTarget;
  const videoUrl = buildReferenceVideoUrl(state.mode, videoTarget);
  if (els.actionVideoLink) els.actionVideoLink.href = videoUrl;
  if (els.appendWordResult) {
    const assessment = assessWordResult();
    els.appendWordResult.disabled =
      state.mode !== "word" ||
      state.wordState !== "RESULT" ||
      !assessment ||
      !assessment.canAppend ||
      !wordResultIsCurrent() ||
      wordResultAccepted;
    setButtonTitle(
      els.appendWordResult,
      wordResultAccepted
        ? "word.append.title.added"
        : els.appendWordResult.disabled
          ? "word.append.title.notYet"
          : "word.append.title.ready",
    );
    setButtonLabel(els.appendWordResult, wordResultAccepted ? "word.append.added" : "word.append.add");
  }
  // Once the result is accepted the dock offers a new recording first.
  els.controlBar.dataset.wordAccepted = String(wordResultAccepted && state.wordState === "RESULT");
  if (els.cancelWord) {
    els.cancelWord.hidden = state.wordState !== "COUNTDOWN" && state.wordState !== "RECORDING";
  }
  if (els.retryWord) {
    els.retryWord.disabled =
      !state.cameraOn ||
      state.wordState === "COUNTDOWN" ||
      state.wordState === "RECORDING" ||
      state.wordState === "PROCESSING";
    setButtonTitle(els.retryWord, els.retryWord.disabled ? "word.retry.title.notYet" : "word.retry.title.ready");
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
