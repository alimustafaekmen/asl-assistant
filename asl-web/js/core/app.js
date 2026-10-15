// ASL Assistant bootstrap and orchestration.
//
// The browser app has no build step. index.html loads plain <script> files that
// share one global scope, so load order is a runtime contract and this file is
// last. Every other module only declares things; startup side effects live here.
//
// What stays in this file: init(), model and fixture loading coordination,
// central event binding, hash routing and mode switching, theme and home
// behaviour, camera permission with start/stop, the render loop, the debug
// panel, and the window.aslDebug console API.
//
// Feature work belongs in its own module. js/README.md has the map.

/**
 * Options for a mode change.
 *
 * @typedef {Object} SetModeOptions
 * @property {boolean} [syncHash] When false, the URL hash is left alone. Used
 *   when the change came from the hash itself.
 */

/**
 * Bring the app up, in the order the modules depend on.
 *
 * Preferences, coach options, and event bindings come first so the UI is
 * usable; the fixture manifest and the route are applied next, then the render
 * loop starts.
 *
 * No model loads here. A bare URL opens letter mode, but most visitors never
 * start the camera, so the models wait for their first real need: the camera
 * starting in a mode that runs one, a word recording, the offline check, or a
 * Model Test run. The word guidance data is a few kilobytes and loads last;
 * its panel renders once that fetch has settled.
 *
 * @returns {Promise<void>}
 */
async function init() {
  restoreTheme();
  buildCoachOptions();
  buildCoachProgress();
  bindEvents();
  restoreTranscript();
  loadReferenceVideoLinks();
  await loadModelTestManifest();
  setMode(modeFromHash(window.location.hash), { syncHash: false });
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });

  requestAnimationFrame(renderLoop);

  await loadGatingData();
  renderWordGuidancePanel();
}

/**
 * Which models a live camera mode runs.
 *
 * Coach needs both, because its target can move between a letter and a word
 * while the camera stays on. The informational screens run none.
 *
 * @param {AppMode} mode
 * @returns {{letter: boolean, word: boolean}}
 */
function liveModelNeeds(mode) {
  return {
    letter: mode === "letter" || mode === "coach",
    word: mode === "word" || mode === "coach",
  };
}

/**
 * Load the models a task needs, the first time it needs them, and say so.
 *
 * Each model loads once however often it is asked for, so this returns at once
 * for a model that is already loaded and then leaves the status line alone.
 * Progress is reported only when a download is actually under way. Each model
 * is optional, so a half-loaded app still runs: the status line says which one
 * is missing rather than failing outright.
 *
 * While the camera is on, the badge reports the camera and MediaPipe, so model
 * progress goes to the message line alone.
 *
 * @param {{letter?: boolean, word?: boolean}} needs
 * @returns {Promise<boolean>} True when every needed model is ready. Never rejects.
 */
async function loadModelsWithStatus(needs) {
  /** @param {string} text */
  const setBadge = (text) => {
    if (!state.cameraOn) els.latencyBadge.textContent = text;
  };
  // Whether each model was already loaded is read before its load is asked
  // for, so a download that starts here is reported.
  /** @type {{label: string, loaded: boolean, ready: Promise<boolean>}[]} */
  const models = [];
  if (needs.letter) {
    models.push({ label: "Harf", loaded: !!letterSession, ready: ensureLetterModel() });
  }
  if (needs.word) {
    models.push({ label: "Kelime", loaded: !!wordSession, ready: ensureWordModel() });
  }
  const downloading = models.some((model) => !model.loaded);
  if (downloading) {
    setMessage("Modeller yükleniyor...", "maybe");
    setBadge("Modeller yükleniyor");
  }

  try {
    const results = await Promise.all(models.map((model) => model.ready));
    const allReady = results.every(Boolean);
    if (!downloading) return allReady;

    const status = models.filter((_, i) => results[i]).map((model) => `${model.label} ✓`);
    if (allReady) {
      setMessage(`Modeller hazır: ${status.join(", ")}.`, "good");
      setBadge("Hazır");
    } else if (status.length) {
      setMessage(
        `Yalnızca ${status.join(", ")} yüklendi. Network sekmesinde 404 var mı kontrol edin.`,
        "low",
      );
      setBadge("Yarım yükleme");
    } else {
      setMessage(
        "Model yüklenemedi. ./models/ altında ONNX dosyaları var mı? Network sekmesini kontrol edin.",
        "low",
      );
      setBadge("Model yok");
    }
    return allReady;
  } catch (err) {
    console.error("Model yükleme hatası:", err);
    setMessage("Model yüklenemedi: " + err.message, "low");
    setBadge("Hata");
    return false;
  }
}

/** Whether bindEvents() has already run; see the guard in bindEvents(). */
let _eventsBound = false;

/**
 * Wire every DOM listener.
 *
 * Bindings stay in one place on purpose. Spreading them across the feature
 * modules would make it impossible to see what the page reacts to.
 *
 * Calling this a second time is a no-op. Every binding here adds a listener
 * rather than replacing one, so a second call would leave two of each and every
 * click would fire twice; nothing at the call site would show it. The guard is
 * the smallest thing that makes the function safe to call again, which is what
 * rebuilding part of a screen would want to do.
 *
 * @returns {void}
 */
function bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  queryAllUi("mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  queryElements("[data-go-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.goMode));
  });

  document.querySelector("[data-home-link]")?.addEventListener("click", (event) => {
    event.preventDefault();
    showHome();
  });

  window.addEventListener("hashchange", () => {
    setMode(modeFromHash(window.location.hash), { syncHash: false });
  });

  queryElements("[data-qr-target]").forEach((button) => {
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
  queryElements("[data-coach-flow]").forEach((button) => {
    button.addEventListener("click", () => setCoachFlow(button.dataset.coachFlow));
  });
  els.showDemoFlow?.addEventListener("click", () => {
    els.demoFlowSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.showTechSummary?.addEventListener("click", () => {
    els.techSummarySection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  queryElements("[data-model-test-task]").forEach((button) => {
    button.addEventListener("click", () => setModelTestTask(button.dataset.modelTestTask));
  });
  els.loadDemoLetter?.addEventListener("click", () => loadAndRunPreferredModelTestSample("letter"));
  els.loadDemoWord?.addEventListener("click", () => loadAndRunPreferredModelTestSample("word"));
  els.loadSelectedModelTestSample?.addEventListener("click", loadSelectedModelTestSample);
  els.modelTestSampleFile?.addEventListener("change", handleModelTestSampleFile);
  els.runModelTestSample?.addEventListener("click", runModelTestSample);
  els.modelTestDropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.modelTestDropZone.classList.add("is-dragging");
  });
  els.modelTestDropZone?.addEventListener("dragleave", () => {
    els.modelTestDropZone.classList.remove("is-dragging");
  });
  els.modelTestDropZone?.addEventListener("drop", handleModelTestSampleDrop);

  els.coachTarget.addEventListener("change", (event) => {
    // The listener is bound to the coach select, so the change event targets it.
    state.coachTarget = /** @type {HTMLSelectElement} */ (event.target).value;
    state.coachStep = 0;
    state.coachFeedback = "";
    if (typeof resetSmoother === "function") resetSmoother();
    if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
    updateCoachPanel();
    updateReferenceForMode();
  });

  window.addEventListener("keydown", (event) => {
    // Ctrl-modified, so it cannot collide with typing and stays available
    // wherever focus is.
    if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      state.debug = !state.debug;
      els.debugPanel.hidden = !state.debug;
      return;
    }
    // Any other modified key belongs to the browser: Cmd+C and Ctrl+C are
    // copy, not "clear the transcript".
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Everything below is an unmodified key, which belongs to the focused
    // control whenever there is one that consumes typing.
    if (isEditableTarget(event.target)) return;
    // Space appends the current prediction only in letter mode. The on-screen
    // control calls the same transcript function instead of simulating a key event.
    if (event.code === "Space" && state.mode === "letter") {
      event.preventDefault();
      appendCurrentLetter();
    }
    if (event.key.toLowerCase() === "s") speakTranscript();
    if (event.key.toLowerCase() === "c") clearTranscript();
    if (event.key.toLowerCase() === "m") cycleMode();
  });
}

/**
 * Return to the home screen and release the camera.
 *
 * Stopping the camera is the point: hiding the workspace alone would leave the
 * stream and the inference loop running, which is wrong for both privacy and
 * battery.
 *
 * @returns {void}
 */
function showHome() {
  if ((state.cameraOn || _cameraStartAttempt) && typeof stopCamera === "function") {
    stopCamera();
  }
  if (els.appShell) {
    els.appShell.dataset.view = "home";
  }
  queryAllUi("mode-tab").forEach((tab) => tab.classList.remove("is-active"));
}

/**
 * Apply the stored theme, keeping the authored default when storage is
 * unavailable.
 *
 * @returns {void}
 */
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
    // Keep the default theme when storage is unavailable or blocked.
  }
}

/**
 * Switch between light and dark, and remember the choice.
 *
 * @returns {void}
 */
function toggleTheme() {
  if (!els.appShell) return;
  const next = els.appShell.dataset.theme === "dark" ? "light" : "dark";
  els.appShell.dataset.theme = next;
  document.body.dataset.theme = next;
  try { localStorage.setItem("asl-theme", next); } catch (err) { /* noop */ }
}

/**
 * Resolve a URL hash to a mode.
 *
 * Unknown input falls back to letter mode, so a stale or hand-edited link opens
 * the app rather than a blank screen.
 *
 * @param {unknown} hash Typically window.location.hash.
 * @returns {AppMode}
 */
function modeFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  // The membership test is the validation; Array.includes cannot narrow a
  // string to the union, so the result is stated here.
  return /** @type {AppMode} */ (
    ["letter", "coach", "word", "project", "test", "qr"].includes(raw) ? raw : "letter"
  );
}

/**
 * Switch to a mode and rebuild everything that depends on it.
 *
 * Temporal state and the recording buffers are cleared first, so a prediction
 * or a half-recorded sign cannot leak across the change. The informational
 * screens replace the workspace entirely and return early, because none of the
 * camera UI applies to them.
 *
 * @param {string} mode Anything unrecognised falls back to letter mode.
 * @param {SetModeOptions} [options]
 * @returns {void}
 */
function setMode(mode, options = {}) {
  if (!["letter", "coach", "word", "project", "test", "qr"].includes(mode)) mode = "letter";
  if (options.syncHash !== false && window.location.hash !== `#${mode}`) {
    window.history.replaceState(null, "", `#${mode}`);
  }
  const shell = els.appShell || queryUi("app-shell");
  if (shell) { shell.dataset.view = "app"; shell.dataset.mode = mode; }
  // Clear temporal state so predictions cannot leak across mode changes.
  if (typeof resetSmoother === "function") resetSmoother();
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;

  // Validated by the membership test at the top of this function.
  state.mode = /** @type {AppMode} */ (mode);
  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;

  queryAllUi("mode-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
  });

  // Informational screens replace the camera workspace with their own section.
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
  queryAllUi("workspace-pane").forEach((el) => {
    el.hidden = isProject || isTest || isQr;
  });
  if (isQr) renderQrDemo();
  if (isProject || isTest || isQr) {
    // These screens replace the camera workspace, so they release the camera
    // exactly as returning home does.
    if (state.cameraOn || _cameraStartAttempt) stopCamera();
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

  // Entering a live mode with the camera already on is a first need for the
  // models it runs; with the camera off, starting it will be.
  if (state.cameraOn) loadModelsWithStatus(liveModelNeeds(state.mode));
}

/**
 * The camera start waiting on getUserMedia, or null when none is.
 *
 * state.cameraOn turns true only once the stream arrives, so without this a
 * second Start would open a second stream and a stop during the permission
 * prompt would have nothing to stop. stopCamera() clears it, which is how the
 * start learns, when its stream arrives, that it was cancelled. Each start
 * gets its own token, so a cancelled start cannot take over a newer one.
 *
 * @type {object | null}
 */
let _cameraStartAttempt = null;

/**
 * Start or stop the camera.
 *
 * getUserMedia needs a secure context, so an insecure page is reported before
 * the permission prompt would fail. Standard media errors are mapped to
 * actionable Turkish messages. MediaPipe failing to start is not fatal: the
 * camera stays on and the status line explains what is missing.
 *
 * A granted camera is what starts the live models downloading; a refused one
 * downloads nothing.
 *
 * @returns {Promise<void>} Resolves after reporting any failure to the user.
 */
async function toggleCamera() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }
  // A start is already waiting for the permission prompt.
  if (_cameraStartAttempt) return;

  // Camera APIs require HTTPS, except on localhost.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.latencyBadge.textContent = "HTTPS gerekli";
    setMessage(
      "Kamera için HTTPS veya localhost gerekiyor. Sayfa http:// üzerinden açılmış olabilir.",
      "low",
    );
    return;
  }

  const attempt = {};
  _cameraStartAttempt = attempt;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    // stopCamera() ran while the prompt was open, so this start was cancelled.
    if (_cameraStartAttempt !== attempt) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    _cameraStartAttempt = null;
    state.stream = stream;
    state.cameraOn = true;
    els.video.srcObject = stream;
    await waitForVideoReady(els.video);
    els.cameraEmpty.hidden = true;
    syncActionBar();
    els.cameraStatus.classList.add("is-live");
    els.cameraStatus.lastChild.textContent = "Kamera";
    els.latencyBadge.textContent = "Kamera açık";

    // Starting the camera is the first need for the live models. They download
    // alongside MediaPipe rather than after it; neither needs the other.
    const liveModelsLoad = loadModelsWithStatus(liveModelNeeds(state.mode));

    if (typeof startMediaPipe === "function") {
      try {
        els.latencyBadge.textContent = "MediaPipe yükleniyor...";
        await startMediaPipe(els.video);
        els.latencyBadge.textContent = "MediaPipe Hand hazır";
      } catch (err) {
        console.warn("MediaPipe başlatılamadı:", err);
        els.latencyBadge.textContent = "MediaPipe yok";
        // Without MediaPipe no model can run, so this must be the message left
        // standing, not a later "models ready".
        await liveModelsLoad;
        setMessage(
          "MediaPipe modeli yüklenemedi. İnternet bağlantısını kontrol edin (CDN'den indiriliyor).",
          "low",
        );
      }
    }
  } catch (error) {
    if (_cameraStartAttempt === attempt) _cameraStartAttempt = null;
    // Map standard browser media errors to actionable messages.
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

/**
 * Stop the camera and return the workspace to a resting state.
 *
 * Every track is stopped, MediaPipe is torn down, and any recording in flight
 * is abandoned: a stale countdown would otherwise block the next recording.
 * The motion buffers are cleared so the next session starts clean.
 *
 * @returns {void}
 */
function stopCamera() {
  _cameraStartAttempt = null;
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

  // Cancel any active recording flow. Leaving a stale countdown state would
  // prevent the next recording from starting.
  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  els.countdown.hidden = true;
  els.cameraStage.dataset.state = "idle";
  if (typeof resetSmoother === "function") resetSmoother();
  updateWordState();
  syncRecordButton();

  // Start the next camera session with empty temporal state.
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  _noHandSeconds = 0;
  _lastStatusTick = 0;
}

/**
 * Drive one animation frame: FPS, overlay, inference, status, debug.
 *
 * Letter inference is throttled to roughly every sixth frame, because the
 * letter model is fast enough to run far more often than the result changes.
 * Word contexts run every frame, since frames are what a recording collects.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
function renderLoop(now) {
  updateFps(now);
  drawOverlay();

  // live-inference.js reads the frame camera.js published; it no-ops until
  // MediaPipe has produced landmark data.
  if (state.cameraOn && typeof realInference === "function") {
    // Letter inference is intentionally throttled to roughly every sixth frame.
    if (state.mode === "letter") {
      if (now - state.lastTick > 120) {
        state.lastTick = now;
        realInference(now);
      }
    } else {
      realInference(now);
    }
  }

  // Refresh the waiting/latency status at most once per second.
  updateMediaPipeStatus(now);
  updateDebug();
  requestAnimationFrame(renderLoop);
}

// Status refresh throttle and the running count of hand-less seconds.
let _lastStatusTick = 0;
let _noHandSeconds = 0;

/**
 * Refresh the status badge at most once a second.
 *
 * After five seconds without a hand the message explains how to fix the
 * framing, rather than leaving the user watching an unchanging badge.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
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
    // Show a clear hint after five seconds without a detected hand.
    if (_noHandSeconds === 5) {
      setMessage(
        "Elinizi kameraya gösterin (50-80 cm uzaklık, iyi ışık, parmaklar açık).",
        "maybe",
      );
    }
  } else {
    if (_noHandSeconds > 0) {
      _noHandSeconds = 0;
      // Clear the waiting state when a hand returns.
      setMessage("El algılandı, tahminler başlıyor.", "good");
    }
    const which = [];
    if (r.rightHandLandmarks) which.push("R");
    if (r.leftHandLandmarks) which.push("L");
    els.latencyBadge.textContent = `✓ El: ${which.join("+")} · ${state.fps || "--"} fps`;
  }

  // Pose and face models load in the background; refresh readiness periodically.
  syncRecordButton();
}

/**
 * Count frames and publish a rate once per second.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
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

/**
 * Resize the overlay canvas to its box and draw the latest landmarks.
 *
 * The canvas is sized in device pixels and scaled back by the pixel ratio, so
 * the overlay stays sharp on a high-density display. Overlay drawing is
 * optional decoration: a failure here must not stop inference.
 *
 * This always draws the latest published MediaPipe result, so it needs no
 * timestamp: the two loops that call it run on different clocks and neither
 * one's reading was ever read here.
 *
 * @returns {void}
 */
function drawOverlay() {
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
      // Overlay rendering is optional; inference should continue if it fails.
    }
  }
}


/**
 * Step through the main modes, for the keyboard shortcut.
 *
 * @returns {void}
 */
function cycleMode() {
  const order = ["letter", "word", "coach", "project"];
  const next = order[(order.indexOf(state.mode) + 1) % order.length];
  setMode(next);
}

/**
 * Refresh the debug panel while it is open.
 *
 * @returns {void}
 */
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

/**
 * Wait until the video reports its dimensions, then start playback.
 *
 * The wait is capped, because a camera that never fires loadedmetadata would
 * otherwise hang startup. Autoplay rejection is logged and ignored: playback
 * often continues anyway.
 *
 * @param {HTMLVideoElement | null} videoEl
 * @returns {Promise<void>}
 */
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

init();

// Runtime diagnostics are available from the browser console via aslDebug.dump().
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
  // Read-only word-pipeline snapshots populated by live-inference.js.
  get wordDebug() {
    if (typeof window === "undefined") return null;
    return {
      lastRecording: window._lastWordDebug || null,
      currentFrame: window._lastWordCurrentFrame || null,
      // Current recording state remains useful before final inference.
      live: {
        wordState: state.wordState,
        wordFrames: state.wordFrames,
        expectedFrames: CONFIG.WORD_FRAME_COUNT,
        mode: state.mode,
      },
    };
  },
  // Read-only letter-pipeline snapshots populated during live inference.
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
