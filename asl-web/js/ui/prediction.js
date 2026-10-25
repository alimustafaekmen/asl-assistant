// Prediction presentation: the primary result, top-3 list, status message,
// feedback bar, and the word result guide.
//
// Display only: model output is parsed, smoothed and thresholded elsewhere,
// and this file turns the values in state into text and CSS state. Letter and
// word contexts each use their own thresholds from config.js.
//
// The word result guide says whether a result looks usable; appending it to
// the transcript stays an explicit user action.

/**
 * Confidence band for the current result, resolved against the thresholds of
 * the active letter or word context. Drives the ring colour and the message.
 *
 * @typedef {"low" | "maybe" | "good"} ConfidenceLevel
 */

/**
 * Feedback bar style. Live inference sends "confusion" and "hard" for model
 * guidance and "low" for a recording quality warning; the transcript sends
 * "good" after an accepted word. Each value has a matching CSS modifier.
 *
 * @typedef {"confusion" | "hard" | "low" | "good"} FeedbackKind
 */

/**
 * Text for the interface that is either written once or redrawn in the
 * current language. A function is called again after a language change, so
 * what it writes follows the switch; a string stays as it was written.
 *
 * @typedef {string | (() => string)} UiText
 */

/**
 * @param {UiText} text
 * @returns {string} The text as it reads now.
 */
function uiText(text) {
  return typeof text === "function" ? text() : text;
}

/**
 * A whole percentage as the current language writes it: "%90" in Turkish,
 * "90%" in English.
 *
 * @param {number} value A whole percentage, not a fraction.
 * @returns {string}
 */
function percentText(value) {
  return t("letter.plate.percent", { n: value });
}

/**
 * The user's wording of each recording quality warning; the technical reasons
 * stay in the debug snapshot (window._lastWordDebug). Each is looked up when
 * it is read, so it is in the language shown at that moment.
 *
 * @type {Record<WordQualityCode, string>}
 */
const WORD_QUALITY_COPY = {
  get pose() { return t("letter.wordQuality.pose"); },
  get face() { return t("letter.wordQuality.face"); },
  get hand() { return t("letter.wordQuality.hand"); },
  get "few-frames"() { return t("letter.wordQuality.fewFrames"); },
  get slow() { return t("letter.wordQuality.slow"); },
  get still() { return t("letter.wordQuality.still"); },
};

/**
 * Show one model result: primary label, confidence ring, decision, top-3,
 * message, and word result guide.
 *
 * The single place a new result enters the UI; everything downstream reads
 * it from state.
 *
 * @param {PredictionResult} prediction
 * @returns {void}
 */
function updatePrediction(prediction) {
  state.prediction = prediction.label;
  state.confidence = prediction.confidence;
  state.top3 = prediction.alternatives?.length ? prediction.alternatives : [];

  const pct = Math.round(state.confidence * 100);
  els.primaryPrediction.textContent = prediction.label;
  // A word needs a smaller face and a wider plate than a single letter.
  els.cameraStage.dataset.kind = prediction.label.length > 1 && prediction.label !== "?" ? "word" : "letter";

  // The coach judges a target letter by its hold, not by how sure the model
  // is of whatever letter it sees: a confident wrong letter must not paint
  // the stage, and with it the landmark overlay, as a success.
  if (state.mode === "coach" && isLetterContext()) {
    renderCoachPlate();
    renderTop3();
    renderWordResultGuide();
    syncActionBar();
    return;
  }

  els.confidenceRing.style.setProperty("--score", String(pct));

  const level = getConfidenceLevel(state.confidence);
  els.confidenceRing.className = `confidence-ring ${level}`;
  els.cameraStage.dataset.state = state.wordState === "RECORDING" ? "recording" : level;

  renderPlateLevel();
  renderTop3();
  updateMessageForPrediction();
  renderWordResultGuide();
  syncActionBar();
  // Only the word reference follows the prediction; the letter chart does
  // not, so letter frames skip this.
  if (state.mode === "word") updateReferenceForMode();
}

/**
 * Write the plate's percentage and its short decision for the result in
 * state. Not called in the coach's letter context, whose plate the coach
 * writes.
 *
 * @returns {void}
 */
function renderPlateLevel() {
  const pct = Math.round(state.confidence * 100);
  if (pct) {
    setText(els.confidenceText, "letter.plate.percent", { n: pct });
  } else {
    els.confidenceText.removeAttribute("data-i18n");
    els.confidenceText.textContent = "--";
  }

  const th = _thresholdsForMode();
  // Uncertainty comes before a close call: a word too weak to accept is not
  // a choice between two usable words, whatever the runner-up scored.
  let decision = "sure";
  if (state.prediction === "?") {
    decision = "waiting";
  } else if (state.confidence < th.unknown) {
    decision = "unsure";
  } else if (isWordLikeMode() && getTopMargin() < 0.03 && state.top3.length > 1) {
    decision = "close";
  } else if (state.confidence < th.confident) {
    decision = "likely";
  }
  setText(els.decisionLabel, `letter.plate.decision.${decision}`);
}

/**
 * Rebuild the ranked alternatives list from state.
 *
 * @returns {void}
 */
function renderTop3() {
  els.top3List.innerHTML = "";
  if (!state.top3.length) {
    // A sentence, because a placeholder row such as "1. - %0" reads as a result.
    const hint = document.createElement("p");
    hint.className = "top3-empty";
    setText(hint, "letter.ranked.empty");
    els.top3List.appendChild(hint);
    return;
  }
  state.top3.forEach((item, index) => {
    const pct = clampPercent(item.confidence * 100);
    const row = document.createElement("div");
    row.className = "top3-row";

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${index + 1}.`;

    const label = document.createElement("b");
    label.title = item.label;
    label.textContent = item.label;

    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const confidence = document.createElement("span");
    setText(confidence, "letter.plate.percent", { n: pct });

    row.append(rank, label, bar, confidence);
    els.top3List.appendChild(row);
  });
}

/**
 * Write the status line for the current result.
 *
 * The 50-class word model gives a low top-1 confidence even when it is right,
 * so a word message lists the likeliest words and flags a close top two
 * instead of treating a low number as failure.
 *
 * @returns {void}
 */
function updateMessageForPrediction() {
  if (state.prediction === "?") {
    setMessage(() => t("letter.plate.idle"), "low");
    return;
  }

  if (isWordLikeMode() && state.top3.length) {
    // This result's candidates, kept for a redraw in another language.
    const top = state.top3.slice();
    if (state.confidence < CONFIG.WORD_UNKNOWN_THRESHOLD) {
      setMessage(() => t("letter.plate.wordUnsure", { top: formatTopPredictions(top) }), "low");
      return;
    }
    if (getTopMargin() < 0.03 && state.top3.length > 1) {
      setMessage(() => t("letter.plate.wordClose", { top: formatTopPredictions(top) }), "maybe");
      return;
    }
    setMessage(() => t("letter.plate.wordLikely", { top: formatTopPredictions(top) }), getConfidenceLevel(state.confidence));
    return;
  }

  const th = _thresholdsForMode();
  if (state.confidence < th.unknown) {
    setMessage(() => t("letter.plate.letterUnsure"), "low");
    return;
  }

  const letter = state.prediction;
  if (state.confidence < th.confident) {
    setMessage(() => t("letter.plate.letterLikely", { letter }), "maybe");
    return;
  }

  setMessage(() => t("letter.plate.letterClear", { letter }), "good");
}

/**
 * @returns {boolean} True in word mode and for a multi-character coach target,
 *   which share the word thresholds and messaging.
 */
function isWordLikeMode() {
  return state.mode === "word" || _isCoachWordTarget();
}

/**
 * @returns {number} Gap between the top two confidences, or 1 when there is no
 *   second candidate to compare against.
 */
function getTopMargin() {
  if (!state.top3 || state.top3.length < 2) return 1;
  return Math.max(0, (state.top3[0].confidence || 0) - (state.top3[1].confidence || 0));
}

/**
 * Format ranked candidates as "1. label %pct · 2. ...", each percentage as
 * the current language writes it.
 *
 * @param {PredictionCandidate[]} items Ranked candidates, best first.
 * @param {number} [limit=3] How many to include.
 * @returns {string} Empty string for an empty list.
 */
function formatTopPredictions(items, limit = 3) {
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.label} ${percentText(Math.round((item.confidence || 0) * 100))}`)
    .join(" · ");
}

/**
 * Judge a finished word recording and say what the user should do next.
 *
 * Decides only whether the accept action is offered; it never appends.
 *
 * @returns {WordResultAssessment | null} Null outside a finished word recording.
 */
function assessWordResult() {
  if (!isWordLikeMode() || state.wordState !== "RESULT") return null;
  if (!state.prediction || state.prediction === "?" || state.prediction.length <= 1) {
    return {
      level: "low",
      decision: t("letter.wordGuide.noResult"),
      action: t("letter.wordGuide.noResultAction"),
      canAppend: false,
    };
  }

  const margin = getTopMargin();
  const warnings = Array.isArray(state.wordQualityWarnings) ? state.wordQualityWarnings : [];
  const confidence = Number(state.confidence || 0);
  const hasQualityRisk = warnings.length > 0;
  const isClose = margin < 0.08 && state.top3.length > 1;
  const belowAccept = confidence < CONFIG.WORD_ACCEPT_THRESHOLD;

  if (belowAccept) {
    return {
      level: "low",
      decision: t("letter.wordGuide.unsure"),
      action: t("letter.wordGuide.unsureAction", { word: state.prediction }),
      canAppend: false,
    };
  }

  if (isClose || hasQualityRisk) {
    const reason = isClose
      ? t("letter.wordGuide.closeAction", { word: state.prediction })
      : t("letter.wordGuide.qualityAction", { warning: WORD_QUALITY_COPY[warnings[0]] });
    return {
      level: "maybe",
      decision: t("letter.wordGuide.check"),
      action: reason,
      canAppend: true,
    };
  }

  return {
    level: "good",
    decision: t("letter.wordGuide.usable"),
    action: t("letter.wordGuide.usableAction"),
    canAppend: true,
  };
}

/**
 * Name the runners-up of a finished word result on the plate; the winner is
 * already its face. Each carries its Turkish gloss once a signer has reviewed
 * the glosses.
 *
 * @returns {void}
 */
function renderPlateNear() {
  const near = document.getElementById("plateNear");
  if (!near) return;
  const show = state.mode === "word" && state.wordState === "RESULT" && state.top3.length > 1;
  near.hidden = !show;
  if (!show) {
    near.textContent = "";
    return;
  }
  const others = state.top3.slice(1, 3).map((item) => {
    const card = wordCard(item.label);
    const gloss = card ? wordGloss(card) : "";
    return `${item.label}${gloss ? ` (${gloss})` : ""} ${percentText(Math.round((item.confidence || 0) * 100))}`;
  });
  near.textContent = t("letter.plate.near", { words: others.join(" · ") });
}

/**
 * Render the word result guide and store the assessment in state.
 *
 * @returns {void}
 */
function renderWordResultGuide() {
  renderPlateNear();
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

/**
 * The status line's text as it was given, so a language change can write it
 * again: a function is called anew, a string stays.
 *
 * @type {UiText | null}
 */
let _messageText = null;

/**
 * Write the status line under the prediction.
 *
 * @param {UiText} text Shown to the user. A function that looks its string
 *   up keeps the line in the current language across a switch.
 * @param {ConfidenceLevel} level Drives the message's colour state.
 * @returns {void}
 */
function setMessage(text, level) {
  _messageText = text;
  // The script owns the line from here on, not the markup's string.
  els.confidenceMessage.removeAttribute("data-i18n");
  els.confidenceMessage.textContent = uiText(text);
  els.confidenceMessage.dataset.level = level;
}

/**
 * Show a problem the user must act on, and announce it.
 *
 * The message line is deliberately not a live region, since it changes with
 * every prediction; a camera or download failure has to be spoken.
 *
 * @param {UiText} text Shown to the user, as setMessage() takes it.
 * @returns {void}
 */
function reportProblem(text) {
  setMessage(text, "low");
  announce(uiText(text));
}

/** The feedback bar's text as it was given; see _messageText. @type {UiText | null} */
let _feedbackText = null;

/**
 * Show the feedback bar above the workspace.
 *
 * @param {UiText} text Shown to the user, as setMessage() takes it.
 * @param {FeedbackKind} kind Selects the feedback-bar CSS modifier.
 * @returns {void}
 */
function showFeedback(text, kind) {
  if (!els.feedbackBar) return;
  _feedbackText = text;
  els.feedbackBar.textContent = uiText(text);
  els.feedbackBar.className = `feedback-bar feedback-bar--${kind}`;
  els.feedbackBar.hidden = false;
}

/** @returns {void} */
function clearFeedback() {
  if (!els.feedbackBar) return;
  _feedbackText = null;
  els.feedbackBar.hidden = true;
  els.feedbackBar.textContent = "";
}

/**
 * Redraw what this file wrote as composed text, in the language just
 * chosen: the status line and the feedback bar where they were given as
 * functions, and the word result guide with its near results. Render only,
 * from state; nothing is announced again. The decision word and the
 * percentages are bound to their strings with setText, so the switch itself
 * rewrites them.
 *
 * @returns {void}
 */
function renderPredictionLanguage() {
  if (_messageText !== null) els.confidenceMessage.textContent = uiText(_messageText);
  if (_feedbackText !== null && els.feedbackBar && !els.feedbackBar.hidden) {
    els.feedbackBar.textContent = uiText(_feedbackText);
  }
  renderWordResultGuide();
}

/**
 * Band a confidence against the thresholds of the active context.
 *
 * @param {number} confidence Probability in [0, 1].
 * @returns {ConfidenceLevel}
 */
function getConfidenceLevel(confidence) {
  const th = _thresholdsForMode();
  if (confidence >= th.confident) return "good";
  if (confidence >= th.unknown) return "maybe";
  return "low";
}

/**
 * Clamp a percentage for a progress bar or a label.
 *
 * @param {number} value Percentage, not a fraction.
 * @returns {number} A whole number in [0, 100]; 0 for anything non-finite.
 */
function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
