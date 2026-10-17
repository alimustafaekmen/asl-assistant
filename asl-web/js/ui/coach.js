// Learning coach: target selection, study flows, scoring, and the word
// screen's guidance cards.
//
// A coach target is a single letter or a word. A letter is scored by holding
// it: live inference feeds every smoothed result to the hold detector
// (ml/hold.js), and a completed hold counts once. A button press never scores
// a letter, because it reads whatever happens to be on the plate: one pose
// pressed five times, or a letter that has already left the camera. A word is
// scored from the result of a completed 45-frame recording.
//
// Learn shows guidance without scoring, practice counts five correct
// repetitions, and quiz counts answers over a fixed question total.
//
// Progress is kept on this device under one localStorage key: per letter, how
// often it was shown correctly, with a hint, and skipped, plus the flow last
// used. Nothing personal and no timestamps. Storage that is missing, corrupt
// or refused gives a fresh start in memory.
//
// The teaching data (the teaching order, a written cue per letter, and groups
// of look-alike letters) is read on the first visit to the coach. The coach
// never waits for it: until it arrives, or if it cannot be read, letters come
// in alphabetical order without cues.
//
// The word guidance cards read the published evaluation data and never
// recompute it.

/**
 * The hold detector for the current target letter. It holds no DOM and
 * starts nothing.
 */
const _coachHold = createHoldTracker({
  holdMs: CONFIG.COACH_HOLD_MS,
  minConfidence: CONFIG.COACH_HOLD_CONFIDENCE,
  graceMs: CONFIG.COACH_HOLD_GRACE_MS,
  releaseMs: CONFIG.COACH_RELEASE_MS,
});

/**
 * A group of letters whose handshapes look alike, and what tells them apart.
 *
 * @typedef {Object} CoachConfusionGroup
 * @property {string[]} letters Members, every one of them in LETTERS.
 * @property {string} reason Turkish sentence: what the members share and what differs.
 * @property {Record<string, string>} cues Turkish cue for each member, telling it from the others.
 */

/**
 * The letter teaching data, as the coach uses it.
 *
 * @typedef {Object} CoachLetterData
 * @property {string[]} order Every letter of LETTERS once, in teaching order.
 * @property {Record<string, string>} cues Turkish handshape cue per letter; a letter may have none.
 * @property {Record<string, string[]>} confusable Look-alike letters per letter.
 * @property {CoachConfusionGroup[]} groups
 */

/**
 * The teaching data in use: the alphabet without cues until the files have
 * been read, and for the visit if they cannot be.
 *
 * @type {CoachLetterData}
 */
let coachLetterData = { order: [...LETTERS], cues: {}, confusable: {}, groups: [] };

/**
 * Where the teaching data stands. "failed" means the curriculum could not be
 * used; the look-alike groups are optional and fail on their own.
 *
 * @type {"idle" | "loading" | "ready" | "failed"}
 */
let coachLetterDataStatus = "idle";

/** The one read of the teaching data, once it has started. @type {Promise<void> | null} */
let _coachLetterDataLoad = null;

/**
 * Whether the learner has moved the target themselves. Teaching data that
 * arrives late may start the teaching order only while this is false.
 */
let _coachTargetTouched = false;

/**
 * What the coach remembers about one letter.
 *
 * @typedef {Object} CoachLetterRecord
 * @property {number} ok Counted holds.
 * @property {number} hint Times the hint was opened for it.
 * @property {number} skip Times it was moved on from without a counted hold.
 */

/**
 * The coach's progress on this device: the value stored under
 * COACH_PROGRESS_KEY.
 *
 * @typedef {Object} CoachProgress
 * @property {1} v
 * @property {CoachFlow} flow The flow last used.
 * @property {Record<string, CoachLetterRecord>} letters Only letters of LETTERS.
 */

const COACH_PROGRESS_KEY = "asl-coach-v1";

/** The progress in use; kept in memory when storage cannot hold it. @type {CoachProgress} */
let coachProgress = { v: 1, flow: "learn", letters: {} };

/** Whether storage is keeping the progress. */
let coachProgressSaved = true;

/** Whether the stored progress has been read; it is read once, on the first visit. */
let _coachProgressRead = false;

/**
 * Read stored progress, keeping only what can be trusted.
 *
 * A letter outside LETTERS or a count that is not a non-negative integer is
 * dropped, and an unknown flow becomes "learn", so nothing stored can make
 * the coach throw or teach a letter the model does not know.
 *
 * @param {string | null} raw The stored text.
 * @returns {CoachProgress | null} Null when there is nothing usable.
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
 * Read the stored progress the first time the coach opens, and return to the
 * flow last used.
 *
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
 * Store the progress. When storage refuses, it stays in memory and the coach
 * says so.
 *
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
 * Add one to a letter's count, and store it.
 *
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
 * Forget the progress, with a toast that can bring it back.
 *
 * @returns {void}
 */
function resetCoachProgress() {
  const previous = JSON.parse(JSON.stringify(coachProgress));
  coachProgress = { v: 1, flow: coachProgress.flow, letters: {} };
  saveCoachProgress();
  updateCoachPanel();
  showToast("İlerleme sıfırlandı", {
    action: {
      label: "Geri al",
      run: () => {
        coachProgress = previous;
        saveCoachProgress();
        updateCoachPanel();
      },
    },
  });
}

/**
 * The first letter of the teaching order not yet shown correctly, or the
 * first letter when every one has been.
 *
 * @returns {string}
 */
function _firstCoachLetterToLearn() {
  const order = coachLetterData.order;
  return order.find((letter) => !(coachProgress.letters[letter]?.ok >= 1)) ?? order[0];
}

/**
 * Start the attempt at the target over.
 *
 * Called when the target, the flow or the screen changes and when the camera
 * stops, because a hold in progress belongs to the target and the camera
 * session it started in. Only a new target forgets that it was counted.
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
 * Open the hint for the target letter: its cue and look-alikes in the coach
 * card, and the reference image.
 *
 * In practice an opened hint is recorded for the letter, once per target.
 * Learn shows the cue anyway, and the quiz has no hints.
 *
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
 * The hint line for a target letter: its cue, and the letters it is
 * confused with.
 *
 * @param {string} target
 * @returns {string}
 */
function coachHintLine(target) {
  const lookAlikes = coachLetterData.confusable[target] ?? [];
  const confused = lookAlikes.length ? ` Karışabilir: ${lookAlikes.join(", ")}.` : "";
  return `İpucu: ${target}. ${coachCueLine(target)}${confused}`;
}

/**
 * Do what the coach offers next, as Space does: move on after a success, or
 * open the hint during a miss in learn or practice.
 *
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

/** The pending advance to the next target after a success, or 0. */
let _coachAdvanceTimer = 0;

/** @returns {void} */
function _cancelCoachAdvance() {
  clearTimeout(_coachAdvanceTimer);
  _coachAdvanceTimer = 0;
  state.coach.advancing = false;
}

/**
 * Bring the next target up after COACH_ADVANCE_MS, unless the learner stays.
 *
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
 * Stay on the target: stop the next one from coming up on its own.
 *
 * Escape, focus moving into the coach's buttons, and the page going to the
 * background all call this, so the timer never decides for a learner who is
 * reading, reaching for a button, or away (WCAG 2.2.1).
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
 * The letter after the target in the teaching order.
 *
 * @returns {string}
 */
function _nextCoachLetter() {
  const order = coachLetterData.order;
  return order[(Math.max(0, order.indexOf(state.coachTarget)) + 1) % order.length];
}

/**
 * What the camera has shown instead of the target, and since when; null
 * while the target, or nothing, is in view. "?" stands for a hand the model
 * cannot read.
 *
 * @type {{seen: string, since: number} | null}
 */
let _coachMissCandidate = null;

/**
 * Follow what the camera shows instead of the target, and call a miss once
 * it has lasted COACH_MISS_MS.
 *
 * Another letter counts once it reaches the unknown threshold; anything less
 * sure is an unreadable hand. The target itself, even below the hold
 * confidence, is not a miss: the learner is close. Each new letter starts its
 * own miss timer.
 *
 * @param {PredictionResult} prediction The smoothed result.
 * @param {number} now Render loop timestamp in milliseconds.
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
 * The plate's line for a miss: what the camera sees, and what tells it from
 * the target.
 *
 * A look-alike group holding both letters gives its reason and its cue for
 * the target, so a target in two groups is explained by the pair actually
 * confused. Otherwise the target's curriculum cue follows; without data only
 * the letter is named.
 *
 * @param {string | null} seen The attempt's missLetter.
 * @param {string} target
 * @returns {string}
 */
function coachMissText(seen, target) {
  if (seen === null) return "";
  if (seen === "?") return "El şekli net seçilemedi. Kol boyu uzaklık, iyi ışık, eliniz kadrajın ortasında.";
  const named = `Şu an ${seen} görünüyor.`;
  const group = coachLetterData.groups.find(
    (candidate) => candidate.letters.includes(seen) && candidate.letters.includes(target),
  );
  const cue = (group && group.cues[target]) || coachLetterData.cues[target];
  if (group) return cue ? `${named} ${group.reason} ${target}: ${cue}` : `${named} ${group.reason}`;
  return cue ? `${named} ${target}: ${cue}` : named;
}

/**
 * Read the curriculum file into the order and the cues.
 *
 * Only letters of LETTERS are kept, each once, and any the file leaves out
 * are appended in alphabetical order, so a file that drifts from the model's
 * labels can neither drop a letter from the coach nor add one.
 *
 * @param {unknown} data Parsed letter_curriculum.json.
 * @returns {Pick<CoachLetterData, "order" | "cues" | "confusable"> | null} Null for another schema.
 */
function readLetterCurriculum(data) {
  if (!isRecord(data) || data.schema_version !== "letter-curriculum-v1") return null;
  /** @type {string[]} */
  const order = [];
  for (const letter of Array.isArray(data.suggested_order) ? data.suggested_order : []) {
    if (typeof letter === "string" && LETTERS.includes(letter) && !order.includes(letter)) order.push(letter);
  }
  for (const letter of LETTERS) if (!order.includes(letter)) order.push(letter);
  /** @type {Record<string, string>} */
  const cues = {};
  /** @type {Record<string, string[]>} */
  const confusable = {};
  for (const entry of Array.isArray(data.letters) ? data.letters : []) {
    if (!isRecord(entry) || typeof entry.letter !== "string" || !LETTERS.includes(entry.letter)) continue;
    const letter = entry.letter;
    if (typeof entry.cue_tr === "string" && entry.cue_tr) cues[letter] = entry.cue_tr;
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
 * Read the confusion file into its look-alike groups.
 *
 * A group keeps its members of LETTERS; one left with fewer than two, or
 * without a reason, teaches nothing and is dropped.
 *
 * @param {unknown} data Parsed letter_confusion.json.
 * @returns {CoachConfusionGroup[] | null} Null for another schema.
 */
function readLetterConfusion(data) {
  if (!isRecord(data) || data.schema_version !== "letter-confusion-v1") return null;
  /** @type {CoachConfusionGroup[]} */
  const groups = [];
  for (const group of Array.isArray(data.groups) ? data.groups : []) {
    if (!isRecord(group) || typeof group.reason_tr !== "string" || !group.reason_tr) continue;
    const listed = Array.isArray(group.letters) ? group.letters : [];
    const letters = LETTERS.filter((letter) => listed.includes(letter));
    if (letters.length < 2) continue;
    const given = isRecord(group.cues) ? group.cues : {};
    /** @type {Record<string, string>} */
    const cues = {};
    for (const letter of letters) {
      const cue = given[letter];
      if (typeof cue === "string" && cue) cues[letter] = cue;
    }
    groups.push({ letters, reason: group.reason_tr, cues });
  }
  return groups;
}

/**
 * Fetch and read one teaching data file. Any failure gives null: the coach
 * goes without that file. The failure is still reported, naming the file, or
 * a broken deploy would lose the cues without a trace.
 *
 * @template T
 * @param {string} path
 * @param {(data: unknown) => T | null} read
 * @param {string} fallback What the coach does without the file, for the warning.
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
 * Read the letter teaching data the first time the coach opens.
 *
 * Not at startup, since most visitors never open the coach. Nothing waits for
 * it. When the data arrives, a target the learner has not moved yet goes to
 * the first letter of the teaching order.
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
 * The line under a target letter in learn: its handshape cue, or why there
 * is none.
 *
 * @param {string} target
 * @returns {string}
 */
function coachCueLine(target) {
  if (coachLetterDataStatus === "failed") return "İpuçları yüklenemedi. Referans görseline bakabilirsiniz.";
  return coachLetterData.cues[target]
    || `Hedef harf: ${target}. El şekli kameraya net görünmeli; poz en az 1 saniye sabit kalmalı.`;
}

/**
 * Show a new target, with nothing seen for it yet.
 *
 * @param {string} target
 * @returns {void}
 */
function _showCoachTarget(target) {
  state.coachTarget = target;
  state.coachFeedback = "";
  resetCoachAttempt({ newTarget: true });
  if (els.coachTarget) els.coachTarget.value = target;
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  // The plate shows what the camera sees; the new target is in the coach
  // card. Another screen's plate is not the coach's to clear.
  if (state.mode === "coach") updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateCoachPanel();
  updateReferenceForMode();
}

/**
 * @param {string} target The value chosen in the target list or grid.
 * @returns {void}
 */
function chooseCoachTarget(target) {
  _coachTargetTouched = true;
  state.coachStep = 0;
  _showCoachTarget(target);
}

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
 * Rebuild the letter grid: one button per letter, in alphabetical order
 * rather than teaching order, so a letter stays where the learner last saw
 * it. In a quiz the grid takes no pick, because the quiz chooses the letters.
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
 * Paint the letter grid from the progress and the target: which letter is
 * current, and which have been shown correctly at least once.
 *
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
    button.setAttribute("aria-label", current ? `${letter}, şimdiki hedef` : shown ? `${letter}, tamamlandı` : letter);
    button.setAttribute("aria-disabled", String(quiz));
    if (current) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  if (els.coachDone) els.coachDone.textContent = `${done}/${LETTERS.length}`;
}

/**
 * Switch between letter and word targets, resetting the session count.
 *
 * @param {string} type Anything other than "word" selects letters.
 * @returns {void}
 */
function setCoachTargetType(type) {
  _coachTargetTouched = true;
  state.coachTargetType = type === "word" ? "word" : "letter";
  state.coachTarget = state.coachTargetType === "word" ? "water" : "A";
  state.coachStep = 0;
  state.quizScore = 0;
  state.coachFeedback = "";
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
 * Switch the study flow and reset the session count for it.
 *
 * Quiz counts answers over a fixed question total; the other flows count five
 * correct repetitions.
 *
 * @param {string} flow Anything unrecognised selects "learn".
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
  state.coachFeedback = "";
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
 * Mark the one checked radio of a group, and leave only it in the tab order.
 *
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
 * Mark which target type is active, and show the picker that goes with it:
 * the letter grid, or the word list.
 *
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
 * Mark which study flow is active.
 *
 * @returns {void}
 */
function updateCoachFlowButtons() {
  queryElements("[data-coach-flow]").forEach((button) => {
    _markCoachRadio(button, button.dataset.coachFlow === state.coachFlow);
  });
}

/**
 * Arrow keys in a radio group check and focus the next or previous radio,
 * wrapping at the ends, as a native radio group does.
 *
 * @param {KeyboardEvent} event A keydown inside the group.
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

/** @returns {boolean} Whether the phone's study sheet is open. */
function isCoachSheetOpen() {
  return els.coachStudy.dataset.open === "true";
}

/**
 * Open or close the study controls as a sheet over the screen, on a phone.
 * On a laptop they always sit beside the stage, and this changes nothing
 * visible.
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
    els.coachStudy.setAttribute("aria-label", "Çalışma");
    els.coachSheetClose?.focus();
  } else {
    els.coachStudy.removeAttribute("role");
    els.coachStudy.removeAttribute("aria-modal");
    els.coachStudy.removeAttribute("aria-label");
    els.coachSessionButton?.focus();
  }
}

/**
 * @returns {string} The study flow and its measure, as the session button
 *   shows them.
 */
function coachSessionLabel() {
  if (state.coachFlow === "practice") return `Pratik: ${state.coachGoal} tekrar`;
  if (state.coachFlow === "quiz") return `Sınav: ${state.quizTotal} soru`;
  return "Öğrenme: sırayla";
}

/**
 * Show the dock buttons and the plate's extras that fit the attempt's phase.
 *
 * After a success the dock offers Tekrar and Sonraki, and the wait for the
 * next target shows its bar and Burada kal. Before one it offers Atla and
 * İpucu; the quiz has no hint, and a word has a check button instead. Hiding
 * is not a guard: each handler checks the state it needs.
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
  // The cue gives way while the plate reports a miss or a success; it shows
  // while a letter is studied in learn, and always once asked for.
  const attempting = state.coach.phase === "miss" || done;
  els.coachHint.hidden = !isWord && !state.coach.hintOpen && (state.coachFlow !== "learn" || attempting);
}

/**
 * Redraw the coach for the current target and progress.
 *
 * @returns {void}
 */
function updateCoachPanel() {
  const target = state.coachTarget;
  const isLetter = target.length === 1;
  els.coachTargetTile.dataset.kind = isLetter ? "letter" : "word";
  els.coachTargetGlyph.textContent = isLetter ? target.toUpperCase() : target;
  const targetText = isLetter
    ? `Hedef harf: ${target}. El şekli kameraya net görünmeli; poz en az 1 saniye sabit kalmalı.`
    : `Hedef kelime: ${target}. Hareketi 3-5 saniye içinde tamamlayın. El, yüz ve omuzlar kadrajda kalmalı.`;
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
  els.coachProgress.setAttribute("aria-label", `Oturum: ${state.coachGoal} hedeften ${counted} tamamlandı`);
  if (els.coachSession) els.coachSession.dataset.flow = state.coachFlow;
  if (els.coachSessionLabel) els.coachSessionLabel.textContent = coachSessionLabel();
  if (els.coachSessionFlow) els.coachSessionFlow.textContent = coachSessionLabel();
  if (els.coachStorageNote) {
    els.coachStorageNote.textContent = coachProgressSaved
      ? "İlerlemeniz yalnızca bu cihazda saklanır, kimseyle paylaşılmaz."
      : "İlerleme bu tarayıcıda saklanamıyor; sayfayı kapatınca sıfırlanır.";
  }
  // The stylesheet selects "hit" for a done target and "active" for the
  // current one.
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
 * Check a word target: start a recording, which is scored from its result.
 * Does nothing for a letter, whose check is the hold.
 *
 * @returns {void}
 */
function checkCoachTarget() {
  if (!_isCoachWordTarget()) return;
  if (!state.cameraOn) {
    setMessage("Önce çalışmayı başlatın.", "low");
    return;
  }
  startWordRecording();
}

/**
 * Move to the next target: the next word, or the next letter of the
 * teaching order.
 *
 * Temporal state is reset so the previous target cannot be scored against the
 * new one. Quiz progress is kept, because the quiz counts questions, not
 * repetitions.
 *
 * @returns {void}
 */
function nextCoachTarget() {
  _coachTargetTouched = true;
  // Moving on from a letter that was not shown is a skip; the advance after
  // a success comes through here too, and is not.
  if (!_isCoachWordTarget() && !state.coach.targetCounted) recordCoachLetter(state.coachTarget, "skip");
  const list = state.coachTargetType === "word" ? WORDS : coachLetterData.order;
  const currentIndex = Math.max(0, list.indexOf(state.coachTarget));
  const nextIndex = (currentIndex + 1) % list.length;
  state.coachStep = state.coachFlow === "quiz" ? state.coachStep : 0;
  _showCoachTarget(list[nextIndex]);
}

/**
 * Start the attempt over on the same letter.
 *
 * Nothing already counted is taken back, and the letter stays counted, so a
 * quiz question still scores once. The wait for the next target ends, since
 * the learner chose this one.
 *
 * @returns {void}
 */
function repeatCoachTarget() {
  if (state.mode !== "coach" || _isCoachWordTarget()) return;
  state.coachFeedback = "";
  resetCoachAttempt();
  if (typeof resetSmoother === "function") resetSmoother();
  if (typeof resetLetterLandmarkSmoother === "function") resetLetterLandmarkSmoother();
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  updateCoachPanel();
}

/**
 * Note that the hand has left the camera, in a coach letter context.
 *
 * Live inference calls this on every frame without a hand; only the first one
 * after a hand changes anything. The last letter is cleared from the plate
 * and the prediction state: left there, it would read as current and could
 * be counted for the target.
 *
 * @returns {void}
 */
function noteCoachHandLost() {
  // A lost hand ends a hold and any miss at once; after a success it counts
  // as the release.
  _coachHold.reset();
  _coachMissCandidate = null;
  state.coach.holdProgress = 0;
  state.coach.missLetter = null;
  if (state.coach.phase !== "success" && state.coach.phase !== "staying") state.coach.phase = "no-hand";
  if (state.prediction === "?") return;
  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
}

/**
 * What the plate says in each phase of an attempt at a target letter.
 *
 * The stage state is what the frame and the landmark overlay are painted
 * with, so "good" belongs to a counted hold alone. The ring is the hold, not
 * the model's confidence; it shows the success colour while it fills.
 *
 * @type {Record<CoachPhase, {stage: string, ring: ConfidenceLevel, level: ConfidenceLevel, decision: (target: string) => string, message: (target: string, attempt: CoachAttempt) => string}>}
 */
const COACH_PLATE = {
  "camera-off": {
    stage: "idle",
    ring: "low",
    level: "low",
    decision: () => "Bekleniyor",
    message: () => "Kamerayı açtığınızda sonuç burada görünür.",
  },
  "no-hand": {
    stage: "low",
    ring: "low",
    level: "low",
    decision: () => "Bekleniyor",
    message: () => "Elinizi kadrajın ortasına getirin.",
  },
  watching: {
    stage: "maybe",
    ring: "maybe",
    level: "maybe",
    decision: (target) => `Hedef: ${target}`,
    message: () => "Halka dolunca kendiliğinden kontrol edilir.",
  },
  holding: {
    stage: "maybe",
    ring: "good",
    level: "maybe",
    decision: () => "Tutun…",
    message: () => "Halka dolunca kendiliğinden kontrol edilir.",
  },
  miss: {
    stage: "maybe",
    ring: "maybe",
    level: "maybe",
    decision: () => "Henüz olmadı",
    message: (target, attempt) => coachMissText(attempt.missLetter, target),
  },
  success: {
    stage: "good",
    ring: "good",
    level: "good",
    decision: () => "Doğru!",
    message: (target, attempt) =>
      `${target} harfini net gösterdiniz.${attempt.advancing ? ` Sıradaki: ${_nextCoachLetter()}` : ""}`,
  },
  staying: {
    stage: "good",
    ring: "good",
    level: "good",
    decision: () => "Doğru!",
    message: () => "Hazır olduğunuzda Sonraki'ye basın.",
  },
};

/**
 * Paint the plate and the stage from the attempt at the target letter.
 *
 * Only the glyph is left to updatePrediction(): it shows the letter the
 * camera sees, while the target stays in the coach card. Nothing here reads
 * the model's confidence.
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
  // Written only when it differs, so a screen reader hears each verdict once
  // and a continuing hold says nothing more.
  const verdict = _coachVerdictText(plate.decision(target), message);
  if (els.coachVerdict.textContent !== verdict) els.coachVerdict.textContent = verdict;
  syncCoachControls();
}

/**
 * What a screen reader is told about the attempt: the success or the miss,
 * and nothing while the learner is still on the way to either.
 *
 * @param {string} decision The plate's headline.
 * @param {string} message The plate's line under it.
 * @returns {string}
 */
function _coachVerdictText(decision, message) {
  const { phase } = state.coach;
  if (phase !== "success" && phase !== "staying" && phase !== "miss") return "";
  return /[.!?…]$/.test(decision) ? `${decision} ${message}` : `${decision}. ${message}`;
}

/**
 * Feed one smoothed letter result to the hold on the target letter.
 *
 * Live inference calls this before the result is shown. A hold that
 * completes is counted here and nowhere else; the detector reports it once,
 * and a pose held on afterwards stays blocked until it is released.
 *
 * @param {PredictionResult} prediction The smoothed result.
 * @param {number} now Render loop timestamp in milliseconds.
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
    // The learner is on the target; whatever was missed is behind them.
    _coachMissCandidate = null;
    state.coach.missLetter = null;
    state.coach.phase = "holding";
    return;
  }
  if (state.coach.phase !== "miss") state.coach.phase = "watching";
  _followCoachMiss(prediction, now);
}

/**
 * Count a completed hold of the target letter.
 *
 * Practice counts repetitions, so every hold after a release counts; a quiz
 * question scores once. Learn shows guidance and counts nothing.
 *
 * @returns {void}
 */
function countCoachLetterHold() {
  const firstForTarget = !state.coach.targetCounted;
  state.coach.targetCounted = true;
  recordCoachLetter(state.coachTarget, "ok");
  // A repetition after staying stays; it does not start the wait again.
  if (state.coach.phase !== "staying") state.coach.phase = "success";
  if (state.coachFlow === "quiz" && firstForTarget) {
    state.quizScore = Math.min(state.quizTotal, state.quizScore + 1);
    state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
  } else if (state.coachFlow === "practice") {
    state.coachStep = Math.min(state.coachGoal, state.coachStep + 1);
  }
  state.coachFeedback = `Doğru! ${state.coachTarget} harfini net gösterdiniz.`;
  // The next target comes up on its own once this one is done: at its first
  // success in learn and quiz, at the last repetition in practice.
  const done = state.coachFlow === "practice" ? state.coachStep >= state.coachGoal : firstForTarget;
  if (done && state.coach.phase === "success" && !state.coach.advancing) _scheduleCoachAdvance();
  updateCoachPanel();
}

/**
 * Compare a finished word recording against the word target and record the
 * outcome. A letter never reaches this: it is counted by its hold, not from
 * what the plate shows.
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
    state.coachFeedback = "Doğru eşleşme. Hareket akışı ve kadraj koşulları yeterli görünüyor.";
  } else {
    state.coachFeedback = "Hedefle eşleşmedi. Hareket daha yavaş tamamlanmalı; yüz ve omuzlar görünür kalmalı.";
  }
  updateCoachPanel();
}

// The word screen's side cards. "Önce bunları deneyin" lists the words the
// published evaluation found easiest and the pairs it confused most; "50
// kelime" lists every word by group with how well it was recognised. Both are
// built from per_word_stats.json and confusion_pairs.json rather than typed
// into the markup, so they cannot disagree with the report. Every word is a
// button that opens its card in the reference viewer.

/** How many easy words the first card offers, and how many confused pairs. */
const WORD_GUIDE_EASY_COUNT = 10;
const WORD_GUIDE_PAIR_COUNT = 5;

/** Display names of the published difficulty levels. @type {Record<string, string>} */
const WORD_DIFFICULTY_LABELS = { easy: "kolay", medium: "orta", hard: "zor" };

/**
 * @param {unknown} value
 * @returns {number} The value when it is a finite number, otherwise NaN.
 */
function _statNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/**
 * The easiest words by the published evaluation: those it marked easy, best
 * recognised first. Without difficulty labels every word is a candidate.
 * Ranked by accuracy, or by F1 where accuracy is missing.
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
 * The most confused pairs, each named once in either direction: "can" read as
 * "yes" and "yes" read as "can" are one pair, and their counts add up.
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
 * A button that opens one word's card in the viewer; focus comes back to it
 * when the viewer closes.
 *
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
 * What a word is called on screen: its card's title ("thank you"), or the
 * model's label when the cards have not loaded.
 *
 * @param {string} word The model's label.
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
 * @returns {HTMLLIElement} A list item holding the word's chip.
 */
function _wordChipItem(word) {
  const item = document.createElement("li");
  const button = wordCardButton(word, "word-chip");
  button.append(_span(wordDisplayName(word), "", "en"));
  item.append(button);
  return item;
}

/**
 * Fill the word screen's two side cards from the published evaluation data.
 *
 * Runs once, after the data has settled. A list the data cannot fill is left
 * as it is, so a failed fetch never blanks it; the first card stays hidden
 * until it has words to offer.
 *
 * @returns {void}
 */
function renderWordGuidancePanel() {
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
    if (els.wordDemoCount) els.wordDemoCount.textContent = `${easy.length} kolay kelime`;
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
        item.append(first, sep, _span(" ile ", "visually-hidden"), second);
        return item;
      }),
    );
  }
  renderWordLibrary(stats);
}

/**
 * Build the "50 kelime" list: one group per category, one button per word
 * with how the published evaluation found it, in words and as a percentage.
 *
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
 * @returns {HTMLLIElement} The word's entry: its name, its gloss once
 *   reviewed, and how well it was recognised.
 */
function _wordLibraryItem(word, stat) {
  const card = wordCard(word);
  const gloss = card ? wordGloss(card) : "";
  const item = document.createElement("li");
  const button = wordCardButton(word, "word-entry");
  button.dataset.gloss = gloss;
  button.dataset.difficulty = stat.difficulty || "unknown";
  button.append(_span(wordDisplayName(word), "word-entry__name", "en"));
  if (gloss) button.append(_span(` (${gloss})`, "word-entry__gloss"));
  const parts = [WORD_DIFFICULTY_LABELS[stat.difficulty || ""] || ""];
  const accuracy = _statNumber(stat.accuracy);
  if (!Number.isNaN(accuracy)) parts.push(formatPercent(accuracy));
  const hint = parts.filter(Boolean).join(" · ");
  if (hint) {
    // The comma keeps the name and the hint apart when read aloud.
    button.append(_span(", ", "visually-hidden"), _span(hint, "word-entry__hint"));
  }
  item.append(button);
  return item;
}

/**
 * Show only the words that match the search field, and say so when none do.
 *
 * English labels are matched with English case rules. A Turkish gloss is
 * matched with Turkish ones, so "İ" finds "i" and "I" finds "ı".
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
