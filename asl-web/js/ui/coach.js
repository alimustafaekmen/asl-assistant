// Learning coach: target selection, study flows, scoring, and word guidance.
//
// A coach target is either a single letter or a word, and that distinction
// drives everything else. Letter targets are scored only when the user presses
// the explicit check, because a live letter prediction updates continuously and
// would otherwise score itself. Word targets are scored from the result of a
// completed 45-frame recording.
//
// Learn shows guidance without scoring, practice counts five correct
// repetitions, and quiz counts answers over a fixed question total.
//
// The word guidance panel is rendered from the published evaluation data, so
// per-word F1 values and confusion pairs are read, never recomputed.

/**
 * Rebuild the target dropdown for the active target type.
 *
 * Word options carry their published difficulty, so a learner can avoid
 * starting on a class the model finds hard.
 *
 * @returns {void}
 */
function buildCoachOptions() {
  const type = state.coachTargetType || "letter";
  els.coachTarget.innerHTML = "";

  const group = document.createElement("optgroup");
  group.label = type === "word" ? "Kelime hedefleri" : "Harf hedefleri";

  if (type === "word") {
    WORDS.forEach((word) => {
      const option = document.createElement("option");
      option.value = word;
      const diff = EASY_WORDS.has(word) ? "rahat" : HARD_WORDS.has(word) ? "riskli" : "orta";
      option.textContent = `${word} (${diff})`;
      group.appendChild(option);
    });
    if (!WORDS.includes(state.coachTarget)) state.coachTarget = "water";
  } else {
    LETTERS.forEach((letter) => {
      const option = document.createElement("option");
      option.value = letter;
      option.textContent = letter;
      group.appendChild(option);
    });
    if (!LETTERS.includes(state.coachTarget)) state.coachTarget = "A";
  }

  els.coachTarget.appendChild(group);
  els.coachTarget.value = state.coachTarget;
  updateCoachModeButtons();
}

/**
 * Rebuild the progress cells for the current goal.
 *
 * @returns {void}
 */
function buildCoachProgress() {
  els.coachProgress.innerHTML = "";
  for (let i = 0; i < state.coachGoal; i += 1) {
    els.coachProgress.appendChild(document.createElement("span"));
  }
}

/**
 * Switch between letter and word practice, resetting progress.
 *
 * @param {string} type Anything other than "word" selects letters.
 * @returns {void}
 */
function setCoachTargetType(type) {
  state.coachTargetType = type === "word" ? "word" : "letter";
  state.coachTarget = state.coachTargetType === "word" ? "water" : "A";
  state.coachStep = 0;
  state.quizScore = 0;
  state.coachFeedback = "";
  buildCoachOptions();
  buildCoachProgress();
  updateCoachPanel();
  updateReferenceForMode();
  syncRecordButton();
}

/**
 * Switch the study flow and reset progress for it.
 *
 * Quiz counts answers over a fixed question total; the other flows count five
 * correct repetitions.
 *
 * @param {string} flow Anything unrecognised selects "learn".
 * @returns {void}
 */
function setCoachFlow(flow) {
  // The membership test is the validation; Array.includes cannot narrow a
  // string to the union, so the result is stated here.
  state.coachFlow = /** @type {CoachFlow} */ (
    ["learn", "practice", "quiz"].includes(flow) ? flow : "learn"
  );
  state.coachGoal = state.coachFlow === "quiz" ? state.quizTotal : 5;
  state.coachStep = 0;
  state.quizScore = 0;
  state.coachFeedback = "";
  buildCoachProgress();
  updateCoachFlowButtons();
  updateCoachPanel();
}

/**
 * Mark which target type is active.
 *
 * @returns {void}
 */
function updateCoachModeButtons() {
  const isWord = state.coachTargetType === "word";
  els.coachLettersOnly?.classList.toggle("is-active", !isWord);
  els.coachWordsOnly?.classList.toggle("is-active", isWord);
  if (els.coachModeLabel) {
    els.coachModeLabel.textContent = isWord ? "Kelime çalışması" : "Harf çalışması";
  }
}

/**
 * Mark which study flow is active.
 *
 * @returns {void}
 */
function updateCoachFlowButtons() {
  queryElements("[data-coach-flow]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.coachFlow === state.coachFlow);
  });
}

/**
 * Redraw the coach panel for the current target and progress.
 *
 * @returns {void}
 */
function updateCoachPanel() {
  const target = state.coachTarget;
  const isLetter = target.length === 1;
  if (els.coachCard) els.coachCard.dataset.targetType = isLetter ? "letter" : "word";
  els.coachTargetBig.textContent = isLetter ? target.toUpperCase() : target;
  const targetText = isLetter
    ? `Hedef harf: ${target}. El şekli kameraya net görünmeli; poz en az 1 saniye sabit kalmalı.`
    : `Hedef kelime: ${target}. Hareketi 3-5 saniye içinde tamamla. El, yüz ve omuzlar kadrajda kalmalı.`;
  els.coachHint.textContent = state.coachFeedback || targetText;
  els.coachScore.textContent =
    state.coachFlow === "quiz"
      ? `${state.quizScore}/${state.quizTotal}`
      : `${Math.min(state.coachStep, state.coachGoal)}/${state.coachGoal}`;
  updateCoachFlowCopy(isLetter);
  updateCoachNextAction(isLetter);
  updateCoachPathSteps();
  [...els.coachProgress.children].forEach((cell, index) => {
    cell.className =
      index < state.coachStep ? "done" : index === state.coachStep ? "current" : "";
  });
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
}

/**
 * Mark how far the learner has got through the three setup steps.
 *
 * @returns {void}
 */
function updateCoachPathSteps() {
  const steps = queryElements(".coach-path span");
  const activeIndex = state.cameraOn ? 2 : state.coachTarget ? 1 : 0;
  steps.forEach((step, index) => {
    step.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
  });
}

/**
 * Write the explanation for the active study flow.
 *
 * @param {boolean} isLetter Whether the current target is a single letter.
 * @returns {void}
 */
function updateCoachFlowCopy(isLetter) {
  if (!els.coachFlowTitle || !els.coachFlowText) return;
  const liveText = state.prediction && state.prediction !== "?"
    ? ` Canlı algılanan: ${state.prediction}.`
    : " Canlı algılanan sonuç kamera başladıktan sonra görünür.";
  if (state.coachFlow === "learn") {
    els.coachFlowTitle.textContent = "Öğren";
    els.coachFlowText.textContent = isLetter
      ? `Referans harfi inceleyin, el şeklini kadraja ortalayın ve video rehberle karşılaştırın.${liveText}`
      : `Referans kelimeyi inceleyin, hareket süresini 3-5 saniye aralığında tutun ve video rehberi kullanın.${liveText}`;
  } else if (state.coachFlow === "practice") {
    els.coachFlowTitle.textContent = "Pratik";
    els.coachFlowText.textContent =
      `Amaç 5 doğru tekrardır. Doğru eşleşmeler ilerlemeye işlenir; yanlış eşleşmede hedef, açı ve kadraj yeniden kontrol edilir.${liveText}`;
  } else {
    els.coachFlowTitle.textContent = "Quiz";
    els.coachFlowText.textContent =
      `Quiz ${state.quizTotal} sorudan oluşur. Her kontrolde skor güncellenir ve Sonraki Hedef ile yeni soru seçilir.${liveText}`;
  }
}

/**
 * Write the single next step the learner should take.
 *
 * @param {boolean} isLetter Whether the current target is a single letter.
 * @returns {void}
 */
function updateCoachNextAction(isLetter) {
  if (!els.coachNextActionTitle || !els.coachNextActionText) return;
  const target = state.coachTarget;
  const hasPrediction = state.prediction && state.prediction !== "?";

  if (!state.cameraOn) {
    els.coachNextActionTitle.textContent = "Çalışmayı başlat";
    els.coachNextActionText.textContent = isLetter
      ? `${target} hedefi hazır. Kamerayı aç, elini kadraja al ve pozunu sabit tut.`
      : `${target} hedefi hazır. Kamerayı aç, el-yüz-omuz görünürlüğünü kontrol et.`;
    return;
  }

  if (!isLetter && ["COUNTDOWN", "RECORDING", "PROCESSING"].includes(state.wordState)) {
    els.coachNextActionTitle.textContent = "Kayıt tamamlanıyor";
    els.coachNextActionText.textContent =
      "Hareketi bitir, kamera karşısında kal ve top-3 sonucu bekle.";
    return;
  }

  if (state.coachFlow === "learn") {
    els.coachNextActionTitle.textContent = isLetter ? "Canlı sonucu izle" : "Kelime pratiği yap";
    els.coachNextActionText.textContent = isLetter
      ? "Tahmin hedefe yaklaşınca Hedefi Kontrol Et ile sonucu doğrula."
      : "Hedefi Kontrol Et butonu kısa bir kelime kaydı alır ve sonucu yorumlar.";
    return;
  }

  if (!hasPrediction) {
    els.coachNextActionTitle.textContent = "Hedefi kamerada göster";
    els.coachNextActionText.textContent = isLetter
      ? "El pozun algılandığında canlı sonuç alanı dolacak."
      : "Kelime kaydı için Hedefi Kontrol Et butonunu kullan.";
    return;
  }

  els.coachNextActionTitle.textContent =
    state.coachFlow === "quiz" ? "Cevabı kontrol et" : "Tekrarı işle";
  els.coachNextActionText.textContent =
    `${hasPrediction ? `Canlı sonuç: ${state.prediction}. ` : ""}` +
    "Hedefle eşleşiyorsa ilerleme güncellenir; eşleşmiyorsa kadrajı ve hareketi düzelt.";
}

/**
 * Start or stop a study session by toggling the camera.
 *
 * @returns {Promise<void>}
 */
async function startCoachStudy() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }
  await toggleCamera();
  if (state.cameraOn) {
    state.coachFeedback = "Çalışma aktif. Hedefi kamerada uygulayın ve Kontrol Et butonunu kullanın.";
    updateCoachPanel();
  }
}

/**
 * Score the current attempt.
 *
 * A letter target is scored from the live prediction only when the learner asks
 * for it, because a live letter prediction updates continuously and would
 * otherwise score itself. A word target starts a recording and is scored from
 * its result instead.
 *
 * @returns {void}
 */
function checkCoachTarget() {
  if (!state.cameraOn) {
    setMessage("Önce çalışmayı başlatın.", "low");
    return;
  }
  if (_isCoachWordTarget()) {
    startWordRecording();
    return;
  }
  updateCoachFromPrediction();
}

/**
 * Move to the next target in the published order.
 *
 * Temporal state is reset so the previous target cannot be scored against the
 * new one. Quiz progress is kept, because the quiz counts questions rather than
 * repetitions.
 *
 * @returns {void}
 */
function nextCoachTarget() {
  const list = state.coachTargetType === "word" ? WORDS : LETTERS;
  const currentIndex = Math.max(0, list.indexOf(state.coachTarget));
  const nextIndex = (currentIndex + 1) % list.length;
  state.coachTarget = list[nextIndex];
  state.coachStep = state.coachFlow === "quiz" ? state.coachStep : 0;
  state.coachFeedback = "";
  if (els.coachTarget) els.coachTarget.value = state.coachTarget;
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  updatePrediction({ label: state.coachTarget, confidence: 0, alternatives: [] });
  updateCoachPanel();
  updateReferenceForMode();
}

/**
 * Compare the current prediction against the target and record the outcome.
 *
 * Words and letters use their own accept thresholds, so a word is not held to
 * the letter model's confidence scale.
 *
 * @returns {void}
 */
function updateCoachFromPrediction() {
  const isWord = state.coachTarget.length > 1;
  const threshold = isWord ? CONFIG.WORD_ACCEPT_THRESHOLD : CONFIG.CONFIDENT_THRESHOLD;
  const matched = state.prediction === state.coachTarget && state.confidence >= threshold;

  if (matched) {
    if (state.coachFlow === "quiz") {
      state.quizScore = Math.min(state.quizTotal, state.quizScore + 1);
    }
    if (state.coachFlow !== "learn") {
      state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
    }
    state.coachFeedback = isWord
      ? "Doğru eşleşme. Hareket akışı ve kadraj koşulları yeterli görünüyor."
      : "Doğru eşleşme. El şekli sabit ve hedefle uyumlu görünüyor.";
  } else {
    state.coachFeedback = isWord
      ? "Hedefle eşleşmedi. Hareket daha yavaş tamamlanmalı; yüz ve omuzlar görünür kalmalı."
      : "Hedefle eşleşmedi. El kadrajın ortasında olmalı ve parmak ayrımları net görünmeli.";
  }
  updateCoachPanel();
}

/**
 * Render one evaluated word as a performance chip.
 *
 * The text is sanitized even though the values currently come from bundled
 * evaluation data, because this output goes to innerHTML.
 *
 * @param {string} word
 * @param {number} f1 Published F1 in [0, 1].
 * @param {"good" | "risky"} severity Chip style.
 * @returns {string} HTML fragment.
 */
function _wordChipHtml(word, f1, severity) {
  const safeWord = String(word).replace(/[<>&]/g, "");
  const f1Pct = Math.round(Math.max(0, Math.min(1, f1)) * 100);
  return (
    `<span class="word-chip word-chip--${severity}">` +
      `<span class="word-chip__name">${safeWord}</span>` +
      `<span class="word-chip__f1">F1 ${f1Pct}</span>` +
    `</span>`
  );
}

/**
 * Render a known confusion pair, with its occurrence count when published.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} count Omitted from the chip when not a positive number.
 * @returns {string} HTML fragment.
 */
function _confusionChipHtml(a, b, count) {
  const safeA = String(a).replace(/[<>&]/g, "");
  const safeB = String(b).replace(/[<>&]/g, "");
  const countBadge = Number.isFinite(count) && count > 0
    ? `<span class="word-chip__count">${count}×</span>`
    : "";
  return (
    `<span class="word-chip word-chip--confusion">` +
      `<span class="word-chip__name">${safeA}</span>` +
      `<span class="word-chip__sep" aria-hidden="true">↔</span>` +
      `<span class="word-chip__name">${safeB}</span>` +
      countBadge +
    `</span>`
  );
}

/**
 * Fill the word guidance panel from the published evaluation data.
 *
 * The lists are read from that data, never recomputed, so the demo and the
 * report cannot disagree. A list with no entries is left as authored rather
 * than emptied.
 *
 * @returns {void}
 */
function renderWordGuidancePanel() {
  const stats =
    typeof perWordStats !== "undefined" && perWordStats
      ? perWordStats
      : {};
  const pairs =
    typeof confusionPairs !== "undefined" && Array.isArray(confusionPairs)
      ? confusionPairs
      : [];

  const ranked = Object.entries(stats)
    .map(([word, value]) => ({
      word,
      f1: Number(value?.f1 || value?.f1_score || value?.test_f1 || 0),
      difficulty: value?.difficulty || "",
    }))
    .filter((item) => item.word);

  const easyItems = ranked
    .filter((item) => item.difficulty === "easy" || item.f1 >= 0.78)
    .sort((a, b) => b.f1 - a.f1)
    .slice(0, 10);

  const riskyItems = ranked
    .filter((item) => item.difficulty === "hard" || item.f1 < 0.62)
    .sort((a, b) => a.f1 - b.f1)
    .slice(0, 8);

  // Unpacking through readConfusionPair() keeps this panel reading the same
  // spellings the live confusion warning accepts; it used to handle only the
  // two object forms and drop array-form pairs without a trace.
  const confusionItems = pairs
    .slice(0, 6)
    .map(readConfusionPair)
    .filter((p) => p.a && p.b);

  if (els.wordDemoList && easyItems.length) {
    els.wordDemoList.innerHTML = easyItems
      .map((item) => _wordChipHtml(item.word, item.f1, "good"))
      .join("");
  }
  if (els.wordRiskList && riskyItems.length) {
    els.wordRiskList.innerHTML = riskyItems
      .map((item) => _wordChipHtml(item.word, item.f1, "risky"))
      .join("");
  }
  if (els.wordConfusionList && confusionItems.length) {
    els.wordConfusionList.innerHTML = confusionItems
      .map((p) => _confusionChipHtml(p.a, p.b, p.count))
      .join("");
  }
}
