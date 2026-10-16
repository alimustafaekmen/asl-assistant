// Live inference: turn the latest MediaPipe frame into a prediction.
//
// camera.js owns the MediaPipe tasks and publishes latestMediaPipeResult. This
// file consumes it and drives the two model paths, which are deliberately
// different:
//
//   Letter: one frame, 93 features, throttled by the render loop, smoothed
//   across frames, and optionally skipped when the motion gate is enabled.
//
//   Word: 45 accepted frames collected into a buffer. A frame is accepted only
//   when hand, pose, and face landmarks are all present, because the feature
//   layout has a fixed slot for each. When the buffer is full, features are
//   rebuilt at sequence level so dominant-hand selection is made across the
//   whole recording rather than per frame, matching the training pipeline. If
//   that rebuild fails, the per-frame buffer is used instead.
//
// Only one asynchronous model call runs at a time; the re-entrancy guard drops
// frames rather than queueing them. A result that arrives after the user
// changed mode or stopped the camera is discarded.
//
// The diagnostics here -- visibility ratios, dominant-hand timeline, shoulder
// fallback counts, feature summaries -- are read-only and never change model
// output.

/**
 * Which hand carried the sign in one frame, by the same rule the feature
 * pipeline uses.
 *
 * @typedef {"right" | "left" | "none"} DominantSide
 */

/**
 * Where the model input for a finished recording came from.
 *
 * "sequence-level" is the training-parity path: features rebuilt across the
 * whole recording. "frame-level-fallback" means that rebuild threw and the
 * per-frame buffer was used instead.
 *
 * @typedef {"frame-level" | "sequence-level" | "frame-level-fallback"} InferenceFeatureSource
 */

/**
 * Per-recording counters. These are diagnostics only: nothing here changes the
 * model input or the prediction.
 *
 * @typedef {Object} WordRecordingStats
 * @property {number} startTs Timestamp of the first observed frame, 0 before then.
 * @property {number} totalObservedFrames Frames seen while recording.
 * @property {number} acceptedFrames Frames that had every required landmark group.
 * @property {number} skippedFrames Frames rejected for a missing group.
 * @property {number} handVisibleCount
 * @property {number} poseVisibleCount
 * @property {number} faceVisibleCount
 * @property {number} dominantHandPresentCount
 * @property {number} dominantHandSwitchCount Hand changes, ignoring frames with no hand.
 * @property {DominantSide[]} dominantHandTimeline Capped at the recording length.
 * @property {DominantSide | null} prevDominantSide Internal comparison state.
 * @property {number} shoulderFallbackUsedCount Frames that used min-max normalization.
 */

/**
 * Landmark visibility over one finished recording.
 *
 * @typedef {Object} LandmarkVisibilitySummary
 * @property {number} handVisibleRatio
 * @property {number} poseVisibleRatio
 * @property {number} faceVisibleRatio
 * @property {number} dominantHandPresentRatio
 * @property {number} totalObservedFrames
 * @property {number} acceptedFrames
 * @property {number} skippedFrames
 */

/**
 * Summary of a numeric block, for the debug snapshot.
 *
 * @typedef {Object} NumericStats
 * @property {number} min
 * @property {number} max
 * @property {number} mean
 * @property {number} [length] Block width, where one applies.
 */

/**
 * Live view of the frame being recorded, for the HUD and the debug API.
 *
 * @typedef {Object} WordCurrentFrameDebug
 * @property {boolean} handVisible
 * @property {boolean} poseVisible
 * @property {boolean} faceVisible
 * @property {number} ts
 * @property {boolean} [acceptedForRecording] Absent until the frame is judged.
 */

/**
 * Read-only snapshot of the last finished recording, published for
 * window.aslDebug.
 *
 * @typedef {Object} WordDebugSnapshot
 * @property {WordState} state
 * @property {number} recordedFrameCount
 * @property {number} expectedFrames
 * @property {number} recordingDurationMs
 * @property {LandmarkVisibilitySummary} visibility
 * @property {WordCurrentFrameDebug | null} currentFrame
 * @property {Object} sequence Mask, feature and motion summaries for the recording.
 * @property {Object | null} prediction Model result and calibration, or null.
 * @property {string[]} qualityWarnings
 * @property {number} ts
 */

// One asynchronous model call at a time; the rest are one-shot log guards.
let _inferenceInFlight = false;
let _firstInferenceLogged = false;
let _firstPredictionLogged = false;
let _wordWaitMessageShown = false;
/**
 * Timestamp of the last MediaPipe result a word recording took, or null at
 * the start of one. The render loop runs word inference on every frame, but
 * MediaPipe publishes from its own loop, so a frame can read a result that
 * has already been recorded.
 *
 * @type {number | null}
 */
let _lastWordFrameTimestamp = null;

// Per-recording visibility and parity diagnostics. These counters do not alter
// inference; they expose dominant-hand changes and shoulder-normalization
// fallback usage for troubleshooting feature-pipeline drift.
/** @type {WordRecordingStats} */
let _wordRecordingStats = {
  startTs: 0,
  totalObservedFrames: 0,
  acceptedFrames: 0,
  skippedFrames: 0,
  handVisibleCount: 0,
  poseVisibleCount: 0,
  faceVisibleCount: 0,
  dominantHandPresentCount: 0,
  dominantHandSwitchCount: 0,
  dominantHandTimeline: [],   // ["right"|"left"|"none"], capped at 45 frames
  prevDominantSide: null,     // Internal comparison state
  shoulderFallbackUsedCount: 0,
};

/**
 * Clear per-recording diagnostics and re-arm the missing-landmark hint.
 *
 * Called when a recording starts, on retry, and after inference finishes, so
 * counters never span two recordings.
 *
 * @returns {void}
 */
function resetWordRecordingStats() {
  _wordWaitMessageShown = false;
  _lastWordFrameTimestamp = null;
  _wordRecordingStats = {
    startTs: 0,
    totalObservedFrames: 0,
    acceptedFrames: 0,
    skippedFrames: 0,
    handVisibleCount: 0,
    poseVisibleCount: 0,
    faceVisibleCount: 0,
    dominantHandPresentCount: 0,
    dominantHandSwitchCount: 0,
    dominantHandTimeline: [],
    prevDominantSide: null,
    shoulderFallbackUsedCount: 0,
  };
}

/**
 * Report the dominant side for one raw frame, using the same rule as the
 * feature pipeline.
 *
 * Read-only: it runs no inference and does not influence the model input. It
 * exists to make a hand switch mid-recording visible in diagnostics.
 *
 * @param {Frame321D} raw321d
 * @returns {DominantSide}
 */
function _observeDominantSide(raw321d) {
  let rZeros = 0;
  let lZeros = 0;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(raw321d[i]) < 1e-8) rZeros++;
    if (Math.abs(raw321d[63 + i]) < 1e-8) lZeros++;
  }
  if (rZeros === 63 && lZeros === 63) return "none";
  return rZeros <= lZeros ? "right" : "left";
}

/**
 * Detect when shoulder normalization had to use its min-max fallback.
 *
 * Offsets 279 and 282 are pose landmarks 11 and 12 in the flattened layout.
 * Read-only; normalization itself makes the same decision independently.
 *
 * @param {Frame321D} raw321d
 * @returns {boolean} True when either shoulder is missing.
 */
function _observeShoulderFallback(raw321d) {
  const lsZero =
    Math.abs(raw321d[279]) < 1e-6 &&
    Math.abs(raw321d[280]) < 1e-6 &&
    Math.abs(raw321d[281]) < 1e-6;
  const rsZero =
    Math.abs(raw321d[282]) < 1e-6 &&
    Math.abs(raw321d[283]) < 1e-6 &&
    Math.abs(raw321d[284]) < 1e-6;
  return lsZero || rsZero;
}

/**
 * Run one inference pass against the latest MediaPipe frame.
 *
 * Called from the render loop. Returns without doing anything when the camera
 * is off, no frame has been published, or a model call is already in flight:
 * frames are dropped rather than queued, so a slow model cannot build a
 * backlog.
 *
 * Letter contexts predict every eligible frame and reset the smoother when the
 * hand disappears. Word contexts collect accepted frames until the recording is
 * full and then finalize it.
 *
 * @param {number} now Render loop timestamp in milliseconds.
 * @returns {Promise<void>} Never rejects; failures are logged and the guard is
 *   released.
 */
async function realInference(now) {
  if (typeof state === "undefined" || !state.cameraOn) return;
  // A word recording's clock runs on every tick, before any frame is looked
  // at: a recording nobody is in front of is the one that has to end.
  if (state.wordState === "RECORDING" && typeof checkWordRecordingClock === "function") {
    checkWordRecordingClock(now);
  }
  if (!latestMediaPipeResult) return;

  const letterContext = isLetterContext();

  // The framing readout is read before a frame is dropped for having no hand,
  // so it can say the hand is what is missing. It only reads the result.
  if (!letterContext && typeof noteWordFraming === "function") {
    noteWordFraming(latestMediaPipeResult);
  }
  if (_inferenceInFlight) return;

  // Skip frames without hands. Letter contexts also reset temporal smoothing,
  // of the predictions and of the landmarks, so a previous sign cannot leak
  // across a hand-loss gap. This frame never reaches computeLetterFeatures(),
  // so its own all-zero reset of the landmark average does not happen here.
  if (!latestMediaPipeResult.rightHandLandmarks && !latestMediaPipeResult.leftHandLandmarks) {
    if (letterContext) {
      resetSmoother();
      resetLetterLandmarkSmoother();
      // The coach counts what it sees, so it is told the hand has gone. Letter
      // mode keeps showing its last letter, as the owner decided.
      if (state.mode === "coach") noteCoachHandLost();
    }
    return;
  }

  if (!_firstInferenceLogged) {
    _firstInferenceLogged = true;
    console.log(`[INF] ilk realInference fired: mode=${state.mode}`);
  }

  _inferenceInFlight = true;
  state.frameCount = (state.frameCount || 0) + 1;
  const tStart = performance.now();
  try {
    // The letter model loads on first need, and the camera start or the mode
    // switch that made this a letter context has asked for it. A frame never
    // asks: after a failure it would start a download every 120 ms. Until the
    // model has loaded and warmed up, frames are dropped here, the same as any
    // frame that arrives while inference is in flight.
    if (letterContext && (!letterSession || !(await ensureLetterModel()))) return;

    const raw = landmarksTo321D(latestMediaPipeResult);
    const normalized = normalizeShoulders(raw);

    // A coach target letter takes the same path as letter mode: the same
    // features, motion gate, smoothing and diagnostics.
    if (letterContext) {
      const f93 = computeLetterFeatures(raw, _videoAspect());

      // Publish a read-only letter snapshot for window.aslDebug.
      let motionGated = false;
      if (typeof window !== "undefined") {
        let rhCount = 0;
        let lhCount = 0;
        for (let i = 0; i < 63; i += 3) {
          if (
            Math.abs(raw[i]) > 1e-8 ||
            Math.abs(raw[i + 1]) > 1e-8 ||
            Math.abs(raw[i + 2]) > 1e-8
          ) rhCount++;
          if (
            Math.abs(raw[63 + i]) > 1e-8 ||
            Math.abs(raw[63 + i + 1]) > 1e-8 ||
            Math.abs(raw[63 + i + 2]) > 1e-8
          ) lhCount++;
        }
        const primary = rhCount >= lhCount ? "right" : "left";
        const mirrorApplied = primary === "left" && lhCount > 0;
        let fmin = Infinity;
        let fmax = -Infinity;
        let fsum = 0;
        for (let i = 0; i < 93; i++) {
          const v = f93[i];
          if (v < fmin) fmin = v;
          if (v > fmax) fmax = v;
          fsum += v;
        }
        // Capture smoothing and motion diagnostics.
        const smoothingState =
          typeof getLetterSmoothingState === "function"
            ? getLetterSmoothingState()
            : { enabled: false, alpha: null, prevSet: false };
        const motionData =
          typeof getLastLetterMotion === "function"
            ? getLastLetterMotion()
            : null;
        const motionGateEnabled =
          typeof CONFIG !== "undefined" && CONFIG.LETTER_MOTION_GATE_ENABLED === true;
        const motionGateThreshold =
          typeof CONFIG !== "undefined" && CONFIG.LETTER_MOTION_GATE_THRESHOLD != null
            ? CONFIG.LETTER_MOTION_GATE_THRESHOLD
            : 0.08;
        motionGated =
          motionGateEnabled &&
          motionData &&
          motionData.meanAbsDelta > motionGateThreshold;

        window._lastLetterDebug = {
          rightSlotPresent: rhCount > 0,
          leftSlotPresent: lhCount > 0,
          rhNonZeroLandmarks: rhCount,
          lhNonZeroLandmarks: lhCount,
          selectedPrimaryHand: primary,
          mirrorApplied,
          firstLandmarkSample: { x: raw[0], y: raw[1], z: raw[2] },
          feature93Stats: { min: fmin, max: fmax, mean: fsum / 93, length: 93 },
          landmarkSmoothing: {
            enabled: smoothingState.enabled,
            alpha: smoothingState.alpha,
            prevSet: smoothingState.prevSet,
          },
          motion: {
            enabled:
              typeof CONFIG !== "undefined" && CONFIG.LETTER_MOTION_DEBUG_ENABLED === true,
            meanAbsDelta: motionData ? motionData.meanAbsDelta : null,
            threshold: motionGateThreshold,
            gateEnabled: motionGateEnabled,
            gated: motionGated,
          },
          ts: now,
        };
      }

      // Skip unstable frames only when the optional motion gate is enabled.
      if (motionGated) {
        if (typeof window !== "undefined") {
          window._lastRawLetterPrediction = {
            label: "?",
            confidence: 0,
            source: "motion_gated",
          };
        }
        if (typeof recordBenchmark === "function") {
          recordBenchmark("total", performance.now() - tStart);
        }
        return;
      }

      const result = await predictLetter(f93);
      if (result) {
        if (!_firstPredictionLogged) {
          _firstPredictionLogged = true;
          console.log(
            `[INF] ilk harf tahmini: ${result.label} (%${(result.confidence * 100).toFixed(1)})`,
          );
        }
        // Distinguish probability-tensor output from the label-only fallback in
        // diagnostics without changing the displayed prediction.
        if (typeof window !== "undefined") {
          window._lastRawLetterPrediction = {
            label: result.label,
            confidence: result.confidence,
            source:
              result.alternatives && result.alternatives.length > 1
                ? "model_probs"
                : "label_only_fallback",
          };
        }
        const smoothed = typeof smoothLetterPrediction === "function"
          ? smoothLetterPrediction(result)
          : result;
        if (typeof window !== "undefined") {
          window._lastSmoothedLetterPrediction = {
            label: smoothed.label,
            confidence: smoothed.confidence,
          };
        }
        // The coach scores a target letter by its hold, so the hold sees the
        // result before the plate shows it.
        if (state.mode === "coach") noteCoachLetter(smoothed, now);
        updatePrediction(smoothed);
      } else {
        console.warn("[INF] predictLetter null döndü; model yüklü mü?");
      }
    } else if (state.mode === "word" || _isCoachWordTarget()) {
      if (state.wordState === "RECORDING") {
        // One MediaPipe result is one frame of the sign, however many render
        // frames read it: a repeat would fill the window with a hand standing
        // still and shorten the recording in time.
        if (latestMediaPipeResult.timestamp === _lastWordFrameTimestamp) return;
        _lastWordFrameTimestamp = latestMediaPipeResult.timestamp;
        // Track landmark visibility for every captured recording frame.
        if (_wordRecordingStats.startTs === 0) {
          _wordRecordingStats.startTs = now;
        }
        _wordRecordingStats.totalObservedFrames++;
        const handVisibleNow = Boolean(
          latestMediaPipeResult?.rightHandLandmarks ||
            latestMediaPipeResult?.leftHandLandmarks,
        );
        const poseVisibleNow = Boolean(latestMediaPipeResult?.poseLandmarks);
        const faceVisibleNow = Boolean(latestMediaPipeResult?.faceLandmarks);
        if (handVisibleNow) _wordRecordingStats.handVisibleCount++;
        if (poseVisibleNow) _wordRecordingStats.poseVisibleCount++;
        if (faceVisibleNow) _wordRecordingStats.faceVisibleCount++;
        // Choose the side with at least as many visible hand coordinates.
        if (handVisibleNow) _wordRecordingStats.dominantHandPresentCount++;
        // Expose the current frame status to the UI and debug panel.
        if (typeof window !== "undefined") {
          window._lastWordCurrentFrame = {
            handVisible: handVisibleNow,
            poseVisible: poseVisibleNow,
            faceVisible: faceVisibleNow,
            ts: now,
          };
        }

        if (!_hasRequiredWordLandmarks(latestMediaPipeResult)) {
          _wordRecordingStats.skippedFrames++;
          if (typeof window !== "undefined") {
            window._lastWordCurrentFrame.acceptedForRecording = false;
          }
          // Show the missing-landmark hint once, then re-arm it after recovery.
          if (!_wordWaitMessageShown && typeof setMessage === "function") {
            setMessage(
              "Kelime kaydı için el, yüz ve omuzlar aynı anda görünmeli. Kadrajı biraz genişletin.",
              "maybe",
            );
            _wordWaitMessageShown = true;
          }
          if (typeof updateWordState === "function") updateWordState();
          return;
        }
        // Re-arm the hint after all required landmark groups recover.
        _wordWaitMessageShown = false;
        _wordRecordingStats.acceptedFrames++;
        if (typeof noteUsableWordFrame === "function") noteUsableWordFrame(now);
        if (typeof window !== "undefined") {
          window._lastWordCurrentFrame.acceptedForRecording = true;
        }

        // Record feature-parity observations without affecting inference.
        const dominantSide = _observeDominantSide(raw);
        _wordRecordingStats.dominantHandTimeline.push(dominantSide);
        if (_wordRecordingStats.dominantHandTimeline.length > 45) {
          _wordRecordingStats.dominantHandTimeline.shift();
        }
        if (
          _wordRecordingStats.prevDominantSide &&
          _wordRecordingStats.prevDominantSide !== dominantSide &&
          dominantSide !== "none" &&
          _wordRecordingStats.prevDominantSide !== "none"
        ) {
          _wordRecordingStats.dominantHandSwitchCount++;
        }
        _wordRecordingStats.prevDominantSide = dominantSide;
        if (_observeShoulderFallback(raw)) {
          _wordRecordingStats.shoulderFallbackUsedCount++;
        }

        const compact = buildCompactFeatures(normalized, previousFrame);
        frameBuffer.push(compact);
        normalizedFrameBuffer.push(normalized);
        previousFrame = normalized;

        state.wordFrames = frameBuffer.length;
        updateWordState();

        if (frameBuffer.length >= CONFIG.WORD_FRAME_COUNT) {
          await _finishWordRecordingReal();
        }
      }
    }

    if (typeof recordBenchmark === "function") {
      recordBenchmark("total", performance.now() - tStart);
    }
  } catch (err) {
    console.error("[INF] realInference HATASI:", err);
  } finally {
    _inferenceInFlight = false;
  }
}

/**
 * The camera frame's width over its height, which the letter features need to
 * see the hand undistorted; 1 until the video reports its size.
 *
 * @returns {number}
 */
function _videoAspect() {
  const width = els.video?.videoWidth || 0;
  const height = els.video?.videoHeight || 0;
  return width > 0 && height > 0 ? width / height : 1;
}

/**
 * @returns {boolean} True in letter mode and for a single-letter coach
 *   target: the contexts that classify one frame at a time.
 */
function isLetterContext() {
  return state.mode === "letter" || (state.mode === "coach" && state.coachTarget?.length === 1);
}

/**
 * @returns {boolean} True when the coach is on a word rather than a letter.
 */
function _isCoachWordTarget() {
  return state.mode === "coach" &&
    typeof state.coachTarget === "string" &&
    state.coachTarget.length > 1;
}

/**
 * Turn a full recording into a prediction and publish the result.
 *
 * Features are rebuilt across the whole recording so dominant-hand selection
 * matches the training pipeline; if that rebuild throws, the per-frame buffer
 * is used and the snapshot records which path ran.
 *
 * A result that arrives after the user changed mode or stopped the camera is
 * discarded rather than displayed, even if the user is back by then. Either way the motion buffers and the
 * per-recording counters are cleared before returning, so the next recording
 * starts clean. A result that arrives after a newer recording started touches
 * nothing, because the state and the buffers belong to that recording. A run
 * that produced no result still ends in RESULT, with no word on offer.
 *
 * @returns {Promise<void>}
 */
async function _finishWordRecordingReal() {
  const recording = wordRecordingSerial;
  state.wordState = "PROCESSING";
  updateWordState();

  // Finalize read-only visibility and feature/motion statistics.
  const recordingDurationMs =
    _wordRecordingStats.startTs > 0
      ? performance.now() - _wordRecordingStats.startTs
      : 0;
  const total = Math.max(1, _wordRecordingStats.totalObservedFrames);
  const visibility = {
    handVisibleRatio: _wordRecordingStats.handVisibleCount / total,
    poseVisibleRatio: _wordRecordingStats.poseVisibleCount / total,
    faceVisibleRatio: _wordRecordingStats.faceVisibleCount / total,
    dominantHandPresentRatio:
      _wordRecordingStats.dominantHandPresentCount / total,
    totalObservedFrames: _wordRecordingStats.totalObservedFrames,
    acceptedFrames: _wordRecordingStats.acceptedFrames,
    skippedFrames: _wordRecordingStats.skippedFrames,
  };

  let inferenceBuffer = frameBuffer;
  let inferenceFeatureSource = "frame-level";
  try {
    if (
      Array.isArray(normalizedFrameBuffer) &&
      normalizedFrameBuffer.length > 0 &&
      typeof buildCompactSequenceFeatures === "function"
    ) {
      inferenceBuffer = buildCompactSequenceFeatures(normalizedFrameBuffer);
      inferenceFeatureSource = "sequence-level";
    }
  } catch (err) {
    console.warn("[WORD] sequence-level feature rebuild failed, falling back to frame-level buffer:", err);
    inferenceBuffer = frameBuffer;
    inferenceFeatureSource = "frame-level-fallback";
  }

  const flat = new Float32Array(45 * 168);
  const mask = new Array(45).fill(false);
  for (let i = 0; i < Math.min(inferenceBuffer.length, 45); i++) {
    flat.set(inferenceBuffer[i], i * 168);
    mask[i] = true;
  }

  // Summarize compact features over real frames only. Motion occupies indices
  // 105..167 of each 168D frame.
  let f168Min = Infinity;
  let f168Max = -Infinity;
  let f168Sum = 0;
  let f168Count = 0;
  let motionMin = Infinity;
  let motionMax = -Infinity;
  let motionSum = 0;
  let motionCount = 0;
  for (let i = 0; i < inferenceBuffer.length; i++) {
    const f = inferenceBuffer[i];
    if (!f) continue;
    for (let j = 0; j < 168; j++) {
      const v = f[j];
      if (v < f168Min) f168Min = v;
      if (v > f168Max) f168Max = v;
      f168Sum += v;
      f168Count++;
    }
    // Motion segment: indices 105..167.
    for (let j = 105; j < 168; j++) {
      const v = Math.abs(f[j]);
      if (v < motionMin) motionMin = v;
      if (v > motionMax) motionMax = v;
      motionSum += v;
      motionCount++;
    }
  }
  const feature168Stats = {
    min: f168Count ? f168Min : 0,
    max: f168Count ? f168Max : 0,
    mean: f168Count ? f168Sum / f168Count : 0,
    length: 168,
  };
  const motionStats = {
    min: motionCount ? motionMin : 0,
    max: motionCount ? motionMax : 0,
    mean: motionCount ? motionSum / motionCount : 0,
  };

  let result = null;
  try {
    result = await predictWord(flat, mask);
  } catch (err) {
    console.error("Word inference hatası:", err);
  }

  // A newer recording started while the model ran: the state and the
  // buffers are that recording's now, so this one leaves them alone.
  if (recording !== wordRecordingSerial) return;

  // Ignore a late asynchronous result if the user changed mode or stopped the
  // camera. A mode change and a stop both return the recording to IDLE, so a
  // state that is no longer PROCESSING means this recording was abandoned,
  // also when the user has come back to a word screen with the camera on by
  // the time the model answers.
  const coachWordTarget = _isCoachWordTarget();
  if (
    state.wordState !== "PROCESSING" ||
    (state.mode !== "word" && !coachWordTarget) ||
    !state.cameraOn
  ) {
    state.wordState = "IDLE";
    state.wordFrames = 0;
    updateWordState();
    frameBuffer = [];
    normalizedFrameBuffer = [];
    previousFrame = null;
    return;
  }

  let wordFeedbackShown = false;
  if (!result) {
    // A failed run ends in a RESULT with no word, never with the previous
    // word still on offer.
    updatePrediction({ label: "?", confidence: 0, alternatives: [] });
    reportProblem("Kayıt işlenemedi. Yeniden kaydedin.");
  } else {
    wordResultSerial = recording;
    updatePrediction(result);
    if (coachWordTarget && typeof updateCoachFromPrediction === "function") {
      updateCoachFromPrediction();
    }

    // Prefer actionable confusion feedback over the broader difficulty warning.
    let confusionMsg = null;
    let hardMsg = null;
    if (typeof getConfusionFeedback === "function" && result.alternatives.length >= 2) {
      confusionMsg = getConfusionFeedback(result.alternatives[0], result.alternatives[1]);
    }
    if (typeof getDifficultyMessage === "function") {
      hardMsg = getDifficultyMessage(result.label);
    }

    if (typeof showFeedback === "function") {
      if (confusionMsg) {
        showFeedback(confusionMsg, "confusion");
        wordFeedbackShown = true;
      } else if (hardMsg) {
        showFeedback(hardMsg, "hard");
        wordFeedbackShown = true;
      } else if (
        result.alternatives?.length > 1 &&
        result.alternatives[0].confidence - result.alternatives[1].confidence < 0.03
      ) {
        const topText =
          typeof formatTopPredictions === "function"
            ? formatTopPredictions(result.alternatives, 2)
            : `${result.alternatives[0].label} / ${result.alternatives[1].label}`;
        showFeedback(
          `İlk iki kelime çok yakın: ${topText}. Aynı işareti daha net ve kadrajı geniş tutarak tekrar deneyin.`,
          "confusion",
        );
        wordFeedbackShown = true;
      } else if (typeof clearFeedback === "function") {
        clearFeedback();
      }
    }

    // Word predictions require explicit user acceptance; they are never appended
    // to the transcript automatically.
  }

  // Publish quality warnings and the final recording snapshot for diagnostics.
  // The state gets codes, which prediction.js words for the user; the debug
  // snapshot keeps the technical reason with its numbers.
  if (typeof window !== "undefined") {
    /** @type {WordQualityCode[]} */
    const codes = [];
    /** @type {string[]} */
    const warnings = [];
    if (visibility.poseVisibleRatio < 0.5) {
      codes.push("pose");
      warnings.push("pose visibility < 0.5: yüz/omuzlar net görünmüyor");
    }
    if (visibility.faceVisibleRatio < 0.5) {
      codes.push("face");
      warnings.push("face visibility < 0.5: yüz net görünmüyor");
    }
    if (visibility.handVisibleRatio < 0.7) {
      codes.push("hand");
      warnings.push("hand visibility < 0.7: el aralıklarla kaybolmuş");
    }
    if (visibility.acceptedFrames < 30) {
      codes.push("few-frames");
      warnings.push(
        `kabul edilen frame az (${visibility.acceptedFrames} < 30): kayıt kalitesi düşük`,
      );
    }
    if (recordingDurationMs > 6000) {
      codes.push("slow");
      warnings.push(
        `kayıt süresi uzun (${(recordingDurationMs / 1000).toFixed(1)} sn): yavaş frame doluşu`,
      );
    }
    if (motionStats.mean < 0.001) {
      codes.push("still");
      warnings.push("motion ortalaması çok düşük: gesture yapılmamış olabilir");
    }

    state.wordQualityWarnings = codes;

    if (
      result &&
      codes.length > 0 &&
      !wordFeedbackShown &&
      typeof showFeedback === "function"
    ) {
      showFeedback(WORD_QUALITY_COPY[codes[0]], "low");
      wordFeedbackShown = true;
    }

    let temperatureVal = null;
    try {
      temperatureVal =
        typeof temperature !== "undefined" ? temperature : null;
    } catch (e) { /* noop */ }

    // Derive parity metrics only when inference produced a result.
    let top1Top2Margin = null;
    let confusionPairMatched = null;
    if (result && Array.isArray(result.alternatives) && result.alternatives.length >= 2) {
      const top1 = result.alternatives[0];
      const top2 = result.alternatives[1];
      top1Top2Margin = (top1.confidence ?? 0) - (top2.confidence ?? 0);
      if (typeof getConfusionFeedback === "function") {
        // Store confusion feedback as a boolean flag in the debug snapshot.
        confusionPairMatched = Boolean(getConfusionFeedback(top1, top2));
      }
    }
    const lowMotionWarning = motionStats.mean < 0.001;

    window._lastWordDebug = {
      state: state.wordState,
      recordedFrameCount: frameBuffer.length,
      expectedFrames: CONFIG.WORD_FRAME_COUNT,
      recordingDurationMs,
      visibility,
      currentFrame: window._lastWordCurrentFrame || null,
      sequence: {
        maskTrueCount: mask.filter(Boolean).length,
        feature168Stats,
        motionStats,
        // These values are diagnostic and do not influence model output.
        dominantHandSwitchCount: _wordRecordingStats.dominantHandSwitchCount,
        dominantHandTimeline: _wordRecordingStats.dominantHandTimeline.slice(),
        shoulderFallbackUsedCount: _wordRecordingStats.shoulderFallbackUsedCount,
        inferenceFeatureSource,
        lowMotionWarning,
      },
      prediction: result
        ? {
            label: result.label,
            confidence: result.confidence,
            top3: result.alternatives,
            temperature: temperatureVal,
            top1Top2Margin,
            confusionPairMatched,
          }
        : null,
      qualityWarnings: warnings,
      ts: performance.now(),
    };
    console.log(
      `[WORD] kayıt bitti: frame=${frameBuffer.length}/${CONFIG.WORD_FRAME_COUNT}, ` +
        `vis hand=${(visibility.handVisibleRatio * 100).toFixed(0)}% pose=${(visibility.poseVisibleRatio * 100).toFixed(0)}% face=${(visibility.faceVisibleRatio * 100).toFixed(0)}%, ` +
        `süre=${(recordingDurationMs / 1000).toFixed(1)}sn` +
        (warnings.length ? ` ⚠ ${warnings.length} uyarı` : ""),
    );
  }

  state.wordState = "RESULT";
  updateWordState();

  // Reset motion, buffers, and recording statistics before the next capture.
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  resetWordRecordingStats();
}
