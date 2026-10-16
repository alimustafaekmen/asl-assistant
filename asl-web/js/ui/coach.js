// Learning coach: target selection, study flows, scoring, and word guidance.
//
// A coach target is either a single letter or a word, and that distinction
// drives everything else. A letter target is scored by holding it: live
// inference feeds every smoothed result to the hold detector (ml/hold.js),
// and a hold that completes counts once. A button press never scores a
// letter, because a press reads whatever happens to be on the plate: one
// pose pressed five times, or a letter that has already left the camera.
// Word targets are scored from the result of a completed 45-frame recording.
//
// Learn shows guidance without scoring, practice counts five correct
// repetitions, and quiz counts answers over a fixed question total.
//
// Progress is kept on this device under one localStorage key, as a
// convenience: per letter, how often it was shown correctly, with a hint and
// skipped, and the flow last used. Nothing personal, no time. Storage that
// is missing, corrupt or refused gives a fresh start in memory.
//
// The letter teaching data, the teaching order and a written cue for each
// letter, and the groups of look-alike letters, is read on the first visit
// to the coach. The coach never waits for it: until it arrives, or when it
// cannot be read, letters come in alphabetical order without cues.
//
// The word guidance panel is rendered from the published evaluation data, so
// per-word F1 values and confusion pairs are read, never recomputed.

/**
 * The hold detector for the current target letter. Created once, from the
 * coach timings in CONFIG; it holds no DOM and starts nothing.
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
 * been read, and for good when they cannot be.
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
 * A letter outside LETTERS or a count that is not a whole number of zero or
 * more is dropped, and an unknown flow becomes "learn", so nothing stored
 * can make the coach throw or teach a letter the model does not know.
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
  // The membership test is the validation; Array.includes cannot narrow a
  // string to the union, so the result is stated here.
  const flow = /** @type {CoachFlow} */ (
    typeof data.flow === "string" && ["learn", "practice", "quiz"].includes(data.flow) ? data.flow : "learn"
  );
  return { v: 1, flow, letters };
}

/**
 * Read the stored progress, the first time the coach opens, and go back to
 * the flow it was last used in.
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
 * Store the progress; when storage refuses, it stays in memory and the coach
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
 * stops: a hold in progress belongs to the target and the camera session it
 * started in. Only a new target forgets that it was counted.
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
 * In practice an opened hint is remembered for the letter, once per target.
 * Learning shows the cue anyway, and the quiz has no hints.
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
 * open the hint during a miss in learning or practice.
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

/**
 * Drop a pending advance to the next target.
 *
 * @returns {void}
 */
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
 * Escape, focus moving into the coach's buttons and the page going to the
 * background all stay, so the wait never decides for a learner who is
 * reading, reaching for a button or away (WCAG 2.2.1).
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
 * it has lasted long enough.
 *
 * Another letter counts once it is at least as sure as the unknown
 * threshold; anything less sure is an unreadable hand. The target itself,
 * even below the hold confidence, is not a miss: the learner is close. A
 * miss is named once per letter, so it is not repeated on every frame, and a
 * new letter has to last the miss time of its own.
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
 * A look-alike group that holds both letters gives its reason and its cue for
 * the target, so a target in two groups is described by the group that is
 * being confused. Otherwise the target's cue from the curriculum follows.
 * The data may be missing, and then only the letter is named.
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
 * domain can drop no letter from the coach and add none.
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
 * Fetch one teaching data file and read it, or give null.
 *
 * A file that cannot be fetched, parsed or read is a file the coach goes
 * without, so every failure ends here.
 *
 * @template T
 * @param {string} path
 * @param {(data: unknown) => T | null} read
 * @returns {Promise<T | null>}
 */
async function _readCoachFile(path, read) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return read(await response.json());
  } catch (err) {
    return null;
  }
}

/**
 * Read the letter teaching data, the first time the coach opens.
 *
 * Both files are read once per visit, never at startup, since most visitors
 * never open the coach. Nothing waits for this: the coach is usable on the
 * alphabet from the start. When the data arrives, a target the learner has
 * not moved yet goes to the first letter of the teaching order.
 *
 * @returns {Promise<void>} Never rejects.
 */
function loadCoachLetterData() {
  if (_coachLetterDataLoad) return _coachLetterDataLoad;
  coachLetterDataStatus = "loading";
  _coachLetterDataLoad = Promise.all([
    _readCoachFile("./data/letter_curriculum.json", readLetterCurriculum),
    _readCoachFile("./data/letter_confusion.json", readLetterConfusion),
  ]).then(([curriculum, groups]) => {
    if (curriculum) {
      coachLetterData = { ...curriculum, groups: groups ?? [] };
      coachLetterDataStatus = "ready";
    } else {
      coachLetterData = { ...coachLetterData, groups: groups ?? [] };
      coachLetterDataStatus = "failed";
      console.warn("Koç ipuçları yüklenemedi; alfabetik sıra kullanılıyor.");
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
 * The written line under a target letter in learning: its handshape cue, or
 * why there is none.
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
 * Show a new target: nothing has been seen for it yet.
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
 * Choose a target from the target list.
 *
 * @param {string} target The list's value.
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
 * Rebuild the letter grid: one button per letter, in the alphabet's order, so
 * a letter is always where the learner last saw it.
 *
 * Every build starts from an empty grid, so it never keeps a button from an
 * earlier one. A quiz asks the letters itself, and its grid does not take a
 * pick.
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
 * Switch between letter and word practice, resetting progress.
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
 * Move the choice of a radio group with the arrow keys, as a radio group
 * does: the next or previous radio is checked and takes focus, and the ends
 * wrap round.
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

/**
 * Whether the phone's study sheet is open.
 *
 * @returns {boolean}
 */
function isCoachSheetOpen() {
  return els.coachStudy.dataset.open === "true";
}

/**
 * Open or close the study controls as a sheet over the screen, on a phone.
 * Beside the stage, on a laptop, they are always there and this changes
 * nothing the learner can see.
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
 * The name of the study flow with its measure, as the session button says it.
 *
 * @returns {string}
 */
function coachSessionLabel() {
  if (state.coachFlow === "practice") return `Pratik: ${state.coachGoal} tekrar`;
  if (state.coachFlow === "quiz") return `Sınav: ${state.quizTotal} soru`;
  return "Öğrenme: sırayla";
}

/**
 * Show the dock buttons and the plate's extras that fit where the attempt is.
 *
 * After a success the dock offers Tekrar and Sonraki, and the wait for the
 * next target shows its bar and Burada kal. Before one it offers Atla and
 * İpucu; the quiz has no hint, and a word has no hint and a button check
 * instead. Hiding a button is only for the eye: every one of them is still
 * a real control that does its own work.
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
  // The cue stays out of the way while the plate says what happened; it is
  // there while the learner studies a letter, and always once asked for.
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
  // Where the progress is kept, or that it is not.
  if (els.coachStorageNote) {
    els.coachStorageNote.textContent = coachProgressSaved
      ? "İlerlemeniz yalnızca bu cihazda saklanır, kimseyle paylaşılmaz."
      : "İlerleme bu tarayıcıda saklanamıyor; sayfayı kapatınca sıfırlanır.";
  }
  // data-state is what the stylesheet selects: "hit" for a done target and
  // "active" for the current one.
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
 *
 * A letter target has no button check: holding it is the check, so a press
 * here does nothing for a letter.
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
 * new one. Quiz progress is kept, because the quiz counts questions rather than
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
 * Show the target again: the attempt starts over on the same letter.
 *
 * Nothing already counted is taken back, and a letter that was counted stays
 * counted, so a quiz question still scores once. The wait for the next target
 * ends, since the learner chose this one.
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
 * Take note that the hand has left the camera, in a coach letter context.
 *
 * Live inference calls this on every frame without a hand; only the first one
 * after a hand changes anything. The last letter goes from the plate and the
 * prediction state, because nobody is holding it any more: left there, it
 * would read as current and could be counted for the target.
 *
 * @returns {void}
 */
function noteCoachHandLost() {
  // A lost hand ends a hold at once, and any miss with it; after a success
  // it is the release.
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
 * camera sees, while the target stays in the coach card. Nothing else here
 * reads the model's confidence.
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
  // A screen reader hears the verdict when the phase changes: written only
  // when it differs, so a hold that goes on says nothing more.
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
  // The next target comes up on its own once the target is done with: at
  // its first success in learning and in the quiz, at the last repetition
  // in practice.
  const done = state.coachFlow === "practice" ? state.coachStep >= state.coachGoal : firstForTarget;
  if (done && state.coach.phase === "success" && !state.coach.advancing) _scheduleCoachAdvance();
  updateCoachPanel();
}

/**
 * Compare a finished word recording against the word target and record the
 * outcome.
 *
 * Only a word reaches this, from its recording's result: a letter is counted
 * by its hold, never from what the plate shows.
 *
 * @returns {void}
 */
function updateCoachFromPrediction() {
  if (!_isCoachWordTarget()) return;
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

  // Each list is written only when it has something to say. The markup carries
  // a hand-written fallback for all three, so leaving a list alone keeps that
  // fallback visible when the published evaluation data did not load. This runs
  // once, after the gating fetch has settled, so it cannot leave stale results
  // from an earlier render.
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
