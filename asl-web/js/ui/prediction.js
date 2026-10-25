// Display only: the word result guide says whether a result looks usable, but
// appending it stays an explicit user action.

/**
 * @typedef {"low" | "maybe" | "good"} ConfidenceLevel
 */

/**
 * Each value has a matching CSS modifier.
 *
 * @typedef {"confusion" | "hard" | "low" | "good"} FeedbackKind
 */

/**
 * A function is called again after a language switch; a string stays as written.
 *
 * @typedef {string | (() => string)} UiText
 */

/**
 * @param {UiText} text
 * @returns {string}
 */
function uiText(text) {
  return typeof text === "function" ? text() : text;
}

/**
 * "%90" in Turkish, "90%" in English.
 *
 * @param {number} value A whole percentage, not a fraction.
 * @returns {string}
 */
function percentText(value) {
  return t("letter.plate.percent", { n: value });
}

/**
 * Getters, so each reads in the language shown at that moment.
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
 * The single place a new result enters the UI.
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
  els.cameraStage.dataset.kind = prediction.label.length > 1 && prediction.label !== "?" ? "word" : "letter";

  // The coach judges a target letter by its hold: a confident wrong letter must
  // not paint the stage as a success.
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
  if (state.mode === "word") updateReferenceForMode();
}

/**
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
  // Uncertainty before a close call: a word too weak to accept is not a choice
  // between two usable words.
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
 * The 50-class word model is often right at a low top-1 confidence, so a word
 * message lists the likeliest words rather than calling it a failure.
 *
 * @returns {void}
 */
function updateMessageForPrediction() {
  if (state.prediction === "?") {
    setMessage(() => t("letter.plate.idle"), "low");
    return;
  }

  if (isWordLikeMode() && state.top3.length) {
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
 * A multi-character coach target counts as a word.
 *
 * @returns {boolean}
 */
function isWordLikeMode() {
  return state.mode === "word" || _isCoachWordTarget();
}

/**
 * @returns {number} 1 when there is no runner-up.
 */
function getTopMargin() {
  if (!state.top3 || state.top3.length < 2) return 1;
  return Math.max(0, (state.top3[0].confidence || 0) - (state.top3[1].confidence || 0));
}

/**
 * @param {PredictionCandidate[]} items Best first.
 * @param {number} [limit=3]
 * @returns {string}
 */
function formatTopPredictions(items, limit = 3) {
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.label} ${percentText(Math.round((item.confidence || 0) * 100))}`)
    .join(" · ");
}

/**
 * Decides only whether the accept action is offered; it never appends.
 *
 * @returns {WordResultAssessment | null}
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
 * Kept as given so a language switch can write it again.
 *
 * @type {UiText | null}
 */
let _messageText = null;

/**
 * @param {UiText} text
 * @param {ConfidenceLevel} level
 * @returns {void}
 */
function setMessage(text, level) {
  _messageText = text;
  els.confidenceMessage.removeAttribute("data-i18n");
  els.confidenceMessage.textContent = uiText(text);
  els.confidenceMessage.dataset.level = level;
}

/**
 * The message line is not a live region, since it changes with every
 * prediction; a camera or download failure has to be spoken.
 *
 * @param {UiText} text
 * @returns {void}
 */
function reportProblem(text) {
  setMessage(text, "low");
  announce(uiText(text));
}

/** @type {UiText | null} */
let _feedbackText = null;

/**
 * @param {UiText} text
 * @param {FeedbackKind} kind
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
 * Redraws composed text in the new language; nothing is announced again.
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
 * @param {number} confidence
 * @returns {ConfidenceLevel}
 */
function getConfidenceLevel(confidence) {
  const th = _thresholdsForMode();
  if (confidence >= th.confident) return "good";
  if (confidence >= th.unknown) return "maybe";
  return "low";
}

/**
 * @param {number} value Percentage, not a fraction.
 * @returns {number}
 */
function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
