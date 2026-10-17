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
 * What the user is told when a recording ends before it finished, by reason.
 *
 * @type {Record<WordEnd, string>}
 */
const WORD_END_COPY = {
  timeout:
    "El, yüz ve omuzlar birlikte görünmedi; kayıt durduruldu. Kol boyu uzaklıkta, iyi ışıkta yeniden deneyin.",
  "download-failed":
    "Kelime tanıma için gereken dosyalar indirilemedi. Bağlantınızı kontrol edip yeniden deneyin.",
  hidden: "Sayfa arka plana geçtiği için kayıt iptal edildi.",
  cancelled: "Kayıt iptal edildi.",
};

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
  reportProblem(WORD_END_COPY[reason]);
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
    if (assessment && !assessment.canAppend) announce("Sonuç yeterince net olmadığı için eklenemez.");
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
    setMessage("Önce kamerayı açın.", "low");
    return;
  }

  if (state.mode === "coach" && state.coachTarget.length === 1) {
    setMessage("Kelime pratiği için koç hedefinden bir kelime seçin.", "maybe");
    return;
  }
  if (!canCaptureWordInCurrentMode()) setMode("word");
  // The word model loads before the countdown. Everything below reads state
  // after this wait, so a camera stopped or a second click made meanwhile is
  // still seen. The load is shared and forgets a failure, so the next press
  // downloads again: the user is asked to try again, never to reload.
  if (_wordModelWait) return;
  const cameraSession = state.stream;
  if (!wordSession) setMessage("Kelime tanıma indiriliyor…", "maybe");
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
  if (typeof mpRunning !== "undefined" && !mpRunning) {
    setMessage("Kelime kaydı için el izlemenin hazır olmasını bekleyin.", "maybe");
    return;
  }
  if (
    typeof poseLandmarker !== "undefined" &&
    typeof faceLandmarker !== "undefined" &&
    (!poseLandmarker || !faceLandmarker)
  ) {
    setMessage("Kelime kaydı için yüz ve omuz izleme gerekiyor, ama henüz hazır değil.", "low");
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
  const labels = {
    IDLE: "Hazır",
    COUNTDOWN: "Geri sayım",
    RECORDING: "Kayıt",
    PROCESSING: "İşleniyor",
    RESULT: "Sonuç",
  };
  els.wordStateLabel.textContent = labels[state.wordState] || state.wordState;
  // The stylesheet shows and hides the plate, the readout and the dock's
  // buttons from this attribute; data-state belongs to the letter screen's
  // confidence colours.
  const step = state.wordState.toLowerCase();
  els.cameraStage.dataset.wordStep = step;
  els.controlBar.dataset.wordStep = step;
  const percent = clampPercent((state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100);
  els.frameProgress.style.width = `${percent}%`;
  if (els.wordHudPercent) els.wordHudPercent.textContent = `%${percent}`;
  if (els.wordHudStep) els.wordHudStep.textContent = state.wordState === "COUNTDOWN" ? "Hazırlanın" : "Kayıt";
  // Exposed as a value, not a live region: a bar that spoke every frame would
  // drown everything else.
  els.wordProgress?.setAttribute("aria-valuenow", String(percent));
  updateWordRecordingHud();
  if (state.wordState === "PROCESSING")
    els.wordStateHint.textContent = "Kayıt tamamlandı; sonuç hazırlanıyor.";
  if (state.wordState === "RESULT") {
    els.wordStateHint.textContent = state.top3.length
      ? `En olası sonuçlar: ${formatTopPredictions(state.top3)}. Doğruysa metne ekleyin; değilse yeniden kaydedin.`
      : "Bu kayıttan sonuç çıkmadı. Yeniden kaydedin.";
  }
  if (state.wordState === "IDLE") {
    els.wordStateHint.textContent = "Kaydı başlatın. Geri sayımdan sonra işareti bir kez, doğal hızda yapın; kayıt dolunca sonuç kendiliğinden gelir.";
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
 * The hint for each landmark group the camera is missing, and for more than
 * one at a time.
 *
 * @type {Record<WordQualityPill | "several", string>}
 */
const WORD_FRAMING_HINTS = {
  hand: "Eliniz görünmüyor; kadrajın ortasına getirin.",
  face: "Yüzünüz görünmüyor; kameraya bakın.",
  pose: "Omuzlarınız görünmüyor; biraz geri çekilin.",
  several: "Eliniz, yüzünüz ve omuzlarınız birlikte görünmeli; biraz geri çekilin.",
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
    els.wordStateHint.textContent =
      framingHint || "Geri sayım bitince işareti yapın; eliniz, yüzünüz ve omuzlarınız kadrajda kalsın.";
  } else {
    const percent = clampPercent((state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100);
    els.wordStateHint.textContent =
      `Kayıt %${percent}. ` + (framingHint || "İşareti doğal hızda tamamlayın; kayıt kendiliğinden biter.");
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
  if (!els.wordQualityPills) return;
  const pending = state.wordState === "IDLE" && !state.cameraOn;
  // One entry per WordQualityPill; a pill with any other data-quality is left
  // untouched.
  /** @type {Record<string, {label: string, ok: boolean}>} */
  const pills = {
    hand: { label: "El", ok: handVisible },
    face: { label: "Yüz", ok: faceVisible },
    pose: { label: "Omuz", ok: poseVisible },
  };
  queryElements("[data-quality]", els.wordQualityPills).forEach((pill) => {
    const entry = pills[pill.dataset.quality ?? ""];
    if (!entry) return;
    if (pending) {
      pill.textContent = `${entry.label} ·`;
      delete pill.dataset.ok; // Neither the ok nor the missing style applies.
    } else {
      pill.textContent = `${entry.label} ${entry.ok ? "✓" : "✗"}`;
      pill.dataset.ok = entry.ok ? "true" : "false";
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

  const mpReady = typeof mpRunning !== "undefined" ? mpRunning : true;
  const poseReady = typeof poseLandmarker === "undefined" || !!poseLandmarker;
  const faceReady = typeof faceLandmarker === "undefined" || !!faceLandmarker;
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
    els.recordWord.title = "Kelime kaydı için önce kamerayı açın.";
    setButtonLabel(els.recordWord, "Kamera kapalı");
  } else if (wordCapableMode && !wordPipelineReady) {
    els.recordWord.title = "Yüz ve omuz izleme yükleniyor…";
    setButtonLabel(els.recordWord, state.mode === "coach" ? "Kelime Pratiği Yükleniyor" : "Yükleniyor…");
  } else if (wordFlowBusy) {
    els.recordWord.title = "Bu kayıt akışı tamamlanınca yeni kayıt alınabilir.";
    setButtonLabel(els.recordWord, state.wordState === "PROCESSING" ? "Sonuç hazırlanıyor…" : "Kayıt sürüyor");
  } else {
    els.recordWord.title = "";
    setButtonLabel(
      els.recordWord,
      state.mode === "coach" ? "Kelime Pratiği" : state.wordState === "RESULT" ? "Yeni kayıt" : "Kaydı başlat",
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
 * @param {string} text
 * @returns {void}
 */
function setButtonLabel(button, text) {
  const label = button.querySelector("[data-label]");
  if (label) label.textContent = text;
  else button.textContent = text;
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
  if (els.cameraToggle) {
    els.cameraToggle.textContent = state.cameraOn ? "Kamerayı kapat" : "Kamerayı aç";
  }
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
    els.appendWordResult.title = wordResultAccepted
      ? "Bu sonuç metne eklendi."
      : els.appendWordResult.disabled
        ? "Sonuç yeterince net olduğunda metne eklenebilir."
        : "Sonuç doğruysa metne ekleyin.";
    setButtonLabel(els.appendWordResult, wordResultAccepted ? "Eklendi" : "Metne ekle");
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
    els.retryWord.title = els.retryWord.disabled
      ? "Kamera açıkken ve kayıt bitince tekrar denenebilir."
      : "Sonuç farklıysa yeniden kaydedin.";
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
