// MediaPipe Tasks Vision orchestration for hands, pose, and face.
//
// The web API exposes separate HandLandmarker, PoseLandmarker, and
// FaceLandmarker tasks. This module combines their latest results into the
// shared `latestMediaPipeResult` object used by rendering and inference.
//
// MediaPipe normally reports handedness from the user's perspective. The
// optional CONFIG.SELFIE_HANDEDNESS_SWAP flag handles devices that consistently
// report the opposite convention.

/**
 * One MediaPipe landmark. Coordinates are normalized against the original,
 * unmirrored video frame.
 *
 * @typedef {Object} NormalizedLandmark
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} [visibility]
 * @property {number} [presence]
 */

/**
 * One detected body part as an ordered landmark list.
 *
 * @typedef {NormalizedLandmark[]} LandmarkList
 */

/**
 * Why one detected hand was assigned to a side, or rejected. Read-only
 * diagnostics; nothing downstream branches on it.
 *
 * @typedef {Object} HandednessDebugEntry
 * @property {string} raw Side as MediaPipe reported it.
 * @property {string} mapped Side after the optional selfie swap.
 * @property {number | null} score Confidence, or null when the task omits one.
 * @property {boolean} gated True when the score fell below the minimum.
 * @property {number} minScore The minimum in force for this frame.
 * @property {boolean} swapApplied Whether the selfie swap was applied.
 */

/**
 * The latest combined frame this module publishes for rendering and inference.
 *
 * Hand fields hold a list per detected person, because MediaPipe reports up to
 * two hands; the single-user app reads the first. Pose and face fields are
 * already flattened to the first detected person. Any group may be null when
 * that task is missing or still loading, which is why letter mode keeps working
 * without pose and face.
 *
 * @typedef {Object} MediaPipeFrameResult
 * @property {LandmarkList[] | null} rightHandLandmarks
 * @property {LandmarkList[] | null} leftHandLandmarks
 * @property {HandednessDebugEntry[]} handednessDebug
 * @property {LandmarkList | null} poseLandmarks
 * @property {LandmarkList | null} faceLandmarks
 * @property {number} timestamp Frame timestamp in milliseconds.
 */

// The MediaPipe Tasks surface below describes only the members this adapter
// uses. The upstream package is loaded from a CDN at runtime and its full type
// tree is deliberately not copied into the source.

/**
 * How MediaPipe reports which hand it detected. Older task builds omit the
 * score, so both fields are optional.
 *
 * @typedef {Object} HandednessCategory
 * @property {string} [categoryName]
 * @property {number} [score]
 */

/**
 * @typedef {Object} HandLandmarkerResult
 * @property {LandmarkList[]} [landmarks] One list per detected hand.
 * @property {HandednessCategory[][]} [handednesses] Parallel to landmarks.
 */

/**
 * @typedef {Object} PoseLandmarkerResult
 * @property {LandmarkList[]} [landmarks] One list per detected person.
 */

/**
 * @typedef {Object} FaceLandmarkerResult
 * @property {LandmarkList[]} [faceLandmarks] One list per detected face.
 */

/**
 * A MediaPipe task running in VIDEO mode.
 *
 * @template TResult
 * @typedef {Object} VideoLandmarkerTask
 * @property {(video: HTMLVideoElement, timestampMs: number) => TResult} detectForVideo
 * @property {() => void} close Release the task's WASM resources.
 */

/**
 * Creates one task with the given delegate, so the GPU and CPU attempts share a
 * single call path.
 *
 * @template TResult
 * @typedef {(delegate: "GPU" | "CPU") => Promise<VideoLandmarkerTask<TResult>>} LandmarkerFactory
 */

/**
 * The parts of the Tasks Vision ESM bundle this adapter reads.
 *
 * @typedef {Object} MediaPipeVisionModule
 * @property {{forVisionTasks: (wasmPath: string) => Promise<unknown>}} FilesetResolver
 * @property {{createFromOptions: (resolver: unknown, options: unknown) => Promise<VideoLandmarkerTask<HandLandmarkerResult>>}} HandLandmarker
 * @property {{createFromOptions: (resolver: unknown, options: unknown) => Promise<VideoLandmarkerTask<PoseLandmarkerResult>>}} PoseLandmarker
 * @property {{createFromOptions: (resolver: unknown, options: unknown) => Promise<VideoLandmarkerTask<FaceLandmarkerResult>>}} FaceLandmarker
 */

/** @type {VideoLandmarkerTask<HandLandmarkerResult> | null} */
let handLandmarker = null;
/** @type {VideoLandmarkerTask<PoseLandmarkerResult> | null} */
let poseLandmarker = null;
/** @type {VideoLandmarkerTask<FaceLandmarkerResult> | null} */
let faceLandmarker = null;
let mpRunning = false;
/** @type {HTMLVideoElement | null} */
let mpVideoEl = null;
/** Last timestamp handed to MediaPipe; it rejects a repeated timestamp. */
let lastHandTs = 0;
/** @type {MediaPipeFrameResult | null} */
let latestMediaPipeResult = null;
/** @type {HandednessDebugEntry[]} */
let latestHandednessDebug = [];
let mpOptionalLoading = false;
/** @type {LandmarkerFactory<PoseLandmarkerResult> | null} */
let mpPoseFactory = null;
/** @type {LandmarkerFactory<FaceLandmarkerResult> | null} */
let mpFaceFactory = null;
// The animation-frame handle stops orphaned loops; the start lock prevents a
// second loop from being created while asynchronous model startup is pending.
/** @type {number | null} */
let _rafId = null;
let mpStarting = false;
// Every start awaits the network several times, and a stop can land in any of
// those waits. stopMediaPipe() bumps the generation; a start or optional load
// that finds it changed after an await was cancelled, closes what it created,
// and leaves every flag to whichever start is current.
let _mpGeneration = 0;

const MP_TASKS_VERSION = "0.10.18";

/**
 * Import the MediaPipe Tasks Vision bundle, on first camera start only.
 *
 * @returns {Promise<MediaPipeVisionModule>}
 * @throws {Error} When the CDN is unreachable.
 */
async function _importTasksVision() {
  const mod = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_TASKS_VERSION}/vision_bundle.mjs`
  );
  return mod;
}

/**
 * Create one task, preferring the GPU delegate and falling back to CPU.
 *
 * @template TResult
 * @param {string} name Task name, for the console trail.
 * @param {LandmarkerFactory<TResult>} factory
 * @param {{gpu: "GPU", cpu: "CPU"}} options Delegate names to try, in order.
 * @returns {Promise<VideoLandmarkerTask<TResult>>}
 * @throws {Error} When both delegates fail; the CPU error is propagated.
 */
async function _createWithFallback(name, factory, options) {
  console.log(`[MP] ${name}: trying the GPU delegate`);
  try {
    const inst = await factory(options.gpu);
    console.log(`[MP] ${name}: GPU ready`);
    return inst;
  } catch (gpuErr) {
    console.warn(`[MP] ${name}: GPU failed (${gpuErr?.message || gpuErr}), falling back to CPU`);
    try {
      const inst = await factory(options.cpu);
      console.log(`[MP] ${name}: CPU ready`);
      return inst;
    } catch (cpuErr) {
      console.error(`[MP] ${name}: CPU failed too:`, cpuErr);
      throw cpuErr;
    }
  }
}

/**
 * Start hand detection and begin loading the optional pose and face tasks.
 *
 * Hands are required by every mode, so a hand failure is fatal and reaches the
 * caller. Pose and face are only needed for words and load in the background,
 * which is what keeps letter mode usable on a slow connection.
 *
 * Re-entry is refused while a start is in flight, so a second detection loop
 * cannot be created. A stop while this awaits cancels it: the start closes
 * whatever task it was given and resolves without detecting anything.
 *
 * @param {HTMLVideoElement} videoEl Live camera video.
 * @returns {Promise<void>}
 * @throws {Error} When the CDN import or the hand task fails.
 */
async function startMediaPipe(videoEl) {
  if (mpRunning || mpStarting) {
    console.log("[MP] already running or starting; skipped");
    return;
  }
  mpStarting = true;
  mpVideoEl = videoEl;
  const generation = _mpGeneration;
  const cancelled = () => generation !== _mpGeneration;

  try {
    console.log("[MP] importing vision_bundle.mjs");
    let vision;
    try {
      vision = await _importTasksVision();
      console.log("[MP] import done");
    } catch (err) {
      console.error("[MP] import failed; is the CDN reachable?", err);
      throw err;
    }
    if (cancelled()) return;

    const { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } = vision;

    console.log("[MP] loading the WASM fileset");
    const resolver = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_TASKS_VERSION}/wasm`,
    );
    if (cancelled()) return;
    console.log("[MP] WASM fileset ready");

    // Pinned like the bundle: a /latest/ model could change under it unseen.
    // When pinned, /1/ and /latest/ served identical bytes (same md5).
    const HAND_MODEL =
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
    const POSE_MODEL =
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
    const FACE_MODEL =
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

    const handDetConf =
      typeof CONFIG !== "undefined" && CONFIG.HAND_DETECTION_CONFIDENCE != null
        ? CONFIG.HAND_DETECTION_CONFIDENCE
        : 0.5;
    const handPresConf =
      typeof CONFIG !== "undefined" && CONFIG.HAND_PRESENCE_CONFIDENCE != null
        ? CONFIG.HAND_PRESENCE_CONFIDENCE
        : 0.5;
    const handTrackConf =
      typeof CONFIG !== "undefined" && CONFIG.HAND_TRACKING_CONFIDENCE != null
        ? CONFIG.HAND_TRACKING_CONFIDENCE
        : 0.5;
    console.log(
      `[MP] Hand thresholds: detection=${handDetConf}, presence=${handPresConf}, tracking=${handTrackConf}, numHands=2`,
    );
    /** @type {LandmarkerFactory<HandLandmarkerResult>} */
    const handFactory = (delegate) =>
      HandLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        numHands: 2,
        runningMode: "VIDEO",
        minHandDetectionConfidence: handDetConf,
        minHandPresenceConfidence: handPresConf,
        minTrackingConfidence: handTrackConf,
      });
    /** @type {LandmarkerFactory<PoseLandmarkerResult>} */
    const poseFactory = (delegate) =>
      PoseLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.3,
        minPosePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    /** @type {LandmarkerFactory<FaceLandmarkerResult>} */
    const faceFactory = (delegate) =>
      FaceLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    mpPoseFactory = poseFactory;
    mpFaceFactory = faceFactory;

    // Hand startup errors are fatal and must reach the caller for user feedback.
    /** @type {VideoLandmarkerTask<HandLandmarkerResult>} */
    let hand;
    try {
      hand = await _createWithFallback("HandLandmarker", handFactory, {
        gpu: "GPU",
        cpu: "CPU",
      });
    } catch (err) {
      console.error("[MP] HandLandmarker failed to start; MediaPipe aborted:", err);
      throw err;
    }
    if (cancelled()) {
      try { hand.close(); } catch (e) { /* noop */ }
      return;
    }
    handLandmarker = hand;

    // Start hand detection immediately. Pose and face assets are larger and
    // may continue loading in the background without blocking letter mode.
    mpRunning = true;
    lastHandTs = 0;
    _firstFrameLogged = false;
    _firstHandLogged = false;
    _noHandWarnLogged = false;
    _frameStats = { processed: 0, handsDetected: 0, lastSummary: 0 };
    console.log("[MP] started: hand task ready (1/3)");
    if (typeof state !== "undefined" && typeof els !== "undefined" && els.latencyBadge) {
      els.latencyBadge.textContent = "El izleme hazır";
    }
    _rafId = requestAnimationFrame(_processFrame);

    _ensureOptionalHolisticLandmarkers();
  } finally {
    // A failed start must not keep the lock, or no later start could run. A
    // cancelled one leaves it alone: stopMediaPipe() already released it, and
    // a newer start may hold it now.
    if (!cancelled()) mpStarting = false;
  }
}

/**
 * Stop detection and release every task.
 *
 * The pending animation frame is cancelled here; without that, a stop followed
 * by a start would leave two loops running.
 *
 * @returns {void}
 */
function stopMediaPipe() {
  // Any start or optional load still awaiting the network is now cancelled.
  _mpGeneration++;
  mpRunning = false;
  mpStarting = false;
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  mpOptionalLoading = false;
  try { handLandmarker?.close(); } catch (e) { /* noop */ }
  try { poseLandmarker?.close(); } catch (e) { /* noop */ }
  try { faceLandmarker?.close(); } catch (e) { /* noop */ }
  handLandmarker = null;
  poseLandmarker = null;
  faceLandmarker = null;
  mpPoseFactory = null;
  mpFaceFactory = null;
  latestMediaPipeResult = null;
}

/**
 * Start loading pose and face if a word context needs them and they are absent.
 *
 * @returns {void}
 */
function _ensureOptionalHolisticLandmarkers() {
  if (!_needsHolisticLandmarks()) return;
  if (poseLandmarker && faceLandmarker) return;
  if (mpOptionalLoading) return;
  if (!mpPoseFactory || !mpFaceFactory) return;
  _loadOptionalHolisticLandmarkers();
}

/**
 * Load the pose and face tasks in the background.
 *
 * Either task may fail without stopping the app; word recording stays disabled
 * until both are present. A task that finishes after the camera stopped is
 * closed rather than kept.
 *
 * @returns {Promise<void>} Resolves even when a task failed to load.
 */
async function _loadOptionalHolisticLandmarkers() {
  if (mpOptionalLoading) return;
  // Read once: a stop during the download clears them for the next session.
  const poseFactory = mpPoseFactory;
  const faceFactory = mpFaceFactory;
  if (!poseFactory || !faceFactory) return;
  mpOptionalLoading = true;
  const generation = _mpGeneration;
  // mpRunning alone cannot tell this load's session from a newer one: a stop
  // and a start during the download set it back to true.
  const cancelled = () => generation !== _mpGeneration;

  let pose = null;
  let face = null;

  try {
    pose = await _createWithFallback("PoseLandmarker", poseFactory, {
      gpu: "GPU",
      cpu: "CPU",
    });
  } catch (err) {
    console.warn("[MP] PoseLandmarker failed to load; word recording stays disabled:", err);
  }

  // A cancelled load leaves mpOptionalLoading to the newer session.
  if (cancelled()) {
    try { pose?.close(); } catch (e) { /* noop */ }
    return;
  }
  poseLandmarker = pose;

  try {
    face = await _createWithFallback("FaceLandmarker", faceFactory, {
      gpu: "GPU",
      cpu: "CPU",
    });
  } catch (err) {
    console.warn("[MP] FaceLandmarker failed to load; word recording stays disabled:", err);
  }

  if (cancelled()) {
    try { face?.close(); } catch (e) { /* noop */ }
    return;
  }
  faceLandmarker = face;
  mpOptionalLoading = false;

  const ready = [
    handLandmarker ? "Hand" : null,
    poseLandmarker ? "Pose" : null,
    faceLandmarker ? "Face" : null,
  ].filter(Boolean);
  console.log(`[MP] tasks ready: ${ready.join("+")} (${ready.length}/3)`);
  if (typeof state !== "undefined" && typeof els !== "undefined" && els.latencyBadge) {
    els.latencyBadge.textContent = `Hazırlanıyor (${ready.length}/3)`;
  }
}

// Console diagnostics for _processFrame: one-shot messages per session, and a
// periodic hand hit-rate summary.
let _firstFrameLogged = false;
let _firstHandLogged = false;
let _handStartTs = 0;
let _noHandWarnLogged = false;
/** @type {{processed: number, handsDetected: number, lastSummary: number}} */
let _frameStats = { processed: 0, handsDetected: 0, lastSummary: 0 };

/**
 * Detect one frame and publish the combined result.
 *
 * Runs on every animation frame while the camera is on, and always schedules
 * the next frame through _rafId so the loop stays cancellable. Frames are
 * skipped, never queued, when the video is not ready or the timestamp did not
 * advance, because MediaPipe rejects a repeated timestamp.
 *
 * @returns {void}
 */
function _processFrame() {
  if (!mpRunning) return;
  if (!mpVideoEl || mpVideoEl.readyState < 2 || mpVideoEl.videoWidth === 0) {
    _rafId = requestAnimationFrame(_processFrame);
    return;
  }

  if (!_firstFrameLogged) {
    _firstFrameLogged = true;
    _handStartTs = performance.now();
    console.log(
      `[MP] first frame: video ${mpVideoEl.videoWidth}x${mpVideoEl.videoHeight}, readyState=${mpVideoEl.readyState}`,
    );
  }
  _frameStats.processed++;

  const ts = performance.now();
  const t0 = ts;
  if (ts <= lastHandTs) {
    _rafId = requestAnimationFrame(_processFrame);
    return;
  }
  lastHandTs = ts;

  let handRes = null;
  let poseRes = null;
  let faceRes = null;
  try {
    if (handLandmarker) handRes = handLandmarker.detectForVideo(mpVideoEl, ts);
    if (_needsHolisticLandmarks()) {
      _ensureOptionalHolisticLandmarkers();
      if (poseLandmarker) poseRes = poseLandmarker.detectForVideo(mpVideoEl, ts);
      if (faceLandmarker) faceRes = faceLandmarker.detectForVideo(mpVideoEl, ts);
    }
  } catch (err) {
    console.warn("[MP] detection failed:", err);
    _rafId = requestAnimationFrame(_processFrame);
    return;
  }

  // The video is mirrored only by CSS. MediaPipe and model features use the
  // original frame coordinates; the overlay handles visual mirroring separately.

  // HandLandmarker returns parallel landmark and handedness arrays. Reject a
  // side assignment below the configured score, but accept results that do not
  // provide a score for compatibility with older task outputs.
  const rightHandLandmarks = [];
  const leftHandLandmarks = [];
  const handednessDebug = [];
  const handMinScore =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_HANDEDNESS_SCORE_MIN != null
      ? CONFIG.LETTER_HANDEDNESS_SCORE_MIN
      : (typeof CONFIG !== "undefined" && CONFIG.HAND_HANDEDNESS_SCORE_MIN != null
          ? CONFIG.HAND_HANDEDNESS_SCORE_MIN
          : 0);
  const swapApplied = _shouldSwapHandedness();
  if (handRes && handRes.landmarks && handRes.handednesses) {
    for (let i = 0; i < handRes.landmarks.length; i++) {
      const category = handRes.handednesses[i]?.[0];
      const rawHanded = category?.categoryName || "";
      const handednessScore = category?.score ?? null;
      let handed = rawHanded;
      if (swapApplied) {
        if (handed === "Left") handed = "Right";
        else if (handed === "Right") handed = "Left";
      }
      const passGate =
        handednessScore == null || handednessScore >= handMinScore;
      handednessDebug.push({
        raw: rawHanded,
        mapped: handed,
        score: handednessScore,
        gated: !passGate,
        minScore: handMinScore,
        swapApplied,
      });
      if (passGate) {
        if (handed === "Right") rightHandLandmarks.push(handRes.landmarks[i]);
        else if (handed === "Left") leftHandLandmarks.push(handRes.landmarks[i]);
      }
    }
    latestHandednessDebug = handednessDebug;
    if (handRes.landmarks.length > 0) {
      _frameStats.handsDetected++;
      if (!_firstHandLogged) {
        _firstHandLogged = true;
        const handsList = handRes.handednesses
          .map((h) => h?.[0]?.categoryName || "?")
          .join(", ");
        console.log(
          `[MP] first hand: handedness=[${handsList}], ` +
            `mapped=[${handednessDebug.map((h) => h.mapped).join(", ")}], ` +
            `landmarks=${handRes.landmarks[0]?.length}, ` +
            `after ${(performance.now() - _handStartTs).toFixed(0)} ms`,
        );
      }
    }
  }

  // Report prolonged hand absence once rather than once per frame.
  if (
    !_firstHandLogged &&
    !_noHandWarnLogged &&
    _frameStats.processed > 60 &&
    performance.now() - _handStartTs > 5000
  ) {
    _noHandWarnLogged = true;
    console.warn(
      `[MP] no hand detected for 5 s (${_frameStats.processed} frames processed). ` +
        "Show the hand clearly, add light, and stay 50-80 cm from the camera.",
    );
  }

  // The hand hit rate, at most every five seconds.
  if (performance.now() - _frameStats.lastSummary > 5000 && _frameStats.processed > 30) {
    _frameStats.lastSummary = performance.now();
    const rate = ((_frameStats.handsDetected / _frameStats.processed) * 100).toFixed(0);
    console.log(
      `[MP] stats: ${_frameStats.processed} frames, ${_frameStats.handsDetected} with a hand (${rate}% hit rate)`,
    );
    _frameStats.processed = 0;
    _frameStats.handsDetected = 0;
  }

  latestMediaPipeResult = {
    rightHandLandmarks: rightHandLandmarks.length ? rightHandLandmarks : null,
    leftHandLandmarks: leftHandLandmarks.length ? leftHandLandmarks : null,
    handednessDebug,
    poseLandmarks:
      poseRes && poseRes.landmarks && poseRes.landmarks.length
        ? poseRes.landmarks[0]
        : null,
    faceLandmarks:
      faceRes && faceRes.faceLandmarks && faceRes.faceLandmarks.length
        ? faceRes.faceLandmarks[0]
        : null,
    timestamp: ts,
  };

  // Render the latest MediaPipe result independently of prediction smoothing so
  // the overlay stays responsive even when model inference is throttled.
  if (typeof drawOverlay === "function") {
    drawOverlay();
  }

  if (typeof recordBenchmark === "function") {
    recordBenchmark("mediapipe", performance.now() - t0);
  }

  _rafId = requestAnimationFrame(_processFrame);
}

/**
 * @returns {boolean} Whether to swap MediaPipe's left and right labels.
 *   Defaults to true when the flag is absent, matching the pre-config behaviour.
 */
function _shouldSwapHandedness() {
  if (typeof CONFIG !== "undefined" && "SELFIE_HANDEDNESS_SWAP" in CONFIG) {
    return Boolean(CONFIG.SELFIE_HANDEDNESS_SWAP);
  }
  return true;
}

/**
 * @returns {boolean} True in word contexts, which are word mode and a coach
 *   target longer than one character.
 */
function _needsHolisticLandmarks() {
  if (typeof state === "undefined") return true;
  const coachWordTarget =
    state.mode === "coach" &&
    typeof state.coachTarget === "string" &&
    state.coachTarget.length > 1;
  return state.mode === "word" || coachWordTarget;
}

/**
 * Whether a frame may be recorded for word inference.
 *
 * All three groups are required: the 321D layout has a fixed slot for each, so
 * a missing group would reach the model as zeros.
 *
 * @param {MediaPipeFrameResult | null | undefined} result
 * @returns {boolean}
 */
function _hasRequiredWordLandmarks(result) {
  return Boolean(result?.rightHandLandmarks || result?.leftHandLandmarks) &&
    Boolean(result?.poseLandmarks) &&
    Boolean(result?.faceLandmarks);
}
