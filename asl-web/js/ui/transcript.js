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
 * Append the current letter prediction, if it is confident enough.
 *
 * Only letter mode appends automatically; a word needs an explicit accept.
 *
 * @returns {void}
 */
function appendCurrentLetter() {
  if (state.mode !== "letter") return;
  if (!state.prediction || state.prediction === "?" || state.prediction.length !== 1) return;
  if (state.confidence < CONFIG.LETTER_THRESHOLD) return;
  if (appendTranscriptToken(state.prediction, { debounceKey: `letter:${state.prediction}` })) {
    announce(`${state.prediction} eklendi`);
  }
}

/**
 * Whether the word result on screen has already been accepted. Starting a new
 * recording clears it, so each result is appended at most once: the debounce
 * alone let a second press a moment later append the same word again.
 */
let wordResultAccepted = false;

/**
 * Append the current word result after the user accepted it.
 *
 * This is the only path from a word prediction to the transcript; nothing
 * appends a word on its own. One accept appends once; the accept action stays
 * disabled until a new recording produces a new result.
 *
 * @returns {void}
 */
function appendWordResultToTranscript() {
  // The same rule as the accept button, checked here as well, because a
  // handler reached another way must not append what the button refuses: a
  // word from word mode, from a finished recording, and from the latest one.
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
  showToast(`“${word}” metne eklendi`, {
    returnFocus: els.recordWord,
    action: {
      label: "Geri al",
      // Takes out exactly the word that was added, and only while it is still
      // the last thing in the text: anything typed since is left alone. The
      // result stays accepted, so undo never offers the same consent twice.
      run: () => {
        if (!state.transcript.endsWith(token)) return;
        state.transcript = state.transcript.slice(0, -token.length);
        saveTranscript();
        renderTranscript();
        announce(`${word} metinden çıkarıldı`);
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

/**
 * Delete the last character.
 *
 * @returns {void}
 */
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
  // The placeholder is styled apart from real text, so the strip says which it is.
  els.transcriptText.dataset.empty = text ? "false" : "true";
  // Fingerspelled text is English letters; the placeholder is Turkish. The
  // caret is decoration, not a character to read out.
  els.transcriptText.lang = text ? "en" : "tr";
  els.transcriptText.innerHTML = `${escapeHtml(text || "Metin burada görünür")}<span class="cursor" aria-hidden="true">|</span>`;
  // One line that scrolls: the end, where the newest letter and the caret
  // are, stays in view, and the start fades out once it is scrolled off.
  // A screen reader still gets the whole text.
  const strip = els.transcriptText;
  strip.scrollLeft = text ? strip.scrollWidth || 0 : 0;
  strip.dataset.overflow = text && strip.scrollLeft > 0 ? "start" : "none";
}

/**
 * Text cleared while its undo is still offered, oldest first. A second clear
 * in that time replaces the toast; without this, its undo would bring back
 * only the second part and the first would be lost for good.
 */
let _clearedPendingUndo = "";

/**
 * Clear the transcript and its stored copy, and offer to undo it.
 *
 * While an earlier clear's undo is still offered, the clears add up, so one
 * "Geri al" restores everything cleared, in order. The undo ends with its
 * toast.
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
  showToast("Metin temizlendi", {
    returnFocus: els.clearText,
    // Also runs for the toast this one replaces, which is why the pending
    // text is set again after showToast().
    onEnd: () => {
      _clearedPendingUndo = "";
    },
    action: {
      label: "Geri al",
      // Anything typed since the clear stays, after the restored text.
      run: () => {
        state.transcript = restorable + state.transcript;
        saveTranscript();
        renderTranscript();
        announce("Metin geri alındı");
      },
    },
  });
  _clearedPendingUndo = restorable;
}

/**
 * Mirror the transcript into localStorage.
 *
 * A storage failure is logged and ignored, because the app must keep working in
 * a private window and with storage blocked.
 *
 * @returns {void}
 */
function saveTranscript() {
  try {
    localStorage.setItem("asl-web-transcript", state.transcript);
  } catch (err) {
    console.warn("Transcript kaydedilemedi:", err?.message || err);
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
    console.warn("Transcript okunamadı:", err?.message || err);
    state.transcript = "";
  }
  renderTranscript();
}

/**
 * Copy the transcript to the clipboard and confirm it in a toast.
 *
 * The camera status chip is no place for this: the status loop rewrites it
 * every second while the camera runs.
 *
 * @returns {Promise<void>} Resolves whether or not the copy succeeded.
 */
async function copyTranscript() {
  const text = state.transcript.trim();
  if (!text) {
    showToast("Kopyalanacak metin yok");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Metin kopyalandı");
  } catch {
    showToast("Kopyalanamadı. Metni seçip elle kopyalayabilirsiniz.");
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
