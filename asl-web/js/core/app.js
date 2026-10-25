// Bootstrap and orchestration. Loads last; every other script only declares
// things, so startup side effects live here. js/README.md has the module map.

/**
 * @typedef {Object} SetModeOptions
 * @property {boolean} [syncHash] False when the change came from the hash itself.
 * @property {boolean} [focus] Move focus to the new screen's h1. Only for a
 *   visitor's change: the pressed control may now be hidden.
 */

/**
 * The route is applied before any slow read, so a deep link never shows the
 * wrong screen while a fetch is pending. No model loads here: most visitors
 * never start the camera.
 *
 * @returns {Promise<void>}
 */
async function init() {
  restoreTheme();
  watchSystemTheme();
  buildCoachOptions();
  buildCoachProgress();
  buildCoachGrid();
  bindEvents();
  restoreTranscript();
  loadReferenceVideoLinks();
  const wordReferenceLoad = loadWordReference();
  setMode(modeFromHash(window.location.hash), { syncHash: false });
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });

  requestAnimationFrame(renderLoop);

  // Nothing calls camera.js before the camera starts, so a missing file would
  // otherwise go unnoticed until then. Reported, not thrown: other screens still work.
  if (typeof startMediaPipe !== "function") {
    reportStartupFailure(new Error("js/media/camera.js did not load"));
  }

  // The word lists wait for the card data so a gloss is there when they are built.
  await Promise.all([loadPublishedModelTestManifest(), loadGatingData(), wordReferenceLoad]);
  renderWordGuidancePanel();
}

/**
 * A letter coach session never downloads the 1.8 MB word model it would not use.
 *
 * @param {AppMode} mode
 * @returns {{letter: boolean, word: boolean}}
 */
function liveModelNeeds(mode) {
  return {
    letter: mode === "letter" || mode === "coach",
    word: mode === "word" || (mode === "coach" && state.coachTargetType === "word"),
  };
}

/**
 * Each model is optional, so a half-loaded app still runs and the status line
 * names what is missing. A load started while the camera was on reports
 * nothing if that camera session has ended, because the stop already reset
 * the badge and the stage.
 *
 * @param {{letter?: boolean, word?: boolean}} needs
 * @returns {Promise<boolean>} True when every needed model is ready. Never rejects.
 */
async function loadModelsWithStatus(needs) {
  /** @param {string} key */
  const setBadge = (key) => {
    if (!state.cameraOn) setText(els.latencyBadge, key);
  };
  const session = state.stream;
  const sessionEnded = () => session !== null && state.stream !== session;
  // Read before the load is asked for, so a download that starts here is reported.
  /** @type {{name: string, loaded: boolean, ready: Promise<boolean>}[]} */
  const models = [];
  if (needs.letter) {
    models.push({ name: "shell.models.letter", loaded: !!letterSession, ready: ensureLetterModel() });
  }
  if (needs.word) {
    models.push({ name: "shell.models.word", loaded: !!wordSession, ready: ensureWordModel() });
  }
  const downloading = models.some((model) => !model.loaded);
  // A record press waiting on the word model reports its own outcome, which
  // must not be overwritten by "ready" or repeated.
  const pressesBefore = wordModelPresses;
  const pressWaiting = needs.word === true && _wordModelWait;
  if (downloading) {
    setMessage(() => t("shell.models.downloading"), "maybe");
    setBadge("shell.badge.preparing");
  }

  try {
    const results = await Promise.all(models.map((model) => model.ready));
    const allReady = results.every(Boolean);
    if (!downloading || sessionEnded()) return allReady;
    if (needs.word && (pressWaiting || wordModelPresses !== pressesBefore)) return allReady;

    const loaded = models.filter((_, i) => results[i]).map((model) => model.name);
    if (allReady) {
      setMessage(() => t("shell.models.ready"), "good");
      setBadge("shell.badge.ready");
    } else if (loaded.length) {
      reportProblem(() => t("shell.models.partial", { models: loaded.map((name) => t(name)).join(t("shell.models.and")) }));
      setBadge("shell.badge.partialDownload");
    } else {
      reportProblem(() => t("shell.models.failed"));
      setBadge("shell.badge.downloadFailed");
    }
    return allReady;
  } catch (err) {
    console.error("Model loading failed:", err);
    if (sessionEnded()) return false;
    reportProblem(() => t("shell.models.failed"));
    setBadge("shell.badge.error");
    return false;
  }
}

let _eventsBound = false;

/**
 * Calling it again is a no-op: every binding adds a listener, so a second
 * call would make every click fire twice.
 *
 * @returns {void}
 */
function bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  queryAllUi("mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Close the phone popover first: closing with focus inside returns focus
      // to its button and would undo the move to the new heading.
      const menu = tab.closest("[popover]");
      if (menu instanceof HTMLElement) closeMenu(menu);
      setMode(tab.dataset.mode, { focus: true });
    });
  });
  bindMenuFallback();

  queryElements("[data-go-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.goMode, { focus: true }));
  });

  // No preventDefault: the link's href moves the address to #letter.
  document.querySelector("[data-home-link]")?.addEventListener("click", showHome);

  // Handled, not followed: #main is not a route and would fall back to letter mode.
  document.getElementById("skipLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main")?.focus({ preventScroll: true });
  });

  // A mouse click gives up focus, so the next Space adds a letter instead of
  // pressing the button again. Keyboard clicks (detail 0) and touches keep it:
  // a blur after a VoiceOver double tap sends VoiceOver to the top of the page.
  /** @type {{button: HTMLElement, pointerType: string} | null} */
  let lastPress = null;
  window.addEventListener("pointerdown", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("button") : null;
    lastPress = button instanceof HTMLElement ? { button, pointerType: event.pointerType } : null;
  });
  window.addEventListener("click", (event) => {
    const press = lastPress;
    lastPress = null;
    if (event.detail === 0 || !(event.target instanceof HTMLElement)) return;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLElement)) return;
    if (press && press.button === button && press.pointerType !== "mouse" && press.pointerType !== "pen") return;
    button.blur();
  });

  window.addEventListener("hashchange", () => {
    setMode(modeFromHash(window.location.hash), { syncHash: false, focus: true });
  });

  // Radios: the arrow keys fire change, which a click handler would miss.
  queryElements("[data-qr-target]").forEach((radio) => {
    radio.addEventListener("change", handleQrTargetChange);
  });
  els.qrCopyDemo?.addEventListener("click", copyQrDemoUrl);
  els.qrShare?.addEventListener("click", shareQrDemoUrl);

  els.themeToggle?.addEventListener("click", toggleTheme);
  queryElements("[data-language]", els.languageSwitch ?? undefined).forEach((option) => {
    option.addEventListener("click", () => chooseLanguage(option.dataset.language ?? ""));
  });
  renderLanguageSwitch();

  // The pressed start or stop control hides, so a keyboard press (detail 0)
  // moves focus to the control now visible; a pointer leaves focus alone.
  const cameraStarts = queryElements('[data-trigger="camera"]');
  els.cameraToggle?.addEventListener("click", async (event) => {
    await toggleCamera();
    if (event?.detail === 0 && !state.cameraOn) cameraStarts[0]?.focus();
  });
  // A failed start hides the stage's buttons behind the camera problem, so
  // keyboard focus goes to that problem's main action.
  /** @param {{detail?: number} | undefined} event */
  const afterCameraStart = (event) => {
    if (event?.detail !== 0) return;
    if (state.cameraOn) els.cameraToggle?.focus();
    else focusCameraProblem();
  };
  cameraStarts.forEach((button) => {
    button.addEventListener("click", async (event) => {
      await toggleCamera();
      afterCameraStart(event);
    });
  });
  els.cameraRetry?.addEventListener("click", async (event) => {
    await toggleCamera();
    afterCameraStart(event);
  });
  // The pressed button is hidden once the demo plays, so keyboard focus goes
  // to the demo panel, or back to the stage's start if loading failed. The
  // demo functions are read on press, so a page without demo-source.js still binds.
  const demoStarts = queryElements('[data-trigger="demo"]');
  demoStarts.forEach((button) => {
    button.addEventListener("click", async (event) => {
      const started = startDemo();
      if (event.detail === 0) els.demoPanel?.focus({ preventScroll: true });
      if ((await started) === "failed" && event.detail === 0) demoStarts[0]?.focus();
    });
  });
  // The stop hides with the demo, so keyboard focus goes to the camera start.
  els.demoStop?.addEventListener("click", (event) => {
    stopDemo();
    if (event.detail === 0) cameraStarts[0]?.focus();
  });
  els.demoSkip?.addEventListener("click", () => skipDemoLetter());
  els.recordWord?.addEventListener("click", startWordRecording);
  els.retryWord?.addEventListener("click", retryWordRecording);
  els.appendWordResult?.addEventListener("click", appendWordResultToTranscript);
  // The button disappears when the recording ends.
  els.cancelWord?.addEventListener("click", (event) => {
    cancelWordRecording();
    if (event.detail === 0) els.recordWord?.focus();
  });
  els.coachCheck?.addEventListener("click", checkCoachTarget);
  els.coachNextTarget?.addEventListener("click", nextCoachTarget);
  els.coachHintButton?.addEventListener("click", showCoachHint);
  els.coachNext?.addEventListener("click", coachPrimaryAction);
  els.coachRepeat?.addEventListener("click", repeatCoachTarget);
  els.coachStay?.addEventListener("click", stayOnCoachTarget);
  els.coachReset?.addEventListener("click", resetCoachProgress);
  els.speakText?.addEventListener("click", speakTranscript);
  els.clearText?.addEventListener("click", clearTranscript);
  els.copyText.addEventListener("click", copyTranscript);
  els.toggleReference.addEventListener("click", toggleReference);
  els.wordLibrarySearch?.addEventListener("input", filterWordLibrary);
  bindReferenceLightbox();

  els.manualAddLetter?.addEventListener("click", appendCurrentLetter);
  document.querySelector('[data-trigger="add-letter"]')?.addEventListener("click", appendCurrentLetter);
  els.insertSpace?.addEventListener("click", insertSpaceInTranscript);
  document.querySelector('[data-trigger="space"]')?.addEventListener("click", insertSpaceInTranscript);
  els.removeLastChar?.addEventListener("click", removeLastTranscriptChar);
  // Reaching for the coach's buttons stays on the target instead of auto-advancing.
  els.controlBar.addEventListener("focusin", () => stayOnCoachTarget());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    stayOnCoachTarget();
    if (typeof stopDemo === "function") stopDemo();
  });
  els.coachLettersOnly?.addEventListener("click", () => setCoachTargetType("letter"));
  els.coachWordsOnly?.addEventListener("click", () => setCoachTargetType("word"));
  queryElements("[data-coach-flow]").forEach((button) => {
    button.addEventListener("click", () => setCoachFlow(button.dataset.coachFlow));
  });
  els.coachFlowGroup?.addEventListener("keydown", moveCoachRadio);
  els.coachContentGroup?.addEventListener("keydown", moveCoachRadio);
  els.coachSessionButton?.addEventListener("click", () => setCoachSheet(!isCoachSheetOpen()));
  els.coachSheetClose?.addEventListener("click", () => setCoachSheet(false));
  document.addEventListener("click", (event) => {
    if (!isCoachSheetOpen() || !(event.target instanceof Node)) return;
    if (els.coachStudy.contains(event.target) || els.coachSessionButton?.contains(event.target)) return;
    setCoachSheet(false);
  });
  queryElements("[data-model-test-task]").forEach((button) => {
    button.addEventListener("click", () => setModelTestTask(button.dataset.modelTestTask));
  });
  els.loadDemoLetter?.addEventListener("click", () => loadAndRunPreferredModelTestSample("letter"));
  els.loadDemoWord?.addEventListener("click", () => loadAndRunPreferredModelTestSample("word"));
  els.loadSelectedModelTestSample?.addEventListener("click", loadSelectedModelTestSample);
  els.modelTestSampleFile?.addEventListener("change", handleModelTestSampleFile);
  els.runModelTestSample?.addEventListener("click", runModelTestSample);
  // Read on press: the visitor may have switched models since binding.
  els.runModelTestBatch?.addEventListener("click", () => runModelTestBatch(state.modelTestTask));
  els.modelTestDropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.modelTestDropZone.classList.add("is-dragging");
  });
  els.modelTestDropZone?.addEventListener("dragleave", () => {
    els.modelTestDropZone.classList.remove("is-dragging");
  });
  els.modelTestDropZone?.addEventListener("drop", handleModelTestSampleDrop);

  els.coachTarget.addEventListener("change", (event) => {
    chooseCoachTarget(/** @type {HTMLSelectElement} */ (event.target).value);
  });

  window.addEventListener("keydown", (event) => {
    // A native popover closes on Escape by itself; the fallback menu does here.
    if (event.key === "Escape" && closeFallbackMenu()) {
      event.preventDefault();
      return;
    }
    // Ctrl-modified, so it never collides with typing.
    if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      state.debug = !state.debug;
      els.debugPanel.hidden = !state.debug;
      return;
    }
    // Other modified keys belong to the browser (Cmd+Backspace, Alt+Enter).
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // The reference viewer is a modal dialog: its keys are its own.
    if (referenceViewerOpen()) return;
    // In the coach, Escape closes the phone sheet or keeps the current target.
    if (state.mode === "coach" && event.key === "Escape") {
      if (isCoachSheetOpen()) setCoachSheet(false);
      else stayOnCoachTarget();
      return;
    }
    // Unmodified keys belong to a focused control that consumes typing. Word
    // mode decides itself, because Escape cancels a recording whatever has focus.
    const fromControl = isEditableTarget(event.target);
    if (state.mode === "word") {
      handleWordKey(event, fromControl);
      return;
    }
    if (fromControl) return;
    // In the coach, Space takes what the coach offers next, if anything.
    if (state.mode === "coach") {
      if (event.code === "Space" && coachPrimaryAction()) event.preventDefault();
      return;
    }
    // No single-letter shortcuts: one that clears the text or leaves the
    // screen, with no way to turn it off, fails WCAG 2.1.4.
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
 * Safari before 17 lacks the methods and throws on the ":popover-open"
 * selector, so the selector is used only where the methods exist.
 *
 * @returns {boolean}
 */
function hasPopoverApi() {
  return typeof HTMLElement.prototype.showPopover === "function";
}

/**
 * The menu and its button when the browser has no Popover API.
 *
 * @returns {{menu: HTMLElement, button: HTMLElement} | null}
 */
function fallbackMenu() {
  if (hasPopoverApi()) return null;
  const button = queryElement("[popovertarget]");
  const menu = button ? document.getElementById(button.getAttribute("popovertarget") || "") : null;
  return button && menu instanceof HTMLElement ? { menu, button } : null;
}

/**
 * @param {{menu: HTMLElement, button: HTMLElement}} parts
 * @param {boolean} open
 * @returns {void}
 */
function setFallbackMenuOpen({ menu, button }, open) {
  menu.dataset.open = String(open);
  button.setAttribute("aria-expanded", String(open));
}

/**
 * With the Popover API the browser handles popovertarget, so nothing is bound.
 *
 * @returns {void}
 */
function bindMenuFallback() {
  const parts = fallbackMenu();
  if (!parts) return;
  parts.button.setAttribute("aria-controls", parts.menu.id);
  setFallbackMenuOpen(parts, false);
  parts.button.addEventListener("click", () => {
    setFallbackMenuOpen(parts, parts.menu.dataset.open !== "true");
  });
}

/**
 * @returns {boolean} Whether a menu was closed.
 */
function closeFallbackMenu() {
  const parts = fallbackMenu();
  if (!parts || parts.menu.dataset.open !== "true") return false;
  setFallbackMenuOpen(parts, false);
  parts.button.focus();
  return true;
}

/**
 * @param {HTMLElement} menu
 * @returns {void}
 */
function closeMenu(menu) {
  if (hasPopoverApi()) {
    if (menu.matches(":popover-open")) menu.hidePopover();
    return;
  }
  const parts = fallbackMenu();
  if (parts && parts.menu === menu) setFallbackMenuOpen(parts, false);
}

/**
 * The brand link opens the letter screen with the camera released: hiding
 * the workspace alone would leave the stream and the inference loop running.
 *
 * @returns {void}
 */
function showHome() {
  if ((state.cameraOn || _cameraStartAttempt) && typeof stopCamera === "function") {
    stopCamera();
  }
  // The brand link's own href updates the address.
  setMode("letter", { syncHash: false, focus: true });
}

/**
 * After load, the only writer of the theme. theme-boot.js painted the root
 * before the stylesheets; aria-pressed is what a screen reader announces.
 *
 * @param {ThemeName} theme
 * @param {"user" | "system"} source Whether the visitor chose it.
 * @returns {void}
 */
function applyTheme(theme, source) {
  paintTheme(theme, source);
  document.body.dataset.theme = theme;
  if (els.appShell) els.appShell.dataset.theme = theme;
  els.themeToggle?.setAttribute("aria-pressed", String(theme === "dark"));
}

/**
 * @returns {void}
 */
function restoreTheme() {
  const saved = savedTheme();
  applyTheme(saved ?? systemTheme(), saved ? "user" : "system");
}

/**
 * The choice is read from the root element, not storage, so a choice made with
 * storage blocked holds for the visit. Safari before 14 has only addListener.
 *
 * @returns {void}
 */
function watchSystemTheme() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  /** @param {{matches: boolean}} event */
  const follow = (event) => {
    if (document.documentElement.dataset.themeSource === "user") return;
    applyTheme(event.matches ? "dark" : "light", "system");
  };
  if (typeof query.addEventListener === "function") query.addEventListener("change", follow);
  else if (typeof query.addListener === "function") query.addListener(follow);
}

/**
 * @returns {void}
 */
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next, "user");
  try { localStorage.setItem("asl-theme", next); } catch (err) { /* storage blocked: the choice lasts this visit */ }
}

/**
 * A screen reader does not notice the page changing language, so the change
 * is announced in the new one.
 *
 * @param {string} language
 * @returns {void}
 */
function chooseLanguage(language) {
  const changed = language !== currentLanguage();
  setLanguage(/** @type {Language} */ (language));
  if (changed && currentLanguage() === language) announce(t("shell.language.changed"));
}

/**
 * Mark the language shown as pressed in the switch.
 *
 * @returns {void}
 */
function renderLanguageSwitch() {
  queryElements("[data-language]", els.languageSwitch ?? undefined).forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.language === currentLanguage()));
  });
}

/**
 * The shell text that state decides: the document title, the camera
 * indicator and the language switch. The marked markup and the bound badges
 * are rewritten already.
 *
 * @returns {void}
 */
function renderShellLanguage() {
  showScreenHeading(state.mode, false);
  renderLanguageSwitch();
  els.cameraStatus.lastChild.textContent = t(state.cameraOn ? "shell.status.cameraOn" : "shell.status.ready");
}

/**
 * Unknown input opens letter mode, so a stale link never shows a blank screen.
 *
 * @param {unknown} hash Typically window.location.hash.
 * @returns {AppMode}
 */
function modeFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  // Array.includes cannot narrow a string to the union.
  return /** @type {AppMode} */ (
    ["letter", "coach", "word", "project", "test", "qr"].includes(raw) ? raw : "letter"
  );
}

/**
 * Temporal state and recording buffers are cleared first, so nothing leaks
 * across the change.
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
  // Every route change ends the demo. Guarded: the page still switches screens
  // if demo-source.js did not load.
  if (typeof stopDemo === "function") stopDemo();
  const shell = els.appShell || queryUi("app-shell");
  if (shell) { shell.dataset.view = "app"; shell.dataset.mode = mode; }
  if (typeof resetSmoother === "function") resetSmoother();
  resetLetterLandmarkSmoother();
  resetCoachAttempt();
  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;

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
  if (isProject) loadProjectModelCard();
  if (isTest) loadLocalModelTestFixtures();
  if (isProject || isTest || isQr) {
    // These screens release the camera as returning home does, and end any
    // camera problem: the next start asks afresh.
    if (state.cameraOn || _cameraStartAttempt) stopCamera();
    clearCameraProblem();
    clearFeedback();
    syncActionBar();
    showScreenHeading(state.mode, options.focus === true);
    return;
  }

  setText(els.modeBadge, `shell.modeBadge.${mode}`);
  setText(els.resultKind, `shell.resultKind.${mode}`);
  els.wordStateCard.dataset.hidden = mode === "letter" ? "true" : "false";
  els.coachStudy.dataset.hidden = mode === "coach" ? "false" : "true";
  if (mode !== "coach" && isCoachSheetOpen()) setCoachSheet(false);
  els.controlBar.dataset.count = mode === "letter" ? "3" : "4";
  clearFeedback();

  if (mode === "coach") {
    // The coach does not wait for its data.
    loadCoachProgress();
    loadCoachLetterData();
    updateCoachModeButtons();
    updateCoachFlowButtons();
    updateCoachPanel();
  }
  // The coach's target never goes on the plate, where it would read as detected.
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });

  updateWordState();
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
  showScreenHeading(state.mode, options.focus === true);

  if (state.cameraOn) loadModelsWithStatus(liveModelNeeds(state.mode));
}

/**
 * The title names the screen for history entries, tabs and screen readers.
 *
 * @param {AppMode} mode
 * @param {boolean} moveFocus
 * @returns {void}
 */
function showScreenHeading(mode, moveFocus) {
  const heading = document.querySelector(`[data-screen-title="${mode}"]`);
  if (!(heading instanceof HTMLElement)) return;
  document.title = `${heading.textContent.trim()} · ASL Assistant`;
  if (moveFocus) heading.focus({ preventScroll: true });
}

/**
 * The camera start in progress, or null. state.cameraOn turns true only when
 * the stream arrives, so this stops a second start and lets a stop during the
 * permission prompt or the first-frame wait cancel it. Each start gets its own
 * token, so a cancelled start cannot take over a newer one.
 *
 * @type {object | null}
 */
let _cameraStartAttempt = null;

/**
 * Listener for a track end the app did not ask for (permission revoked, camera
 * unplugged or taken). stopCamera() removes it first, so its own stop is not
 * reported as a lost camera.
 *
 * @type {(() => void) | null}
 */
let _cameraTrackEnded = null;

/**
 * @typedef {"denied" | "system" | "busy" | "notfound" | "insecure" | "unsupported" | "failed" | "ended"} CameraProblemKind
 */

/**
 * Only the insecure page names something: the published address, without the
 * trailing slash.
 *
 * @param {CameraProblemKind} kind
 * @returns {I18nParams | null}
 */
function cameraProblemParams(kind) {
  return kind === "insecure" ? { address: CONFIG.DEMO_PUBLIC_URL.replace(/\/+$/, "") } : null;
}

/**
 * Chrome on macOS and Windows says "Permission denied by system" when the
 * operating system, not the site setting, blocks the camera.
 *
 * @param {unknown} error
 * @returns {CameraProblemKind}
 */
function cameraProblemKind(error) {
  const name = isRecord(error) ? String(error.name || "") : "";
  const message = isRecord(error) ? String(error.message || "") : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return /system/i.test(message) ? "system" : "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "notfound";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    case "SecurityError":
      return "insecure";
    default:
      // OverconstrainedError and anything unforeseen.
      return "failed";
  }
}

/**
 * Only reorders the steps, so a wrong guess costs a scroll. iPadOS Safari
 * reports a Mac, so a Mac with a touch screen is taken for an iPad.
 *
 * @returns {string | null} A data-browser value of #cameraHelpSteps.
 */
function cameraHelpBrowser() {
  const nav = /** @type {{userAgent?: string, maxTouchPoints?: number, userAgentData?: {platform?: string}}} */ (
    /** @type {unknown} */ (navigator)
  );
  const ua = String(nav.userAgent || "");
  const platform = String(nav.userAgentData?.platform || "");
  const iPadAsMac = /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) return /CriOS/.test(ua) ? "ios-chrome" : "ios-safari";
  if (/Android/i.test(ua) || /Android/i.test(platform)) return "android-chrome";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\/|Edg\//.test(ua)) return "desktop-chrome";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "mac-safari";
  return null;
}

/**
 * Where retrying cannot help (insecure page, no camera API) only the demo is
 * offered; with no camera found it comes first.
 *
 * @param {CameraProblemKind} kind
 * @returns {void}
 */
function showCameraProblem(kind) {
  const params = cameraProblemParams(kind);
  els.cameraStage.dataset.camera = kind;
  els.cameraEmpty.hidden = false;
  if (els.cameraIntro) els.cameraIntro.hidden = true;
  if (els.cameraProblem) els.cameraProblem.hidden = false;
  // Bound to their keys, so a language change rewrites them in place.
  setText(els.cameraProblemTitle, `shell.cameraProblem.${kind}.title`, params);
  setText(els.cameraProblemText, `shell.cameraProblem.${kind}.text`, params);

  const retry = els.cameraRetry;
  const without = els.cameraNoCamera;
  if (retry && without) {
    const canRetry = kind !== "insecure" && kind !== "unsupported";
    const withoutFirst = !canRetry || kind === "notfound";
    retry.hidden = !canRetry;
    retry.classList.toggle("btn--stage-primary", !withoutFirst);
    retry.classList.toggle("btn--stage", withoutFirst);
    without.classList.toggle("btn--stage-primary", withoutFirst);
    without.classList.toggle("btn--stage", !withoutFirst);
    // Visual order is focus order: the main action comes first.
    retry.parentElement?.replaceChildren(...(withoutFirst ? [without, retry] : [retry, without]));
  }

  const steps = els.cameraHelpSteps;
  const first = cameraHelpBrowser();
  if (steps && first) {
    const items = Array.from(steps.children);
    const chosen = items.find((item) => item instanceof HTMLElement && item.dataset.browser === first);
    if (chosen) steps.replaceChildren(chosen, ...items.filter((item) => item !== chosen));
  }

  reportProblem(() => `${t(`shell.cameraProblem.${kind}.title`)}. ${t(`shell.cameraProblem.${kind}.text`, params)}`);
}

/**
 * @returns {void}
 */
function clearCameraProblem() {
  if (els.cameraProblem) els.cameraProblem.hidden = true;
  if (els.cameraIntro) els.cameraIntro.hidden = false;
  els.cameraStage.dataset.camera = state.cameraOn ? "on" : "off";
}

/**
 * After a failed keyboard start: the pressed button is now hidden.
 *
 * @returns {void}
 */
function focusCameraProblem() {
  if (!els.cameraProblem || els.cameraProblem.hidden) return;
  const main = els.cameraRetry && !els.cameraRetry.hidden && els.cameraRetry.classList.contains("btn--stage-primary")
    ? els.cameraRetry
    : els.cameraNoCamera;
  main?.focus();
}

/**
 * getUserMedia needs a secure context, so an insecure page is reported before
 * the prompt would fail. A MediaPipe failure is not fatal: the camera stays
 * on and the status line says what is missing.
 *
 * @returns {Promise<void>} Resolves after reporting any failure to the user.
 */
async function toggleCamera() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }
  if (_cameraStartAttempt) return;
  // The camera and the demo never run together; the camera wins.
  if (typeof stopDemo === "function") stopDemo();

  // Browsers hide the camera API on an insecure page; a secure page without
  // it is an old browser.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const insecure = window.isSecureContext === false;
    setText(els.latencyBadge, insecure ? "shell.badge.httpsRequired" : "shell.badge.cameraFailed");
    showCameraProblem(insecure ? "insecure" : "unsupported");
    return;
  }

  const attempt = {};
  _cameraStartAttempt = attempt;
  const cancelled = () => _cameraStartAttempt !== attempt;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (cancelled()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.stream = stream;
    state.cameraOn = true;
    els.video.srcObject = stream;
    // Watched from here on, so a camera lost during the video wait also cancels.
    const onTrackEnded = () => {
      stopCamera();
      showCameraProblem("ended");
    };
    stream.getTracks().forEach((track) => track.addEventListener("ended", onTrackEnded));
    _cameraTrackEnded = onTrackEnded;
    await waitForVideoReady(els.video);
    // The stream is now state.stream, so the stop already released it.
    if (cancelled()) return;
    clearCameraProblem();
    els.cameraEmpty.hidden = true;
    els.cameraStage.dataset.camera = "on";
    syncActionBar();
    els.cameraStatus.classList.add("is-live");
    els.cameraStatus.lastChild.textContent = t("shell.status.cameraOn");
    setText(els.latencyBadge, "shell.badge.cameraOn");

    // The models download alongside MediaPipe; neither needs the other.
    const liveModelsLoad = loadModelsWithStatus(liveModelNeeds(state.mode));

    if (typeof startMediaPipe === "function") {
      try {
        setText(els.latencyBadge, "shell.badge.trackingPreparing");
        await startMediaPipe(els.video);
        if (cancelled()) return;
        setText(els.latencyBadge, "shell.badge.trackingReady");
      } catch (err) {
        console.warn("MediaPipe failed to start:", err);
        if (cancelled()) return;
        setText(els.latencyBadge, "shell.badge.trackingMissing");
        // This must be the message left standing, not a later "models ready".
        await liveModelsLoad;
        if (cancelled()) return;
        reportProblem(() => t("shell.tracking.failed"));
      }
    }
  } catch (error) {
    // A cancelled start has nothing to report: the stop already reset the stage.
    if (cancelled()) {
      console.warn("A cancelled camera start failed:", error);
      return;
    }
    // The browser's own text is English and technical, so it stays in the console.
    setText(els.latencyBadge, "shell.badge.cameraFailed");
    showCameraProblem(cameraProblemKind(error));
    console.error("getUserMedia error:", error);
  } finally {
    if (_cameraStartAttempt === attempt) _cameraStartAttempt = null;
  }
}

/**
 * Any recording in flight is abandoned, or a stale countdown would block the next one.
 *
 * @returns {void}
 */
function stopCamera() {
  _cameraStartAttempt = null;
  const onTrackEnded = _cameraTrackEnded;
  _cameraTrackEnded = null;
  state.stream?.getTracks().forEach((track) => {
    if (onTrackEnded) track.removeEventListener("ended", onTrackEnded);
    track.stop();
  });
  state.stream = null;
  state.cameraOn = false;
  els.video.srcObject = null;
  els.cameraEmpty.hidden = false;
  clearCameraProblem();
  syncActionBar();
  els.cameraStatus.classList.remove("is-live");
  els.cameraStatus.lastChild.textContent = t("shell.status.ready");
  els.fpsLabel.textContent = "-- fps";
  setText(els.latencyBadge, "shell.badge.ready");

  if (typeof stopMediaPipe === "function") {
    try { stopMediaPipe(); } catch (e) { /* noop */ }
  }

  state.wordState = "IDLE";
  state.wordFrames = 0;
  state.wordQualityWarnings = [];
  state.wordResultAssessment = null;
  els.countdown.hidden = true;
  els.cameraStage.dataset.state = "idle";
  if (typeof resetSmoother === "function") resetSmoother();
  resetLetterLandmarkSmoother();
  resetCoachAttempt();
  updateWordState();
  syncRecordButton();

  frameBuffer = [];
  normalizedFrameBuffer = [];
  previousFrame = null;
  _noHandSeconds = 0;
  _lastStatusTick = 0;
}

/**
 * Letter contexts run at most every 120 ms, so the five-frame smoothing window
 * spans about 600 ms of signing. Word contexts run every frame, since frames
 * are what a recording collects.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {boolean}
 */
function isInferenceDue(now) {
  return !isLetterContext() || now - state.lastTick > 120;
}

/**
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
function renderLoop(now) {
  updateFps(now);
  drawOverlay();
  if (typeof updatePlateSide === "function") updatePlateSide(now);

  if (framesLive() && typeof realInference === "function" && isInferenceDue(now)) {
    // Only a letter tick moves the throttle, so the first letter frame after a
    // word context runs at once.
    if (isLetterContext()) state.lastTick = now;
    realInference(now);
  }

  updateMediaPipeStatus(now);
  updateDebug();
  requestAnimationFrame(renderLoop);
}

let _lastStatusTick = 0;
let _noHandSeconds = 0;

/**
 * After five seconds without a hand the message explains the framing.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
function updateMediaPipeStatus(now) {
  if (!state.cameraOn) return;
  if (now - _lastStatusTick < 1000) return;
  _lastStatusTick = now;

  if (typeof latestMediaPipeResult === "undefined" || !latestMediaPipeResult) {
    setText(els.latencyBadge, "shell.badge.preparing");
    return;
  }
  const r = latestMediaPipeResult;
  const hasHand = !!(r.rightHandLandmarks || r.leftHandLandmarks);
  if (!hasHand) {
    _noHandSeconds++;
    setText(els.latencyBadge, "shell.badge.searching");
    if (_noHandSeconds === 5) setMessage(() => t("shell.hand.missing"), "maybe");
  } else {
    if (_noHandSeconds > 0) {
      _noHandSeconds = 0;
      setMessage(() => t("shell.hand.detected"), "good");
    }
    setText(els.latencyBadge, "shell.badge.handDetected");
  }

  // Pose and face models load in the background, so readiness is refreshed here.
  syncRecordButton();
}

/**
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

// True while the overlay canvas holds a drawing.
let _overlayDrawn = false;

/**
 * Sized in device pixels so the overlay stays sharp on high-density displays.
 * Drawing is decoration: a failure must not stop inference. It takes no
 * timestamp because its callers run on different clocks.
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
    // Resizing empties the bitmap.
    _overlayDrawn = false;
  }

  // Clearing an empty canvas still makes the browser composite a new frame,
  // so an idle stage is cleared once and then left alone.
  const live = framesLive();
  if (!live && !_overlayDrawn) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  _overlayDrawn = live;

  if (!live) return;

  if (typeof drawLandmarks === "function" && typeof latestMediaPipeResult !== "undefined") {
    try {
      // The demo has no video behind it; its square is drawn in the free room on the stage.
      const frameRect = state.demo === "playing" ? demoFrameRect(cssWidth, cssHeight, rect) : null;
      drawLandmarks(ctx, latestMediaPipeResult, cssWidth, cssHeight, els.video, frameRect);
    } catch (err) {
      // Overlay drawing is optional; inference continues.
    }
  }
}


/**
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
    els.debugLatency.textContent = "latency: --";
  }
}

/**
 * The wait is capped, because a camera that never fires loadedmetadata would
 * hang startup. An autoplay rejection is ignored: playback often starts anyway.
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
    console.warn("video.play() failed; autoplay may still start playback:", err?.message || err);
  }
}

/**
 * Until init() binds them the buttons look ready and do nothing, so a failed
 * start must not stay silent. Uses getElementById because runtime.js, which
 * builds the registry, may be the script that failed.
 *
 * @param {unknown} error
 * @returns {void}
 */
function reportStartupFailure(error) {
  console.error("The app failed to start:", error);
  // The strings may be what failed to load, so the Turkish stands by, named
  // as Turkish and shown even if the page was still waiting to be translated.
  const translated = typeof t === "function" && t("shell.startupFailed");
  if (!translated) document.documentElement.setAttribute("lang", "tr");
  document.documentElement.removeAttribute("data-i18n-pending");
  const text =
    translated || "Uygulama başlatılamadı. Sayfayı yenileyin; sorun sürerse bağlantınızı kontrol edin.";
  const notice = document.getElementById("startupError");
  if (notice) {
    notice.textContent = text;
    notice.hidden = false;
  }
  const announcer = document.getElementById("announcer");
  if (announcer) announcer.textContent = text;
}

init().catch(reportStartupFailure);

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
  get wordDebug() {
    if (typeof window === "undefined") return null;
    return {
      lastRecording: window._lastWordDebug || null,
      currentFrame: window._lastWordCurrentFrame || null,
      live: {
        wordState: state.wordState,
        wordFrames: state.wordFrames,
        expectedFrames: CONFIG.WORD_FRAME_COUNT,
        mode: state.mode,
      },
    };
  },
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
    console.log("ASL Assistant debug dump");
    console.log("state:", { mode: state.mode, cameraOn: state.cameraOn, wordState: state.wordState, frameCount: state.frameCount, fps: state.fps });
    console.log("models:", this.models);
    console.log("mediapipe:", this.mediapipe);
    console.log("buffers:", this.buffers);
    console.log("letterDebug:", this.letterDebug);
    console.log("wordDebug:", this.wordDebug);
    console.log("latestResult:", this.latestResult);
  },
};
