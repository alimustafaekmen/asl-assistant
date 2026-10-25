// A word result is appended only after the user accepts it. Storage failures
// are ignored so the app still works in private windows.

/**
 * @typedef {Object} TranscriptAppendOptions
 * @property {string} [debounceKey] A held key or a double click appends once.
 * @property {boolean} [skipIfDuplicate]
 */

/**
 * @returns {void}
 */
function appendCurrentLetter() {
  if (state.mode !== "letter") return;
  if (!state.prediction || state.prediction === "?" || state.prediction.length !== 1) return;
  if (state.confidence < CONFIG.LETTER_THRESHOLD) return;
  if (appendTranscriptToken(state.prediction, { debounceKey: `letter:${state.prediction}` })) {
    announce(t("letter.transcript.letterAdded", { letter: state.prediction }));
    // The demo advances only once the user has added the letter it shows.
    if (typeof noteDemoLetterAdded === "function") noteDemoLetterAdded(state.prediction);
  }
}

// This, not the debounce, limits a word result to one append: a second press
// after the debounce window would pass it.
let wordResultAccepted = false;

/**
 * The only path from a word prediction to the transcript.
 *
 * @returns {void}
 */
function appendWordResultToTranscript() {
  // The accept button's rule, checked again for callers that bypass the button.
  if (state.mode !== "word" || state.wordState !== "RESULT") return;
  if (!wordResultIsCurrent() || wordResultAccepted) return;
  if (!state.prediction || state.prediction === "?" || state.prediction.length <= 1) return;
  if (state.confidence < CONFIG.WORD_ACCEPT_THRESHOLD) return;
  const word = state.prediction;
  const token = `${word} `;
  const appended = appendTranscriptToken(token, { debounceKey: `word:${word}` });
  wordResultAccepted = true;
  syncActionBar();
  // A press the debounce swallowed repeats one already confirmed.
  if (!appended) return;
  showToast(() => t("letter.transcript.wordAdded", { word }), {
    returnFocus: els.recordWord,
    action: {
      label: () => t("letter.toast.undo"),
      // Only while the word still ends the text, so later typing is kept.
      // The result stays accepted: undo never offers the same consent twice.
      run: () => {
        if (!state.transcript.endsWith(token)) return;
        state.transcript = state.transcript.slice(0, -token.length);
        saveTranscript();
        renderTranscript();
        announce(t("letter.transcript.wordRemoved", { word }));
      },
    },
  });
}

/**
 * @param {string} token Letter, or a word with its trailing space.
 * @param {TranscriptAppendOptions} [options]
 * @returns {boolean} False when skipped, so no confirmation claims it.
 */
function appendTranscriptToken(token, options = {}) {
  if (!token) return false;
  if (options.debounceKey) {
    const now = performance.now();
    if (state.lastTranscriptAppendKey === options.debounceKey && now - state.lastTranscriptAppendTs < 250) {
      return false;
    }
    state.lastTranscriptAppendKey = options.debounceKey;
    state.lastTranscriptAppendTs = now;
  }
  if (options.skipIfDuplicate && state.transcript.endsWith(token)) return false;
  state.transcript += token;
  saveTranscript();
  renderTranscript();
  return true;
}

/**
 * @returns {void}
 */
function insertSpaceInTranscript() {
  const clean = state.transcript.replace(/\s+$/g, "");
  state.transcript = clean ? `${clean} ` : "";
  saveTranscript();
  renderTranscript();
}

/** @returns {void} */
function removeLastTranscriptChar() {
  state.transcript = state.transcript.slice(0, -1);
  saveTranscript();
  renderTranscript();
}

/**
 * @returns {void}
 */
function renderTranscript() {
  const text = state.transcript.trim();
  els.transcriptText.dataset.empty = text ? "false" : "true";
  // Fingerspelled text is English; the placeholder is in the interface's
  // language, so the script owns the line's lang from here on.
  els.transcriptText.removeAttribute("data-i18n-lang");
  els.transcriptText.lang = text ? "en" : currentLanguage();
  els.transcriptText.innerHTML = `${escapeHtml(text || t("letter.transcript.placeholder"))}<span class="cursor" aria-hidden="true">|</span>`;
  // Keep the newest letter in view; the start fades once scrolled off.
  const strip = els.transcriptText;
  strip.scrollLeft = text ? strip.scrollWidth || 0 : 0;
  strip.dataset.overflow = text && strip.scrollLeft > 0 ? "start" : "none";
}

// A second clear replaces the toast; without this its undo would restore only
// the second part.
let _clearedPendingUndo = "";

/**
 * @returns {void}
 */
function clearTranscript() {
  const cleared = state.transcript;
  state.transcript = "";
  saveTranscript();
  renderTranscript();
  if (!cleared.trim()) return;
  const restorable = _clearedPendingUndo + cleared;
  showToast(() => t("letter.transcript.cleared"), {
    returnFocus: els.clearText,
    // Also runs for the toast this one replaces, hence the assignment after
    // showToast().
    onEnd: () => {
      _clearedPendingUndo = "";
    },
    action: {
      label: () => t("letter.toast.undo"),
      // Anything typed since the clear stays, after the restored text.
      run: () => {
        state.transcript = restorable + state.transcript;
        saveTranscript();
        renderTranscript();
        announce(t("letter.transcript.restored"));
      },
    },
  });
  _clearedPendingUndo = restorable;
}

/**
 * @returns {void}
 */
function saveTranscript() {
  try {
    localStorage.setItem("asl-web-transcript", state.transcript);
  } catch (err) {
    console.warn("Could not save the transcript:", err?.message || err);
  }
}

/**
 * @returns {void}
 */
function restoreTranscript() {
  try {
    state.transcript = localStorage.getItem("asl-web-transcript") || "";
  } catch (err) {
    console.warn("Could not read the stored transcript:", err?.message || err);
    state.transcript = "";
  }
  renderTranscript();
}

/**
 * Confirms in a toast: the status loop rewrites the status chip every second.
 *
 * @returns {Promise<void>}
 */
async function copyTranscript() {
  const text = state.transcript.trim();
  if (!text) {
    showToast(() => t("letter.transcript.nothingToCopy"));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(() => t("letter.transcript.copied"));
  } catch {
    showToast(() => t("letter.transcript.copyFailed"));
  }
}

/**
 * @returns {void}
 */
function speakTranscript() {
  // "?" is the plate's "nothing detected", not a letter to read aloud.
  const letter = state.prediction === "?" ? "" : state.prediction;
  const text = state.transcript.trim() || letter;
  if (!text) {
    showToast(() => t("letter.transcript.nothingToSpeak"));
    return;
  }
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
