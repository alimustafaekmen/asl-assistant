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
 * The user's wording of each recording quality warning; the technical reasons
 * stay in the debug snapshot (window._lastWordDebug).
 *
 * @type {Record<WordQualityCode, string>}
 */
const WORD_QUALITY_COPY = {
  pose: "Omuzlarınız az göründü.",
  face: "Yüzünüz az göründü.",
  hand: "Eliniz aralıklarla kayboldu.",
  "few-frames": "Kayıt kısa kaldı.",
  slow: "Kayıt yavaş doldu; ışığı artırın.",
  still: "Hareket algılanmadı; işareti tam yapın.",
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

  els.confidenceText.textContent = pct ? `%${pct}` : "--";
  els.confidenceRing.style.setProperty("--score", String(pct));

  const level = getConfidenceLevel(state.confidence);
  els.confidenceRing.className = `confidence-ring ${level}`;
  els.cameraStage.dataset.state = state.wordState === "RECORDING" ? "recording" : level;

  const th = _thresholdsForMode();
  // Uncertainty comes before a close call: a word too weak to accept is not
  // a choice between two usable words, whatever the runner-up scored.
  if (prediction.label === "?") {
    els.decisionLabel.textContent = "Bekleniyor";
  } else if (state.confidence < th.unknown) {
    els.decisionLabel.textContent = "Emin değil";
  } else if (isWordLikeMode() && getTopMargin() < 0.03 && state.top3.length > 1) {
    els.decisionLabel.textContent = "Çok yakın";
  } else if (state.confidence < th.confident) {
    els.decisionLabel.textContent = "Büyük olasılıkla";
  } else {
    els.decisionLabel.textContent = "Emin";
  }

  renderTop3();
  updateMessageForPrediction();
  renderWordResultGuide();
  syncActionBar();
  // Only the word reference follows the prediction; the letter chart does
  // not, so letter frames skip this.
  if (state.mode === "word") updateReferenceForMode();
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
    hint.textContent = "Kamera açılınca en olası sonuçlar burada görünür.";
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
    confidence.textContent = `%${pct}`;

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
    setMessage("Kamerayı açtığınızda sonuç burada görünür.", "low");
    return;
  }

  if (isWordLikeMode() && state.top3.length) {
    const topText = formatTopPredictions(state.top3);
    if (state.confidence < CONFIG.WORD_UNKNOWN_THRESHOLD) {
      setMessage(`Emin olunamadı. En yakın sonuçlar: ${topText}. Eliniz, yüzünüz ve omuzlarınız görünür olacak şekilde yeniden kaydedin.`, "low");
      return;
    }
    if (getTopMargin() < 0.03 && state.top3.length > 1) {
      setMessage(`İlk iki sonuç çok yakın: ${topText}. Doğru olanı kontrol edin.`, "maybe");
      return;
    }
    setMessage(`En olası sonuçlar: ${topText}.`, getConfidenceLevel(state.confidence));
    return;
  }

  const th = _thresholdsForMode();
  if (state.confidence < th.unknown) {
    setMessage("Emin olunamadı. Işığı artırmayı ya da elinizi biraz yaklaştırmayı deneyin.", "low");
    return;
  }

  if (state.confidence < th.confident) {
    setMessage(`Büyük olasılıkla ${state.prediction}. Biraz daha sabit tutun.`, "maybe");
    return;
  }

  setMessage(`${state.prediction} harfi net görünüyor.`, "good");
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
 * Format ranked candidates as "1. label %pct · 2. ...".
 *
 * @param {PredictionCandidate[]} items Ranked candidates, best first.
 * @param {number} [limit=3] How many to include.
 * @returns {string} Empty string for an empty list.
 */
function formatTopPredictions(items, limit = 3) {
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.label} %${Math.round((item.confidence || 0) * 100)}`)
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
      decision: "Sonuç çıkmadı",
      action: "Kamerayı, ışığı ve kadrajı kontrol edip yeniden kaydedin.",
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
      decision: "Emin olunamadı",
      action: `En yakın sonuç ${state.prediction}, ama metne eklemek için yeterince net değil. Daha net bir kayıtla yeniden deneyin: eliniz, yüzünüz ve omuzlarınız görünür olsun.`,
      canAppend: false,
    };
  }

  if (isClose || hasQualityRisk) {
    const reason = isClose
      ? `İlk iki sonuç çok yakın. Doğrusu ${state.prediction} ise ekleyin; değilse yeniden kaydedin.`
      : `${WORD_QUALITY_COPY[warnings[0]]} Sonucu kontrol ederek ekleyin.`;
    return {
      level: "maybe",
      decision: "Kontrol ederek ekleyin",
      action: reason,
      canAppend: true,
    };
  }

  return {
    level: "good",
    decision: "Sonuç kullanılabilir",
    action: "Doğruysa metne ekleyin; değilse yeniden kaydedin.",
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
    return `${item.label}${gloss ? ` (${gloss})` : ""} %${Math.round((item.confidence || 0) * 100)}`;
  });
  near.textContent = `Yakın: ${others.join(" · ")}`;
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
 * Write the status line under the prediction.
 *
 * @param {string} text Turkish text shown to the user.
 * @param {ConfidenceLevel} level Drives the message's colour state.
 * @returns {void}
 */
function setMessage(text, level) {
  els.confidenceMessage.textContent = text;
  els.confidenceMessage.dataset.level = level;
}

/**
 * Show a problem the user must act on, and announce it.
 *
 * The message line is deliberately not a live region, since it changes with
 * every prediction; a camera or download failure has to be spoken.
 *
 * @param {string} text Turkish text shown to the user.
 * @returns {void}
 */
function reportProblem(text) {
  setMessage(text, "low");
  announce(text);
}

/**
 * Show the feedback bar above the workspace.
 *
 * @param {string} text Turkish text shown to the user.
 * @param {FeedbackKind} kind Selects the feedback-bar CSS modifier.
 * @returns {void}
 */
function showFeedback(text, kind) {
  if (!els.feedbackBar) return;
  els.feedbackBar.textContent = text;
  els.feedbackBar.className = `feedback-bar feedback-bar--${kind}`;
  els.feedbackBar.hidden = false;
}

/** @returns {void} */
function clearFeedback() {
  if (!els.feedbackBar) return;
  els.feedbackBar.hidden = true;
  els.feedbackBar.textContent = "";
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
