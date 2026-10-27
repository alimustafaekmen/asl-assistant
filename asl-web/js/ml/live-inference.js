// Live inference: turns the latest published MediaPipe frame into a prediction.
//
// Letter: one frame, 93 features, throttled by the render loop and smoothed.
// Word: 45 accepted frames, each with hand, pose and face, since the layout has
// a fixed slot for each. Features are then rebuilt at sequence level so the
// dominant hand is chosen across the whole recording, as in training.
//
// One model call at a time: frames are dropped, never queued, and a word result
// that arrives after a mode change or camera stop is discarded. The diagnostics
// never change model output.

/**
 * Which hand carried the sign in one frame, by the feature pipeline's rule.
 *
 * @typedef {"right" | "left" | "none"} DominantSide
 */

/**
 * "frame-level-fallback": the sequence-level rebuild threw and the per-frame
 * buffer was used instead.
 *
 * @typedef {"frame-level" | "sequence-level" | "frame-level-fallback"} InferenceFeatureSource
 */

/**
 * Diagnostics only: nothing here changes the model input or the prediction.
 *
 * @typedef {Object} WordRecordingStats
 * @property {number} startTs Timestamp of the first observed frame, 0 before then.
 * @property {number} totalObservedFrames Frames seen while recording.
 * @property {number} acceptedFrames Frames that had every required landmark group.
 * @property {number} skippedFrames Frames rejected for a missing group.
 * @property {number} handVisibleCount
 * @property {number} poseVisibleCount
 * @property {number} faceVisibleCount
 * @property {number} dominantHandSwitchCount Hand changes, ignoring frames with no hand.
 * @property {DominantSide[]} dominantHandTimeline Capped at the recording length.
 * @property {DominantSide | null} prevDominantSide Internal comparison state.
 * @property {number} shoulderFallbackUsedCount Frames that used min-max normalization.
 */

/**
 * @typedef {Object} LandmarkVisibilitySummary
 * @property {number} handVisibleRatio
 * @property {number} poseVisibleRatio
 * @property {number} faceVisibleRatio
 * @property {number} totalObservedFrames
 * @property {number} acceptedFrames
 * @property {number} skippedFrames
 */

/**
 * @typedef {Object} NumericStats
 * @property {number} min
 * @property {number} max
 * @property {number} mean
 * @property {number} [length] Block width, where one applies.
 */

/**
 * @typedef {Object} WordCurrentFrameDebug
 * @property {boolean} handVisible
 * @property {boolean} poseVisible
 * @property {boolean} faceVisible
 * @property {number} ts
 * @property {boolean} [acceptedForRecording] Absent until the frame is judged.
 */

/**
 * Read-only snapshot of the last finished recording, for window.aslDebug.
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

// One asynchronous model call at a time; the rest show a log line or the word
// hint only once.
let _inferenceInFlight = false;
let _firstInferenceLogged = false;
let _firstPredictionLogged = false;
let _wordWaitMessageShown = false;
/**
 * Created on first use, so this script still loads without letter-model.js.
 *
 * @type {FrameWarning | null}
 */
let _noLetterResultWarning = null;
/**
 * Timestamp of the last result a word recording took. MediaPipe publishes from
 * its own loop, so a render frame can read a result already recorded.
 *
 * @type {number | null}
 */
let _lastWordFrameTimestamp = null;

/** @type {WordRecordingStats} */
let _wordRecordingStats = {
  startTs: 0,
  totalObservedFrames: 0,
  acceptedFrames: 0,
  skippedFrames: 0,
  handVisibleCount: 0,
  poseVisibleCount: 0,
  faceVisibleCount: 0,
  dominantHandSwitchCount: 0,
  dominantHandTimeline: [],
  prevDominantSide: null,
  shoulderFallbackUsedCount: 0,
};

/**
 * Called when a recording starts, ends early or is retried, and after
 * inference, so counters never span two recordings.
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
    dominantHandSwitchCount: 0,
    dominantHandTimeline: [],
    prevDominantSide: null,
    shoulderFallbackUsedCount: 0,
  };
}

/**
 * By the per-frame rule of computeDominantHand(). The model input chooses one
 * side per recording; this makes a mid-recording switch visible.
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
 * Pose landmarks 11 and 12 sit at 279 and 282. Counts only a missing shoulder,
 * not the coincident-shoulder fallback.
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
 * Called from the render loop. Frames are dropped, not queued, while a model
 * call is in flight, so a slow model cannot build a backlog.
 *
 * @param {number} now Render loop timestamp in milliseconds.
 * @returns {Promise<void>} Never rejects; failures are logged and the guard is
 *   released.
 */
async function realInference(now) {
  if (typeof state === "undefined" || !framesLive()) return;
  // The recording clock runs before any frame is looked at: a recording nobody
  // is in front of is the one that has to end.
  if (state.wordState === "RECORDING" && typeof checkWordRecordingClock === "function") {
    checkWordRecordingClock(now);
  }
  // If camera.js never loaded the name does not exist, and a bare read would throw.
  if (typeof latestMediaPipeResult === "undefined" || !latestMediaPipeResult) return;

  const letterContext = isLetterContext();

  // Read before a handless frame is dropped, so it can say the hand is missing.
  if (!letterContext && typeof noteWordFraming === "function") {
    noteWordFraming(latestMediaPipeResult);
  }
  if (_inferenceInFlight) return;

  // Letter contexts reset both smoothers on hand loss, so a previous sign
  // cannot leak across the gap.
  if (!latestMediaPipeResult.rightHandLandmarks && !latestMediaPipeResult.leftHandLandmarks) {
    if (letterContext) {
      resetSmoother();
      resetLetterLandmarkSmoother();
      // The coach counts what it sees; letter mode keeps its last letter on purpose.
      if (state.mode === "coach") noteCoachHandLost();
    }
    return;
  }

  if (!_firstInferenceLogged) {
    _firstInferenceLogged = true;
    console.log(`[INF] first realInference: mode=${state.mode}`);
  }

  _inferenceInFlight = true;
  state.frameCount = (state.frameCount || 0) + 1;
  const tStart = performance.now();
  try {
    // A frame never asks for the model: after a failure it would start a
    // download every 120 ms. Frames are dropped until it is loaded and warm.
    if (letterContext && (!letterSession || !(await ensureLetterModel()))) return;

    const raw = landmarksTo321D(latestMediaPipeResult);
    const normalized = normalizeShoulders(raw);

    if (letterContext) {
      const f93 = computeLetterFeatures(raw, _frameAspect(latestMediaPipeResult));

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
      const motionGated =
        motionGateEnabled &&
        motionData &&
        motionData.meanAbsDelta > motionGateThreshold;

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
        const smoothingState =
          typeof getLetterSmoothingState === "function"
            ? getLetterSmoothingState()
            : { enabled: false, alpha: null, prevSet: false };

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

      const mode = state.mode;
      const coachTarget = state.coachTarget;
      const result = await predictLetter(f93);
      // A mode change, a new coach target or a camera stop has already reset
      // the screen this frame was meant for.
      if (!framesLive() || state.mode !== mode || state.coachTarget !== coachTarget) return;
      if (result) {
        _noLetterResultWarning?.clear();
        if (!_firstPredictionLogged) {
          _firstPredictionLogged = true;
          console.log(
            `[INF] first letter prediction: ${result.label} (${(result.confidence * 100).toFixed(1)}%)`,
          );
        }
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
        // The hold sees the result before the plate shows it.
        if (state.mode === "coach") noteCoachLetter(smoothed, now);
        updatePrediction(smoothed);
      } else {
        _noLetterResultWarning ??= createFrameWarning();
        _noLetterResultWarning.note("warn", "[INF] predictLetter returned no result; frame dropped");
      }
    } else if (state.mode === "word" || _isCoachWordTarget()) {
      if (state.wordState === "RECORDING") {
        // One MediaPipe result is one frame of the sign: a repeat would fill the
        // window with a still hand and shorten the recording in time.
        if (latestMediaPipeResult.timestamp === _lastWordFrameTimestamp) return;
        _lastWordFrameTimestamp = latestMediaPipeResult.timestamp;
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
          // Show the hint once, then re-arm it after recovery.
          if (!_wordWaitMessageShown && typeof showWordMessage === "function") {
            showWordMessage("word.message.notAllInView", "maybe");
            _wordWaitMessageShown = true;
          }
          if (typeof updateWordState === "function") updateWordState();
          return;
        }
        _wordWaitMessageShown = false;
        _wordRecordingStats.acceptedFrames++;
        if (typeof noteUsableWordFrame === "function") noteUsableWordFrame(now);
        if (typeof window !== "undefined") {
          window._lastWordCurrentFrame.acceptedForRecording = true;
        }

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
    console.error("[INF] realInference failed:", err);
  } finally {
    _inferenceInFlight = false;
  }
}

/**
 * The letter features need it to see the hand undistorted; 1 until the video
 * reports its size.
 *
 * @returns {number}
 */
function _videoAspect() {
  const width = els.video?.videoWidth || 0;
  const height = els.video?.videoHeight || 0;
  return width > 0 && height > 0 ? width / height : 1;
}

/**
 * The frame's own aspect comes first: the demo's square photographs play while
 * the hidden video may still report the last camera's size.
 *
 * @param {MediaPipeFrameResult} result
 * @returns {number}
 */
function _frameAspect(result) {
  return result.aspect !== undefined && result.aspect > 0 ? result.aspect : _videoAspect();
}

/**
 * @returns {boolean} True in letter mode and for a single-letter coach target.
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
 * A result that arrives after a mode change or camera stop is discarded, even
 * if the user is back by then; one that arrives after a newer recording started
 * touches nothing, because the state and buffers belong to that recording. A
 * run with no result still ends in RESULT, with no word on offer.
 *
 * @returns {Promise<void>}
 */
async function _finishWordRecordingReal() {
  const recording = wordRecordingSerial;
  state.wordState = "PROCESSING";
  updateWordState();

  const recordingDurationMs =
    _wordRecordingStats.startTs > 0
      ? performance.now() - _wordRecordingStats.startTs
      : 0;
  const total = Math.max(1, _wordRecordingStats.totalObservedFrames);
  const visibility = {
    handVisibleRatio: _wordRecordingStats.handVisibleCount / total,
    poseVisibleRatio: _wordRecordingStats.poseVisibleCount / total,
    faceVisibleRatio: _wordRecordingStats.faceVisibleCount / total,
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

  // true marks a real frame; predictWord() passes the mask on uninverted.
  const flat = new Float32Array(45 * 168);
  const mask = new Array(45).fill(false);
  for (let i = 0; i < Math.min(inferenceBuffer.length, 45); i++) {
    flat.set(inferenceBuffer[i], i * 168);
    mask[i] = true;
  }

  // Summaries over real frames only; motion occupies 105..167.
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
    console.error("[WORD] word inference failed:", err);
  }

  // A newer recording started while the model ran; its state is not ours.
  if (recording !== wordRecordingSerial) return;

  // A mode change or stop returns the recording to IDLE, so a state that is no
  // longer PROCESSING means this one was abandoned.
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
    // Never leave the previous word on offer after a failed run.
    updatePrediction({ label: "?", confidence: 0, alternatives: [] });
    reportWordProblem("word.message.processingFailed");
  } else {
    wordResultSerial = recording;
    updatePrediction(result);
    if (coachWordTarget && typeof updateCoachFromPrediction === "function") {
      updateCoachFromPrediction();
    }

    // Actionable confusion feedback wins over the broader difficulty warning.
    let confusionMsg = null;
    let hardMsg = null;
    if (typeof confusionFeedbackCopy === "function" && result.alternatives.length >= 2) {
      confusionMsg = confusionFeedbackCopy(result.alternatives[0], result.alternatives[1]);
    }
    if (typeof difficultyCopy === "function") {
      hardMsg = difficultyCopy(result.label);
    }

    if (typeof showFeedback === "function") {
      if (confusionMsg) {
        showWordFeedback(confusionMsg, "confusion");
        wordFeedbackShown = true;
      } else if (hardMsg) {
        showWordFeedback(hardMsg, "hard");
        wordFeedbackShown = true;
      } else if (
        result.alternatives?.length > 1 &&
        result.alternatives[0].confidence - result.alternatives[1].confidence < 0.03
      ) {
        // Worked out when shown, so the percentages follow the language.
        const alternatives = result.alternatives;
        showWordFeedback(
          { key: "word.feedback.closeCall", params: () => ({ top: formatWordCandidates(alternatives, 2) }) },
          "confusion",
        );
        wordFeedbackShown = true;
      } else if (typeof clearFeedback === "function") {
        clearFeedback();
      }
    }

    // Consent: a word reaches the transcript only when the user accepts it.
  }

  // The state gets codes for prediction.js; the debug snapshot keeps the
  // technical reason with its numbers.
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
    // Looked up again on a language change, so the warning follows a switch.
    const code = codes[0];
    showFeedback(() => WORD_QUALITY_COPY[code], "low");
    wordFeedbackShown = true;
  }

  if (typeof window !== "undefined") {
    const temperatureVal = typeof temperature !== "undefined" ? temperature : null;

    let top1Top2Margin = null;
    let confusionPairMatched = null;
    if (result && Array.isArray(result.alternatives) && result.alternatives.length >= 2) {
      const top1 = result.alternatives[0];
      const top2 = result.alternatives[1];
      top1Top2Margin = (top1.confidence ?? 0) - (top2.confidence ?? 0);
      if (typeof getConfusionFeedback === "function") {
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
      `[WORD] recording done: frames=${frameBuffer.length}/${CONFIG.WORD_FRAME_COUNT}, ` +
        `visible hand=${(visibility.handVisibleRatio * 100).toFixed(0)}% pose=${(visibility.poseVisibleRatio * 100).toFixed(0)}% face=${(visibility.faceVisibleRatio * 100).toFixed(0)}%, ` +
        `duration=${(recordingDurationMs / 1000).toFixed(1)}s` +
        (warnings.length ? `, ${warnings.length} warnings` : ""),
    );
  }

  state.wordState = "RESULT";
  updateWordState();

  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  resetWordRecordingStats();
}
