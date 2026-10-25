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
 * @property {boolean} [focus] When true, focus moves to the new screen's h1.
 *   Set for a change the visitor made, never for the first load: the control
 *   they pressed may now be hidden, and a screen reader starts the new
 *   screen at its heading.
 */

/**
 * Bring the app up, in the order the modules depend on.
 *
 * Preferences, coach options, and event bindings come first so the UI is
 * usable; the route is applied next and the render loop starts. Only then do
 * the reads that can be slow begin: a deep link must not show the wrong
 * screen, nor a started camera go unread, while a fetch is pending. The local
 * Model Test fixtures are not read here at all; that screen asks for them.
 *
 * No model loads here. A bare URL opens letter mode, but most visitors never
 * start the camera, so the models wait for their first real need: the camera
 * starting in a mode that runs one, a word recording, or a Model Test run.
 * The fixture manifest and the word guidance data are a few kilobytes and
 * load last; the guidance panel renders once its fetch has settled.
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

  // Nothing calls camera.js before the camera starts, so a page that could not
  // fetch it would start in silence and open a camera nothing tracks. It is
  // reported here rather than thrown, so the screens without a camera still work.
  if (typeof startMediaPipe !== "function") {
    reportStartupFailure(new Error("js/media/camera.js did not load"));
  }

  // The word lists wait for the card data too, so a word's gloss, once shown,
  // is there when they are built.
  await Promise.all([loadPublishedModelTestManifest(), loadGatingData(), wordReferenceLoad]);
  renderWordGuidancePanel();
}

/**
 * Which models a live camera mode runs.
 *
 * The coach runs the letter model, and the word model only while it is on
 * words: a letter session never downloads the word model, 1.8 MB it would
 * not use. Turning the coach to words with the camera on asks for it then.
 * The informational screens run none.
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
 * Load the models a task needs, the first time it needs them, and say so.
 *
 * Each model loads once however often it is asked for, so this returns at once
 * for a model that is already loaded and then leaves the status line alone.
 * Progress is reported only when a download is actually under way. Each model
 * is optional, so a half-loaded app still runs: the status line says which one
 * is missing rather than failing outright.
 *
 * While the camera is on, the badge reports the camera and MediaPipe, so model
 * progress goes to the message line alone. A load asked for while the camera
 * was on belongs to that camera session: if the camera has been stopped (or
 * restarted) by the time it settles, the outcome is not reported at all,
 * because the stop has already put the badge and the stage back to idle.
 *
 * @param {{letter?: boolean, word?: boolean}} needs
 * @returns {Promise<boolean>} True when every needed model is ready. Never rejects.
 */
async function loadModelsWithStatus(needs) {
  /** @param {string} key */
  const setBadge = (key) => {
    if (!state.cameraOn) setText(els.latencyBadge, key);
  };
  // The camera session this load belongs to, or null when the camera is off.
  const session = state.stream;
  const sessionEnded = () => session !== null && state.stream !== session;
  // Whether each model was already loaded is read before its load is asked
  // for, so a download that starts here is reported.
  /** @type {{name: string, loaded: boolean, ready: Promise<boolean>}[]} */
  const models = [];
  if (needs.letter) {
    models.push({ name: "shell.models.letter", loaded: !!letterSession, ready: ensureLetterModel() });
  }
  if (needs.word) {
    models.push({ name: "shell.models.word", loaded: !!wordSession, ready: ensureWordModel() });
  }
  const downloading = models.some((model) => !model.loaded);
  // A record press waiting on the word model, now or by the time it settles,
  // reports that model's outcome itself: its refusal (hand tracking not ready)
  // or its failure (try again) must not be overwritten by "Hazır" (ready) or
  // repeated.
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

/** Whether bindEvents() has already run; see the guard in bindEvents(). */
let _eventsBound = false;

/**
 * Wire every DOM listener.
 *
 * Bindings stay in one place on purpose. Spreading them across the feature
 * modules would make it impossible to see what the page reacts to.
 *
 * Calling it again is a no-op. Every binding adds a listener rather than
 * replacing one, so a second call would make every click fire twice, with
 * nothing at the call site to show it.
 *
 * @returns {void}
 */
function bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  queryAllUi("mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // On a phone the secondary screens sit in a popover menu, which would
      // otherwise stay open over the screen it just opened. It closes first:
      // a popover that closes with focus inside gives focus back to its
      // button, which would undo the move to the new screen's heading.
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

  // The skip link is handled here, not followed: #main is not a route, so
  // the hash change would fall back to letter mode and leave coach or word.
  document.getElementById("skipLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main")?.focus({ preventScroll: true });
  });

  // A button clicked with a mouse keeps focus, so the next Space would press
  // it again (another space after the "Boşluk" button) instead of adding the
  // current letter; such a click gives its focus up. A click from the
  // keyboard has detail 0 and keeps its focus, as a keyboard user expects.
  // So does a touch: iOS VoiceOver's double tap is one, and a blur there
  // sends VoiceOver back to the top of the page. The pointerType of the
  // pointerdown on the same button tells the two apart; a click with no such
  // press is blurred.
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

  // A hash change is the visitor's: a link, the address bar, the history.
  window.addEventListener("hashchange", () => {
    setMode(modeFromHash(window.location.hash), { syncHash: false, focus: true });
  });

  // The targets are radios: the arrow keys move between them and fire change,
  // which a click handler would miss.
  queryElements("[data-qr-target]").forEach((radio) => {
    radio.addEventListener("change", handleQrTargetChange);
  });
  els.qrCopyDemo?.addEventListener("click", copyQrDemoUrl);
  els.qrShare?.addEventListener("click", shareQrDemoUrl);

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.languageToggle?.addEventListener("click", toggleLanguage);

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
  // sits where the eye already is rather than in the action bar. A start
  // that fails hides them too, behind the camera problem, so a keyboard user
  // is taken to that problem's main action.
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
  // The problem's retry starts the camera the way the stage's own start does.
  els.cameraRetry?.addEventListener("click", async (event) => {
    await toggleCamera();
    afterCameraStart(event);
  });
  // The camera-free demo starts from the letter stage, the camera problem and
  // the project page, and plays on the letter screen. The button pressed is
  // hidden by then, so a keyboard press takes focus to the demo's panel, and
  // back to the stage's own start when the recording could not be loaded.
  // The demo's functions are read when pressed, not when bound: a page that
  // could not fetch the demo still binds everything else.
  const demoStarts = queryElements('[data-trigger="demo"]');
  demoStarts.forEach((button) => {
    button.addEventListener("click", async (event) => {
      const started = startDemo();
      if (event.detail === 0) els.demoPanel?.focus({ preventScroll: true });
      if ((await started) === "failed" && event.detail === 0) demoStarts[0]?.focus();
    });
  });
  // The demo's stop hides with it, so a keyboard user's focus goes to the
  // stage's camera start, which is back in view. Its end action is one of the
  // camera triggers above.
  els.demoStop?.addEventListener("click", (event) => {
    stopDemo();
    if (event.detail === 0) cameraStarts[0]?.focus();
  });
  els.demoSkip?.addEventListener("click", () => skipDemoLetter());
  els.recordWord?.addEventListener("click", startWordRecording);
  els.retryWord?.addEventListener("click", retryWordRecording);
  els.appendWordResult?.addEventListener("click", appendWordResultToTranscript);
  // The button disappears when the recording ends, so a keyboard user's focus
  // goes to the button that starts the next one.
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
  // After a coach success the next target comes up on its own; reaching for
  // the coach's buttons or leaving the page stays on the target instead.
  els.controlBar.addEventListener("focusin", () => stayOnCoachTarget());
  // A page in the background shows nobody the demo, so it stops rather than
  // play on unseen.
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
  // On a phone the study controls are a sheet: the session button opens it,
  // and its close button, a press outside it and Escape close it.
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
  // Read the model when the button is pressed, not when it is bound: the
  // visitor may have switched models since.
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
    // The listener is bound to the coach select, so the change event targets it.
    chooseCoachTarget(/** @type {HTMLSelectElement} */ (event.target).value);
  });

  window.addEventListener("keydown", (event) => {
    // A native popover closes on Escape by itself; the fallback menu does
    // here, and gives focus back to its button.
    if (event.key === "Escape" && closeFallbackMenu()) {
      event.preventDefault();
      return;
    }
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
    // The reference viewer is a modal dialog: its keys are its own.
    if (referenceViewerOpen()) return;
    // In the coach, Escape closes the phone's study sheet when it is open,
    // and otherwise only ever keeps the current target, which no focused
    // control would miss, so it works wherever focus is.
    if (state.mode === "coach" && event.key === "Escape") {
      if (isCoachSheetOpen()) setCoachSheet(false);
      else stayOnCoachTarget();
      return;
    }
    // Everything below is an unmodified key, which belongs to the focused
    // control whenever there is one that consumes typing. Word mode decides
    // that itself, because Escape cancels a recording whatever has focus.
    const fromControl = isEditableTarget(event.target);
    if (state.mode === "word") {
      handleWordKey(event, fromControl);
      return;
    }
    if (fromControl) return;
    // In the coach, Space takes what the coach offers next, as it takes the
    // letter on the letter screen; with nothing on offer it keeps its default
    // action. The coach has no other key.
    if (state.mode === "coach") {
      if (event.code === "Space" && coachPrimaryAction()) event.preventDefault();
      return;
    }
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
 * Whether the browser has the Popover API.
 *
 * Safari before 17 has neither the methods nor the ":popover-open"
 * selector, and rejects that selector with an exception, so it must not be
 * used where the methods are missing.
 *
 * @returns {boolean}
 */
function hasPopoverApi() {
  return typeof HTMLElement.prototype.showPopover === "function";
}

/**
 * The popover menu and its button, when the browser cannot open it.
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
 * Open or close the fallback menu. data-open drives its display, and the
 * button's aria-expanded says the same to a screen reader.
 *
 * @param {{menu: HTMLElement, button: HTMLElement}} parts
 * @param {boolean} open
 * @returns {void}
 */
function setFallbackMenuOpen({ menu, button }, open) {
  menu.dataset.open = String(open);
  button.setAttribute("aria-expanded", String(open));
}

/**
 * Let the "Diğer" (more) button open its menu in a browser without popovers.
 *
 * With the Popover API the browser does all of this from popovertarget, so
 * nothing is bound.
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
 * Close the fallback menu if it is open, and give focus back to its button.
 *
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
 * Close a popover menu, natively or through the fallback.
 *
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
  setMode("letter", { syncHash: false, focus: true });
}

/**
 * Show a theme everywhere it is read. After load, the only writer of the
 * theme.
 *
 * theme-boot.js already painted the root element before the stylesheets;
 * this repeats that and mirrors the theme onto the body and the shell, which
 * the legacy stylesheet still keys on, and onto the button's pressed state,
 * which is what a screen reader announces.
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
 * Apply the theme the visitor chose, else the system's.
 *
 * @returns {void}
 */
function restoreTheme() {
  const saved = savedTheme();
  applyTheme(saved ?? systemTheme(), saved ? "user" : "system");
}

/**
 * Follow the system switching between light and dark, until the visitor
 * chooses a theme.
 *
 * The choice is read from the root element rather than from storage, so a
 * choice made with storage blocked is kept for the rest of the visit too.
 * Safari before 14 hands out media query lists with addListener only, so the
 * method is looked up on the list itself.
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
 * Switch between light and dark, and remember the choice.
 *
 * @returns {void}
 */
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next, "user");
  try { localStorage.setItem("asl-theme", next); } catch (err) { /* storage blocked: the choice lasts this visit */ }
}

/**
 * Switch between Turkish and English, remember the choice, and say so.
 *
 * The button's own name changes with the language, which a screen reader
 * does not read out again, so the change is announced in the new language.
 *
 * @returns {void}
 */
function toggleLanguage() {
  setLanguage(currentLanguage() === "tr" ? "en" : "tr");
  announce(t("shell.language.changed"));
}

/**
 * Redraw the shell text that state decides, after a language change.
 *
 * The marked markup and the bound badges have been rewritten by then; what
 * is left is the document title, which follows the screen's heading, and
 * the camera indicator, written as plain text.
 *
 * @returns {void}
 */
function renderShellLanguage() {
  showScreenHeading(state.mode, false);
  els.cameraStatus.lastChild.textContent = t(state.cameraOn ? "shell.status.cameraOn" : "shell.status.ready");
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
  // Every route change ends the demo, the letter screen's own included: it
  // is the same release the camera gets on the information screens. Guarded,
  // so a page that could not fetch the demo still switches screens.
  if (typeof stopDemo === "function") stopDemo();
  const shell = els.appShell || queryUi("app-shell");
  if (shell) { shell.dataset.view = "app"; shell.dataset.mode = mode; }
  if (typeof resetSmoother === "function") resetSmoother();
  resetLetterLandmarkSmoother();
  resetCoachAttempt();
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
  // The page's figures come from the model card, read when the page opens.
  if (isProject) loadProjectModelCard();
  // The panel re-renders its fixture list when the read settles.
  if (isTest) loadLocalModelTestFixtures();
  if (isProject || isTest || isQr) {
    // These screens replace the camera workspace, so they release the camera
    // exactly as returning home does, and a camera problem is over: the
    // visitor has moved on, and the next camera start asks afresh.
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
    // Progress and the teaching data are read on the first visit; the coach
    // does not wait for the data.
    loadCoachProgress();
    loadCoachLetterData();
    updateCoachModeButtons();
    updateCoachFlowButtons();
    updateCoachPanel();
  }
  // Nothing has been seen on the new screen yet. The coach's target is shown
  // in the coach card, never on the plate, where it would read as detected.
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });

  updateWordState();
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
  showScreenHeading(state.mode, options.focus === true);

  // Entering a live mode with the camera already on is a first need for the
  // models it runs; with the camera off, starting it will be.
  if (state.cameraOn) loadModelsWithStatus(liveModelNeeds(state.mode));
}

/**
 * Name the screen in the document title, and move focus to its h1 if asked.
 *
 * The title is the screen's h1 and the app name, so a history entry, a tab
 * and a screen reader all say which screen it is.
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
 * The camera start still in progress, or null when none is.
 *
 * state.cameraOn turns true only once the stream arrives, so without this a
 * second Start would open a second stream and a stop during the permission
 * prompt would have nothing to stop. The start then still waits for the first
 * video frame and for hand tracking, and a stop can land in either wait too.
 * stopCamera() clears the token, which is how the start learns, after each
 * wait, that it was cancelled. Each start gets its own token, so a cancelled
 * start cannot take over a newer one.
 *
 * @type {object | null}
 */
let _cameraStartAttempt = null;

/**
 * The listener on the live stream's tracks for an end the app did not ask
 * for, or null while no stream is live.
 *
 * The browser ends a track on its own when the permission is revoked, the
 * camera is unplugged, or another app takes it. stopCamera() removes the
 * listener before it stops the tracks, so a stop of its own is never reported
 * as a lost camera.
 *
 * @type {(() => void) | null}
 */
let _cameraTrackEnded = null;

/**
 * Why the camera is not open, as the stage shows it.
 *
 * @typedef {"denied" | "system" | "busy" | "notfound" | "insecure" | "unsupported" | "failed" | "ended"} CameraProblemKind
 */

/**
 * The parameters of a camera problem's text. Only the insecure page names
 * something: the published address, from the one place it is kept, written
 * as a visitor would type it, without the trailing slash.
 *
 * @param {CameraProblemKind} kind
 * @returns {I18nParams | null}
 */
function cameraProblemParams(kind) {
  return kind === "insecure" ? { address: CONFIG.DEMO_PUBLIC_URL.replace(/\/+$/, "") } : null;
}

/**
 * Map a getUserMedia rejection to the problem the stage shows.
 *
 * Chrome on macOS and Windows says "Permission denied by system" when the
 * operating system, not the site setting, blocks the camera. The message is
 * only a hint; anything else with that name is a site refusal.
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
 * Which browser's steps to allow the camera fit this visitor, or null.
 *
 * Used only to put those steps first; every browser's stay in the list, so
 * a wrong guess costs a scroll, not the answer. iPadOS Safari reports a Mac,
 * so a Mac with a touch screen is taken for an iPad.
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
 * Show why the camera is not open, in place of the first-visit stage.
 *
 * The stage stays at rest (no video). Where retrying cannot help (an
 * insecure page, a browser without the API) only "Örneği izleyin" (watch the
 * camera-free demo) is offered; where there is no camera it comes first.
 * The cause is announced once, through the message line's report.
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
 * Put the first-visit stage back.
 *
 * @returns {void}
 */
function clearCameraProblem() {
  if (els.cameraProblem) els.cameraProblem.hidden = true;
  if (els.cameraIntro) els.cameraIntro.hidden = false;
  els.cameraStage.dataset.camera = state.cameraOn ? "on" : "off";
}

/**
 * Move focus to the camera problem's main action, if one is shown.
 *
 * Called after a keyboard press that failed to open the camera: the button
 * pressed sits in the first-visit content, which is now hidden.
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
 * Start or stop the camera.
 *
 * getUserMedia needs a secure context, so an insecure page is reported before
 * the permission prompt would fail. Standard media errors are mapped to
 * actionable Turkish messages. MediaPipe failing to start is not fatal: the
 * camera stays on and the status line explains what is missing. A track the
 * browser ends releases the camera as a stop does, and the user is told.
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
  // The camera and the demo never run together; the camera wins.
  if (typeof stopDemo === "function") stopDemo();

  // Camera APIs require HTTPS, except on localhost; a browser hides them on
  // an insecure page. A secure page without them is an old browser.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const insecure = window.isSecureContext === false;
    setText(els.latencyBadge, insecure ? "shell.badge.httpsRequired" : "shell.badge.cameraFailed");
    showCameraProblem(insecure ? "insecure" : "unsupported");
    return;
  }

  const attempt = {};
  _cameraStartAttempt = attempt;
  // stopCamera() ran during the last wait, so this start was cancelled.
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
    // Watched from here on, so a camera lost during the video wait also
    // cancels this start.
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

    // Starting the camera is the first need for the live models. They download
    // alongside MediaPipe rather than after it; neither needs the other.
    const liveModelsLoad = loadModelsWithStatus(liveModelNeeds(state.mode));

    if (typeof startMediaPipe === "function") {
      try {
        setText(els.latencyBadge, "shell.badge.trackingPreparing");
        await startMediaPipe(els.video);
        if (cancelled()) return;
        setText(els.latencyBadge, "shell.badge.trackingReady");
      } catch (err) {
        console.warn("MediaPipe failed to start:", err);
        // A camera stopped meanwhile has nothing left to track hands on.
        if (cancelled()) return;
        setText(els.latencyBadge, "shell.badge.trackingMissing");
        // Without MediaPipe no model can run, so this must be the message left
        // standing, not a later "models ready".
        await liveModelsLoad;
        if (cancelled()) return;
        reportProblem(() => t("shell.tracking.failed"));
      }
    }
  } catch (error) {
    // A start the user cancelled (home, an information screen) has nothing
    // left to report: the stop already put the camera area back to idle.
    if (cancelled()) {
      console.warn("A cancelled camera start failed:", error);
      return;
    }
    // The browser's own text is for the console; it is English and technical.
    setText(els.latencyBadge, "shell.badge.cameraFailed");
    showCameraProblem(cameraProblemKind(error));
    console.error("getUserMedia error:", error);
  } finally {
    if (_cameraStartAttempt === attempt) _cameraStartAttempt = null;
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
 * Whether the render loop runs inference on this frame.
 *
 * Letter contexts, letter mode and a coach target letter alike, run at most
 * once every 120 ms: the letter model is fast enough to run far more often
 * than the result changes, and the five-frame smoothing window is meant to
 * span about 600 ms of signing wherever a letter is read. Word contexts run
 * every frame, since frames are what a recording collects.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {boolean}
 */
function isInferenceDue(now) {
  return !isLetterContext() || now - state.lastTick > 120;
}

/**
 * Drive one animation frame: FPS, overlay, inference, status, debug.
 *
 * @param {number} now Animation frame timestamp in milliseconds.
 * @returns {void}
 */
function renderLoop(now) {
  updateFps(now);
  drawOverlay();
  // On a laptop, the result plate steps aside from a hand under it.
  if (typeof updatePlateSide === "function") updatePlateSide(now);

  // live-inference.js reads the frame camera.js or the demo published; it
  // no-ops until one has produced landmark data.
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
    // Which hand and the frame rate are developer readouts; the debug panel
    // has the frame rate.
    setText(els.latencyBadge, "shell.badge.handDetected");
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
 * It draws the latest published MediaPipe result, so it takes no timestamp;
 * its two callers, the render loop and the detection loop, run on different
 * clocks.
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

  if (!framesLive()) return;

  if (typeof drawLandmarks === "function" && typeof latestMediaPipeResult !== "undefined") {
    try {
      // The demo's recorded square has no video behind it to cover; it is
      // drawn in the room the demo's card and the plate leave on the stage.
      const frameRect = state.demo === "playing" ? demoFrameRect(cssWidth, cssHeight, rect) : null;
      drawLandmarks(ctx, latestMediaPipeResult, cssWidth, cssHeight, els.video, frameRect);
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
    els.debugLatency.textContent = "latency: --";
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
    console.warn("video.play() failed; autoplay may still start playback:", err?.message || err);
  }
}

/**
 * Tell the user the app could not start.
 *
 * Until init() has bound it, the page is static markup whose buttons look
 * ready and do nothing, so a failed start must not stay silent. The likely
 * causes are a script the page could not fetch, which leaves names init()
 * needs undefined, and an error thrown while starting. The elements are read
 * with getElementById rather than through the registry, because runtime.js,
 * which builds the registry, may be the script that failed.
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
      // Readable while a recording runs, before its final inference.
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
