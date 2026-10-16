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
    setMessage("Modeller indiriliyor…", "maybe");
    setBadge("Hazırlanıyor");
  }

  try {
    const results = await Promise.all(models.map((model) => model.ready));
    const allReady = results.every(Boolean);
    if (!downloading) return allReady;

    const status = models.filter((_, i) => results[i]).map((model) => model.label.toLocaleLowerCase("tr"));
    if (allReady) {
      setMessage("Hazır. Elinizi kameraya gösterin.", "good");
      setBadge("Hazır");
    } else if (status.length) {
      reportProblem(
        `Yalnızca ${status.join(" ve ")} modeli indirilebildi. Bağlantınızı kontrol edip sayfayı yenileyin.`,
      );
      setBadge("Eksik yükleme");
    } else {
      reportProblem("Model indirilemedi. Bağlantınızı kontrol edip sayfayı yenileyin.");
      setBadge("Model indirilemedi");
    }
    return allReady;
  } catch (err) {
    console.error("Model yükleme hatası:", err);
    reportProblem("Model indirilemedi. Bağlantınızı kontrol edip sayfayı yenileyin.");
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
    tab.addEventListener("click", () => {
      setMode(tab.dataset.mode);
      // On a phone the secondary screens sit in a popover menu, which would
      // otherwise stay open over the screen it just opened.
      const menu = tab.closest("[popover]");
      if (menu instanceof HTMLElement && menu.matches(":popover-open")) {
        menu.hidePopover();
      }
    });
  });

  queryElements("[data-go-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.goMode));
  });

  // No preventDefault: the link's href moves the address to #letter.
  document.querySelector("[data-home-link]")?.addEventListener("click", showHome);

  // A button clicked with a pointer keeps focus, so the next Space would press
  // it again (another space after Boşluk) instead of adding the current
  // letter. A click from the keyboard has detail 0 and keeps its focus, as a
  // keyboard user expects.
  window.addEventListener("click", (event) => {
    if (event.detail === 0 || !(event.target instanceof HTMLElement)) return;
    const button = event.target.closest("button");
    if (button instanceof HTMLElement) button.blur();
  });

  window.addEventListener("hashchange", () => {
    setMode(modeFromHash(window.location.hash), { syncHash: false });
  });

  queryElements("[data-qr-target]").forEach((button) => {
    button.addEventListener("click", () => setQrTarget(button.dataset.qrTarget));
  });
  els.qrCopyDemo?.addEventListener("click", copyQrDemoUrl);

  els.themeToggle?.addEventListener("click", toggleTheme);

  // The start buttons sit in the empty camera stage, which hides once the
  // camera is on, and the stop button hides once it is off. After a keyboard
  // press (detail 0) focus moves to the control that is now visible, instead
  // of falling to the page; a pointer leaves focus alone.
  const cameraStarts = queryElements('[data-trigger="camera"]');
  els.cameraToggle?.addEventListener("click", async (event) => {
    await toggleCamera();
    if (event?.detail === 0 && !state.cameraOn) cameraStarts[0]?.focus();
  });
  // The empty camera stage offers its own start buttons, so the first action
  // sits where the eye already is rather than in the action bar.
  cameraStarts.forEach((button) => {
    button.addEventListener("click", async (event) => {
      await toggleCamera();
      if (event?.detail === 0 && state.cameraOn) els.cameraToggle?.focus();
    });
  });
  queryElements('[data-trigger="coach-start"]').forEach((button) => {
    button.addEventListener("click", startCoachStudy);
  });
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
    // Any other modified key belongs to the browser: Cmd+Backspace and
    // Alt+Enter are editing and system keys, not transcript commands.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Everything below is an unmodified key, which belongs to the focused
    // control whenever there is one that consumes typing.
    if (isEditableTarget(event.target)) return;
    // The transcript keys act in letter mode only, where the transcript is
    // what the user is building. The on-screen buttons call the same
    // functions instead of simulating a key event. There are deliberately no
    // single-letter keys: one that clears the text or leaves the screen, with
    // no way to turn it off, fails WCAG 2.1.4.
    if (state.mode !== "letter") return;
    if (event.code === "Space") {
      event.preventDefault();
      appendCurrentLetter();
    } else if (event.key === "Enter") {
      event.preventDefault();
      insertSpaceInTranscript();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      removeLastTranscriptChar();
    }
  });
}

/**
 * Go "home": the letter screen with the camera released.
 *
 * There is no separate home view. The letter screen's empty camera stage is
 * where the app explains itself, so the brand link opens that screen.
 * Stopping the camera is the point: hiding the workspace alone would leave
 * the stream and the inference loop running, which is wrong for both privacy
 * and battery.
 *
 * @returns {void}
 */
function showHome() {
  if ((state.cameraOn || _cameraStartAttempt) && typeof stopCamera === "function") {
    stopCamera();
  }
  // The brand link's own href (#letter) updates the address, so the switch
  // here leaves the history alone.
  setMode("letter", { syncHash: false });
}

/**
 * Apply the theme: the one the user chose, else the system's preference, else
 * the authored default.
 *
 * @returns {void}
 */
function restoreTheme() {
  if (!els.appShell) return;
  /** @type {string | null} */
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("asl-theme");
  } catch (err) {
    // Storage can be unavailable or blocked; the preference still applies.
  }
  const theme =
    savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : els.appShell.dataset.theme || "light";
  els.appShell.dataset.theme = theme;
  document.body.dataset.theme = theme;
  els.themeToggle?.setAttribute("aria-pressed", String(theme === "dark"));
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
  els.themeToggle?.setAttribute("aria-pressed", String(next === "dark"));
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
    const isCurrent = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", isCurrent);
    // The class only paints the tab; a screen reader needs the attribute.
    if (isCurrent) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
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
    reportProblem("Bu tarayıcı kameraya erişemiyor. Siteyi https adresinden ya da güncel bir tarayıcıda açın.");
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
    els.cameraStatus.lastChild.textContent = "Kamera açık";
    els.latencyBadge.textContent = "Kamera açık";

    // Starting the camera is the first need for the live models. They download
    // alongside MediaPipe rather than after it; neither needs the other.
    const liveModelsLoad = loadModelsWithStatus(liveModelNeeds(state.mode));

    if (typeof startMediaPipe === "function") {
      try {
        els.latencyBadge.textContent = "El izleme hazırlanıyor";
        await startMediaPipe(els.video);
        els.latencyBadge.textContent = "El izleme hazır";
      } catch (err) {
        console.warn("MediaPipe başlatılamadı:", err);
        els.latencyBadge.textContent = "El izleme yok";
        // Without MediaPipe no model can run, so this must be the message left
        // standing, not a later "models ready".
        await liveModelsLoad;
        reportProblem("El izleme bileşeni indirilemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
      }
    }
  } catch (error) {
    if (_cameraStartAttempt === attempt) _cameraStartAttempt = null;
    // Map standard browser media errors to actionable messages.
    let msg = "Kamera açılamadı.";
    switch (error?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        msg = "Kamera izni verilmedi. Tarayıcının site ayarlarından kameraya izin verip yeniden deneyin.";
        break;
      case "NotFoundError":
      case "DevicesNotFoundError":
        msg = "Kamera bulunamadı. Bu cihazda kullanılabilir bir kamera yok; Kamerasız dene ile devam edebilirsiniz.";
        break;
      case "NotReadableError":
      case "TrackStartError":
        msg = "Kamera başka bir uygulamada açık. O uygulamayı kapatıp yeniden deneyin.";
        break;
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        msg = "Kamera bu ayarlarla açılamadı. Sayfayı yenileyip yeniden deneyin.";
        break;
      case "SecurityError":
        msg = "Tarayıcı kamerayı engelliyor. Siteyi https adresinden açın.";
        break;
      default:
        // The browser's own text is for the console; it is English and technical.
        msg = "Kamera açılamadı. Sayfayı yenileyip yeniden deneyin.";
    }
    els.latencyBadge.textContent = "Kamera açılamadı";
    reportProblem(msg);
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
    els.latencyBadge.textContent = "Hazırlanıyor";
    return;
  }
  const r = latestMediaPipeResult;
  const hasHand = !!(r.rightHandLandmarks || r.leftHandLandmarks);
  if (!hasHand) {
    _noHandSeconds++;
    els.latencyBadge.textContent = "El aranıyor";
    // Show a clear hint after five seconds without a detected hand.
    if (_noHandSeconds === 5) {
      setMessage(
        "El görünmüyor. Kol boyu uzaklıkta, iyi ışıkta, eliniz kadrajın ortasında olsun.",
        "maybe",
      );
    }
  } else {
    if (_noHandSeconds > 0) {
      _noHandSeconds = 0;
      // Clear the waiting state when a hand returns.
      setMessage("El algılandı.", "good");
    }
    // Which hand and the frame rate are developer readouts; the debug panel
    // has the frame rate.
    els.latencyBadge.textContent = "El algılandı";
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
