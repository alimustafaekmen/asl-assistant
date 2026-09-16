// ─── ASL Assistant — App Controller ──────────────────────────
// Vanilla JS. Diğer modüller (landmarks/features/letter-model/word-model/
// gating/benchmark/camera) global scope üzerinden bağlıdır.

const CONFIG = {
  // ─── Harf eşikleri (24 sınıf, top-1 tipik 0.5–0.95) ───
  UNKNOWN_THRESHOLD: 0.45,
  CONFIDENT_THRESHOLD: 0.65,
  LETTER_THRESHOLD: 0.6,
  // ─── Kelime eşikleri (50 sınıf SignTransformer, top-1 tipik 0.05–0.30) ───
  // 0.65 imkansız; gerçek modelde "give @ %7.6" doğru tahmin sayılır.
  WORD_UNKNOWN_THRESHOLD: 0.10,
  WORD_CONFIDENT_THRESHOLD: 0.20,
  WORD_ACCEPT_THRESHOLD: 0.15,
  // ─── Smoother / display ───
  SMOOTHING_ALPHA: 0.4,
  SMOOTHER_WINDOW: 5,
  TOP_K: 3,
  WORD_FRAME_COUNT: 45,
  // Geri sayım: 3 adım (3 → 2 → 1) gösterir. Her adım 720ms (startWordRecording
  // içinde `await wait(720)`). Toplam görünür süre ~2.16 saniye — bilinçli
  // "snappy" UX tercihi; bu yüzden isim "_SECONDS" olsa da süre 1 saniye değil.
  COUNTDOWN_SECONDS: 3,
  // MediaPipe Tasks web runtime bu kamerada kullanıcı perspektifine uygun
  // handedness döndürüyor. True olursa sol el Right slotuna düşer ve harf
  // modeli aynalama/feature tarafında sürekli yanlış sınıfa sapabilir.
  SELFIE_HANDEDNESS_SWAP: false,
  // ─── MediaPipe Hand Landmarker thresholds ───
  // Desktop pipeline (config/settings.py: 0.5/0.4) ile hizalandı.
  // Daha yüksek değer → düşük kaliteli landmark reject, feature gürültüsü düşer.
  // 0.3 ile geri almak için bu değerleri override et.
  HAND_DETECTION_CONFIDENCE: 0.5,
  HAND_PRESENCE_CONFIDENCE: 0.5,
  HAND_TRACKING_CONFIDENCE: 0.5,
  // ─── Hafif handedness quality gate (0.75 → 0.5) ───
  // Desktop hand_detector.py: score < 0.75 → reject (LANDMARK_QUALITY_THRESHOLD).
  // Web canlı testte 0.75 çok keser olabilir → 0.5 default ile başla
  // canlı testten sonra 0.75'e tekrar çekilebilir. 0 yapılırsa gate kapanır.
  // LETTER_HANDEDNESS_SCORE_MIN öncelikli; HAND_HANDEDNESS_SCORE_MIN geriye uyumlu fallback.
  LETTER_HANDEDNESS_SCORE_MIN: 0.5,
  HAND_HANDEDNESS_SCORE_MIN: 0.5,
  // ─── Letter landmark smoothing ───
  // Desktop landmark_smoother.py EMA(α=0.6) ile frame jitter düşürür.
  // Web'de hand 63D landmark'lara aynı EMA uygulanır (mirror std sonrası, normalize öncesi).
  // Sadece letter mode için; word pipeline ETKİLENMEZ.
  // Reset: mode değişimi, hand kaybı, kamera reset → smoother sıfırlanır.
  LETTER_LANDMARK_SMOOTHING_ENABLED: true,
  LETTER_LANDMARK_SMOOTHING_ALPHA: 0.6,
  // ─── Letter motion metric ───
  // Frame-frame seçilen el delta (mean abs). Default sadece debug'da görünür.
  // GATE_ENABLED true yapılırsa motion threshold üstündeyse prediction skip edilir.
  // Default false → mevcut davranış değişmez.
  LETTER_MOTION_DEBUG_ENABLED: true,
  LETTER_MOTION_GATE_ENABLED: false,
  LETTER_MOTION_GATE_THRESHOLD: 0.08,
  DEMO_PUBLIC_URL: "https://asl-demo.netlify.app/",
  DEBUG_MODE: false,
};

// Aktif mode için eşikleri döner (state.mode'a göre word/letter ayrımı).
function _thresholdsForMode() {
  if (state.mode === "word" || (state.mode === "coach" && state.coachTarget?.length > 1)) {
    return {
      unknown: CONFIG.WORD_UNKNOWN_THRESHOLD,
      confident: CONFIG.WORD_CONFIDENT_THRESHOLD,
      accept: CONFIG.WORD_ACCEPT_THRESHOLD,
    };
  }
  return {
    unknown: CONFIG.UNKNOWN_THRESHOLD,
    confident: CONFIG.CONFIDENT_THRESHOLD,
    accept: CONFIG.LETTER_THRESHOLD,
  };
}

// 24 harf — letter_label_map.json sırası (J ve Z dinamik, dahil değil)
const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
];

// 50 kelime — word_to_idx.json alfabetik sırası (model çıkış sırası)
const WORDS = [
  "all", "before", "bird", "book", "brother", "brown", "bye", "can",
  "child", "cow", "dad", "dog", "donkey", "drink", "duck", "finish",
  "fireman", "food", "give", "go", "happy", "have", "hear", "hello",
  "home", "hot", "hungry", "like", "lips", "listen", "look", "mom",
  "mouse", "no", "open", "please", "pretend", "sad", "shhh", "sick",
  "sleep", "sleepy", "talk", "thankyou", "toothbrush", "uncle",
  "wait", "water", "who", "yes",
];

// classification_report.txt → F1 ≥ 0.75
const EASY_WORDS = new Set([
  "water", "sad", "cow", "uncle", "brown", "duck", "donkey", "lips",
  "shhh", "dad", "finish", "home", "food", "like", "no", "sick",
  "have", "happy",
]);

// classification_report.txt → F1 < 0.65
const HARD_WORDS = new Set([
  "open", "give", "all", "sleepy", "book", "go", "child", "listen",
  "talk", "sleep", "who", "toothbrush", "can", "hear", "hello",
  "fireman",
]);

const REFERENCE_ASSETS = {
  letter: {
    src: "./assets/signs/letters.png",
    alt: "ASL harf referans görseli",
  },
  wordPoster: {
    src: "./assets/signs/kelime.png",
    alt: "ASL 50 kelime genel referans posteri",
  },
  wordPages: [
    "./assets/signs/word-1.png",
    "./assets/signs/word-2.png",
    "./assets/signs/word-3.png",
    "./assets/signs/word-4.png",
    "./assets/signs/word-5.png",
  ],
};

const PREFERRED_JURY_WORD_IDS = [
  "word-bird-01",
  "word-water-01",
  "word-sad-01",
  "word-duck-01",
  "word-brown-01",
  "word-give-01",
];

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
  modelsReady: false,
  juryTask: "letter",
  jurySample: null,
  juryManifest: null,
  qrTarget: "letter",
};

const els = {
  video: document.getElementById("cameraVideo"),
  canvas: document.getElementById("overlayCanvas"),
  cameraStage: document.getElementById("cameraStage"),
  cameraEmpty: document.getElementById("cameraEmpty"),
  cameraStatus: document.getElementById("cameraStatus"),
  controlBar: document.getElementById("controlBar"),
  cameraToggle: document.getElementById("cameraToggle"),
  recordWord: document.getElementById("recordWord"),
  retryWord: document.getElementById("retryWord"),
  appendWordResult: document.getElementById("appendWordResult"),
  actionVideoLink: document.getElementById("actionVideoLink"),
  speakText: document.getElementById("speakText"),
  clearText: document.getElementById("clearText"),
  copyText: document.getElementById("copyText"),
  primaryPrediction: document.getElementById("primaryPrediction"),
  confidenceText: document.getElementById("confidenceText"),
  confidenceRing: document.getElementById("confidenceRing"),
  confidenceMessage: document.getElementById("confidenceMessage"),
  feedbackBar: document.getElementById("feedbackBar"),
  decisionLabel: document.getElementById("decisionLabel"),
  top3List: document.getElementById("top3List"),
  transcriptText: document.getElementById("transcriptText"),
  modeBadge: document.getElementById("modeBadge"),
  resultKind: document.getElementById("resultKind"),
  latencyBadge: document.getElementById("latencyBadge"),
  fpsLabel: document.getElementById("fpsLabel"),
  wordStateCard: document.getElementById("wordStateCard"),
  wordStateLabel: document.getElementById("wordStateLabel"),
  frameProgress: document.getElementById("frameProgress"),
  wordStateHint: document.getElementById("wordStateHint"),
  wordResultGuide: document.getElementById("wordResultGuide"),
  wordResultDecision: document.getElementById("wordResultDecision"),
  wordResultAction: document.getElementById("wordResultAction"),
  coachCard: document.getElementById("coachCard"),
  coachTarget: document.getElementById("coachTarget"),
  coachTargetBig: document.getElementById("coachTargetBig"),
  coachHint: document.getElementById("coachHint"),
  coachScore: document.getElementById("coachScore"),
  coachProgress: document.getElementById("coachProgress"),
  referenceImage: document.getElementById("referenceImage"),
  referenceBody: document.getElementById("referenceBody"),
  toggleReference: document.getElementById("toggleReference"),
  referenceThumbs: document.getElementById("referenceThumbs"),
  offlineTest: document.getElementById("offlineTest"),
  manualAddLetter: document.getElementById("manualAddLetter"),
  insertSpace: document.getElementById("insertSpace"),
  removeLastChar: document.getElementById("removeLastChar"),
  coachLettersOnly: document.getElementById("coachLettersOnly"),
  coachWordsOnly: document.getElementById("coachWordsOnly"),
  coachStart: document.getElementById("coachStart"),
  coachCheck: document.getElementById("coachCheck"),
  coachNextTarget: document.getElementById("coachNextTarget"),
  coachVideoLink: document.getElementById("coachVideoLink"),
  coachFlowTitle: document.getElementById("coachFlowTitle"),
  coachFlowText: document.getElementById("coachFlowText"),
  coachModeLabel: document.getElementById("coachModeLabel"),
  coachNextActionTitle: document.getElementById("coachNextActionTitle"),
  coachNextActionText: document.getElementById("coachNextActionText"),
  referenceKicker: document.getElementById("referenceKicker"),
  referenceTitle: document.getElementById("referenceTitle"),
  referenceNote: document.getElementById("referenceNote"),
  referenceVideoLink: document.getElementById("referenceVideoLink"),
  countdown: document.getElementById("countdown"),
  debugPanel: document.getElementById("debugPanel"),
  debugMode: document.getElementById("debugMode"),
  debugConfidence: document.getElementById("debugConfidence"),
  debugFrames: document.getElementById("debugFrames"),
  debugLatency: document.getElementById("debugLatency"),
  projectScreen: document.getElementById("projectScreen"),
  modelTestScreen: document.getElementById("modelTestScreen"),
  qrScreen: document.getElementById("qrScreen"),
  workspaceMain: document.querySelector(".workspace"),
  appShell: document.querySelector(".app-shell"),
  homeScreen: document.getElementById("homeScreen"),
  themeToggle: document.getElementById("themeToggle"),
  wordQualityPills: document.getElementById("wordQualityPills"),
  wordDemoList: document.getElementById("wordDemoList"),
  wordRiskList: document.getElementById("wordRiskList"),
  wordConfusionList: document.getElementById("wordConfusionList"),
  showDemoFlow: document.getElementById("showDemoFlow"),
  showTechSummary: document.getElementById("showTechSummary"),
  demoFlowSection: document.getElementById("demoFlowSection"),
  techSummarySection: document.getElementById("techSummarySection"),
  jurySampleStatus: document.getElementById("jurySampleStatus"),
  jurySampleFile: document.getElementById("jurySampleFile"),
  juryFileName: document.getElementById("juryFileName"),
  loadDemoLetter: document.getElementById("loadDemoLetter"),
  loadDemoWord: document.getElementById("loadDemoWord"),
  juryDropZone: document.getElementById("juryDropZone"),
  juryDomainHelp: document.getElementById("juryDomainHelp"),
  jurySampleSelect: document.getElementById("jurySampleSelect"),
  loadSelectedJurySample: document.getElementById("loadSelectedJurySample"),
  runJurySample: document.getElementById("runJurySample"),
  juryProcessSteps: document.getElementById("juryProcessSteps"),
  juryMatchBadge: document.getElementById("juryMatchBadge"),
  juryExpectedLabel: document.getElementById("juryExpectedLabel"),
  juryPredictedLabel: document.getElementById("juryPredictedLabel"),
  juryConfidence: document.getElementById("juryConfidence"),
  juryLatency: document.getElementById("juryLatency"),
  juryTop3List: document.getElementById("juryTop3List"),
  juryResultNote: document.getElementById("juryResultNote"),
  juryTaskLabel: document.getElementById("juryTaskLabel"),
  jurySourceLabel: document.getElementById("jurySourceLabel"),
  jurySchemaLabel: document.getElementById("jurySchemaLabel"),
  juryShapeLabel: document.getElementById("juryShapeLabel"),
  juryMaskLabel: document.getElementById("juryMaskLabel"),
  qrCanvas: document.getElementById("qrCanvas"),
  qrDemoUrl: document.getElementById("qrDemoUrl"),
  qrOpenDemo: document.getElementById("qrOpenDemo"),
  qrCopyDemo: document.getElementById("qrCopyDemo"),
  qrStatus: document.getElementById("qrStatus"),
};

const ctx = els.canvas.getContext("2d");

// ─── Word recording buffers (realInference kullanır) ───
let previousFrame = null;
let frameBuffer = [];
let normalizedFrameBuffer = [];

// Desktop uygulaması da REFERENCE_DIR/asl_video_links.json okuyor.
// Web tarafında aynı yapı ./data/asl_video_links.json olarak varsa kullanılır;
// yoksa hedefe göre güvenli YouTube arama linki üretilir.
let referenceVideoLinks = { alphabet_video: "", words: {} };

async function init() {
  restoreTheme();
  buildCoachOptions();
  buildCoachProgress();
  bindEvents();
  restoreTranscript();
  loadReferenceVideoLinks();
  await loadJuryManifest();
  setMode(modeFromHash(window.location.hash), { syncHash: false });
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });

  await loadModelsWithStatus();

  requestAnimationFrame(renderLoop);
}

async function loadModelsWithStatus() {
  setMessage("Modeller yükleniyor...", "maybe");
  els.latencyBadge.textContent = "Modeller yükleniyor";
  try {
    const tasks = [];
    // Promise.all'ın array sırasıyla aynı sırada result almak için sabit pozisyon
    const idx = { letter: -1, word: -1, gating: -1 };
    if (typeof loadLetterModel === "function") {
      idx.letter = tasks.length;
      tasks.push(loadLetterModel());
    }
    if (typeof loadWordModel === "function") {
      idx.word = tasks.length;
      tasks.push(loadWordModel());
    }
    if (typeof loadGatingData === "function") {
      idx.gating = tasks.length;
      tasks.push(loadGatingData());
    }
    const results = await Promise.all(tasks);
    const letterOk = idx.letter >= 0 ? results[idx.letter] : false;
    const wordOk = idx.word >= 0 ? results[idx.word] : false;
    renderWordJuryPanel();

    if (wordOk && typeof warmupWordModel === "function") {
      await warmupWordModel();
    }
    if (letterOk && typeof warmupLetterModel === "function") {
      await warmupLetterModel();
    }

    state.modelsReady = Boolean(letterOk && wordOk);
    const status = [];
    if (letterOk) status.push("Harf ✓");
    if (wordOk) status.push("Kelime ✓");

    if (status.length === 2) {
      setMessage(`Modeller hazır: ${status.join(", ")}. Kamerayı başlatabilirsiniz.`, "good");
      els.latencyBadge.textContent = "Hazır";
    } else if (status.length) {
      setMessage(
        `Yalnızca ${status.join(", ")} yüklendi. Network sekmesinde 404 var mı kontrol edin.`,
        "low",
      );
      els.latencyBadge.textContent = "Yarım yükleme";
    } else {
      setMessage(
        "Model yüklenemedi. ./models/ altında ONNX dosyaları var mı? Network sekmesini kontrol edin.",
        "low",
      );
      els.latencyBadge.textContent = "Model yok";
    }
  } catch (err) {
    console.error("Model yükleme hatası:", err);
    setMessage("Model yüklenemedi: " + err.message, "low");
    els.latencyBadge.textContent = "Hata";
  }
}

function bindEvents() {
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  document.querySelectorAll("[data-go-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.goMode));
  });

  document.querySelector("[data-home-link]")?.addEventListener("click", (event) => {
    event.preventDefault();
    showHome();
  });

  window.addEventListener("hashchange", () => {
    setMode(modeFromHash(window.location.hash), { syncHash: false });
  });

  document.querySelectorAll("[data-qr-target]").forEach((button) => {
    button.addEventListener("click", () => setQrTarget(button.dataset.qrTarget));
  });
  els.qrCopyDemo?.addEventListener("click", copyQrDemoUrl);

  els.themeToggle?.addEventListener("click", toggleTheme);

  els.cameraToggle?.addEventListener("click", toggleCamera);
  els.recordWord?.addEventListener("click", startWordRecording);
  els.retryWord?.addEventListener("click", retryWordRecording);
  els.appendWordResult?.addEventListener("click", appendWordResultToTranscript);
  els.coachStart?.addEventListener("click", startCoachStudy);
  els.coachCheck?.addEventListener("click", checkCoachTarget);
  els.coachNextTarget?.addEventListener("click", nextCoachTarget);
  els.speakText?.addEventListener("click", speakTranscript);
  els.clearText?.addEventListener("click", clearTranscript);
  els.copyText.addEventListener("click", copyTranscript);
  els.toggleReference.addEventListener("click", toggleReference);
  els.offlineTest.addEventListener("click", runOfflineCheck);
  bindReferenceLightbox();

  els.manualAddLetter?.addEventListener("click", appendCurrentLetter);
  document.querySelector('[data-trigger="add-letter"]')?.addEventListener("click", appendCurrentLetter);
  els.insertSpace?.addEventListener("click", insertSpaceInTranscript);
  document.querySelector('[data-trigger="space"]')?.addEventListener("click", insertSpaceInTranscript);
  els.removeLastChar?.addEventListener("click", removeLastTranscriptChar);
  els.coachLettersOnly?.addEventListener("click", () => setCoachTargetType("letter"));
  els.coachWordsOnly?.addEventListener("click", () => setCoachTargetType("word"));
  document.querySelectorAll("[data-coach-flow]").forEach((button) => {
    button.addEventListener("click", () => setCoachFlow(button.dataset.coachFlow));
  });
  els.showDemoFlow?.addEventListener("click", () => {
    els.demoFlowSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.showTechSummary?.addEventListener("click", () => {
    els.techSummarySection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelectorAll("[data-jury-task]").forEach((button) => {
    button.addEventListener("click", () => setJuryTask(button.dataset.juryTask));
  });
  els.loadDemoLetter?.addEventListener("click", () => loadAndRunPreferredJurySample("letter"));
  els.loadDemoWord?.addEventListener("click", () => loadAndRunPreferredJurySample("word"));
  els.loadSelectedJurySample?.addEventListener("click", loadSelectedJurySample);
  els.jurySampleFile?.addEventListener("change", handleJurySampleFile);
  els.runJurySample?.addEventListener("click", runJurySample);
  els.juryDropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.juryDropZone.classList.add("is-dragging");
  });
  els.juryDropZone?.addEventListener("dragleave", () => {
    els.juryDropZone.classList.remove("is-dragging");
  });
  els.juryDropZone?.addEventListener("drop", handleJurySampleDrop);

  els.coachTarget.addEventListener("change", (event) => {
    state.coachTarget = event.target.value;
    state.coachStep = 0;
    state.coachFeedback = "";
    if (typeof resetSmoother === "function") resetSmoother();
    if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
    updateCoachPanel();
    updateReferenceForMode();
  });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      state.debug = !state.debug;
      els.debugPanel.hidden = !state.debug;
    }
    // Space yalnızca Harf Çeviri için tek harf ekler. Buton tarafı keyboard
    // event simüle etmez; aynı transcript fonksiyonunu doğrudan çağırır.
    if (event.code === "Space" && state.mode === "letter") {
      event.preventDefault();
      appendCurrentLetter();
    }
    if (event.key.toLowerCase() === "s") speakTranscript();
    if (event.key.toLowerCase() === "c") clearTranscript();
    if (event.key.toLowerCase() === "m") cycleMode();
  });
}

function buildCoachOptions() {
  const type = state.coachTargetType || "letter";
  els.coachTarget.innerHTML = "";

  const group = document.createElement("optgroup");
  group.label = type === "word" ? "Kelime hedefleri" : "Harf hedefleri";

  if (type === "word") {
    WORDS.forEach((word) => {
      const option = document.createElement("option");
      option.value = word;
      const diff = EASY_WORDS.has(word) ? "rahat" : HARD_WORDS.has(word) ? "riskli" : "orta";
      option.textContent = `${word} (${diff})`;
      group.appendChild(option);
    });
    if (!WORDS.includes(state.coachTarget)) state.coachTarget = "water";
  } else {
    LETTERS.forEach((letter) => {
      const option = document.createElement("option");
      option.value = letter;
      option.textContent = letter;
      group.appendChild(option);
    });
    if (!LETTERS.includes(state.coachTarget)) state.coachTarget = "A";
  }

  els.coachTarget.appendChild(group);
  els.coachTarget.value = state.coachTarget;
  updateCoachModeButtons();
}

function buildCoachProgress() {
  els.coachProgress.innerHTML = "";
  for (let i = 0; i < state.coachGoal; i += 1) {
    els.coachProgress.appendChild(document.createElement("span"));
  }
}

function setCoachTargetType(type) {
  state.coachTargetType = type === "word" ? "word" : "letter";
  state.coachTarget = state.coachTargetType === "word" ? "water" : "A";
  state.coachStep = 0;
  state.quizScore = 0;
  state.coachFeedback = "";
  buildCoachOptions();
  buildCoachProgress();
  updateCoachPanel();
  updateReferenceForMode();
  syncRecordButton();
}

function setCoachFlow(flow) {
  state.coachFlow = ["learn", "practice", "quiz"].includes(flow) ? flow : "learn";
  state.coachGoal = state.coachFlow === "quiz" ? state.quizTotal : 5;
  state.coachStep = 0;
  state.quizScore = 0;
  state.coachFeedback = "";
  buildCoachProgress();
  updateCoachFlowButtons();
  updateCoachPanel();
}

function updateCoachModeButtons() {
  const isWord = state.coachTargetType === "word";
  els.coachLettersOnly?.classList.toggle("is-active", !isWord);
  els.coachWordsOnly?.classList.toggle("is-active", isWord);
  if (els.coachModeLabel) {
    els.coachModeLabel.textContent = isWord ? "Kelime çalışması" : "Harf çalışması";
  }
}

function updateCoachFlowButtons() {
  document.querySelectorAll("[data-coach-flow]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.coachFlow === state.coachFlow);
  });
}


function showHome() {
  // Ana ekrana dönerken kamerayı + inference döngüsünü durdur: aksi halde
  // kamera LED'i yanık, MediaPipe/ONNX çalışır kalırdı (gizlilik + batarya).
  // Going home must stop the camera and inference loop, not just hide the UI.
  if (state.cameraOn && typeof stopCamera === "function") {
    stopCamera();
  }
  if (els.appShell) {
    els.appShell.dataset.view = "home";
  }
  document.querySelectorAll(".mode-tab").forEach((tab) => tab.classList.remove("is-active"));
}

function restoreTheme() {
  try {
    const savedTheme = localStorage.getItem("asl-theme");
    if (els.appShell && (savedTheme === "dark" || savedTheme === "light")) {
      els.appShell.dataset.theme = savedTheme;
      document.body.dataset.theme = savedTheme;
    } else if (els.appShell?.dataset.theme) {
      document.body.dataset.theme = els.appShell.dataset.theme;
    }
  } catch (err) {
    // localStorage yoksa varsayılan tema kalır.
  }
}

function toggleTheme() {
  if (!els.appShell) return;
  const next = els.appShell.dataset.theme === "dark" ? "light" : "dark";
  els.appShell.dataset.theme = next;
  document.body.dataset.theme = next;
  try { localStorage.setItem("asl-theme", next); } catch (err) { /* noop */ }
}

async function loadReferenceVideoLinks() {
  try {
    const res = await fetch("./data/asl_video_links.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    referenceVideoLinks = {
      alphabet_video: data.alphabet_video || "",
      words: data.words || {},
    };
    updateReferenceForMode();
  } catch (err) {
    // Desktop link JSON'u web'e taşınmadıysa sessizce arama linkine düş.
  }
}

function modeFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  return ["letter", "coach", "word", "project", "test", "qr"].includes(raw) ? raw : "letter";
}

function setMode(mode, options = {}) {
  if (!["letter", "coach", "word", "project", "test", "qr"].includes(mode)) mode = "letter";
  if (options.syncHash !== false && window.location.hash !== `#${mode}`) {
    window.history.replaceState(null, "", `#${mode}`);
  }
  const shell = els.appShell || document.querySelector(".app-shell");
  if (shell) { shell.dataset.view = "app"; shell.dataset.mode = mode; }
  // Mod değişimi: smoother + buffer'ı temizle, eski tahminler sızmasın
  if (typeof resetSmoother === "function") resetSmoother();
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;

  state.mode = mode;
  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
  });

  // Project/Test ekranları: kamera workspace'ini gizle, ilgili section'ı göster
  const isProject = mode === "project";
  const isTest = mode === "test";
  const isQr = mode === "qr";
  if (els.projectScreen) {
    els.projectScreen.hidden = !isProject;
  }
  if (els.modelTestScreen) {
    els.modelTestScreen.hidden = !isTest;
  }
  if (els.qrScreen) {
    els.qrScreen.hidden = !isQr;
  }
  document.querySelectorAll(".camera-column, .side-panel").forEach((el) => {
    el.hidden = isProject || isTest || isQr;
  });
  if (isQr) renderQrDemo();
  if (isProject || isTest || isQr) {
    clearFeedback();
    syncActionBar();
    return;
  }

  els.modeBadge.textContent =
    mode === "letter" ? "Harf Modu" : mode === "word" ? "Kelime Modu" : "Öğrenme Koçu";
  els.resultKind.textContent =
    mode === "word" ? "Kelime" : mode === "coach" ? "Hedef" : "Harf";
  els.wordStateCard.dataset.hidden = mode === "letter" ? "true" : "false";
  els.coachCard.dataset.hidden = mode === "coach" ? "false" : "true";
  els.controlBar.dataset.count = mode === "letter" ? "3" : "4";
  clearFeedback();

  if (mode === "coach") {
    updateCoachModeButtons();
    updateCoachFlowButtons();
    updateCoachPanel();
    updatePrediction({ label: state.coachTarget, confidence: 0, alternatives: [] });
  } else {
    updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  }

  updateWordState();
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
}

async function toggleCamera() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }

  // HTTP'de (localhost dışı) navigator.mediaDevices undefined olur.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.latencyBadge.textContent = "HTTPS gerekli";
    setMessage(
      "Kamera için HTTPS veya localhost gerekiyor. Sayfa http:// üzerinden açılmış olabilir.",
      "low",
    );
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    state.cameraOn = true;
    els.video.srcObject = stream;
    await waitForVideoReady(els.video);
    els.cameraEmpty.hidden = true;
    syncActionBar();
    els.cameraStatus.classList.add("is-live");
    els.cameraStatus.lastChild.textContent = "Kamera";
    els.latencyBadge.textContent = "Kamera açık";

    if (typeof startMediaPipe === "function") {
      try {
        els.latencyBadge.textContent = "MediaPipe yükleniyor...";
        await startMediaPipe(els.video);
        els.latencyBadge.textContent = "MediaPipe Hand hazır";
      } catch (err) {
        console.warn("MediaPipe başlatılamadı:", err);
        els.latencyBadge.textContent = "MediaPipe yok";
        setMessage(
          "MediaPipe modeli yüklenemedi. İnternet bağlantısını kontrol edin (CDN'den indiriliyor).",
          "low",
        );
      }
    }
  } catch (error) {
    // Tarayıcı standart MediaError adları:
    //   NotAllowedError    → kullanıcı izin reddetti
    //   NotFoundError      → kamera bulunamadı
    //   NotReadableError   → kamera başka bir uygulama tarafından kullanılıyor
    //   OverconstrainedError → constraints uyumsuz
    //   SecurityError      → sayfa izolasyonu hatası
    let msg = "Kamera açılamadı.";
    switch (error?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        msg = "Kamera izni reddedildi. Tarayıcı adres çubuğundan izin verin.";
        break;
      case "NotFoundError":
      case "DevicesNotFoundError":
        msg = "Kamera bulunamadı. Cihazda webcam takılı mı?";
        break;
      case "NotReadableError":
      case "TrackStartError":
        msg = "Kamera başka bir uygulama tarafından kullanılıyor. Diğer uygulamayı kapatın.";
        break;
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        msg = "Kamera bu çözünürlüğü desteklemiyor.";
        break;
      case "SecurityError":
        msg = "Tarayıcı güvenlik nedeniyle kamerayı engelliyor (HTTPS veya localhost gerekli).";
        break;
      default:
        msg = `Kamera açılamadı: ${error?.message || error?.name || "bilinmeyen hata"}`;
    }
    els.latencyBadge.textContent = "Kamera açılamadı";
    setMessage(msg, "low");
    console.error("getUserMedia error:", error);
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.cameraOn = false;
  els.video.srcObject = null;
  els.cameraEmpty.hidden = false;
  syncActionBar();
  els.cameraStatus.classList.remove("is-live");
  els.cameraStatus.lastChild.textContent = "Hazır";
  els.fpsLabel.textContent = "-- fps";
  els.latencyBadge.textContent = "Hazır";

  if (typeof stopMediaPipe === "function") {
    try { stopMediaPipe(); } catch (e) { /* noop */ }
  }

  // Kayıt akışı iptal: wordState IDLE'a dön, countdown gizle.
  // Aksi halde kullanıcı sonra "Kelime kaydı" basınca startWordRecording
  // wordState !== IDLE/RESULT diye early-return eder ve buton kilitlenir.
  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  els.countdown.hidden = true;
  els.cameraStage.dataset.state = "idle";
  if (typeof resetSmoother === "function") resetSmoother();
  updateWordState();
  syncRecordButton();

  // Buffers + status counter reset (sonraki kamera açılışı için temiz state)
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  _noHandSeconds = 0;
  _lastStatusTick = 0;
}

function renderLoop(now) {
  updateFps(now);
  drawOverlay(now);

  // Gerçek inference camera.js + MediaPipe hazır olduğunda devreye girer.
  // Şu anda landmark verisi yoksa pipeline beklemede kalır.
  if (state.cameraOn && typeof realInference === "function") {
    // Throttle: harf modunda her frame değil, ~6 frame'de bir
    if (state.mode === "letter") {
      if (now - state.lastTick > 120) {
        state.lastTick = now;
        realInference(now);
      }
    } else {
      realInference(now);
    }
  }

  // Latency badge: MediaPipe el bekliyor mu durumu (saniyede bir güncelle)
  updateMediaPipeStatus(now);
  updateDebug();
  requestAnimationFrame(renderLoop);
}

let _lastStatusTick = 0;
let _noHandSeconds = 0;
function updateMediaPipeStatus(now) {
  if (!state.cameraOn) return;
  if (now - _lastStatusTick < 1000) return;
  _lastStatusTick = now;

  if (typeof latestMediaPipeResult === "undefined" || !latestMediaPipeResult) {
    els.latencyBadge.textContent = "MP: bekleniyor...";
    return;
  }
  const r = latestMediaPipeResult;
  const hasHand = !!(r.rightHandLandmarks || r.leftHandLandmarks);
  if (!hasHand) {
    _noHandSeconds++;
    els.latencyBadge.textContent = "✋ El bekleniyor";
    // 5 sn'dir el yoksa kullanıcıya net mesaj
    if (_noHandSeconds === 5) {
      setMessage(
        "Elinizi kameraya gösterin (50-80 cm uzaklık, iyi ışık, parmaklar açık).",
        "maybe",
      );
    }
  } else {
    if (_noHandSeconds > 0) {
      _noHandSeconds = 0;
      // Hand recovery
      setMessage("El algılandı, tahminler başlıyor.", "good");
    }
    const which = [];
    if (r.rightHandLandmarks) which.push("R");
    if (r.leftHandLandmarks) which.push("L");
    els.latencyBadge.textContent = `✓ El: ${which.join("+")} · ${state.fps || "--"} fps`;
  }

  // Pose/Face arka planda yüklenir; her saniye buton durumunu güncelle
  syncRecordButton();
}

function updateFps(now) {
  if (!state.cameraOn) {
    state.fpsFrames = 0;
    state.fpsStart = now;
    return;
  }

  state.fpsFrames += 1;
  if (!state.fpsStart) state.fpsStart = now;
  const elapsed = now - state.fpsStart;
  if (elapsed >= 1000) {
    state.fps = Math.round((state.fpsFrames * 1000) / elapsed);
    state.fpsFrames = 0;
    state.fpsStart = now;
    els.fpsLabel.textContent = `${state.fps} fps`;
  }
}

// Overlay: gerçek landmark verisi gelirse onu çiz (camera.js drawLandmarks tanımlarsa).
// Sahte daire animasyonu KALDIRILDI.
function drawOverlay(now) {
  const rect = els.canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  if (els.canvas.width !== pixelWidth || els.canvas.height !== pixelHeight) {
    els.canvas.width = pixelWidth;
    els.canvas.height = pixelHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!state.cameraOn) return;

  if (typeof drawLandmarks === "function" && typeof latestMediaPipeResult !== "undefined") {
    try {
      drawLandmarks(ctx, latestMediaPipeResult, cssWidth, cssHeight, els.video);
    } catch (err) {
      // sessizce geç
    }
  }
}

function updatePrediction(prediction) {
  state.prediction = prediction.label;
  state.confidence = prediction.confidence;
  state.top3 = prediction.alternatives?.length ? prediction.alternatives : [];

  const pct = Math.round(state.confidence * 100);
  els.primaryPrediction.textContent = prediction.label;
  els.confidenceText.textContent = pct ? `${pct}%` : "--";
  els.confidenceRing.style.setProperty("--score", String(pct));

  const level = getConfidenceLevel(state.confidence);
  els.confidenceRing.className = `confidence-ring ${level}`;
  els.cameraStage.dataset.state = state.wordState === "RECORDING" ? "recording" : level;

  const th = _thresholdsForMode();
  if (prediction.label === "?") {
    els.decisionLabel.textContent = "Beklemede";
  } else if (isWordLikeMode() && getTopMargin() < 0.03 && state.top3.length > 1) {
    els.decisionLabel.textContent = "Yakın sonuç";
  } else if (state.confidence < th.unknown) {
    els.decisionLabel.textContent = "Emin değil";
  } else if (state.confidence < th.confident) {
    els.decisionLabel.textContent = "Muhtemel";
  } else {
    els.decisionLabel.textContent = "Güvenli";
  }

  renderTop3();
  updateMessageForPrediction();
  renderWordResultGuide();
  syncActionBar();
}

function renderTop3() {
  els.top3List.innerHTML = "";
  const rows = state.top3.length ? state.top3 : [{ label: "-", confidence: 0 }];
  rows.forEach((item, index) => {
    const pct = clampPercent(item.confidence * 100);
    const row = document.createElement("div");
    row.className = "top3-row";

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${index + 1}`;

    const label = document.createElement("b");
    label.title = item.label;
    label.textContent = item.label;

    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const confidence = document.createElement("span");
    confidence.textContent = `${pct}%`;

    row.append(rank, label, bar, confidence);
    els.top3List.appendChild(row);
  });
}

function updateMessageForPrediction() {
  if (state.prediction === "?") {
    setMessage("Kamera başlayınca tahminler burada görünür.", "low");
    return;
  }

  if (isWordLikeMode() && state.top3.length) {
    const topText = formatTopPredictions(state.top3);
    const margin = getTopMargin();
    const marginText = state.top3.length > 1 ? ` Top-1/Top-2 farkı: %${Math.round(margin * 100)}.` : "";
    const prefix = state.wordState === "RESULT" ? "Kelime kaydı sonucu." : "Kelime tahmini.";
    if (state.confidence < CONFIG.WORD_UNKNOWN_THRESHOLD) {
      setMessage(`${prefix} Modelin gördükleri: ${topText}.${marginText} Kayıt güveni düşük; kadraj ve hareket süresini iyileştirin.`, "low");
      return;
    }
    if (margin < 0.03 && state.top3.length > 1) {
      setMessage(`${prefix} Modelin gördükleri: ${topText}.${marginText} İlk iki sonuç çok yakın; sonucu dikkatli yorumlayın.`, "maybe");
      return;
    }
    setMessage(`${prefix} Modelin gördükleri: ${topText}.${marginText}`, getConfidenceLevel(state.confidence));
    return;
  }

  const th = _thresholdsForMode();
  if (state.confidence < th.unknown) {
    setMessage("Emin değilim. Işık, kamera açısı veya el konumu iyileştirilebilir.", "low");
    return;
  }

  if (state.confidence < th.confident) {
    setMessage(`Muhtemel sonuç: ${state.prediction}. Alternatifleri kontrol et.`, "maybe");
    return;
  }

  setMessage(`${state.prediction} güvenli görünüyor.`, "good");
}

function isWordLikeMode() {
  return state.mode === "word" || _isCoachWordTarget();
}

function getTopMargin() {
  if (!state.top3 || state.top3.length < 2) return 1;
  return Math.max(0, (state.top3[0].confidence || 0) - (state.top3[1].confidence || 0));
}

function formatTopPredictions(items, limit = 3) {
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.label} %${Math.round((item.confidence || 0) * 100)}`)
    .join(" · ");
}

function assessWordResult() {
  if (!isWordLikeMode() || state.wordState !== "RESULT") return null;
  if (!state.prediction || state.prediction === "?" || state.prediction.length <= 1) {
    return {
      level: "low",
      decision: "Sonuç üretilemedi",
      action: "Kamerayı, ışığı ve kadrajı kontrol edip Tekrar Dene ile yeni kayıt al.",
      canAppend: false,
    };
  }

  const margin = getTopMargin();
  const warnings = Array.isArray(state.wordQualityWarnings) ? state.wordQualityWarnings : [];
  const confidence = Number(state.confidence || 0);
  const topText = state.top3.length ? formatTopPredictions(state.top3, 3) : state.prediction;
  const hasQualityRisk = warnings.length > 0;
  const isClose = margin < 0.08 && state.top3.length > 1;
  const belowAccept = confidence < CONFIG.WORD_ACCEPT_THRESHOLD;

  if (belowAccept) {
    return {
      level: "low",
      decision: "Güven düşük",
      action: `Model ${topText} gördü, ama sonuç metne eklemek için zayıf. Tekrar Dene ile hareketi daha net kaydet.`,
      canAppend: false,
    };
  }

  if (isClose || hasQualityRisk) {
    const reason = isClose
      ? `İlk iki sonuç yakın; fark %${Math.round(margin * 100)}.`
      : "Kayıt kalitesi uyarı verdi.";
    return {
      level: "maybe",
      decision: "Kontrol ederek onayla",
      action: `${reason} Sonuç doğruysa Metne Ekle, farklı görünüyorsa Tekrar Dene.`,
      canAppend: true,
    };
  }

  return {
    level: "good",
    decision: "Sonuç kullanılabilir",
    action: `Model ${state.prediction} sonucunu daha net gördü. Doğruysa Metne Ekle, yeni kelime için Yeni Kelime Kaydı kullan.`,
    canAppend: true,
  };
}

function renderWordResultGuide() {
  if (!els.wordResultGuide || !els.wordResultDecision || !els.wordResultAction) return;
  const assessment = assessWordResult();
  state.wordResultAssessment = assessment;

  if (!assessment) {
    els.wordResultGuide.hidden = true;
    els.wordResultGuide.removeAttribute("data-level");
    return;
  }

  els.wordResultGuide.hidden = false;
  els.wordResultGuide.dataset.level = assessment.level;
  els.wordResultDecision.textContent = assessment.decision;
  els.wordResultAction.textContent = assessment.action;
}

function setMessage(text, level) {
  els.confidenceMessage.textContent = text;
  els.confidenceMessage.dataset.level = level;
}

function showFeedback(text, kind) {
  // kind: "confusion" | "hard"
  if (!els.feedbackBar) return;
  els.feedbackBar.textContent = text;
  els.feedbackBar.className = `feedback-bar feedback-bar--${kind}`;
  els.feedbackBar.hidden = false;
}

function clearFeedback() {
  if (!els.feedbackBar) return;
  els.feedbackBar.hidden = true;
  els.feedbackBar.textContent = "";
}

function getConfidenceLevel(confidence) {
  const th = _thresholdsForMode();
  if (confidence >= th.confident) return "good";
  if (confidence >= th.unknown) return "maybe";
  return "low";
}

function appendCurrentLetter() {
  if (state.mode !== "letter") return;
  if (!state.prediction || state.prediction === "?" || state.prediction.length !== 1) return;
  if (state.confidence < CONFIG.LETTER_THRESHOLD) return;
  appendTranscriptToken(state.prediction, { debounceKey: `letter:${state.prediction}` });
}

function appendWordResultToTranscript() {
  if (!state.prediction || state.prediction === "?" || state.prediction.length <= 1) return;
  if (state.confidence < CONFIG.WORD_ACCEPT_THRESHOLD) return;
  appendTranscriptToken(`${state.prediction} `, { debounceKey: `word:${state.prediction}` });
  showFeedback(`"${state.prediction}" metne eklendi. Yeni deneme için Yeni Kelime Kaydı ya da Tekrar Dene kullan.`, "good");
}

function acceptPrediction(manual = true) {
  if (!state.prediction || state.prediction === "?") return;
  const th = _thresholdsForMode();
  if (state.confidence < th.accept) return;
  const next = state.prediction.length === 1 ? state.prediction : `${state.prediction} `;
  appendTranscriptToken(next, {
    debounceKey: manual ? `manual:${next}` : "",
    skipIfDuplicate: !manual,
  });
}

function appendTranscriptToken(token, options = {}) {
  if (!token) return;
  if (options.debounceKey) {
    const now = performance.now();
    if (state.lastTranscriptAppendKey === options.debounceKey && now - state.lastTranscriptAppendTs < 250) {
      return;
    }
    state.lastTranscriptAppendKey = options.debounceKey;
    state.lastTranscriptAppendTs = now;
  }
  if (options.skipIfDuplicate && state.transcript.endsWith(token)) return;
  state.transcript += token;
  saveTranscript();
  renderTranscript();
}

function insertSpaceInTranscript() {
  const clean = state.transcript.replace(/\s+$/g, "");
  state.transcript = clean ? `${clean} ` : "";
  saveTranscript();
  renderTranscript();
}

function removeLastTranscriptChar() {
  state.transcript = state.transcript.slice(0, -1);
  saveTranscript();
  renderTranscript();
}

function renderTranscript() {
  const text = state.transcript.trim() || "Henüz metin yok";
  els.transcriptText.innerHTML = `${escapeHtml(text)}<span class="cursor">|</span>`;
}

function clearTranscript() {
  state.transcript = "";
  saveTranscript();
  renderTranscript();
}

function saveTranscript() {
  try {
    localStorage.setItem("asl-web-transcript", state.transcript);
  } catch (err) {
    console.warn("Transcript kaydedilemedi:", err?.message || err);
  }
}

function restoreTranscript() {
  try {
    state.transcript = localStorage.getItem("asl-web-transcript") || "";
  } catch (err) {
    console.warn("Transcript okunamadı:", err?.message || err);
    state.transcript = "";
  }
  renderTranscript();
}

async function copyTranscript() {
  try {
    await navigator.clipboard.writeText(state.transcript.trim());
    els.latencyBadge.textContent = "Kopyalandı";
  } catch {
    els.latencyBadge.textContent = "Kopyalanamadı";
  }
}

function speakTranscript() {
  const text = state.transcript.trim() || state.prediction;
  if (!text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

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

  // Motion reset — eski işaret kalıntısı önlenir
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  // visibility sayaçları yeni kayıt için sıfırlanır
  if (typeof resetWordRecordingStats === "function") resetWordRecordingStats();

  state.wordState = "COUNTDOWN";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  updateWordState();
  clearFeedback();

  for (let i = CONFIG.COUNTDOWN_SECONDS; i > 0; i -= 1) {
    // Geri sayım sırasında kullanıcı modu değiştirebilir veya kamerayı kapatabilir;
    // bu durumda kayıt akışını sessizce iptal et (wordState tutmasın).
    if (!state.cameraOn || !canCaptureWordInCurrentMode() || state.wordState !== "COUNTDOWN") {
      els.countdown.hidden = true;
      return;
    }
    els.countdown.hidden = false;
    els.countdown.textContent = String(i);
    await wait(720);
  }

  // Final guard: countdown bittiğinde hala uygun durumdayız mı?
  if (!state.cameraOn || !canCaptureWordInCurrentMode() || state.wordState !== "COUNTDOWN") {
    els.countdown.hidden = true;
    return;
  }

  els.countdown.hidden = true;
  state.wordState = "RECORDING";
  els.cameraStage.dataset.state = "recording";
  updateWordState();
}

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

function canCaptureWordInCurrentMode() {
  return state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);
}

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
      : "Sonuç üretildi. Doğru değilse Tekrar Dene ile yeni kayıt al.";
  }
  if (state.wordState === "IDLE") {
    els.wordStateHint.textContent = "Başlat'a bas, geri sayımdan sonra işareti 2-4 saniye yap. 45 frame dolunca sistem otomatik sonucu gösterir.";
    updateWordQualityPills(false, false, false);
  }
  updateWordFlowSteps();
  renderWordResultGuide();
  syncActionBar();
}

function updateWordFlowSteps() {
  const steps = document.querySelectorAll(".word-flow-steps span");
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

// Word RECORDING sırasında HUD — el/yüz/omuz görünürlüğünü
// kullanıcıya hızlıca bildirir. wordStateHint metnine eklenir
// (mevcut UI yapısını bozmadan, sadece metin).
//   "Kayıt: 18/45 — El ✓ Yüz ✓ Omuz ✗"
function updateWordRecordingHud(handVisible, poseVisible, faceVisible) {
  if (!els || !els.wordStateHint) return;
  if (state.wordState !== "RECORDING") return;
  const tick = (b) => (b ? "✓" : "✗");
  els.wordStateHint.textContent =
    `Kayıt: ${state.wordFrames}/${CONFIG.WORD_FRAME_COUNT} — ` +
    `El ${tick(handVisible)} Yüz ${tick(faceVisible)} Omuz ${tick(poseVisible)}. ` +
    "Hareketi bitir; sistem otomatik işleyecek.";
  updateWordQualityPills(handVisible, poseVisible, faceVisible);
}

function updateWordQualityPills(handVisible, poseVisible, faceVisible) {
  if (!els.wordQualityPills) return;
  // Kullanıcı henüz kamerayı açmamışsa "bekleme" stilinde göster (`·`).
  // RECORDING/PROCESSING/RESULT veya kamera açıkken gerçek ✓/✗ stilini kullan.
  // Bu sayede ekran ilk açıldığında üç adet kırmızı ✗ yanıltıcı görünmez.
  const pending = state.wordState === "IDLE" && !state.cameraOn;
  const values = { hand: handVisible, face: faceVisible, pose: poseVisible };
  els.wordQualityPills.querySelectorAll("[data-quality]").forEach((pill) => {
    const key = pill.dataset.quality;
    const label = key === "hand" ? "El" : key === "face" ? "Yüz" : "Omuz";
    if (pending) {
      pill.textContent = `${label} ·`;
      delete pill.dataset.ok; // nötr stil (CSS data-ok=true/false attribute selektörleri devre dışı)
    } else {
      const ok = Boolean(values[key]);
      pill.textContent = `${label} ${ok ? "✓" : "✗"}`;
      pill.dataset.ok = ok ? "true" : "false";
    }
  });
}

function updateCoachPanel() {
  const target = state.coachTarget;
  const isLetter = target.length === 1;
  if (els.coachCard) els.coachCard.dataset.targetType = isLetter ? "letter" : "word";
  els.coachTargetBig.textContent = isLetter ? target.toUpperCase() : target;
  const targetText = isLetter
    ? `Hedef harf: ${target}. El şekli kameraya net görünmeli; poz en az 1 saniye sabit kalmalı.`
    : `Hedef kelime: ${target}. Hareketi 3-5 saniye içinde tamamla. El, yüz ve omuzlar kadrajda kalmalı.`;
  els.coachHint.textContent = state.coachFeedback || targetText;
  els.coachScore.textContent =
    state.coachFlow === "quiz"
      ? `${state.quizScore}/${state.quizTotal}`
      : `${Math.min(state.coachStep, state.coachGoal)}/${state.coachGoal}`;
  updateCoachFlowCopy(isLetter);
  updateCoachNextAction(isLetter);
  updateCoachPathSteps();
  [...els.coachProgress.children].forEach((cell, index) => {
    cell.className =
      index < state.coachStep ? "done" : index === state.coachStep ? "current" : "";
  });
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
}

function updateCoachPathSteps() {
  const steps = document.querySelectorAll(".coach-path span");
  const activeIndex = state.cameraOn ? 2 : state.coachTarget ? 1 : 0;
  steps.forEach((step, index) => {
    step.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
  });
}

function updateCoachFlowCopy(isLetter) {
  if (!els.coachFlowTitle || !els.coachFlowText) return;
  const target = state.coachTarget;
  const liveText = state.prediction && state.prediction !== "?"
    ? ` Canlı algılanan: ${state.prediction}.`
    : " Canlı algılanan sonuç kamera başladıktan sonra görünür.";
  if (state.coachFlow === "learn") {
    els.coachFlowTitle.textContent = "Öğren";
    els.coachFlowText.textContent = isLetter
      ? `Referans harfi inceleyin, el şeklini kadraja ortalayın ve video rehberle karşılaştırın.${liveText}`
      : `Referans kelimeyi inceleyin, hareket süresini 3-5 saniye aralığında tutun ve video rehberi kullanın.${liveText}`;
  } else if (state.coachFlow === "practice") {
    els.coachFlowTitle.textContent = "Pratik";
    els.coachFlowText.textContent =
      `Amaç 5 doğru tekrardır. Doğru eşleşmeler ilerlemeye işlenir; yanlış eşleşmede hedef, açı ve kadraj yeniden kontrol edilir.${liveText}`;
  } else {
    els.coachFlowTitle.textContent = "Quiz";
    els.coachFlowText.textContent =
      `Quiz ${state.quizTotal} sorudan oluşur. Her kontrolde skor güncellenir ve Sonraki Hedef ile yeni soru seçilir.${liveText}`;
  }
}

function updateCoachNextAction(isLetter) {
  if (!els.coachNextActionTitle || !els.coachNextActionText) return;
  const target = state.coachTarget;
  const hasPrediction = state.prediction && state.prediction !== "?";

  if (!state.cameraOn) {
    els.coachNextActionTitle.textContent = "Çalışmayı başlat";
    els.coachNextActionText.textContent = isLetter
      ? `${target} hedefi hazır. Kamerayı aç, elini kadraja al ve pozunu sabit tut.`
      : `${target} hedefi hazır. Kamerayı aç, el-yüz-omuz görünürlüğünü kontrol et.`;
    return;
  }

  if (!isLetter && ["COUNTDOWN", "RECORDING", "PROCESSING"].includes(state.wordState)) {
    els.coachNextActionTitle.textContent = "Kayıt tamamlanıyor";
    els.coachNextActionText.textContent =
      "Hareketi bitir, kamera karşısında kal ve top-3 sonucu bekle.";
    return;
  }

  if (state.coachFlow === "learn") {
    els.coachNextActionTitle.textContent = isLetter ? "Canlı sonucu izle" : "Kelime pratiği yap";
    els.coachNextActionText.textContent = isLetter
      ? "Tahmin hedefe yaklaşınca Hedefi Kontrol Et ile sonucu doğrula."
      : "Hedefi Kontrol Et butonu kısa bir kelime kaydı alır ve sonucu yorumlar.";
    return;
  }

  if (!hasPrediction) {
    els.coachNextActionTitle.textContent = "Hedefi kamerada göster";
    els.coachNextActionText.textContent = isLetter
      ? "El pozun algılandığında canlı sonuç alanı dolacak."
      : "Kelime kaydı için Hedefi Kontrol Et butonunu kullan.";
    return;
  }

  els.coachNextActionTitle.textContent =
    state.coachFlow === "quiz" ? "Cevabı kontrol et" : "Tekrarı işle";
  els.coachNextActionText.textContent =
    `${hasPrediction ? `Canlı sonuç: ${state.prediction}. ` : ""}` +
    "Hedefle eşleşiyorsa ilerleme güncellenir; eşleşmiyorsa kadrajı ve hareketi düzelt.";
}

function syncRecordButton() {
  if (!els.recordWord) return;
  const coachLetterTarget = state.mode === "coach" && state.coachTarget.length === 1;
  const wordCapableMode =
    state.mode === "word" || (state.mode === "coach" && state.coachTarget.length > 1);

  // Kelime modu için Hand+Pose+Face hepsi gerekli — Pose/Face arka planda
  // yükleniyorsa butonu disable et ve tooltip ile sebebi göster.
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
    coachLetterTarget || wordFlowBusy || (wordCapableMode && !wordPipelineReady);

  if (wordCapableMode && !wordPipelineReady) {
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

async function startCoachStudy() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }
  await toggleCamera();
  if (state.cameraOn) {
    state.coachFeedback = "Çalışma aktif. Hedefi kamerada uygulayın ve Kontrol Et butonunu kullanın.";
    updateCoachPanel();
  }
}

function checkCoachTarget() {
  if (!state.cameraOn) {
    setMessage("Önce çalışmayı başlatın.", "low");
    return;
  }
  if (_isCoachWordTarget()) {
    startWordRecording();
    return;
  }
  updateCoachFromPrediction();
}

function nextCoachTarget() {
  const list = state.coachTargetType === "word" ? WORDS : LETTERS;
  const currentIndex = Math.max(0, list.indexOf(state.coachTarget));
  const nextIndex = (currentIndex + 1) % list.length;
  state.coachTarget = list[nextIndex];
  state.coachStep = state.coachFlow === "quiz" ? state.coachStep : 0;
  state.coachFeedback = "";
  if (els.coachTarget) els.coachTarget.value = state.coachTarget;
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  updatePrediction({ label: state.coachTarget, confidence: 0, alternatives: [] });
  updateCoachPanel();
  updateReferenceForMode();
}

function syncActionBar() {
  if (els.cameraToggle) {
    els.cameraToggle.textContent = state.cameraOn ? "Durdur" : "Başlat";
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
      !assessment.canAppend;
    els.appendWordResult.title = els.appendWordResult.disabled
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

function updateCoachFromPrediction() {
  const isWord = state.coachTarget.length > 1;
  const threshold = isWord ? CONFIG.WORD_ACCEPT_THRESHOLD : CONFIG.CONFIDENT_THRESHOLD;
  const matched = state.prediction === state.coachTarget && state.confidence >= threshold;

  if (matched) {
    if (state.coachFlow === "quiz") {
      state.quizScore = Math.min(state.quizTotal, state.quizScore + 1);
    }
    if (state.coachFlow !== "learn") {
      state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
    }
    state.coachFeedback = isWord
      ? "Doğru eşleşme. Hareket akışı ve kadraj koşulları yeterli görünüyor."
      : "Doğru eşleşme. El şekli sabit ve hedefle uyumlu görünüyor.";
  } else {
    state.coachFeedback = isWord
      ? "Hedefle eşleşmedi. Hareket daha yavaş tamamlanmalı; yüz ve omuzlar görünür kalmalı."
      : "Hedefle eşleşmedi. El kadrajın ortasında olmalı ve parmak ayrımları net görünmeli.";
  }
  updateCoachPanel();
}

// Tek bir kelimeyi (rahat/zor) chip olarak HTML'e dönüştürür.
// F1 değeri küçük badge halinde gösterilir — XSS yok çünkü word/f1 known data.
function _wordChipHtml(word, f1, severity) {
  const safeWord = String(word).replace(/[<>&]/g, "");
  const f1Pct = Math.round(Math.max(0, Math.min(1, f1)) * 100);
  return (
    `<span class="word-chip word-chip--${severity}">` +
      `<span class="word-chip__name">${safeWord}</span>` +
      `<span class="word-chip__f1">F1 ${f1Pct}</span>` +
    `</span>`
  );
}

// Confusion çiftini chip olarak HTML'e çevirir, varsa count rozetiyle.
function _confusionChipHtml(a, b, count) {
  const safeA = String(a).replace(/[<>&]/g, "");
  const safeB = String(b).replace(/[<>&]/g, "");
  const countBadge = Number.isFinite(count) && count > 0
    ? `<span class="word-chip__count">${count}×</span>`
    : "";
  return (
    `<span class="word-chip word-chip--confusion">` +
      `<span class="word-chip__name">${safeA}</span>` +
      `<span class="word-chip__sep" aria-hidden="true">↔</span>` +
      `<span class="word-chip__name">${safeB}</span>` +
      countBadge +
    `</span>`
  );
}

function renderWordJuryPanel() {
  const stats =
    typeof perWordStats !== "undefined" && perWordStats
      ? perWordStats
      : {};
  const pairs =
    typeof confusionPairs !== "undefined" && Array.isArray(confusionPairs)
      ? confusionPairs
      : [];

  const ranked = Object.entries(stats)
    .map(([word, value]) => ({
      word,
      f1: Number(value?.f1 || value?.f1_score || value?.test_f1 || 0),
      difficulty: value?.difficulty || "",
    }))
    .filter((item) => item.word);

  const easyItems = ranked
    .filter((item) => item.difficulty === "easy" || item.f1 >= 0.78)
    .sort((a, b) => b.f1 - a.f1)
    .slice(0, 10);

  const riskyItems = ranked
    .filter((item) => item.difficulty === "hard" || item.f1 < 0.62)
    .sort((a, b) => a.f1 - b.f1)
    .slice(0, 8);

  const confusionItems = pairs
    .slice(0, 6)
    .filter((p) => (p.word_a || p.a) && (p.word_b || p.b));

  if (els.wordDemoList && easyItems.length) {
    els.wordDemoList.innerHTML = easyItems
      .map((item) => _wordChipHtml(item.word, item.f1, "good"))
      .join("");
  }
  if (els.wordRiskList && riskyItems.length) {
    els.wordRiskList.innerHTML = riskyItems
      .map((item) => _wordChipHtml(item.word, item.f1, "risky"))
      .join("");
  }
  if (els.wordConfusionList && confusionItems.length) {
    els.wordConfusionList.innerHTML = confusionItems
      .map((p) =>
        _confusionChipHtml(
          p.word_a || p.a,
          p.word_b || p.b,
          Number(p.count ?? p.confusions ?? 0),
        ),
      )
      .join("");
  }
}

function setJuryTask(task) {
  state.juryTask = task === "word" ? "word" : "letter";
  document.querySelectorAll("[data-jury-task]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.juryTask === state.juryTask);
  });
  renderJurySampleOptions();
  updateJuryDomainHelp();
}

async function loadJuryManifest() {
  try {
    const res = await fetch("./data/jury-samples/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    state.juryManifest = await res.json();
  } catch (err) {
    console.warn("Jury sample manifest okunamadı:", err?.message || err);
    state.juryManifest = {
      letters: [
        {
          id: "legacy-letter-a",
          label: "A",
          title: "Harf A",
          path: "./data/letter_test_sample.json",
          expected_label: "A",
        },
      ],
      words: [
        {
          id: "legacy-word-give",
          label: "give",
          title: "Kelime give",
          path: "./data/test_sample.json",
          expected_label: "give",
        },
      ],
    };
  }
  renderJurySampleOptions();
}

function getJuryManifestItems(task = state.juryTask) {
  const manifest = state.juryManifest || {};
  return task === "word" ? (manifest.words || []) : (manifest.letters || []);
}

function renderJurySampleOptions() {
  if (!els.jurySampleSelect) return;
  const items = getJuryManifestItems();
  els.jurySampleSelect.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.juryTask === "word"
      ? "Hazır kelime fixture yok"
      : "Hazır harf fixture yok";
    els.jurySampleSelect.appendChild(option);
    if (els.loadSelectedJurySample) els.loadSelectedJurySample.disabled = true;
    return;
  }

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.path;
    const conf = Number.isFinite(Number(item.confidence))
      ? ` · beklenen %${Math.round(Number(item.confidence) * 100)}`
      : "";
    option.textContent = `${item.title || item.label || item.id}${conf}`;
    option.dataset.sampleId = item.id || "";
    option.dataset.label = item.expected_label || item.label || "";
    els.jurySampleSelect.appendChild(option);
  });
  if (state.juryTask === "word") {
    const options = Array.from(els.jurySampleSelect.options);
    const preferred = PREFERRED_JURY_WORD_IDS
      .map((id) => options.find((option) => option.dataset.sampleId === id))
      .find(Boolean);
    if (preferred) preferred.selected = true;
  }
  if (els.loadSelectedJurySample) els.loadSelectedJurySample.disabled = false;
}

async function loadPreferredJurySample(task) {
  const normalizedTask = task === "word" ? "word" : "letter";
  setJuryTask(normalizedTask);
  const items = getJuryManifestItems(normalizedTask);
  const preferredIds = normalizedTask === "word" ? PREFERRED_JURY_WORD_IDS : ["letter-a"];
  const sample =
    preferredIds.map((id) => items.find((item) => item.id === id)).find(Boolean) || items[0];

  if (!sample?.path) {
    showJuryError(
      normalizedTask === "word"
        ? "Hazır kelime demo fixture bulunamadı."
        : "Hazır harf demo fixture bulunamadı.",
    );
    return;
  }

  await loadJurySampleFromUrl(sample.path, sample.title || sample.label || sample.id);
}

async function loadAndRunPreferredJurySample(task) {
  const normalizedTask = task === "word" ? "word" : "letter";
  await loadPreferredJurySample(normalizedTask);
  if (state.jurySample?.task === normalizedTask) {
    await runJurySample();
  }
}

function updateJuryDomainHelp() {
  if (!els.juryDomainHelp) return;
  if (state.juryTask === "word") {
    els.juryDomainHelp.textContent =
      "Kelime modu hareketi değerlendirir: 45 frame boyunca çıkarılan özellikler ve gerçek frame maskesi modele verilir. Bu yüzden tek fotoğraf değil, kısa bir hareket dizisi test edilir.";
  } else {
    els.juryDomainHelp.textContent =
      "Harf modu statik el pozunu değerlendirir: tek frame üzerinden 93 sayısal özellik çıkarılır ve 24 harf sınıfından biri tahmin edilir.";
  }
}

function getDemoBaseUrl() {
  const host = window.location.hostname;
  const isLocal =
    window.location.protocol === "file:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "";
  if (isLocal) return CONFIG.DEMO_PUBLIC_URL;

  const pathname = window.location.pathname || "/";
  const directory = pathname.endsWith("/") ? pathname : pathname.replace(/[^/]*$/, "");
  return new URL(directory || "/", window.location.origin).href;
}

function buildQrDemoUrl(target = state.qrTarget) {
  const normalizedTarget = ["letter", "word", "test"].includes(target) ? target : "letter";
  return `${getDemoBaseUrl()}#${normalizedTarget}`;
}

function setQrTarget(target) {
  state.qrTarget = ["letter", "word", "test"].includes(target) ? target : "letter";
  renderQrDemo();
}

function renderQrDemo() {
  const url = buildQrDemoUrl();
  document.querySelectorAll("[data-qr-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.qrTarget === state.qrTarget);
  });
  if (els.qrDemoUrl) els.qrDemoUrl.textContent = url;
  if (els.qrOpenDemo) els.qrOpenDemo.href = url;

  if (!els.qrCanvas) return;
  els.qrCanvas.innerHTML = "";
  if (window.kjua && typeof window.kjua === "function") {
    const qrNode = window.kjua({
      render: "canvas",
      crisp: true,
      minVersion: 1,
      ecLevel: "H",
      size: 420,
      ratio: undefined,
      fill: "#102033",
      back: "#ffffff",
      text: url,
      rounded: 0,
      quiet: 2,
    });
    els.qrCanvas.appendChild(qrNode);
    if (els.qrStatus) els.qrStatus.textContent = `QR hazır: ${url}`;
    return;
  }

  if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 420;
    els.qrCanvas.appendChild(canvas);
    window.QRCode.toCanvas(
      canvas,
      url,
      {
        width: 420,
        margin: 2,
        errorCorrectionLevel: "H",
        color: {
          dark: "#102033",
          light: "#ffffff",
        },
      },
      (error) => {
        if (els.qrStatus) {
          els.qrStatus.textContent = error
            ? `QR üretilemedi: ${error.message || error}`
            : `QR hazır: ${url}`;
        }
      },
    );
    return;
  }

  {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 420;
    els.qrCanvas.appendChild(canvas);
    const ctx2d = canvas.getContext("2d");
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = "#102033";
    ctx2d.font = "700 22px sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.fillText("QR yüklenemedi", canvas.width / 2, canvas.height / 2 - 12);
    ctx2d.font = "500 15px sans-serif";
    ctx2d.fillText("Aşağıdaki linki açın", canvas.width / 2, canvas.height / 2 + 20);
    if (els.qrStatus) els.qrStatus.textContent = "QR kütüphanesi yüklenemedi; bağlantı metni yedek olarak kullanılabilir.";
    return;
  }
}

async function copyQrDemoUrl() {
  const url = buildQrDemoUrl();
  try {
    await navigator.clipboard.writeText(url);
    if (els.qrStatus) els.qrStatus.textContent = "Demo linki panoya kopyalandı.";
  } catch (err) {
    const input = document.createElement("input");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    if (els.qrStatus) els.qrStatus.textContent = "Demo linki panoya kopyalandı.";
  }
}

async function loadSelectedJurySample() {
  const option = els.jurySampleSelect?.selectedOptions?.[0];
  if (!option?.value) {
    showJuryError("Bu domain için hazır fixture bulunamadı.");
    return;
  }
  await loadJurySampleFromUrl(option.value, option.textContent.trim());
}

async function loadJurySampleFromUrl(url, displayName) {
  try {
    if (els.jurySampleStatus) els.jurySampleStatus.textContent = "Örnek yükleniyor";
    updateJuryProcess("loading");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${displayName} alınamadı (HTTP ${res.status})`);
    const sample = await res.json();
    setJurySample(sample, displayName || url);
  } catch (err) {
    showJuryError(err.message);
    console.error(err);
  }
}

async function handleJurySampleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await readJurySampleFile(file);
}

async function handleJurySampleDrop(event) {
  event.preventDefault();
  els.juryDropZone?.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await readJurySampleFile(file);
}

async function readJurySampleFile(file) {
  try {
    updateJuryProcess("loading");
    const text = await file.text();
    const sample = JSON.parse(text);
    setJurySample(sample, file.name);
  } catch (err) {
    showJuryError(`JSON okunamadı: ${err.message}`);
  }
}

function setJurySample(rawSample, sourceName) {
  const sample = normalizeJurySample(rawSample, sourceName);
  state.jurySample = sample;
  setJuryTask(sample.task);
  updateJuryProcess("validated");

  if (els.jurySampleStatus) els.jurySampleStatus.textContent = "Örnek hazır";
  if (els.juryFileName) els.juryFileName.textContent = sourceName || sample.source || "Yüklenen JSON";
  if (els.runJurySample) els.runJurySample.disabled = false;
  if (els.juryTaskLabel) els.juryTaskLabel.textContent = sample.task === "word" ? "Kelime modeli" : "Harf modeli";
  if (els.jurySourceLabel) els.jurySourceLabel.textContent = sample.source || sourceName || "JSON fixture";
  if (els.jurySchemaLabel) els.jurySchemaLabel.textContent = sample.schemaVersion;
  if (els.juryShapeLabel) els.juryShapeLabel.textContent = sample.shapeLabel;
  if (els.juryMaskLabel) els.juryMaskLabel.textContent = sample.maskLabel;
  if (els.juryExpectedLabel) els.juryExpectedLabel.textContent = sample.expectedLabel || "Referans yok";
  if (els.juryPredictedLabel) els.juryPredictedLabel.textContent = "-";
  if (els.juryConfidence) els.juryConfidence.textContent = "-";
  if (els.juryLatency) els.juryLatency.textContent = "-";
  if (els.juryMatchBadge) {
    els.juryMatchBadge.textContent = "Çalıştırılmadı";
    els.juryMatchBadge.dataset.match = "unknown";
  }
  if (els.juryResultNote) {
    els.juryResultNote.textContent =
      sample.task === "word"
        ? "Kelime örneği 45 frame hareket bilgisinden hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek."
        : "Harf örneği tek el pozundan hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek.";
  }
  renderJuryTop3([]);
}

function normalizeJurySample(rawSample, sourceName) {
  if (!rawSample || typeof rawSample !== "object") {
    throw new Error("Fixture JSON object olmalı");
  }

  const inferredTask = rawSample.task || (Array.isArray(rawSample.mask) ? "word" : "letter");
  const task = inferredTask === "word" ? "word" : "letter";
  const rawFeatures = rawSample.features || rawSample.input || rawSample.feature_vector;
  if (!Array.isArray(rawFeatures)) {
    throw new Error("features alanı array olmalı");
  }
  const features = flattenNumericArray(rawFeatures, "features");

  const expectedLabel =
    rawSample.expected_label ||
    rawSample.expected_word ||
    rawSample.expected_letter ||
    rawSample.label ||
    "";

  if (task === "word") {
    const mask = normalizeMask(rawSample.mask);
    if (features.length !== 45 * 168) {
      throw new Error(`Kelime fixture features[7560] bekler, ${features.length} geldi`);
    }
    if (mask.length !== 45) {
      throw new Error(`Kelime fixture mask[45] bekler, ${mask.length} geldi`);
    }
    const realFrames = mask.filter(Boolean).length;
    return {
      task,
      sampleId: rawSample.sample_id || "",
      features: Float32Array.from(features),
      mask,
      expectedLabel,
      expectedConfidence: Number(rawSample.expected_confidence ?? NaN),
      expectedTop3: rawSample.expected_top3 || [],
      schemaVersion: rawSample.schema_version || "legacy-word-test-sample",
      source: rawSample.source || rawSample.dataset || sourceName || "word fixture",
      shapeLabel: "45 × 168 = 7560 float",
      maskLabel: `${realFrames}/45 real frame`,
    };
  }

  if (features.length !== 93) {
    throw new Error(`Harf fixture features[93] bekler, ${features.length} geldi`);
  }
  return {
    task,
    sampleId: rawSample.sample_id || "",
    features: Float32Array.from(features),
    mask: null,
    expectedLabel,
    expectedConfidence: Number(rawSample.expected_confidence ?? NaN),
    expectedTop3: rawSample.expected_top3 || [],
    schemaVersion: rawSample.schema_version || "asl-sample-v1",
    source: rawSample.source || rawSample.dataset || sourceName || "letter fixture",
    shapeLabel: "93 float",
    maskLabel: "Yok",
  };
}

function flattenNumericArray(value, fieldName) {
  const out = [];
  const stack = [...value].reverse();
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i--) stack.push(item[i]);
      continue;
    }
    const num = Number(item);
    if (!Number.isFinite(num)) {
      throw new Error(`${fieldName} içinde sayısal olmayan değer var`);
    }
    out.push(num);
  }
  return out;
}

function normalizeMask(value) {
  if (!Array.isArray(value)) {
    throw new Error(`Kelime fixture mask[45] bekler, ${value == null ? 0 : "geçersiz"} geldi`);
  }
  return value.map((item) => {
    if (item === true || item === 1 || item === "1") return true;
    if (item === false || item === 0 || item === "0") return false;
    if (typeof item === "string") {
      const lowered = item.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
    }
    throw new Error("mask sadece bool, 0/1 veya true/false string değerleri içermeli");
  });
}

async function runJurySample() {
  const sample = state.jurySample;
  if (!sample) {
    showJuryError("Önce JSON fixture yükle veya hazır örnek seç.");
    return;
  }

  try {
    if (els.jurySampleStatus) els.jurySampleStatus.textContent = "Model çalışıyor";
    if (els.runJurySample) {
      els.runJurySample.disabled = true;
      els.runJurySample.textContent = "Model Çalışıyor";
    }
    updateJuryProcess("running");

    let result = null;
    const t0 = performance.now();
    if (sample.task === "word") {
      if (typeof predictWord !== "function") throw new Error("word-model.js yüklenmemiş");
      if (typeof wordSession !== "undefined" && !wordSession) {
        const ok = await loadWordModel();
        if (!ok) throw new Error("Kelime modeli yüklenemedi");
      }
      result = await predictWord(sample.features, sample.mask);
    } else {
      if (typeof predictLetter !== "function") throw new Error("letter-model.js yüklenmemiş");
      if (typeof letterSession !== "undefined" && !letterSession) {
        const ok = await loadLetterModel();
        if (!ok) throw new Error("Harf modeli yüklenemedi");
      }
      result = await predictLetter(sample.features);
    }
    const elapsed = performance.now() - t0;
    if (!result) throw new Error("Model tahmin döndürmedi");

    renderJuryResult(sample, result, elapsed);
  } catch (err) {
    showJuryError(err.message);
    console.error(err);
  } finally {
    if (els.runJurySample) {
      els.runJurySample.disabled = false;
      els.runJurySample.textContent = "Seçili Örneği Tekrar Çalıştır";
    }
  }
}

function renderJuryResult(sample, result, elapsed) {
  const expected = sample.expectedLabel || "";
  const matched = expected ? result.label === expected : null;
  const alternatives = result.alternatives?.length
    ? result.alternatives
    : [{ label: result.label, confidence: result.confidence || 0 }];
  if (els.jurySampleStatus) els.jurySampleStatus.textContent = "Tamamlandı";
  updateJuryProcess("done");
  if (els.juryMatchBadge) {
    els.juryMatchBadge.textContent =
      matched === null ? "Referans yok" : matched ? "Eşleşti" : "Eşleşmedi";
    els.juryMatchBadge.dataset.match = matched === null ? "unknown" : matched ? "yes" : "no";
  }
  if (els.juryExpectedLabel) els.juryExpectedLabel.textContent = expected || "Referans yok";
  if (els.juryPredictedLabel) els.juryPredictedLabel.textContent = result.label;
  if (els.juryConfidence) els.juryConfidence.textContent = formatPercent(result.confidence);
  if (els.juryLatency) els.juryLatency.textContent = `${elapsed.toFixed(0)} ms`;
  renderJuryTop3(alternatives);

  if (els.juryResultNote) {
    const topText = formatTopPredictions(alternatives);
    const matchText =
      matched === null
        ? "Bu fixture için referans etiket yok."
        : matched
          ? "Tahmin beklenen etiketle eşleşti. Bu, seçilen test girdisinde modelin doğru sınıfı seçtiğini gösterir."
          : "Tahmin beklenen etiketten farklı. Bu durumda top-3 listesi modelin hangi sınıfları karıştırdığını gösterir.";
    els.juryResultNote.textContent = `${matchText} Top-3: ${topText}.`;
  }
}

function renderJuryTop3(items) {
  if (!els.juryTop3List) return;
  els.juryTop3List.innerHTML = "";
  const rows = items.length ? items.slice(0, 3) : [{ label: "-", confidence: 0 }];
  rows.forEach((item, index) => {
    const pct = clampPercent((item.confidence || 0) * 100);
    const row = document.createElement("div");
    row.className = "top3-row";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${index + 1}`;
    const label = document.createElement("b");
    label.textContent = item.label;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const confidence = document.createElement("span");
    confidence.textContent = `${pct}%`;
    row.append(rank, label, bar, confidence);
    els.juryTop3List.appendChild(row);
  });
}

function showJuryError(message) {
  if (els.jurySampleStatus) els.jurySampleStatus.textContent = "Hata";
  updateJuryProcess("error");
  if (els.juryMatchBadge) {
    els.juryMatchBadge.textContent = "Hata";
    els.juryMatchBadge.dataset.match = "no";
  }
  if (els.juryResultNote) els.juryResultNote.textContent = message;
}

function updateJuryProcess(status) {
  if (!els.juryProcessSteps) return;
  const activeByStatus = {
    idle: [],
    loading: ["sample"],
    validated: ["sample", "validate"],
    running: ["sample", "validate", "inference"],
    done: ["sample", "validate", "inference", "result"],
    error: [],
  };
  const active = new Set(activeByStatus[status] || []);
  els.juryProcessSteps.dataset.status = status;
  els.juryProcessSteps.querySelectorAll("[data-step]").forEach((step) => {
    step.dataset.state = active.has(step.dataset.step) ? "done" : "";
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `%${(value * 100).toFixed(1)}`;
}


function updateReferenceForMode() {
  if (!els.referenceImage) return;
  const mode = state.mode;
  const target = state.coachTarget || "A";
  const wordModeTarget =
    mode === "word" && state.prediction && state.prediction.length > 1
      ? state.prediction
      : "";
  const coachIsWord = mode === "coach" && target.length > 1;
  const isWordRef = mode === "word" || coachIsWord;

  const refAsset = isWordRef ? REFERENCE_ASSETS.wordPages[0] : REFERENCE_ASSETS.letter.src;
  els.referenceImage.src = refAsset;
  els.referenceImage.alt = isWordRef
    ? "ASL kelime referans sayfası 1"
    : REFERENCE_ASSETS.letter.alt;
  els.referenceImage.loading = "lazy";
  els.referenceImage.decoding = "async";
  renderReferenceThumbnails(isWordRef);

  if (els.referenceKicker) {
    els.referenceKicker.textContent =
      mode === "coach" ? "Koç referansı" : mode === "word" ? "Kelime referansı" : "Harf referansı";
  }
  if (els.referenceTitle) {
    els.referenceTitle.textContent =
      mode === "coach"
        ? (coachIsWord ? `Kelime hedefi: ${target}` : `Harf hedefi: ${target}`)
        : mode === "word"
          ? (wordModeTarget ? `Seçili kelime: ${wordModeTarget}` : "50 kelime referans kartı")
          : "ASL harf kartları";
  }
  if (els.referenceNote) {
    els.referenceNote.textContent =
      mode === "word"
        ? "Kelime referansı 5 sayfaya bölünmüştür. Sayfa seçip işareti incelerken yüz, omuz ve el aynı anda kamerada kalmalı."
        : mode === "coach"
          ? (coachIsWord
              ? "Kelime hedefleri için referans sayfasını aç, sonra 45 frame kayıtla sonucu kontrol et."
              : "Hedefi yapamazsan görsel referansı aç veya video rehberden destek al.")
          : "Harf karışırsa referans görseli açıp el şeklini karşılaştır.";
  }
  if (els.referenceVideoLink) {
    els.referenceVideoLink.href = buildReferenceVideoUrl(
      mode,
      mode === "word" ? wordModeTarget : target,
    );
  }
}

function renderReferenceThumbnails(isWordRef) {
  if (!els.referenceThumbs) return;
  els.referenceThumbs.innerHTML = "";
  els.referenceThumbs.hidden = !isWordRef;
  if (!isWordRef) return;

  REFERENCE_ASSETS.wordPages.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reference-thumb";
    button.textContent = `${index + 1}`;
    button.title = `Kelime referans sayfası ${index + 1}`;
    button.dataset.active = index === 0 ? "true" : "false";
    button.addEventListener("click", () => {
      els.referenceImage.src = src;
      els.referenceImage.alt = `ASL kelime referans sayfası ${index + 1}`;
      els.referenceThumbs
        .querySelectorAll(".reference-thumb")
        .forEach((thumb) => { thumb.dataset.active = "false"; });
      button.dataset.active = "true";
    });
    els.referenceThumbs.appendChild(button);
  });
}

function buildReferenceVideoUrl(mode, target) {
  const isWordTarget = mode === "word" || (mode === "coach" && target && target.length > 1);
  if (isWordTarget && target && referenceVideoLinks.words && referenceVideoLinks.words[target]) {
    return referenceVideoLinks.words[target];
  }
  if (!isWordTarget && referenceVideoLinks.alphabet_video) {
    return referenceVideoLinks.alphabet_video;
  }
  const query = isWordTarget
    ? `ASL ${target || "basic words"} sign tutorial`
    : target && target.length === 1
      ? `ASL letter ${target} hand sign tutorial`
      : "ASL alphabet hand signs tutorial";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function toggleReference() {
  const isHidden = els.referenceBody.hidden;
  els.referenceBody.hidden = !isHidden;
  els.toggleReference.textContent = isHidden ? "Gizle" : "Göster";
}

// ─── Reference Image Lightbox ─────────────
// Sağ paneldeki referans görseline tıklanınca tam ekran modalda açar.
// Davranış: ESC, arka plan veya × ile kapanır. Letter ve word modu için
// aynı `referenceImage.src`'yi kullanır (mod değişince JS otomatik günceller).
function _openReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImage");
  const title = document.getElementById("lightboxTitle");
  if (!lb || !img || !els.referenceImage) return;
  const src = els.referenceImage.currentSrc || els.referenceImage.src;
  const alt = els.referenceImage.alt || "ASL referans görseli";
  img.src = src;
  img.alt = alt;
  if (title) title.textContent = alt;
  lb.hidden = false;
  // body scroll'u kilitle (modal arkasında kaydırma yapılmasın)
  document.body.dataset.lightboxOpen = "true";
  // Kapatma butonuna odakla (erişilebilirlik)
  document.getElementById("lightboxClose")?.focus();
}

function _closeReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  delete document.body.dataset.lightboxOpen;
  // Geri odak: referans görseline veya toggle butonuna
  els.referenceImage?.focus?.();
}

function bindReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  const closeBtn = document.getElementById("lightboxClose");
  if (!lb) return;

  // Referans görseline tıkla → aç. Tab + Enter de çalışsın.
  if (els.referenceImage) {
    els.referenceImage.style.cursor = "zoom-in";
    els.referenceImage.setAttribute("role", "button");
    els.referenceImage.setAttribute("tabindex", "0");
    els.referenceImage.setAttribute("title", "Tam ekranda görüntüle");
    els.referenceImage.addEventListener("click", _openReferenceLightbox);
    els.referenceImage.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        _openReferenceLightbox();
      }
    });
  }

  // Kapatma yolu 1: × butonu
  closeBtn?.addEventListener("click", _closeReferenceLightbox);

  // Kapatma yolu 2: backdrop click (sadece backdrop, içerik değil)
  lb.addEventListener("click", (event) => {
    if (event.target === lb) _closeReferenceLightbox();
  });

  // Kapatma yolu 3: ESC tuşu (yalnız modal açıkken)
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lb.hidden) {
      event.preventDefault();
      _closeReferenceLightbox();
    }
  });
}

async function runOfflineCheck() {
  els.offlineTest.textContent = "Test ediliyor...";
  try {
    if (typeof loadWordModel !== "function" || typeof predictWord !== "function") {
      throw new Error("word-model.js yüklenmemiş");
    }

    // Model henüz yüklenmediyse yükle
    if (typeof wordSession !== "undefined" && !wordSession) {
      const ok = await loadWordModel();
      if (!ok) throw new Error("Model yüklenemedi");
    }

    // test_sample.json oku
    const sampleRes = await fetch("./data/test_sample.json", { cache: "no-store" });
    if (!sampleRes.ok) throw new Error(`test_sample.json alınamadı (HTTP ${sampleRes.status})`);
    const sample = await sampleRes.json();

    if (!Array.isArray(sample.features) || sample.features.length !== 45 * 168) {
      throw new Error(`features uzunluğu 7560 olmalı, ${sample.features?.length} alındı`);
    }
    if (!Array.isArray(sample.mask) || sample.mask.length !== 45) {
      throw new Error(`mask uzunluğu 45 olmalı, ${sample.mask?.length} alındı`);
    }

    const features = Float32Array.from(sample.features);
    const mask = sample.mask;

    const t0 = performance.now();
    const result = await predictWord(features, mask);
    const elapsed = performance.now() - t0;
    if (!result) throw new Error("Inference döndürmedi");

    const expected = sample.expected_word;
    const match = result.label === expected;
    const confDelta = Math.abs(result.confidence - (sample.expected_confidence ?? 0));

    // Top-3 karşılaştırma metni
    const top3Str = result.alternatives
      .map((a, i) => `${i + 1}. ${a.label} %${(a.confidence * 100).toFixed(1)}`)
      .join(" · ");

    const sign = match ? "✓" : "✗";
    els.offlineTest.textContent = `${sign} ${match ? "Eşleşiyor" : "Eşleşmiyor"}`;
    setMessage(
      `Beklenen: ${expected} · ONNX: ${result.label} (%${(result.confidence * 100).toFixed(1)}) ` +
        `· Δconf=${confDelta.toExponential(2)} · ${elapsed.toFixed(0)}ms · ${top3Str}`,
      match ? "good" : "low",
    );

    // Konsola detaylı doğrulama (Python expected_top3 ile karşılaştırma)
    console.log("=== Offline test ===");
    console.log(`expected_word: ${expected} (conf ${sample.expected_confidence?.toFixed(4)})`);
    console.log(`web onnx     : ${result.label} (conf ${result.confidence.toFixed(4)})`);
    console.log("expected top-3:", sample.expected_top3);
    console.log("web top-3:", result.alternatives);
    if (sample.expected_logits && Array.isArray(sample.expected_logits)) {
      console.log(`temperature kullanılan: ${typeof temperature !== "undefined" ? temperature : "?"}`);
    }
  } catch (err) {
    els.offlineTest.textContent = "Offline test";
    setMessage("Test hatası: " + err.message, "low");
    console.error(err);
  }
}

function cycleMode() {
  const order = ["letter", "word", "coach", "project"];
  const next = order[(order.indexOf(state.mode) + 1) % order.length];
  setMode(next);
}

function updateDebug() {
  if (!state.debug) return;
  els.debugMode.textContent = `mode: ${state.mode}`;
  els.debugConfidence.textContent = `confidence: ${state.confidence.toFixed(3)}`;
  els.debugFrames.textContent = `frames: ${state.frameCount}`;

  if (typeof getBenchmarkSummary === "function") {
    const bm = getBenchmarkSummary();
    els.debugLatency.textContent = `mp:${bm.mediapipe} fe:${bm.feature} onnx:${bm.onnx} total:${bm.total}`;
  } else {
    els.debugLatency.textContent = `latency: ${state.cameraOn ? "—" : "--"}`;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForVideoReady(videoEl) {
  if (!videoEl) return;
  if (videoEl.readyState < 1 || videoEl.videoWidth === 0) {
    await new Promise((resolve) => {
      const done = () => {
        videoEl.removeEventListener("loadedmetadata", done);
        resolve();
      };
      videoEl.addEventListener("loadedmetadata", done, { once: true });
      window.setTimeout(done, 2500);
    });
  }
  try {
    await videoEl.play();
  } catch (err) {
    console.warn("Video play() başarısız, autoplay devam edebilir:", err?.message || err);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

init();

// Console'dan canlı introspection için: window.aslDebug.dump()
// Konsola yapıştır: aslDebug.dump()
window.aslDebug = {
  state,
  CONFIG,
  get latestResult() {
    return typeof latestMediaPipeResult !== "undefined" ? latestMediaPipeResult : null;
  },
  get models() {
    return {
      wordSession: typeof wordSession !== "undefined" ? !!wordSession : "undefined",
      letterSession: typeof letterSession !== "undefined" ? !!letterSession : "undefined",
      wordLabels: typeof wordLabels !== "undefined" ? wordLabels.length : "undefined",
      letterLabels: typeof letterLabels !== "undefined" ? letterLabels.length : "undefined",
      temperature: typeof temperature !== "undefined" ? temperature : "undefined",
    };
  },
  get mediapipe() {
    return {
      handLandmarker: typeof handLandmarker !== "undefined" ? !!handLandmarker : "undefined",
      poseLandmarker: typeof poseLandmarker !== "undefined" ? !!poseLandmarker : "undefined",
      faceLandmarker: typeof faceLandmarker !== "undefined" ? !!faceLandmarker : "undefined",
      mpRunning: typeof mpRunning !== "undefined" ? mpRunning : "undefined",
      handedness: typeof latestHandednessDebug !== "undefined" ? latestHandednessDebug : "undefined",
    };
  },
  get buffers() {
    return {
      frameBufferLength: frameBuffer.length,
      normalizedFrameBufferLength: normalizedFrameBuffer.length,
      previousFrame: previousFrame ? "set" : "null",
    };
  },
  // Word pipeline canlı snapshot (debug-only).
  // _finishWordRecordingReal içinde global window._lastWordDebug set edilir.
  // RECORDING boyunca window._lastWordCurrentFrame anlık frame visibility tutar.
  get wordDebug() {
    if (typeof window === "undefined") return null;
    return {
      lastRecording: window._lastWordDebug || null,
      currentFrame: window._lastWordCurrentFrame || null,
      // Anlık state (kayıt sürerken bile kullanışlı)
      live: {
        wordState: state.wordState,
        wordFrames: state.wordFrames,
        expectedFrames: CONFIG.WORD_FRAME_COUNT,
        mode: state.mode,
      },
    };
  },
  // Letter pipeline canlı snapshot (debug-only, davranış değiştirmez).
  // realInference letter mode içinde global window._lastLetterDebug,
  // window._lastRawLetterPrediction, window._lastSmoothedLetterPrediction set eder.
  get letterDebug() {
    if (typeof window === "undefined") return null;
    const handednessDebug =
      typeof latestMediaPipeResult !== "undefined" && latestMediaPipeResult
        ? latestMediaPipeResult.handednessDebug || null
        : null;
    return {
      handedness: handednessDebug,
      letterSnapshot: window._lastLetterDebug || null,
      rawLetterPrediction: window._lastRawLetterPrediction || null,
      smoothedLetterPrediction: window._lastSmoothedLetterPrediction || null,
      uiState: {
        mode: state.mode,
        thresholdTier:
          typeof _thresholdsForMode === "function" ? _thresholdsForMode() : null,
      },
    };
  },
  dump() {
    console.log("=== ASL DEBUG ===");
    console.log("state:", { mode: state.mode, cameraOn: state.cameraOn, wordState: state.wordState, frameCount: state.frameCount, fps: state.fps });
    console.log("models:", this.models);
    console.log("mediapipe:", this.mediapipe);
    console.log("buffers:", this.buffers);
    console.log("letterDebug:", this.letterDebug);
    console.log("wordDebug:", this.wordDebug);
    console.log("latestResult:", this.latestResult);
  },
};
console.log("[ASL] Debug API: window.aslDebug.dump()");
