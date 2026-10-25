// A letter is scored only by holding it (ml/hold.js), never by a button press:
// a press reads whatever is on the plate, such as one pose pressed five times.
//
// Progress stays on this device: counts per letter and the last flow, nothing
// personal and no timestamps. The coach never waits for its teaching data;
// until it arrives letters come in alphabetical order without cues.

const _coachHold = createHoldTracker({
  holdMs: CONFIG.COACH_HOLD_MS,
  minConfidence: CONFIG.COACH_HOLD_CONFIDENCE,
  graceMs: CONFIG.COACH_HOLD_GRACE_MS,
  releaseMs: CONFIG.COACH_RELEASE_MS,
});

/**
 * @typedef {{tr: string, en?: string}} CoachText
 */

/**
 * Letters whose handshapes look alike.
 *
 * @typedef {Object} CoachConfusionGroup
 * @property {string[]} letters
 * @property {CoachText} reason
 * @property {Record<string, CoachText>} cues
 */

/**
 * @typedef {Object} CoachLetterData
 * @property {string[]} order Every letter of LETTERS once.
 * @property {Record<string, CoachText>} cues
 * @property {Record<string, string[]>} confusable
 * @property {CoachConfusionGroup[]} groups
 */

/**
 * @type {CoachLetterData}
 */
let coachLetterData = { order: [...LETTERS], cues: {}, confusable: {}, groups: [] };

/**
 * The look-alike groups are optional and fail on their own.
 *
 * @type {"idle" | "loading" | "ready" | "failed"}
 */
let coachLetterDataStatus = "idle";

/** @type {Promise<void> | null} */
let _coachLetterDataLoad = null;

// Late teaching data may set the target only while the learner has not.
let _coachTargetTouched = false;

/**
 * @typedef {Object} CoachLetterRecord
 * @property {number} ok
 * @property {number} hint
 * @property {number} skip
 */

/**
 * @typedef {Object} CoachProgress
 * @property {1} v
 * @property {CoachFlow} flow
 * @property {Record<string, CoachLetterRecord>} letters
 */

const COACH_PROGRESS_KEY = "asl-coach-v1";

/** @type {CoachProgress} */
let coachProgress = { v: 1, flow: "learn", letters: {} };

let coachProgressSaved = true;

let _coachProgressRead = false;

/**
 * Nothing stored can make the coach throw or teach a letter the model does
 * not know.
 *
 * @param {string | null} raw
 * @returns {CoachProgress | null}
 */
function readCoachProgress(raw) {
  if (raw === null) return null;
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;
  /** @param {unknown} value @returns {value is number} */
  const isCount = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  /** @type {Record<string, CoachLetterRecord>} */
  const letters = {};
  const stored = isRecord(data.letters) ? data.letters : {};
  for (const letter of LETTERS) {
    const record = stored[letter];
    if (!isRecord(record)) continue;
    const { ok, hint, skip } = record;
    if (isCount(ok) && isCount(hint) && isCount(skip)) letters[letter] = { ok, hint, skip };
  }
  // includes() validates the value but cannot narrow its type, hence the cast.
  const flow = /** @type {CoachFlow} */ (
    typeof data.flow === "string" && ["learn", "practice", "quiz"].includes(data.flow) ? data.flow : "learn"
  );
  return { v: 1, flow, letters };
}

/**
 * @returns {void}
 */
function loadCoachProgress() {
  if (_coachProgressRead) return;
  _coachProgressRead = true;
  /** @type {string | null} */
  let raw = null;
  try {
    raw = localStorage.getItem(COACH_PROGRESS_KEY);
  } catch (err) {
    coachProgressSaved = false;
  }
  const stored = readCoachProgress(raw);
  if (!stored) return;
  coachProgress = stored;
  if (stored.flow !== state.coachFlow) setCoachFlow(stored.flow);
}

/**
 * @returns {void}
 */
function saveCoachProgress() {
  try {
    localStorage.setItem(COACH_PROGRESS_KEY, JSON.stringify(coachProgress));
    coachProgressSaved = true;
  } catch (err) {
    coachProgressSaved = false;
  }
}

/**
 * @param {string} letter
 * @param {keyof CoachLetterRecord} count
 * @returns {void}
 */
function recordCoachLetter(letter, count) {
  if (!LETTERS.includes(letter)) return;
  const record = coachProgress.letters[letter] ?? { ok: 0, hint: 0, skip: 0 };
  record[count] += 1;
  coachProgress.letters[letter] = record;
  saveCoachProgress();
}

/**
 * @returns {void}
 */
function resetCoachProgress() {
  const previous = JSON.parse(JSON.stringify(coachProgress));
  coachProgress = { v: 1, flow: coachProgress.flow, letters: {} };
  saveCoachProgress();
  updateCoachPanel();
  showToast(() => t("coach.toast.reset"), {
    action: {
      label: () => t("coach.toast.undo"),
      run: () => {
        coachProgress = previous;
        saveCoachProgress();
        updateCoachPanel();
      },
    },
  });
}

/**
 * @returns {string}
 */
function _firstCoachLetterToLearn() {
  const order = coachLetterData.order;
  return order.find((letter) => !(coachProgress.letters[letter]?.ok >= 1)) ?? order[0];
}

/**
 * A hold belongs to the target and the camera session it started in. Only a
 * new target forgets that it was counted.
 *
 * @param {{newTarget?: boolean}} [options]
 * @returns {void}
 */
function resetCoachAttempt(options = {}) {
  _cancelCoachAdvance();
  _coachHold.reset();
  _coachMissCandidate = null;
  state.coach.phase = state.cameraOn ? "no-hand" : "camera-off";
  state.coach.holdProgress = 0;
  state.coach.missLetter = null;
  if (options.newTarget) {
    state.coach.targetCounted = false;
    state.coach.hintOpen = false;
  }
}

/**
 * @returns {void}
 */
function showCoachHint() {
  if (state.coachFlow === "quiz" || _isCoachWordTarget()) return;
  if (!state.coach.hintOpen && state.coachFlow === "practice") recordCoachLetter(state.coachTarget, "hint");
  state.coach.hintOpen = true;
  if (els.referenceBody.hidden) toggleReference();
  updateCoachPanel();
}

/**
 * @param {string} target
 * @returns {string}
 */
function coachHintLine(target) {
  const lookAlikes = coachLetterData.confusable[target] ?? [];
  const confused = lookAlikes.length ? ` ${t("coach.hint.lookAlikes", { letters: lookAlikes.join(", ") })}` : "";
  return `${t("coach.hint.line", { letter: target, cue: coachCueLine(target) })}${confused}`;
}

/**
 * @returns {boolean} Whether anything was on offer.
 */
function coachPrimaryAction() {
  if (state.mode !== "coach" || _isCoachWordTarget()) return false;
  const { phase } = state.coach;
  if (phase === "success" || phase === "staying") {
    nextCoachTarget();
    return true;
  }
  if (phase === "miss" && state.coachFlow !== "quiz") {
    showCoachHint();
    return true;
  }
  return false;
}

let _coachAdvanceTimer = 0;

/** @returns {void} */
function _cancelCoachAdvance() {
  clearTimeout(_coachAdvanceTimer);
  _coachAdvanceTimer = 0;
  state.coach.advancing = false;
}

/**
 * @returns {void}
 */
function _scheduleCoachAdvance() {
  _cancelCoachAdvance();
  state.coach.advancing = true;
  _coachAdvanceTimer = setTimeout(() => {
    _coachAdvanceTimer = 0;
    state.coach.advancing = false;
    nextCoachTarget();
  }, CONFIG.COACH_ADVANCE_MS);
}

/**
 * WCAG 2.2.1: the timer never decides for a learner who is reading, reaching
 * for a button, or away.
 *
 * @returns {boolean} Whether an advance was pending.
 */
function stayOnCoachTarget() {
  if (!state.coach.advancing) return false;
  _cancelCoachAdvance();
  state.coach.phase = "staying";
  renderCoachPlate();
  updateCoachPanel();
  return true;
}

/**
 * @returns {string}
 */
function _nextCoachLetter() {
  const order = coachLetterData.order;
  return order[(Math.max(0, order.indexOf(state.coachTarget)) + 1) % order.length];
}

/**
 * "?" stands for a hand the model cannot read.
 *
 * @type {{seen: string, since: number} | null}
 */
let _coachMissCandidate = null;

/**
 * The target itself, even below the hold confidence, is not a miss: the
 * learner is close.
 *
 * @param {PredictionResult} prediction
 * @param {number} now
 * @returns {void}
 */
function _followCoachMiss(prediction, now) {
  const target = state.coachTarget;
  const unsure = prediction.confidence < CONFIG.UNKNOWN_THRESHOLD;
  const seen = unsure ? "?" : prediction.label === target ? null : prediction.label;
  if (seen === null) {
    _coachMissCandidate = null;
    return;
  }
  if (!_coachMissCandidate || _coachMissCandidate.seen !== seen) {
    _coachMissCandidate = { seen, since: now };
  }
  if (now - _coachMissCandidate.since >= CONFIG.COACH_MISS_MS) {
    state.coach.missLetter = seen;
    state.coach.phase = "miss";
  }
}

/**
 * A target in two look-alike groups is explained by the pair actually confused.
 *
 * @param {string | null} seen
 * @param {string} target
 * @returns {string}
 */
function coachMissText(seen, target) {
  if (seen === null) return "";
  if (seen === "?") return t("coach.miss.unclear");
  const named = t("coach.miss.seen", { letter: seen });
  const group = coachLetterData.groups.find(
    (candidate) => candidate.letters.includes(seen) && candidate.letters.includes(target),
  );
  const cue = coachText(group?.cues[target]) || coachText(coachLetterData.cues[target]);
  if (group) {
    const reason = coachText(group.reason);
    return cue ? `${named} ${reason} ${target}: ${cue}` : `${named} ${reason}`;
  }
  return cue ? `${named} ${target}: ${cue}` : named;
}

/**
 * Falls back to Turkish: a cue in the other language teaches more than none.
 *
 * @param {CoachText | undefined} text
 * @returns {string}
 */
function coachText(text) {
  if (!text) return "";
  return (currentLanguage() === "en" && text.en) || text.tr;
}

/**
 * @param {unknown} turkish
 * @param {unknown} english
 * @returns {CoachText | null}
 */
function _readCoachText(turkish, english) {
  if (typeof turkish !== "string" || !turkish) return null;
  return typeof english === "string" && english ? { tr: turkish, en: english } : { tr: turkish };
}

/**
 * A file that drifts from the model's labels can neither drop a letter from
 * the coach nor add one.
 *
 * @param {unknown} data Parsed letter_curriculum.json.
 * @returns {Pick<CoachLetterData, "order" | "cues" | "confusable"> | null}
 */
function readLetterCurriculum(data) {
  if (!isRecord(data) || data.schema_version !== "letter-curriculum-v1") return null;
  /** @type {string[]} */
  const order = [];
  for (const letter of Array.isArray(data.suggested_order) ? data.suggested_order : []) {
    if (typeof letter === "string" && LETTERS.includes(letter) && !order.includes(letter)) order.push(letter);
  }
  for (const letter of LETTERS) if (!order.includes(letter)) order.push(letter);
  /** @type {Record<string, CoachText>} */
  const cues = {};
  /** @type {Record<string, string[]>} */
  const confusable = {};
  for (const entry of Array.isArray(data.letters) ? data.letters : []) {
    if (!isRecord(entry) || typeof entry.letter !== "string" || !LETTERS.includes(entry.letter)) continue;
    const letter = entry.letter;
    const cue = _readCoachText(entry.cue_tr, entry.cue_en);
    if (cue) cues[letter] = cue;
    if (Array.isArray(entry.confusable_with)) {
      confusable[letter] = entry.confusable_with.filter(
        /** @returns {other is string} */
        (other) => typeof other === "string" && LETTERS.includes(other) && other !== letter,
      );
    }
  }
  return { order, cues, confusable };
}

/**
 * @param {unknown} data Parsed letter_confusion.json.
 * @returns {CoachConfusionGroup[] | null}
 */
function readLetterConfusion(data) {
  if (!isRecord(data) || data.schema_version !== "letter-confusion-v1") return null;
  /** @type {CoachConfusionGroup[]} */
  const groups = [];
  for (const group of Array.isArray(data.groups) ? data.groups : []) {
    if (!isRecord(group)) continue;
    const reason = _readCoachText(group.reason_tr, group.reason_en);
    if (!reason) continue;
    const listed = Array.isArray(group.letters) ? group.letters : [];
    const letters = LETTERS.filter((letter) => listed.includes(letter));
    if (letters.length < 2) continue;
    const given = isRecord(group.cues) ? group.cues : {};
    const givenEn = isRecord(group.cues_en) ? group.cues_en : {};
    /** @type {Record<string, CoachText>} */
    const cues = {};
    for (const letter of letters) {
      const cue = _readCoachText(given[letter], givenEn[letter]);
      if (cue) cues[letter] = cue;
    }
    groups.push({ letters, reason, cues });
  }
  return groups;
}

/**
 * A failure is logged so a broken deploy does not lose the cues without a trace.
 *
 * @template T
 * @param {string} path
 * @param {(data: unknown) => T | null} read
 * @param {string} fallback
 * @returns {Promise<T | null>}
 */
async function _readCoachFile(path, read, fallback) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = read(await response.json());
    if (result === null) throw new Error("not in the expected format");
    return result;
  } catch (err) {
    console.warn(`${path} could not be read; ${fallback}:`, err);
    return null;
  }
}

/**
 * Not at startup, since most visitors never open the coach.
 *
 * @returns {Promise<void>} Never rejects.
 */
function loadCoachLetterData() {
  if (_coachLetterDataLoad) return _coachLetterDataLoad;
  coachLetterDataStatus = "loading";
  _coachLetterDataLoad = Promise.all([
    _readCoachFile("./data/letter_curriculum.json", readLetterCurriculum, "using alphabetical order without cues"),
    _readCoachFile("./data/letter_confusion.json", readLetterConfusion, "look-alike letters go unexplained"),
  ]).then(([curriculum, groups]) => {
    if (curriculum) {
      coachLetterData = { ...curriculum, groups: groups ?? [] };
      coachLetterDataStatus = "ready";
    } else {
      coachLetterData = { ...coachLetterData, groups: groups ?? [] };
      coachLetterDataStatus = "failed";
    }
    if (!_coachTargetTouched && state.coachTargetType === "letter") {
      _showCoachTarget(_firstCoachLetterToLearn());
    } else {
      updateCoachPanel();
    }
  });
  return _coachLetterDataLoad;
}

/**
 * @param {string} target
 * @returns {string}
 */
function coachCueLine(target) {
  if (coachLetterDataStatus === "failed") return t("coach.cue.failed");
  return coachText(coachLetterData.cues[target]) || t("coach.target.letter", { letter: target });
}

/**
 * Kept as a key so a language switch can say it again.
 *
 * @type {{key: string, params?: I18nParams} | null}
 */
let _coachFeedback = null;

/**
 * @param {string | null} key Null clears it.
 * @param {I18nParams} [params]
 * @returns {void}
 */
function _setCoachFeedback(key, params) {
  _coachFeedback = key ? { key, params } : null;
  state.coachFeedback = key ? t(key, params) : "";
}

/**
 * @param {string} target
 * @returns {void}
 */
function _showCoachTarget(target) {
  state.coachTarget = target;
  _setCoachFeedback(null);
  resetCoachAttempt({ newTarget: true });
  if (els.coachTarget) els.coachTarget.value = target;
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  // Another screen's plate is not the coach's to clear.
  if (state.mode === "coach") updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateCoachPanel();
  updateReferenceForMode();
}

/**
 * @param {string} target
 * @returns {void}
 */
function chooseCoachTarget(target) {
  _coachTargetTouched = true;
  state.coachStep = 0;
  _showCoachTarget(target);
}

/**
 * Word options carry their published difficulty, so a learner can avoid
 * starting on a class the model finds hard.
 *
 * @returns {void}
 */
function buildCoachOptions() {
  const type = state.coachTargetType || "letter";
  els.coachTarget.innerHTML = "";

  const group = document.createElement("optgroup");
  group.label = t(type === "word" ? "coach.options.words" : "coach.options.letters");

  if (type === "word") {
    WORDS.forEach((word) => {
      const option = document.createElement("option");
      option.value = word;
      const diff = EASY_WORDS.has(word) ? "easy" : HARD_WORDS.has(word) ? "hard" : "medium";
      option.textContent = `${word} (${t(`coach.options.${diff}`)})`;
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
 * @returns {void}
 */
function buildCoachProgress() {
  els.coachProgress.innerHTML = "";
  for (let i = 0; i < state.coachGoal; i += 1) {
    els.coachProgress.appendChild(document.createElement("span"));
  }
}

/**
 * Alphabetical, not teaching order, so a letter stays where the learner last
 * saw it.
 *
 * @returns {void}
 */
function buildCoachGrid() {
  els.coachGrid.innerHTML = "";
  LETTERS.forEach((letter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "letter-grid__item";
    button.dataset.letter = letter;
    button.textContent = letter;
    button.addEventListener("click", () => {
      if (state.coachFlow === "quiz") return;
      chooseCoachTarget(letter);
    });
    els.coachGrid.appendChild(button);
  });
  renderCoachGrid();
}

/**
 * @returns {void}
 */
function renderCoachGrid() {
  const quiz = state.coachFlow === "quiz";
  els.coachGrid.setAttribute("aria-disabled", String(quiz));
  if (els.coachGridNote) els.coachGridNote.hidden = !quiz;
  let done = 0;
  for (const button of els.coachGrid.children) {
    if (!(button instanceof HTMLElement)) continue;
    const letter = button.dataset.letter ?? "";
    const shown = coachProgress.letters[letter]?.ok >= 1;
    const current = state.coachTargetType === "letter" && letter === state.coachTarget;
    if (shown) done += 1;
    button.dataset.state = current ? "current" : shown ? "done" : "todo";
    button.setAttribute(
      "aria-label",
      current ? t("coach.grid.current", { letter }) : shown ? t("coach.grid.done", { letter }) : letter,
    );
    button.setAttribute("aria-disabled", String(quiz));
    if (current) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  if (els.coachDone) els.coachDone.textContent = `${done}/${LETTERS.length}`;
}

/**
 * @param {string} type
 * @returns {void}
 */
function setCoachTargetType(type) {
  _coachTargetTouched = true;
  state.coachTargetType = type === "word" ? "word" : "letter";
  state.coachTarget = state.coachTargetType === "word" ? "water" : "A";
  state.coachStep = 0;
  state.quizScore = 0;
  _setCoachFeedback(null);
  resetCoachAttempt({ newTarget: true });
  buildCoachOptions();
  buildCoachProgress();
  updateCoachPanel();
  updateReferenceForMode();
  syncRecordButton();
  // Words need the word model, which a letter session did not load.
  if (state.cameraOn && state.mode === "coach") loadModelsWithStatus(liveModelNeeds("coach"));
}

/**
 * @param {string} flow
 * @returns {void}
 */
function setCoachFlow(flow) {
  // includes() validates the value but cannot narrow its type, hence the cast.
  state.coachFlow = /** @type {CoachFlow} */ (
    ["learn", "practice", "quiz"].includes(flow) ? flow : "learn"
  );
  state.coachGoal = state.coachFlow === "quiz" ? state.quizTotal : 5;
  state.coachStep = 0;
  state.quizScore = 0;
  _setCoachFeedback(null);
  resetCoachAttempt({ newTarget: true });
  if (coachProgress.flow !== state.coachFlow) {
    coachProgress.flow = state.coachFlow;
    saveCoachProgress();
  }
  buildCoachProgress();
  updateCoachFlowButtons();
  updateCoachPanel();
}

/**
 * @param {HTMLElement | null} radio
 * @param {boolean} checked
 * @returns {void}
 */
function _markCoachRadio(radio, checked) {
  if (!radio) return;
  radio.classList.toggle("is-active", checked);
  radio.setAttribute("aria-checked", String(checked));
  radio.setAttribute("tabindex", checked ? "0" : "-1");
}

/**
 * @returns {void}
 */
function updateCoachModeButtons() {
  const isWord = state.coachTargetType === "word";
  _markCoachRadio(els.coachLettersOnly, !isWord);
  _markCoachRadio(els.coachWordsOnly, isWord);
  if (els.coachLetterPicker) els.coachLetterPicker.hidden = isWord;
  if (els.coachWordPicker) els.coachWordPicker.hidden = !isWord;
}

/**
 * @returns {void}
 */
function updateCoachFlowButtons() {
  queryElements("[data-coach-flow]").forEach((button) => {
    _markCoachRadio(button, button.dataset.coachFlow === state.coachFlow);
  });
}

/**
 * Arrow keys behave as in a native radio group.
 *
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function moveCoachRadio(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const group = event.currentTarget;
  if (!step || !(group instanceof HTMLElement) || !(event.target instanceof HTMLElement)) return;
  const radios = queryElements('[role="radio"]', group);
  const from = radios.indexOf(event.target);
  if (from < 0) return;
  event.preventDefault();
  const next = radios[(from + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/**
 * Lets the phone's Back gesture close the sheet without a history entry.
 *
 * @type {{ destroy(): void, onclose: (() => void) | null } | null}
 */
let _coachSheetWatcher = null;

/** @returns {boolean} */
function isCoachSheetOpen() {
  return els.coachStudy.dataset.open === "true";
}

/**
 * A sheet on a phone; on a laptop nothing visible changes.
 *
 * @param {boolean} open
 * @returns {void}
 */
function setCoachSheet(open) {
  if (open === isCoachSheetOpen()) return;
  els.coachStudy.dataset.open = String(open);
  els.coachSessionButton?.setAttribute("aria-expanded", String(open));
  if (open) {
    els.coachStudy.setAttribute("role", "dialog");
    els.coachStudy.setAttribute("aria-modal", "true");
    els.coachStudy.setAttribute("aria-label", t("coach.study.title"));
    els.coachSheetClose?.focus();
    // Not in the TypeScript DOM library yet.
    const Watcher = /** @type {any} */ (globalThis).CloseWatcher;
    if (typeof Watcher === "function") {
      _coachSheetWatcher = new Watcher();
      _coachSheetWatcher.onclose = () => setCoachSheet(false);
    }
  } else {
    _coachSheetWatcher?.destroy();
    _coachSheetWatcher = null;
    els.coachStudy.removeAttribute("role");
    els.coachStudy.removeAttribute("aria-modal");
    els.coachStudy.removeAttribute("aria-label");
    els.coachSessionButton?.focus();
  }
}

/**
 * @returns {{key: string, params?: I18nParams}}
 */
function coachSessionLabel() {
  if (state.coachFlow === "practice") return { key: "coach.session.practice", params: { count: state.coachGoal } };
  if (state.coachFlow === "quiz") return { key: "coach.session.quiz", params: { count: state.quizTotal } };
  return { key: "coach.session.learn" };
}

/**
 * Hiding is not a guard: each handler checks the state it needs.
 *
 * @returns {void}
 */
function syncCoachControls() {
  const isWord = _isCoachWordTarget();
  const done = !isWord && (state.coach.phase === "success" || state.coach.phase === "staying");
  const quiz = state.coachFlow === "quiz";
  if (els.coachRepeat) els.coachRepeat.hidden = !done;
  if (els.coachNext) els.coachNext.hidden = !done;
  if (els.coachNextTarget) els.coachNextTarget.hidden = done;
  if (els.coachHintButton instanceof HTMLButtonElement) {
    els.coachHintButton.hidden = done || isWord;
    els.coachHintButton.disabled = quiz;
  }
  // Holding the letter is its check; the button only records a word.
  if (els.coachCheck instanceof HTMLButtonElement) {
    els.coachCheck.hidden = !isWord;
    els.coachCheck.disabled = !isWord;
  }
  if (els.coachAdvance) els.coachAdvance.hidden = !state.coach.advancing;
  els.coachAdvanceBar?.style.setProperty("--advance-ms", `${CONFIG.COACH_ADVANCE_MS}ms`);
  // The cue gives way while the plate reports a miss or a success.
  const attempting = state.coach.phase === "miss" || done;
  els.coachHint.hidden = !isWord && !state.coach.hintOpen && (state.coachFlow !== "learn" || attempting);
}

/**
 * @returns {void}
 */
function updateCoachPanel() {
  const target = state.coachTarget;
  const isLetter = target.length === 1;
  els.coachTargetTile.dataset.kind = isLetter ? "letter" : "word";
  els.coachTargetGlyph.textContent = isLetter ? target.toUpperCase() : target;
  const targetText = isLetter
    ? t("coach.target.letter", { letter: target })
    : t("coach.target.word", { word: target });
  state.coachFeedback = _coachFeedback ? t(_coachFeedback.key, _coachFeedback.params) : "";
  els.coachHint.textContent =
    isLetter && state.coach.hintOpen
      ? coachHintLine(target)
      : isLetter && state.coachFlow === "learn"
        ? coachCueLine(target)
        : state.coachFeedback || targetText;
  els.coachScore.textContent =
    state.coachFlow === "quiz"
      ? `${state.quizScore}/${state.quizTotal}`
      : `${Math.min(state.coachStep, state.coachGoal)}/${state.coachGoal}`;
  const counted = state.coachFlow === "quiz" ? state.quizScore : Math.min(state.coachStep, state.coachGoal);
  setAttrText(els.coachProgress, "aria-label", "coach.session.progress", { goal: state.coachGoal, done: counted });
  if (els.coachSession) els.coachSession.dataset.flow = state.coachFlow;
  const session = coachSessionLabel();
  setText(els.coachSessionLabel, session.key, session.params);
  setText(els.coachSessionFlow, session.key, session.params);
  setText(els.coachStorageNote, coachProgressSaved ? "coach.letters.storageSaved" : "coach.letters.storageLost");
  [...els.coachProgress.children].forEach((cell, index) => {
    if (!(cell instanceof HTMLElement)) return;
    if (index < state.coachStep) cell.dataset.state = "hit";
    else if (index === state.coachStep) cell.dataset.state = "active";
    else delete cell.dataset.state;
  });
  renderCoachGrid();
  syncCoachControls();
  updateReferenceForMode();
  syncRecordButton();
  syncActionBar();
}

/**
 * @returns {void}
 */
function checkCoachTarget() {
  if (!_isCoachWordTarget()) return;
  if (!state.cameraOn) {
    setMessage(t("coach.check.startFirst"), "low");
    return;
  }
  startWordRecording();
}

/**
 * Quiz progress is kept: the quiz counts questions, not repetitions.
 *
 * @returns {void}
 */
function nextCoachTarget() {
  _coachTargetTouched = true;
  // The advance after a success also comes through here and is not a skip.
  if (!_isCoachWordTarget() && !state.coach.targetCounted) recordCoachLetter(state.coachTarget, "skip");
  const list = state.coachTargetType === "word" ? WORDS : coachLetterData.order;
  const currentIndex = Math.max(0, list.indexOf(state.coachTarget));
  const nextIndex = (currentIndex + 1) % list.length;
  state.coachStep = state.coachFlow === "quiz" ? state.coachStep : 0;
  _showCoachTarget(list[nextIndex]);
}

/**
 * The letter stays counted, so a quiz question still scores once.
 *
 * @returns {void}
 */
function repeatCoachTarget() {
  if (state.mode !== "coach" || _isCoachWordTarget()) return;
  _setCoachFeedback(null);
  resetCoachAttempt();
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateCoachPanel();
}

/**
 * The last letter is cleared: left on the plate it would read as current and
 * could be counted for the target.
 *
 * @returns {void}
 */
function noteCoachHandLost() {
  // After a success a lost hand counts as the release.
  _coachHold.reset();
  _coachMissCandidate = null;
  state.coach.holdProgress = 0;
  state.coach.missLetter = null;
  if (state.coach.phase !== "success" && state.coach.phase !== "staying") state.coach.phase = "no-hand";
  if (state.prediction === "?") return;
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
}

/**
 * The stage state paints the frame and the overlay, so "good" belongs to a
 * counted hold alone. The ring shows the hold, not the model's confidence.
 *
 * @type {Record<CoachPhase, {stage: string, ring: ConfidenceLevel, level: ConfidenceLevel, decision: (target: string) => string, message: (target: string, attempt: CoachAttempt) => string}>}
 */
const COACH_PLATE = {
  "camera-off": {
    stage: "idle",
    ring: "low",
    level: "low",
    decision: () => t("coach.plate.waiting"),
    message: () => t("coach.plate.cameraOff"),
  },
  "no-hand": {
    stage: "low",
    ring: "low",
    level: "low",
    decision: () => t("coach.plate.waiting"),
    message: () => t("coach.plate.noHand"),
  },
  watching: {
    stage: "maybe",
    ring: "maybe",
    level: "maybe",
    decision: (target) => t("coach.plate.target", { letter: target }),
    message: () => t("coach.plate.autoCheck"),
  },
  holding: {
    stage: "maybe",
    ring: "good",
    level: "maybe",
    decision: () => t("coach.plate.hold"),
    message: () => t("coach.plate.autoCheck"),
  },
  miss: {
    stage: "maybe",
    ring: "maybe",
    level: "maybe",
    decision: () => t("coach.plate.notYet"),
    message: (target, attempt) => coachMissText(attempt.missLetter, target),
  },
  success: {
    stage: "good",
    ring: "good",
    level: "good",
    decision: () => t("coach.plate.correct"),
    message: (target, attempt) =>
      `${t("coach.plate.shown", { letter: target })}${
        attempt.advancing ? ` ${t("coach.plate.upNext", { letter: _nextCoachLetter() })}` : ""
      }`,
  },
  staying: {
    stage: "good",
    ring: "good",
    level: "good",
    decision: () => t("coach.plate.correct"),
    message: () => t("coach.plate.whenReady"),
  },
};

/**
 * Nothing here reads the model's confidence; the glyph is left to
 * updatePrediction().
 *
 * @returns {void}
 */
function renderCoachPlate() {
  if (state.mode !== "coach" || !isLetterContext()) return;
  const plate = COACH_PLATE[state.coach.phase];
  const target = state.coachTarget;
  els.confidenceText.textContent = "--";
  els.confidenceRing.style.setProperty("--score", String(Math.round(state.coach.holdProgress * 100)));
  els.confidenceRing.className = `confidence-ring ${plate.ring}`;
  els.cameraStage.dataset.state = plate.stage;
  els.decisionLabel.textContent = plate.decision(target);
  const message = plate.message(target, state.coach);
  setMessage(message, plate.level);
  // Written only on a change, so each verdict is heard once. A language switch
  // empties the region rather than speak the same verdict again.
  const verdict = _coachVerdictText(plate.decision(target), message);
  const about = verdict ? [state.coach.phase, target, state.coach.missLetter, state.coach.advancing].join("|") : "";
  const language = currentLanguage();
  if (about !== _coachSpoken.about) _coachSpoken = { about, language, muted: false };
  else if (language !== _coachSpoken.language) _coachSpoken.muted = true;
  const spoken = _coachSpoken.muted ? "" : verdict;
  if (els.coachVerdict.textContent !== spoken) els.coachVerdict.textContent = spoken;
  syncCoachControls();
}

let _coachSpoken = { about: "", language: "", muted: false };

/**
 * Silent while the learner is still on the way to a success or a miss.
 *
 * @param {string} decision
 * @param {string} message
 * @returns {string}
 */
function _coachVerdictText(decision, message) {
  const { phase } = state.coach;
  if (phase !== "success" && phase !== "staying" && phase !== "miss") return "";
  return /[.!?…]$/.test(decision) ? `${decision} ${message}` : `${decision}. ${message}`;
}

/**
 * The only place a hold is counted; a pose held on afterwards stays blocked
 * until it is released.
 *
 * @param {PredictionResult} prediction
 * @param {number} now
 * @returns {void}
 */
function noteCoachLetter(prediction, now) {
  const hold = _coachHold.update(
    { label: prediction.label, confidence: prediction.confidence, handPresent: true },
    state.coachTarget,
    now,
  );
  state.coach.holdProgress = hold.progress;
  if (hold.phase === "done") {
    countCoachLetterHold();
    return;
  }
  if (state.coach.phase === "success" || state.coach.phase === "staying") return;
  if (hold.phase === "holding") {
    _coachMissCandidate = null;
    state.coach.missLetter = null;
    state.coach.phase = "holding";
    return;
  }
  if (state.coach.phase !== "miss") state.coach.phase = "watching";
  _followCoachMiss(prediction, now);
}

/**
 * @returns {void}
 */
function countCoachLetterHold() {
  const firstForTarget = !state.coach.targetCounted;
  state.coach.targetCounted = true;
  recordCoachLetter(state.coachTarget, "ok");
  // A repetition after staying does not start the wait again.
  if (state.coach.phase !== "staying") state.coach.phase = "success";
  if (state.coachFlow === "quiz" && firstForTarget) {
    state.quizScore = Math.min(state.quizTotal, state.quizScore + 1);
    state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
  } else if (state.coachFlow === "practice") {
    state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
  }
  _setCoachFeedback("coach.feedback.letter", { letter: state.coachTarget });
  const done = state.coachFlow === "practice" ? state.coachStep >= state.coachGoal : firstForTarget;
  if (done && state.coach.phase === "success" && !state.coach.advancing) _scheduleCoachAdvance();
  updateCoachPanel();
}

/**
 * Word targets only; a letter is counted by its hold.
 *
 * @returns {void}
 */
function updateCoachFromPrediction() {
  if (!_isCoachWordTarget()) return;
  const matched = state.prediction === state.coachTarget && state.confidence >= CONFIG.WORD_ACCEPT_THRESHOLD;

  if (matched) {
    if (state.coachFlow === "quiz") {
      state.quizScore = Math.min(state.quizTotal, state.quizScore + 1);
    }
    if (state.coachFlow !== "learn") {
      state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
    }
    _setCoachFeedback("coach.feedback.wordMatch");
  } else {
    _setCoachFeedback("coach.feedback.wordMiss");
  }
  updateCoachPanel();
}

// The word screen's side cards are built from the published evaluation data,
// not typed into the markup, so they cannot disagree with the report.

const WORD_GUIDE_EASY_COUNT = 10;
const WORD_GUIDE_PAIR_COUNT = 5;

const WORD_DIFFICULTY_LEVELS = ["easy", "medium", "hard"];

let _wordGuidanceRendered = false;

/**
 * "%7,6" and "%46" in Turkish, "7.6%" and "46%" in English.
 *
 * @param {number} value Probability in [0, 1].
 * @returns {string}
 */
function _wordGuidePercent(value) {
  const percent = value * 100;
  const text = Math.abs(percent) < 10 ? percent.toFixed(1).replace(/\.0$/, "") : String(Math.round(percent));
  return t("coach.wordGuide.percent", { n: currentLanguage() === "tr" ? text.replace(".", ",") : text });
}

/**
 * @param {unknown} value
 * @returns {number} NaN unless a finite number.
 */
function _statNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/**
 * Without difficulty labels every word is a candidate.
 *
 * @param {Record<string, PerWordStat>} stats
 * @param {number} limit
 * @returns {string[]}
 */
function easiestWords(stats, limit) {
  const entries = Object.entries(stats).filter(([word, stat]) => word && stat && typeof stat === "object");
  const easy = entries.filter(([, stat]) => stat.difficulty === "easy");
  const pool = easy.length ? easy : entries;
  /** @param {PerWordStat} stat */
  const score = (stat) => {
    const accuracy = _statNumber(stat.accuracy);
    return Number.isNaN(accuracy) ? _statNumber(stat.f1) : accuracy;
  };
  return pool
    .map(([word, stat]) => ({ word, score: score(stat) }))
    .filter((item) => !Number.isNaN(item.score))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, limit)
    .map((item) => item.word);
}

/**
 * "can" read as "yes" and "yes" read as "can" are one pair.
 *
 * @param {ConfusionPairRaw[]} pairs
 * @param {number} limit
 * @returns {ConfusionPair[]}
 */
function confusedPairsOnce(pairs, limit) {
  /** @type {Map<string, ConfusionPair>} */
  const merged = new Map();
  pairs.forEach((raw) => {
    const { a, b, count } = readConfusionPair(raw);
    if (!a || !b || a === b) return;
    const key = [a, b].sort().join("\u0000");
    const known = merged.get(key);
    if (known) known.count += count;
    else merged.set(key, { a, b, count });
  });
  return [...merged.values()].sort((x, y) => y.count - x.count).slice(0, limit);
}

/**
 * @param {string} word
 * @param {string} className
 * @returns {HTMLButtonElement}
 */
function wordCardButton(word, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.word = word;
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", () => {
    openReferenceViewer({ kind: "card", label: word, opener: button });
  });
  return button;
}

/**
 * The card's title ("thank you"), or the model's label before the cards load.
 *
 * @param {string} word
 * @returns {string}
 */
function wordDisplayName(word) {
  return (typeof wordCard === "function" && wordCard(word)?.title) || word;
}

/**
 * @param {string} text
 * @param {string} [className]
 * @param {string} [lang]
 * @returns {HTMLSpanElement}
 */
function _span(text, className = "", lang = "") {
  const span = document.createElement("span");
  if (className) span.className = className;
  if (lang) span.lang = lang;
  span.textContent = text;
  return span;
}

/**
 * @param {string} word
 * @returns {HTMLLIElement}
 */
function _wordChipItem(word) {
  const item = document.createElement("li");
  const button = wordCardButton(word, "word-chip");
  button.append(_span(wordDisplayName(word), "", "en"));
  item.append(button);
  return item;
}

/**
 * A list the data cannot fill is left as it is, so a failed fetch never
 * blanks it.
 *
 * @returns {void}
 */
function renderWordGuidancePanel() {
  _wordGuidanceRendered = true;
  const stats =
    typeof perWordStats !== "undefined" && perWordStats && typeof perWordStats === "object"
      ? perWordStats
      : {};
  const pairs =
    typeof confusionPairs !== "undefined" && Array.isArray(confusionPairs)
      ? confusionPairs
      : [];

  const easy = easiestWords(stats, WORD_GUIDE_EASY_COUNT);
  if (els.wordDemoList && easy.length) {
    els.wordDemoList.replaceChildren(...easy.map(_wordChipItem));
    setText(els.wordDemoCount, "coach.wordGuide.easyCount", { count: easy.length });
    if (els.wordDemoCard) els.wordDemoCard.hidden = false;
  }

  const confused = confusedPairsOnce(pairs, WORD_GUIDE_PAIR_COUNT);
  if (els.wordConfusionList && confused.length) {
    els.wordConfusionList.replaceChildren(
      ...confused.map(({ a, b }) => {
        const item = document.createElement("li");
        const first = wordCardButton(a, "word-chip");
        first.append(_span(wordDisplayName(a), "", "en"));
        const second = wordCardButton(b, "word-chip");
        second.append(_span(wordDisplayName(b), "", "en"));
        const sep = _span("↔", "word-pair__sep");
        sep.setAttribute("aria-hidden", "true");
        item.append(first, sep, _span(` ${t("coach.wordGuide.pairJoin")} `, "visually-hidden"), second);
        return item;
      }),
    );
  }
  renderWordLibrary(stats);
}

/**
 * @param {Record<string, PerWordStat>} stats
 * @returns {void}
 */
function renderWordLibrary(stats) {
  const groups = els.wordLibraryGroups;
  if (!groups) return;
  groups.replaceChildren(
    ...WORD_CATEGORIES.map((category, index) => {
      const section = document.createElement("section");
      section.className = "word-library__group";
      const heading = document.createElement("h3");
      heading.className = "word-library__title";
      heading.id = `wordLibraryGroup${index + 1}`;
      heading.textContent = category.title;
      const list = document.createElement("ul");
      list.className = "word-library__list";
      list.setAttribute("aria-labelledby", heading.id);
      list.append(...category.words.map((word) => _wordLibraryItem(word, stats[word] || {})));
      section.append(heading, list);
      return section;
    }),
  );
  filterWordLibrary();
}

/**
 * @param {string} word
 * @param {PerWordStat} stat
 * @returns {HTMLLIElement}
 */
function _wordLibraryItem(word, stat) {
  const card = wordCard(word);
  const gloss = card ? wordGloss(card) : "";
  const item = document.createElement("li");
  const button = wordCardButton(word, "word-entry");
  button.dataset.gloss = gloss;
  button.dataset.difficulty = stat.difficulty || "unknown";
  button.append(_span(wordDisplayName(word), "word-entry__name", "en"));
  // An English reader does not need the Turkish gloss; the search still finds it.
  if (gloss && currentLanguage() === "tr") button.append(_span(` (${gloss})`, "word-entry__gloss"));
  const level = stat.difficulty || "";
  const parts = [WORD_DIFFICULTY_LEVELS.includes(level) ? t(`coach.wordGuide.level.${level}`) : ""];
  const accuracy = _statNumber(stat.accuracy);
  if (!Number.isNaN(accuracy)) parts.push(_wordGuidePercent(accuracy));
  const hint = parts.filter(Boolean).join(" · ");
  if (hint) {
    // The comma keeps the name and the hint apart when read aloud.
    button.append(_span(", ", "visually-hidden"), _span(hint, "word-entry__hint"));
  }
  item.append(button);
  return item;
}

/**
 * A Turkish gloss is matched with Turkish case rules, so "İ" finds "i" and
 * "I" finds "ı".
 *
 * @returns {void}
 */
function filterWordLibrary() {
  const groups = els.wordLibraryGroups;
  if (!groups) return;
  const raw = (els.wordLibrarySearch?.value ?? "").trim();
  const query = raw.toLowerCase();
  const queryTr = raw.toLocaleLowerCase("tr");
  let shown = 0;
  for (const section of Array.from(groups.children)) {
    if (!(section instanceof HTMLElement)) continue;
    let inGroup = 0;
    for (const button of Array.from(section.querySelectorAll("[data-word]"))) {
      if (!(button instanceof HTMLElement)) continue;
      const word = button.dataset.word ?? "";
      const gloss = button.dataset.gloss ?? "";
      const match =
        !raw ||
        word.toLowerCase().includes(query) ||
        wordDisplayName(word).toLowerCase().includes(query) ||
        (gloss !== "" && gloss.toLocaleLowerCase("tr").includes(queryTr));
      if (button.parentElement) button.parentElement.hidden = !match;
      if (match) inGroup += 1;
    }
    section.hidden = inGroup === 0;
    shown += inGroup;
  }
  if (els.wordLibraryEmpty) els.wordLibraryEmpty.hidden = shown > 0;
}

/**
 * Redraws only: no listener, timer or fetch starts.
 *
 * @param {Language} previous
 * @returns {void}
 */
function renderCoachLanguage(previous) {
  buildCoachOptions();
  // Another screen's coach card is redrawn when the coach opens.
  if (state.mode === "coach") updateCoachPanel();
  else renderCoachGrid();
  renderCoachPlate();
  if (isCoachSheetOpen()) els.coachStudy.setAttribute("aria-label", t("coach.study.title"));
  // The one plate message the coach writes outside its own plate.
  if (els.confidenceMessage.textContent === translateIn(previous, "coach.check.startFirst")) {
    setMessage(t("coach.check.startFirst"), "low");
  }
  if (_wordGuidanceRendered) renderWordGuidancePanel();
}
