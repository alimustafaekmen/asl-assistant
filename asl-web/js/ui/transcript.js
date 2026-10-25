// Transcript editing, persistence, clipboard, and speech output.
//
// Letters are appended one character at a time; word results are appended with
// a trailing space, and only after the user accepts them. Nothing here appends
// a prediction on its own.
//
// The transcript is mirrored into localStorage under "asl-web-transcript" so a
// reload does not lose it. Storage failures are logged and ignored, because the
// app must keep working in private windows and with storage blocked.

/**
 * Options for one transcript append.
 *
 * @typedef {Object} TranscriptAppendOptions
 * @property {string} [debounceKey] Suppresses a repeat of the same key within
 *   250 ms, so a held key or a double click appends once.
 * @property {boolean} [skipIfDuplicate] Skips the append when the transcript
 *   already ends with this token.
 */

/**
 * Append the current letter prediction, if it is confident enough. Letter
 * mode only; a word goes through appendWordResultToTranscript().
 *
 * @returns {void}
 */
function appendCurrentLetter() {
  if (state.mode !== "letter") return;
  if (!state.prediction || state.prediction === "?" || state.prediction.length !== 1) return;
  if (state.confidence < CONFIG.LETTER_THRESHOLD) return;
  if (appendTranscriptToken(state.prediction, { debounceKey: `letter:${state.prediction}` })) {
    announce(t("letter.transcript.letterAdded", { letter: state.prediction }));
    // The demo moves to its next letter only when the user has added the
    // one it shows.
    if (typeof noteDemoLetterAdded === "function") noteDemoLetterAdded(state.prediction);
  }
}

/**
 * Whether the word result on screen has already been accepted; a new
 * recording clears it. This, not the 250 ms debounce, limits each result to
 * one append: a second press after the debounce window would pass it.
 */
let wordResultAccepted = false;

/**
 * Append the current word result after the user accepted it.
 *
 * The only path from a word prediction to the transcript. One accept appends
 * once; the accept action stays disabled until a new recording produces a
 * new result.
 *
 * @returns {void}
 */
function appendWordResultToTranscript() {
  // The accept button's rule, checked again so a caller that bypasses the
  // button cannot append what it refuses: a word-mode result, finished, from
  // the latest recording.
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
      // Removes the added word only while it is still the end of the text, so
      // anything typed since is left alone. The result stays accepted: undo
      // never offers the same consent twice.
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
 * Append one token and persist the transcript.
 *
 * @param {string} token Letter, or a word with its trailing space.
 * @param {TranscriptAppendOptions} [options]
 * @returns {boolean} Whether the token was appended; the debounce and the
 *   duplicate check can each skip it, and a confirmation must not claim it.
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
 * End the current word with a single trailing space.
 *
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
 * Redraw the transcript, escaping it before it reaches innerHTML.
 *
 * @returns {void}
 */
function renderTranscript() {
  const text = state.transcript.trim();
  // Lets the stylesheet set the placeholder apart from real text.
  els.transcriptText.dataset.empty = text ? "false" : "true";
  // Fingerspelled text is English letters; the placeholder is in the
  // interface's language. The caret is decoration, not a character to read
  // out. The script owns the line's language from here on, not the markup.
  els.transcriptText.removeAttribute("data-i18n-lang");
  els.transcriptText.lang = text ? "en" : currentLanguage();
  els.transcriptText.innerHTML = `${escapeHtml(text || t("letter.transcript.placeholder"))}<span class="cursor" aria-hidden="true">|</span>`;
  // One scrolling line: the end, with the newest letter and the caret, stays
  // in view and the start fades once scrolled off. A screen reader still
  // gets the whole text.
  const strip = els.transcriptText;
  strip.scrollLeft = text ? strip.scrollWidth || 0 : 0;
  strip.dataset.overflow = text && strip.scrollLeft > 0 ? "start" : "none";
}

/**
 * Text cleared while its undo is still offered, oldest first. A second clear
 * replaces the toast, and without this its undo would restore only the
 * second part.
 */
let _clearedPendingUndo = "";

/**
 * Clear the transcript and its stored copy, and offer to undo it.
 *
 * Clears made while an earlier undo is offered add up, so one "Geri al"
 * restores everything, in order. The undo ends with its toast.
 *
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
    // Also runs for the toast this one replaces, which is why the pending
    // text is set again after showToast().
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
 * Mirror the transcript into localStorage; a failure is logged and ignored.
 *
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
 * Restore the stored transcript, or start empty when storage is unavailable.
 *
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
 * Copy the transcript to the clipboard and confirm it in a toast, not in the
 * camera status chip, which the status loop rewrites every second.
 *
 * @returns {Promise<void>} Resolves whether or not the copy succeeded.
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
 * Speak the transcript, or the current prediction when it is empty.
 *
 * Does nothing where speech synthesis is unavailable.
 *
 * @returns {void}
 */
function speakTranscript() {
  const text = state.transcript.trim() || state.prediction;
  if (!text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

/**
 * Escape text for interpolation into innerHTML.
 *
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
