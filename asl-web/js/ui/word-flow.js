// IDLE -> COUNTDOWN -> RECORDING -> PROCESSING -> RESULT.
//
// Every way into a new recording clears the motion buffers, or a previous sign
// would be fed into the next 45-frame window. A failed model run still ends in
// RESULT, with nothing to accept, so the user sees that this one failed; a
// recording ended early returns to IDLE and says why.

// Without these serials the previous word would stay acceptable through the
// next recording and could be appended again if that recording failed.
let wordRecordingSerial = 0;
let wordResultSerial = 0;

/**
 * @returns {boolean}
 */
function wordResultIsCurrent() {
  return wordResultSerial !== 0 && wordResultSerial === wordRecordingSerial;
}

/**
 * @type {Record<WordEnd, string>}
 */
const WORD_END_COPY = {
  timeout: "word.end.timeout",
  "download-failed": "word.end.downloadFailed",
  hidden: "word.end.hidden",
  cancelled: "word.end.cancelled",
};

/**
 * Function params are recomputed on each render, so a percentage in them
 * follows the language too.
 *
 * @typedef {Object} WordCopy
 * @property {string} key
 * @property {I18nParams | (() => I18nParams) | null} [params]
 */

/**
 * prediction.js writes these lines as plain text, so a language switch
 * rewrites an entry only while the element still shows it.
 *
 * @type {Map<Element, {copy: WordCopy, text: string}>}
 */
const _wordLinesShown = new Map();

/**
 * @param {WordCopy} copy
 * @returns {string}
 */
function wordCopyText(copy) {
  const params = typeof copy.params === "function" ? copy.params() : copy.params;
  return t(copy.key, params ?? null);
}

/**
 * @param {Element | null | undefined} element
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
 * @param {number} percent
 * @returns {string}
 */
function formatWordPercent(percent) {
  return t("word.percent", { n: percent });
}

/**
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
 * Render only: nothing is announced again.
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

// A second press during the model download would report its outcome twice.
let _wordModelWait = false;

// When a press waited on the model too, the press reports the outcome and the
// model status report stays quiet.
let wordModelPresses = 0;

/**
 * @param {WordEnd} reason
 * @returns {void}
 */
function reportWordEnd(reason) {
  state.wordEnd = reason;
  reportWordProblem(WORD_END_COPY[reason]);
}

/**
 * Keyed by the recording serial, so an abandoned recording cannot lend its
 * elapsed time to the next one. The render loop drives it; there is no timer.
 *
 * @type {{recording: number, startedAt: number, lastUsableAt: number | null}}
 */
let wordRecordingClock = { recording: 0, startedAt: 0, lastUsableAt: null };

/**
 * @param {number} now
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
 * @param {number} now
 * @returns {void}
 */
function noteUsableWordFrame(now) {
  if (wordRecordingClock.recording === wordRecordingSerial) wordRecordingClock.lastUsableAt = now;
}

let _wordPageWatched = false;

/**
 * A hidden page gets no animation frames, so a recording would resume later
 * with a gap the model never saw.
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
 * A half-filled window must not reach the model or the next recording.
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
  // Last, so nothing redrawn above replaces the reason.
  reportWordEnd(reason);
}

/**
 * PROCESSING is one model call and cannot be cancelled.
 *
 * @returns {void}
 */
function cancelWordRecording() {
  endWordRecordingEarly("cancelled");
}

/**
 * A focused control keeps Enter and Space for itself. There are deliberately
 * no single-letter keys.
 *
 * @param {{key: string, code?: string, preventDefault: () => void}} event
 * @param {boolean} fromControl
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
 * The countdown is asynchronous, so mode, camera and state are rechecked at
 * every step.
 *
 * @returns {Promise<void>}
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
  // The load forgets a failure, so the next press downloads again: the user is
  // asked to try again, never to reload.
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
  // A camera stopped meanwhile has reset the screen; a user who left has moved on.
  if (!state.cameraOn || state.stream !== cameraSession || !canCaptureWordInCurrentMode()) return;
  if (!modelReady) {
    reportWordEnd("download-failed");
    return;
  }
  // Undeclared means camera.js never loaded, so not ready.
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
  // Without the serial, a recording replaced within one step would find the
  // state back in COUNTDOWN and keep counting into the new one.
  const recording = wordRecordingSerial;
  wordResultSerial = 0;
  wordResultAccepted = false;
  state.wordState = "COUNTDOWN";
  state.wordFrames = 0;
  state.wordEnd = null;
  state.wordFraming = null;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateWordState();
  clearFeedback();

  // A superseded countdown leaves the count on screen to the newer recording.
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
 * @returns {boolean}
 */
function canCaptureWordInCurrentMode() {
  return state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);
}

/**
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
  // Not data-state, which holds the letter screen's confidence colours.
  const step = state.wordState.toLowerCase();
  els.cameraStage.dataset.wordStep = step;
  els.controlBar.dataset.wordStep = step;
  const percent = clampPercent((state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100);
  els.frameProgress.style.width = `${percent}%`;
  setText(els.wordHudPercent, "word.percent", { n: percent });
  setText(els.wordHudStep, state.wordState === "COUNTDOWN" ? "word.hud.getReady" : "word.hud.recording");
  // A value, not a live region: a bar that spoke every frame would drown the rest.
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
  syncRecordButton();
  syncActionBar();
}

/**
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
 * Called before a frame without a hand is dropped, since that is the frame
 * whose readout matters most. Never touches the recording buffers.
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
 * The hint names the missing landmark group, so the user can see what to fix.
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
 * @typedef {"hand" | "face" | "pose"} WordQualityPill
 */

/**
 * Neutral before the camera starts: three crosses on a fresh page would
 * suggest a problem that does not exist yet.
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
 * Null until first drawn: the authored pills stand until then.
 *
 * @type {{visible: Record<WordQualityPill, boolean>, pending: boolean} | null}
 */
let _wordPillsShown = null;

/**
 * @returns {void}
 */
function renderWordQualityPills() {
  if (!_wordPillsShown || !els.wordQualityPills) return;
  const { visible, pending } = _wordPillsShown;
  queryElements("[data-quality]", els.wordQualityPills).forEach((pill) => {
    const group = pill.dataset.quality ?? "";
    if (group !== "hand" && group !== "face" && group !== "pose") return;
    if (pending) {
      pill.textContent = `${t(`word.pill.${group}`)} ·`;
      delete pill.dataset.ok;
    } else {
      pill.textContent = `${t(`word.pill.${group}`)} ${visible[group] ? "✓" : "✗"}`;
      pill.dataset.ok = visible[group] ? "true" : "false";
    }
  });
}

/**
 * Word inference needs hand, pose and face together, so the button waits for
 * all three MediaPipe tasks.
 *
 * @returns {void}
 */
function syncRecordButton() {
  if (!els.recordWord) return;
  const coachLetterTarget = state.mode === "coach" && state.coachTarget.length === 1;
  const wordCapableMode =
    state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);

  // Undeclared means camera.js never loaded, so not ready.
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

  // Pose and face start with the camera: ask for it rather than claim progress.
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
 * Writes into a [data-label] child when there is one, so a key hint or icon
 * beside it stays.
 *
 * @param {HTMLElement} button
 * @param {string} key
 * @returns {void}
 */
function setButtonLabel(button, key) {
  setText(button.querySelector("[data-label]") ?? button, key);
}

/**
 * @param {HTMLElement} button
 * @param {string | null} key Null for none.
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
 * Accept is enabled only for a current, usable word result not yet accepted.
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
