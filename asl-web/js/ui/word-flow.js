// Word recording flow: countdown, capture progress, quality readout, and the
// action bar buttons that drive it.
//
// The recording state machine is IDLE -> COUNTDOWN -> RECORDING -> PROCESSING
// -> RESULT. Frames are collected by live inference; this file owns what the
// user sees and which controls are available at each step.
//
// Starting a recording and retrying both clear the motion buffers, because a
// previous sign left in them would be fed into the next 45-frame window. Mode
// changes, stopping the camera, and finishing inference clear them too, from
// their own call sites.
//
// Recording stays disabled until hand, pose, and face models are all ready: a
// word needs all three, unlike a letter.
//
// A finished recording always ends in RESULT, also when the model produced
// nothing: that RESULT shows no word and offers nothing to accept, so the
// state machine stays IDLE -> COUNTDOWN -> RECORDING -> PROCESSING -> RESULT
// and the user sees that this recording, not the one before, failed.

/**
 * Which recording is current, and which recording the result on screen came
 * from (0: no result on screen).
 *
 * Each start takes the next number. A model run publishes its result only if
 * no newer recording has started meanwhile, and accepting a word requires the
 * result to be the current recording's. Without this the previous word stayed
 * acceptable through the next recording, and was appended a second time when
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
 * Start a word recording: check readiness, clear the buffers, count down, then
 * hand over to live inference.
 *
 * The motion buffers are cleared here because a previous sign left in them
 * would be fed into the next 45-frame window.
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
    setMessage("Önce kamerayı başlat.", "low");
    return;
  }

  if (state.mode === "coach" && state.coachTarget.length === 1) {
    setMessage("Kelime pratiği için koç hedefinden bir kelime seçin.", "maybe");
    return;
  }
  if (!canCaptureWordInCurrentMode()) setMode("word");
  // A recording is useless without the word model, so it loads before the
  // countdown. Everything below reads state after this wait, so a camera
  // stopped or a second click made meanwhile is still seen.
  if (!(await loadModelsWithStatus({ word: true }))) return;
  if (!state.cameraOn || !canCaptureWordInCurrentMode()) return;
  if (typeof mpRunning !== "undefined" && !mpRunning) {
    setMessage("Kelime kaydı için MediaPipe'in hazır olmasını bekleyin.", "maybe");
    return;
  }
  if (
    typeof poseLandmarker !== "undefined" &&
    typeof faceLandmarker !== "undefined" &&
    (!poseLandmarker || !faceLandmarker)
  ) {
    setMessage("Kelime modu için MediaPipe Hand + Pose + Face birlikte hazır olmalı.", "low");
    return;
  }
  if (state.wordState !== "IDLE" && state.wordState !== "RESULT") return;

  // Reset motion history so a previous sign cannot affect the next recording.
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  // Reset per-recording landmark visibility statistics.
  if (typeof resetWordRecordingStats === "function") resetWordRecordingStats();

  wordRecordingSerial += 1;
  wordResultSerial = 0;
  wordResultAccepted = false;
  state.wordState = "COUNTDOWN";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  // The previous word leaves the screen with its recording.
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateWordState();
  clearFeedback();

  for (let i = CONFIG.COUNTDOWN_SECONDS; i > 0; i -= 1) {
    // The user may change mode or stop the camera during countdown. Abort
    // without retaining a stale recording state.
    if (!state.cameraOn || !canCaptureWordInCurrentMode() || state.wordState !== "COUNTDOWN") {
      els.countdown.hidden = true;
      return;
    }
    els.countdown.hidden = false;
    els.countdown.textContent = String(i);
    await wait(720);
  }

  // Recheck state after the asynchronous countdown completes.
  if (!state.cameraOn || !canCaptureWordInCurrentMode() || state.wordState !== "COUNTDOWN") {
    els.countdown.hidden = true;
    return;
  }

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
    COUNTDOWN: "Hazırlan",
    RECORDING: "Kayıt",
    PROCESSING: "İşleniyor",
    RESULT: "Sonuç",
  };
  els.wordStateLabel.textContent = labels[state.wordState] || state.wordState;
  els.frameProgress.style.width = `${Math.round(
    (state.wordFrames / CONFIG.WORD_FRAME_COUNT) * 100,
  )}%`;
  if (state.wordState === "COUNTDOWN") els.wordStateHint.textContent = "Geri sayım bitince işarete başla. El, yüz ve omuz kadrajda kalsın.";
  if (state.wordState === "RECORDING")
    els.wordStateHint.textContent = `${state.wordFrames}/${CONFIG.WORD_FRAME_COUNT} frame alınıyor. Hareketi doğal hızda tamamla; sistem otomatik durur.`;
  if (state.wordState === "PROCESSING")
    els.wordStateHint.textContent = "Kayıt tamamlandı. Model sonucu hesaplanıyor.";
  if (state.wordState === "RESULT") {
    els.wordStateHint.textContent = state.top3.length
      ? `Modelin gördükleri: ${formatTopPredictions(state.top3)}. Doğruysa Metne Ekle, farklıysa Tekrar Dene.`
      : "Bu kayıttan sonuç çıkmadı. Tekrar Dene ile yeni bir kayıt alın.";
  }
  if (state.wordState === "IDLE") {
    els.wordStateHint.textContent = "Başlat'a bas, geri sayımdan sonra işareti 2-4 saniye yap. 45 frame dolunca sistem otomatik sonucu gösterir.";
    updateWordQualityPills(false, false, false);
  }
  updateWordFlowSteps();
  renderWordResultGuide();
  // The record button is busy from the countdown to the result, so it is
  // redrawn with every step rather than only on mode and camera changes.
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
 * Show capture progress with per-group visibility while recording.
 *
 * Reads, for example, "Kayıt: 18/45 — El ✓ Yüz ✓ Omuz ✗", so a user whose
 * frames are being rejected can see which group to fix.
 *
 * @param {boolean} handVisible
 * @param {boolean} poseVisible
 * @param {boolean} faceVisible
 * @returns {void}
 */
function updateWordRecordingHud(handVisible, poseVisible, faceVisible) {
  if (!els || !els.wordStateHint) return;
  if (state.wordState !== "RECORDING") return;
  /** @param {boolean} b @returns {string} */
  const tick = (b) => (b ? "✓" : "✗");
  els.wordStateHint.textContent =
    `Kayıt: ${state.wordFrames}/${CONFIG.WORD_FRAME_COUNT} — ` +
    `El ${tick(handVisible)} Yüz ${tick(faceVisible)} Omuz ${tick(poseVisible)}. ` +
    "Hareketi bitir; sistem otomatik işleyecek.";
  updateWordQualityPills(handVisible, poseVisible, faceVisible);
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
  // Use a neutral state before the camera starts; showing three failures on
  // initial load would incorrectly suggest a capture problem.
  const pending = state.wordState === "IDLE" && !state.cameraOn;
  // One entry per WordQualityPill. A pill whose data-quality is not one of
  // these is left untouched rather than labelled as a shoulder, which is what
  // the previous chained fallback did for any unrecognised key.
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
      delete pill.dataset.ok; // Disable the CSS true/false state selectors.
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

  // Word inference requires hand, pose, and face models. Keep recording
  // disabled while the optional MediaPipe components are still loading.
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
  // loading: ask for the camera instead of claiming progress.
  if (wordCapableMode && !state.cameraOn) {
    els.recordWord.title = "Kelime kaydı için önce kamerayı başlatın.";
    els.recordWord.textContent = "Önce Kamerayı Başlat";
  } else if (wordCapableMode && !wordPipelineReady) {
    els.recordWord.title = "Pose+Face modeli yükleniyor...";
    els.recordWord.textContent =
      state.mode === "coach" ? "Kelime Pratiği Yükleniyor" : "Kelime Kaydı Yükleniyor";
  } else if (wordFlowBusy) {
    els.recordWord.title = "Bu kayıt akışı tamamlanınca yeni kayıt alınabilir.";
    els.recordWord.textContent =
      state.wordState === "PROCESSING" ? "Sonuç Hazırlanıyor" : "Kayıt Sürüyor";
  } else {
    els.recordWord.title = "";
    els.recordWord.textContent =
      state.mode === "coach"
        ? "Kelime Pratiği"
        : state.wordState === "RESULT"
          ? "Yeni Kelime Kaydı"
          : "Kelime Kaydı Başlat";
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
  if (els.cameraToggle) {
    els.cameraToggle.textContent = state.cameraOn ? "Kamerayı kapat" : "Kamerayı aç";
  }
  if (els.coachStart) {
    els.coachStart.textContent = state.cameraOn ? "Çalışmayı Durdur" : "Çalışmayı Başlat";
  }
  const videoTarget =
    state.mode === "word"
      ? (state.prediction && state.prediction.length > 1 ? state.prediction : "")
      : state.coachTarget;
  const videoUrl = buildReferenceVideoUrl(state.mode, videoTarget);
  if (els.actionVideoLink) els.actionVideoLink.href = videoUrl;
  if (els.coachVideoLink) els.coachVideoLink.href = videoUrl;
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
        ? "Kelime sonucu yeterince güvenli olduğunda metne eklenebilir."
        : "Gördüğün sonuç doğruysa metne ekle.";
  }
  if (els.retryWord) {
    els.retryWord.disabled =
      !state.cameraOn ||
      state.wordState === "COUNTDOWN" ||
      state.wordState === "RECORDING" ||
      state.wordState === "PROCESSING";
    els.retryWord.title = els.retryWord.disabled
      ? "Kamera açıkken ve kayıt bitince tekrar denenebilir."
      : "Sonuç farklıysa yeni kayıt al.";
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
