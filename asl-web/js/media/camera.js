// ─── MediaPipe Tasks Vision (Hand + Pose + Face) ──────────────
//
// MediaPipe HolisticLandmarker'ın resmi web bindings'i şu anda
// HandLandmarker / PoseLandmarker / FaceLandmarker olarak ayrı.
// Üçünü birleştirip `latestMediaPipeResult` global'ine yazarız.
//
// SELFIE-MODE HANDEDNESS:
// MediaPipe Tasks genellikle kullanıcı perspektifinde "Left/Right" döndürür.
// Bu yüzden varsayılan swap kapalıdır. Eğer belirli bir cihazda kullanıcı
// sağ eli "Left" olarak gelirse CONFIG.SELFIE_HANDEDNESS_SWAP açılabilir.

let handLandmarker = null;
let poseLandmarker = null;
let faceLandmarker = null;
let mpRunning = false;
let mpVideoEl = null;
let lastHandTs = 0;
let latestMediaPipeResult = null;
let latestHandednessDebug = [];
let mpOptionalLoading = false;
let mpPoseFactory = null;
let mpFaceFactory = null;
// Frame döngüsünün rAF handle'ı ve "başlatılıyor" kilidi.
// _rafId sayesinde durdurunca bekleyen frame iptal edilir; mpStarting ise
// startMediaPipe'ın await'leri sırasında ikinci bir döngü açılmasını engeller.
// rAF handle + start lock prevent orphaned / duplicate frame loops.
let _rafId = null;
let mpStarting = false;

const MP_TASKS_VERSION = "0.10.18";

async function _importTasksVision() {
  // Dinamik ESM import
  const mod = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_TASKS_VERSION}/vision_bundle.mjs`
  );
  return mod;
}

// GPU delegate başarısız olursa CPU'ya düşen helper.
async function _createWithFallback(name, factory, options) {
  console.log(`[MP] ${name}: GPU deneniyor...`);
  try {
    const inst = await factory(options.gpu);
    console.log(`[MP] ${name}: GPU OK ✓`);
    return inst;
  } catch (gpuErr) {
    console.warn(`[MP] ${name}: GPU başarısız (${gpuErr?.message || gpuErr}), CPU'ya düşülüyor`);
    try {
      const inst = await factory(options.cpu);
      console.log(`[MP] ${name}: CPU OK ✓`);
      return inst;
    } catch (cpuErr) {
      console.error(`[MP] ${name}: CPU de başarısız:`, cpuErr);
      throw cpuErr;
    }
  }
}

async function startMediaPipe(videoEl) {
  if (mpRunning || mpStarting) {
    console.log("[MP] zaten çalışıyor/başlatılıyor, atlanıyor");
    return;
  }
  mpStarting = true;
  mpVideoEl = videoEl;

  console.log("[MP] vision_bundle.mjs import ediliyor...");
  let vision;
  try {
    vision = await _importTasksVision();
    console.log("[MP] import OK ✓");
  } catch (err) {
    console.error("[MP] import HATASI — CDN erişimi yok mu?", err);
    mpStarting = false;
    throw err;
  }

  const { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } = vision;

  console.log("[MP] FilesetResolver.forVisionTasks (wasm) yükleniyor...");
  const resolver = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_TASKS_VERSION}/wasm`,
  );
  console.log("[MP] resolver OK ✓");

  const HAND_MODEL =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
  const POSE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
  const FACE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

  // Hand kritik (her iki mod da kullanır). Pose/Face kelime modu için.
  // Hand fail ederse her şey durur. Pose/Face fail ederse harf modu yine çalışır.
  // Threshold'lar CONFIG'e taşındı; default 0.5 (desktop ile hizalandı).
  // Bazı kameralarda 0.5 çok katı olursa CONFIG.HAND_DETECTION_CONFIDENCE = 0.3 ile geri alınabilir.
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
  const handFactory = (delegate) =>
    HandLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      numHands: 2,
      runningMode: "VIDEO",
      minHandDetectionConfidence: handDetConf,
      minHandPresenceConfidence: handPresConf,
      minTrackingConfidence: handTrackConf,
    });
  const poseFactory = (delegate) =>
    PoseLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
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

  // Hand zorunlu — hata fırlatırsa kullanıcı bilgilendirilsin.
  try {
    handLandmarker = await _createWithFallback("HandLandmarker", handFactory, {
      gpu: "GPU",
      cpu: "CPU",
    });
  } catch (err) {
    console.error("[MP] HandLandmarker başlatılamadı, MediaPipe iptal:", err);
    handLandmarker = null;
    throw err;
  }

  // Harf algilama icin sadece Hand yeterli. Pose/Face modelleri buyuk ve CDN'de
  // gecikebilir; onlari beklersek kamera acik oldugu halde detection baslamaz.
  mpRunning = true;
  mpStarting = false;
  lastHandTs = 0;
  _firstFrameLogged = false;
  _firstHandLogged = false;
  _noHandWarnLogged = false;
  _frameStats = { processed: 0, handsDetected: 0, lastSummary: 0 };
  console.log("[MP] başlatıldı: Hand hazır (1/3)");
  if (typeof state !== "undefined" && typeof els !== "undefined" && els.latencyBadge) {
    els.latencyBadge.textContent = "MP: Hand hazır";
  }
  _rafId = requestAnimationFrame(_processFrame);

  _ensureOptionalHolisticLandmarkers();
}

function stopMediaPipe() {
  mpRunning = false;
  mpStarting = false;
  // Bekleyen frame'i iptal et ki durdurduktan sonra döngü artık kalmasın.
  // Cancel any pending frame so no loop survives a stop/restart.
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

function _ensureOptionalHolisticLandmarkers() {
  if (!_needsHolisticLandmarks()) return;
  if (poseLandmarker && faceLandmarker) return;
  if (mpOptionalLoading) return;
  if (!mpPoseFactory || !mpFaceFactory) return;
  _loadOptionalHolisticLandmarkers();
}

async function _loadOptionalHolisticLandmarkers() {
  if (mpOptionalLoading) return;
  mpOptionalLoading = true;

  let pose = null;
  let face = null;

  try {
    pose = await _createWithFallback("PoseLandmarker", mpPoseFactory, {
      gpu: "GPU",
      cpu: "CPU",
    });
  } catch (err) {
    console.warn("[MP] PoseLandmarker yüklenemedi (kelime modu etkilenir):", err);
  }

  if (!mpRunning) {
    try { pose?.close(); } catch (e) { /* noop */ }
    mpOptionalLoading = false;
    return;
  }
  poseLandmarker = pose;

  try {
    face = await _createWithFallback("FaceLandmarker", mpFaceFactory, {
      gpu: "GPU",
      cpu: "CPU",
    });
  } catch (err) {
    console.warn("[MP] FaceLandmarker yüklenemedi (kelime modu etkilenir):", err);
  }

  if (!mpRunning) {
    try { face?.close(); } catch (e) { /* noop */ }
    mpOptionalLoading = false;
    return;
  }
  faceLandmarker = face;
  mpOptionalLoading = false;

  const ready = [
    handLandmarker ? "Hand" : null,
    poseLandmarker ? "Pose" : null,
    faceLandmarker ? "Face" : null,
  ].filter(Boolean);
  console.log(`[MP] opsiyonel modeller hazır: ${ready.join("+")} (${ready.length}/3)`);
  if (typeof state !== "undefined" && typeof els !== "undefined" && els.latencyBadge) {
    els.latencyBadge.textContent = `MP: ${ready.length}/3 hazır`;
  }
}

// Tek seferlik debug bayrakları
let _firstFrameLogged = false;
let _firstHandLogged = false;
let _handStartTs = 0;
let _noHandWarnLogged = false;
let _frameStats = { processed: 0, handsDetected: 0, lastSummary: 0 };

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
      `[MP] ilk frame işleniyor — video ${mpVideoEl.videoWidth}x${mpVideoEl.videoHeight}, readyState=${mpVideoEl.readyState}`,
    );
  }
  _frameStats.processed++;

  const ts = performance.now();
  const t0 = ts;
  // Aynı timestamp ile çift çağrı yapılmamalı (MediaPipe hata verir)
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
    console.warn("[MP] detect hatası:", err);
    _rafId = requestAnimationFrame(_processFrame);
    return;
  }

  // SELFIE-MODE: video CSS'te scaleX(-1) ile aynalı gösteriliyor.
  // MediaPipe ham görüntüyü işliyor (ayna değil) → handedness ham görüntüye göre.
  // Training de ayna değil → landmarklar olduğu gibi kullanılır.
  // Sadece çizimde aynalama yapacağız (drawLandmarks kendi yapar).

  // Hand landmarker: result.landmarks (Array<NormalizedLandmark[]>), result.handednesses
  // handedness score yakalanır, eşiğin altındaysa slot'a yazılmaz.
  // LETTER_HANDEDNESS_SCORE_MIN (yeni isim) öncelikli; HAND_HANDEDNESS_SCORE_MIN fallback.
  // Score yoksa gate atlanır (eski davranışı bozma).
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
          `[MP] ✓ ilk el algılandı — handedness=[${handsList}], ` +
            `mapped=[${handednessDebug.map((h) => h.mapped).join(", ")}], ` +
            `lm sayısı=${handRes.landmarks[0]?.length}, ` +
            `ilk el için ${(performance.now() - _handStartTs).toFixed(0)}ms geçti`,
        );
      }
    }
  }

  // 5 sn boyunca el algılanmadıysa bir kez uyar
  if (
    !_firstHandLogged &&
    !_noHandWarnLogged &&
    _frameStats.processed > 60 &&
    performance.now() - _handStartTs > 5000
  ) {
    _noHandWarnLogged = true;
    console.warn(
      `[MP] ⚠ 5 sn'dir hand detection YOK (${_frameStats.processed} frame işlendi, 0 hand). ` +
        "Eli kameraya net göster, ışığı artır, mesafeyi 50-80 cm tut.",
    );
  }

  // Her 5 sn'de bir kısa stat özeti (el algılandığı sürece)
  if (performance.now() - _frameStats.lastSummary > 5000 && _frameStats.processed > 30) {
    _frameStats.lastSummary = performance.now();
    const rate = ((_frameStats.handsDetected / _frameStats.processed) * 100).toFixed(0);
    console.log(
      `[MP] stat — ${_frameStats.processed} frame, ${_frameStats.handsDetected} hand (%${rate} hit)`,
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

  // Overlay, prediction smoother'dan bağımsız olarak en yeni MediaPipe sonucunu
  // çizer. Böylece görsel landmarklar model tahmininden bir frame daha hızlı
  // güncellenir ve word modunda raw sonuca yakın hissedilir.
  if (typeof drawOverlay === "function") {
    drawOverlay(ts);
  }

  if (typeof recordBenchmark === "function") {
    recordBenchmark("mediapipe", performance.now() - t0);
  }

  _rafId = requestAnimationFrame(_processFrame);
}

function _shouldSwapHandedness() {
  if (typeof CONFIG !== "undefined" && "SELFIE_HANDEDNESS_SWAP" in CONFIG) {
    return Boolean(CONFIG.SELFIE_HANDEDNESS_SWAP);
  }
  return true;
}

function _needsHolisticLandmarks() {
  if (typeof state === "undefined") return true;
  const coachWordTarget =
    state.mode === "coach" &&
    typeof state.coachTarget === "string" &&
    state.coachTarget.length > 1;
  return state.mode === "word" || coachWordTarget;
}

function _hasRequiredWordLandmarks(result) {
  return Boolean(result?.rightHandLandmarks || result?.leftHandLandmarks) &&
    Boolean(result?.poseLandmarks) &&
    Boolean(result?.faceLandmarks);
}

// ─── Overlay çizimi (app.js drawOverlay → drawLandmarks) ─────
function drawLandmarks(ctx, result, width, height, videoEl = null) {
  if (!result) return;
  ctx.save();

  const videoRect = _getVideoCoverRect(videoEl, width, height);
  const projectPoint = (pt) => {
    const rawX = videoRect.x + pt.x * videoRect.width;
    const rawY = videoRect.y + pt.y * videoRect.height;
    // Video CSS'te scaleX(-1) ile aynali. MediaPipe ham video koordinati
    // dondurdugu icin overlay'de x koordinatini aynali goruntuye cevir.
    return { x: width - rawX, y: rawY };
  };

  const drawDot = (pt, color, radius = 4) => {
    if (!pt) return;
    const { x, y } = projectPoint(pt);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawLine = (a, b, color, lineWidth = 2) => {
    if (!a || !b) return;
    const pa = projectPoint(a);
    const pb = projectPoint(b);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  };

  const drawHand = (hand, color) => {
    if (!hand || !hand.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];
    for (const [a, b] of connections) {
      if (a < hand.length && b < hand.length) drawLine(hand[a], hand[b], color, 2);
    }
    for (const pt of hand) drawDot(pt, color, 3.8);
  };

  // Kelime ve kelime-koç modunda model el + yüz + omuz/pose bilgisine ihtiyaç
  // duyuyor. Kullanıcıya bunu göstermek için full mesh yerine hafif, düşük
  // maliyetli kritik noktaları çiziyoruz. Harf modunda ekranı kalabalıklaştırmaz.
  const shouldDrawHolistic =
    typeof state !== "undefined" &&
    (state.mode === "word" ||
      (state.mode === "coach" && typeof state.coachTarget === "string" && state.coachTarget.length > 1));

  const drawPoseKeypoints = (pose) => {
    if (!pose || !pose.length) return;
    const color = "rgba(200, 154, 62, 0.95)";
    // MediaPipe Pose indices: 11/12 shoulders, 13/14 elbows, 15/16 wrists, 0 nose.
    const pairs = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
    for (const [a, b] of pairs) drawLine(pose[a], pose[b], color, 2.5);
    [0, 11, 12, 13, 14, 15, 16].forEach((idx) => drawDot(pose[idx], color, idx === 0 ? 3.5 : 5));
  };

  const drawFaceKeypoints = (face) => {
    if (!face || !face.length) return;
    const color = "rgba(81, 127, 141, 0.9)";
    // Full 468 nokta çizmek hem kalabalık hem pahalı. Sadece yüz yönü/merkezini
    // anlatan kritik noktalar: burun, alın/çene, göz köşeleri, ağız çevresi.
    const idxs = [1, 10, 152, 33, 263, 13, 14, 61, 291].filter((i) => i < face.length);
    idxs.forEach((idx) => drawDot(face[idx], color, 3));
  };

  if (shouldDrawHolistic) {
    drawPoseKeypoints(result.poseLandmarks);
    drawFaceKeypoints(result.faceLandmarks);
  }

  const rh = Array.isArray(result.rightHandLandmarks) && Array.isArray(result.rightHandLandmarks[0])
    ? result.rightHandLandmarks[0]
    : result.rightHandLandmarks;
  const lh = Array.isArray(result.leftHandLandmarks) && Array.isArray(result.leftHandLandmarks[0])
    ? result.leftHandLandmarks[0]
    : result.leftHandLandmarks;

  drawHand(rh, "rgba(99, 179, 237, 0.92)");
  drawHand(lh, "rgba(31, 185, 129, 0.92)");

  ctx.restore();
}

function _getVideoCoverRect(videoEl, boxWidth, boxHeight) {
  const videoWidth = videoEl?.videoWidth || 0;
  const videoHeight = videoEl?.videoHeight || 0;
  if (!videoWidth || !videoHeight || !boxWidth || !boxHeight) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }

  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  return {
    x: (boxWidth - renderedWidth) / 2,
    y: (boxHeight - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight,
  };
}

// ─── Ana inference döngüsü (app.js renderLoop'tan çağrılır) ──
// Reentrancy guard: hızlı çağrılarda async predictLetter/predictWord
// çakışmasın. Aynı anda en fazla 1 inference çalışır; ikincisi atlanır.
let _inferenceInFlight = false;
let _firstInferenceLogged = false;
let _firstPredictionLogged = false;
let _wordWaitMessageShown = false;

// Word recording istatistikleri (visibility tracking).
// RECORDING boyunca her gözlemlenen frame için sayaçlar tutulur.
// resetWordRecordingStats() ile her yeni kayıt başında sıfırlanır.
//
// Parity-debug eklemeleri: davranışı DEĞİŞTİRMEZ, sadece
// runtime gözlemini görünür yapar — dominant hand frame-level switch sayısı,
// shoulder fallback'in kaç frame'de devreye girdiği. Word feature parity
// testinde (tests/validation/check_word_feature_parity.py) ölçülen KNOWN_GAP
// hazardlarını canlı kayıtta lokalize eder.
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
  dominantHandTimeline: [],   // ["right"|"left"|"none"], cap 45
  prevDominantSide: null,     // internal, gözlem için
  shoulderFallbackUsedCount: 0,
};

function resetWordRecordingStats() {
  // Her yeni kayıt başında "landmark eksik" uyarısını da sıfırla; aksi halde
  // uyarı bir kez gösterilip bir daha hiç görünmeyebilirdi.
  // Reset the "missing landmarks" hint flag on every fresh recording.
  _wordWaitMessageShown = false;
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

// Parity-debug: hangi tarafın dominant olduğunu (features.js::computeDominantHand
// ile aynı kararı) raw 321D üzerinden tek-frame için raporlar. Bu fonksiyon
// hiçbir state değiştirmez; sadece okur. ASYNC değil, ekstra inference yok.
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

// Parity-debug: landmarks.js::normalizeShoulders early-return (raw döndüğü)
// koşulunu tekrar eder. Ek hesap yok. State değişmez.
//   LS_OFF=279, RS_OFF=282 (pose 11 ve 12).
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

async function realInference(now) {
  if (typeof state === "undefined" || !state.cameraOn) return;
  if (!latestMediaPipeResult) return;
  if (_inferenceInFlight) return;

  // Her iki el de yoksa bu frame'i atla. Harf bağlamında label smoother'ı da
  // sıfırla: el kaybolup yeni harf gösterildiğinde eski tahminler buffer'da
  // sızmasın (harf doğruluğu için önemli).
  // No hand at all: skip the frame. In letter context also reset the label
  // smoother so stale letters do not leak across a hand-loss gap.
  if (!latestMediaPipeResult.rightHandLandmarks && !latestMediaPipeResult.leftHandLandmarks) {
    const isLetterContext =
      state.mode === "letter" ||
      (state.mode === "coach" && state.coachTarget?.length === 1);
    if (isLetterContext && typeof resetSmoother === "function") resetSmoother();
    return;
  }

  if (!_firstInferenceLogged) {
    _firstInferenceLogged = true;
    console.log(`[INF] ilk realInference fired — mode=${state.mode}`);
  }

  _inferenceInFlight = true;
  state.frameCount = (state.frameCount || 0) + 1;
  const tStart = performance.now();
  try {
    const raw = landmarksTo321D(latestMediaPipeResult);
    const normalized = normalizeShoulders(raw);

    if (state.mode === "letter") {
      const f93 = computeLetterFeatures(raw);

      // Debug snapshot: davranış değiştirmez, global state yazar.
      // window.aslDebug.letterDebug üzerinden okunur.
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
        // smoothing ve motion debug
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

      // Motion gate: gate enabled VE delta threshold üstündeyse predict skip
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
            `[INF] ilk harf tahmini — ${result.label} (%${(result.confidence * 100).toFixed(1)})`,
          );
        }
        // ham tahmin debug global. source: alternatives uzunluğu
        // > 1 ise model probabilities (Tier 1); aksi halde label-only fallback (Tier 2).
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
        updatePrediction(smoothed);
      } else {
        console.warn("[INF] predictLetter null döndü — model yüklü mü?");
      }
    } else if (state.mode === "word" || _isCoachWordTarget()) {
      if (state.wordState === "RECORDING") {
        // visibility tracking — RECORDING boyunca her frame için.
        // İlk gözlem frame'inde startTs set et.
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
        // Dominant hand (rh non-zero >= lh non-zero veya tek el)
        if (handVisibleNow) _wordRecordingStats.dominantHandPresentCount++;
        // Anlık snapshot (UI / debug için)
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
          // 60 fps'te setMessage spam etmemek için throttle: bir kez göster,
          // tüm landmark'lar gelince reset (aşağıda).
          if (!_wordWaitMessageShown && typeof setMessage === "function") {
            setMessage(
              "Kelime kaydı için el, yüz ve omuzlar aynı anda görünmeli. Kadrajı biraz genişletin.",
              "maybe",
            );
            _wordWaitMessageShown = true;
          }
          // status hint (HUD) — eksik olanı belirt
          if (typeof updateWordRecordingHud === "function") {
            updateWordRecordingHud(handVisibleNow, poseVisibleNow, faceVisibleNow);
          }
          if (typeof updateWordState === "function") updateWordState();
          return;
        }
        // Tüm landmark'lar geldi → bayrağı sıfırla (sonra tekrar kaybolursa
        // mesaj yeniden gösterilebilsin)
        _wordWaitMessageShown = false;
        _wordRecordingStats.acceptedFrames++;
        if (typeof window !== "undefined") {
          window._lastWordCurrentFrame.acceptedForRecording = true;
        }

        // Parity-debug observation. Davranış değişmez.
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
        // HUD güncelleme (kayıt N/45 + el/yüz/omuz indicator)
        if (typeof updateWordRecordingHud === "function") {
          updateWordRecordingHud(handVisibleNow, poseVisibleNow, faceVisibleNow);
        }
        updateWordState();

        if (frameBuffer.length >= CONFIG.WORD_FRAME_COUNT) {
          await _finishWordRecordingReal();
        }
      }
    } else if (state.mode === "coach") {
      const isLetterTarget = state.coachTarget.length === 1;
      if (isLetterTarget) {
        // Koç harf modu: canlı tahmini göster ama otomatik SKORLAMA yapma.
        // Skorlama yalnızca "Hedefi Kontrol Et" butonuyla yapılır
        // (checkCoachTarget → updateCoachFromPrediction). Her frame otomatik
        // skorlamak bir bug'dı — kontrol butonunu anlamsız kılıyordu.
        // Live prediction only; scoring runs on the explicit "Check" button.
        const f93 = computeLetterFeatures(raw);
        const result = await predictLetter(f93);
        if (result) {
          const smoothed = typeof smoothLetterPrediction === "function"
            ? smoothLetterPrediction(result)
            : result;
          updatePrediction(smoothed);
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

function _isCoachWordTarget() {
  return state.mode === "coach" &&
    typeof state.coachTarget === "string" &&
    state.coachTarget.length > 1;
}

async function _finishWordRecordingReal() {
  state.wordState = "PROCESSING";
  updateWordState();

  // Final stats hesabı (debug-only, davranış değiştirmez).
  // Visibility ratio'ları ve feature168/motion stats finalize edilir.
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

  // feature168 ve motion stats hesabı (buffer üzerinden, debug-only).
  // Mask True olan frame'lerin (gerçek kayıt) son segmentleri (motion 105..167)
  // üzerinden ortalama ve min/max alınır.
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
    // Motion segment [105..167]
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

  // Inference sırasında kullanıcı modu değiştirmiş veya kamerayı kapatmış olabilir.
  // Bu durumda sonucu UI'a yansıtma; sadece state'i temizle.
  const coachWordTarget = _isCoachWordTarget();
  if ((state.mode !== "word" && !coachWordTarget) || !state.cameraOn) {
    state.wordState = "IDLE";
    state.wordFrames = 0;
    updateWordState();
    frameBuffer = [];
    normalizedFrameBuffer = [];
    previousFrame = null;
    return;
  }

  let wordFeedbackShown = false;
  if (result) {
    updatePrediction(result);
    if (coachWordTarget && typeof updateCoachFromPrediction === "function") {
      updateCoachFromPrediction();
    }

    // Feedback önceliği: önce confusion (acil aksiyon), yoksa hard (ikincil uyarı)
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

    // Kelime modeli için otomatik metne ekleme kapalı tutulur. 50 sınıflı
    // kelime tahmininde kullanıcı onayı, yanlış kelimenin transcript'e
    // sessizce eklenmesinden daha güvenlidir.
  }

  // qualityWarnings + window._lastWordDebug yaz (debug-only).
  if (typeof window !== "undefined") {
    const warnings = [];
    if (visibility.poseVisibleRatio < 0.5)
      warnings.push("pose visibility < 0.5 — yüz/omuzlar net görünmüyor");
    if (visibility.faceVisibleRatio < 0.5)
      warnings.push("face visibility < 0.5 — yüz net görünmüyor");
    if (visibility.handVisibleRatio < 0.7)
      warnings.push("hand visibility < 0.7 — el aralıklarla kaybolmuş");
    if (visibility.acceptedFrames < 30)
      warnings.push(
        `kabul edilen frame az (${visibility.acceptedFrames} < 30) — kayıt kalitesi düşük`,
      );
    if (recordingDurationMs > 6000)
      warnings.push(
        `kayıt süresi uzun (${(recordingDurationMs / 1000).toFixed(1)} sn) — yavaş frame doluşu`,
      );
    if (motionStats.mean < 0.001)
      warnings.push("motion ortalaması çok düşük — gesture yapılmamış olabilir");

    state.wordQualityWarnings = warnings.slice();

    if (
      result &&
      warnings.length > 0 &&
      !wordFeedbackShown &&
      typeof showFeedback === "function"
    ) {
      showFeedback(warnings[0], "low");
      wordFeedbackShown = true;
    }

    let temperatureVal = null;
    try {
      temperatureVal =
        typeof temperature !== "undefined" ? temperature : null;
    } catch (e) { /* noop */ }

    // Parity-debug computed metrics. Sadece debug; davranış
    // değiştirmez. result null ise top1/top2 hesabı atlanır.
    let top1Top2Margin = null;
    let confusionPairMatched = null;
    if (result && Array.isArray(result.alternatives) && result.alternatives.length >= 2) {
      const top1 = result.alternatives[0];
      const top2 = result.alternatives[1];
      top1Top2Margin = (top1.confidence ?? 0) - (top2.confidence ?? 0);
      if (typeof getConfusionFeedback === "function") {
        // getConfusionFeedback string|null döner; bool'a çevir.
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
        // Parity-debug additions; davranış değiştirmez.
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
      `[WORD] kayıt bitti — frame=${frameBuffer.length}/${CONFIG.WORD_FRAME_COUNT}, ` +
        `vis hand=${(visibility.handVisibleRatio * 100).toFixed(0)}% pose=${(visibility.poseVisibleRatio * 100).toFixed(0)}% face=${(visibility.faceVisibleRatio * 100).toFixed(0)}%, ` +
        `süre=${(recordingDurationMs / 1000).toFixed(1)}sn` +
        (warnings.length ? ` ⚠ ${warnings.length} uyarı` : ""),
    );
  }

  state.wordState = "RESULT";
  updateWordState();

  // KRİTİK: motion + buffer reset (recording stats da reset — sonraki kayıt için)
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  resetWordRecordingStats();
}
