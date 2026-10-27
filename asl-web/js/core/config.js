// Runtime configuration and label lists. Loads before every script that reads
// them. Label order is part of the model contract (letter_labels.json,
// word_labels.json): a wrong order still runs and predicts nonsense.

/**
 * Letter and word thresholds use different scales: the 50-class word model
 * gives low top-1 confidence even when it is right.
 *
 * @typedef {Object} RuntimeConfig
 * @property {number} UNKNOWN_THRESHOLD Below this a letter result is uncertain.
 * @property {number} CONFIDENT_THRESHOLD Above this a letter result is confident.
 * @property {number} LETTER_THRESHOLD Minimum confidence to append a letter.
 * @property {number} WORD_UNKNOWN_THRESHOLD Below this a word result is uncertain.
 * @property {number} WORD_CONFIDENT_THRESHOLD Above this a word result is confident.
 * @property {number} WORD_ACCEPT_THRESHOLD Minimum confidence to offer a word for acceptance.
 * @property {number} SMOOTHING_ALPHA Not read by any script; the letter smoother is a majority vote.
 * @property {number} SMOOTHER_WINDOW Letter predictions the smoother votes over.
 * @property {number} TOP_K Number of alternatives shown to the user.
 * @property {number} WORD_FRAME_COUNT Frames in one word recording; the model input depends on this.
 * @property {number} COUNTDOWN_SECONDS Countdown step count, not a duration.
 * @property {number} WORD_FIRST_FRAME_TIMEOUT_MS A recording with no usable frame this long after it starts ends.
 * @property {number} WORD_NO_HAND_TIMEOUT_MS A recording whose usable frames stop for this long ends.
 * @property {number} WORD_MAX_RECORDING_MS A recording still not full after this long ends.
 * @property {number} COACH_HOLD_MS How long a coach target letter must be held to count.
 * @property {number} COACH_HOLD_CONFIDENCE Smoothed confidence at which the target counts as held.
 * @property {number} COACH_HOLD_GRACE_MS Longest dip below that confidence that only pauses a hold.
 * @property {number} COACH_RELEASE_MS How long another letter must show before the same target counts again.
 * @property {number} COACH_MISS_MS How long another letter must show before the coach names it.
 * @property {number} COACH_ADVANCE_MS Wait after a success before the next target comes up.
 * @property {number} COACH_SESSION_SIZE Targets in one practice session or quiz.
 * @property {boolean} SELFIE_HANDEDNESS_SWAP Swap left/right on devices that report the opposite convention.
 * @property {number} HAND_DETECTION_CONFIDENCE MediaPipe hand detection threshold.
 * @property {number} HAND_PRESENCE_CONFIDENCE MediaPipe hand presence threshold.
 * @property {number} HAND_TRACKING_CONFIDENCE MediaPipe hand tracking threshold.
 * @property {number} LETTER_HANDEDNESS_SCORE_MIN A hand with a lower handedness score is dropped, in every mode.
 * @property {number} HAND_HANDEDNESS_SCORE_MIN Read only when LETTER_HANDEDNESS_SCORE_MIN is unset.
 * @property {boolean} LETTER_LANDMARK_SMOOTHING_ENABLED Enable letter-only landmark EMA.
 * @property {number} LETTER_LANDMARK_SMOOTHING_ALPHA Letter landmark EMA weight.
 * @property {boolean} LETTER_MOTION_DEBUG_ENABLED Publish letter motion diagnostics.
 * @property {boolean} LETTER_MOTION_GATE_ENABLED Skip unstable letter frames.
 * @property {number} LETTER_MOTION_GATE_THRESHOLD Mean absolute delta above which a frame is skipped.
 * @property {string} DEMO_PUBLIC_URL Published demo URL used when no shareable origin exists.
 */

/**
 * @typedef {Object} ThresholdSet
 * @property {number} unknown Below this the result is reported as uncertain.
 * @property {number} confident At or above this the result is reported as confident.
 * @property {number} accept Minimum confidence for the accept action.
 */

/**
 * @typedef {Object} ReferenceAsset
 * @property {string} src Image path relative to asl-web/.
 * @property {string} alt Alt text in the page's language, read when shown.
 */

/**
 * @typedef {Object} ReferenceAssets
 * @property {ReferenceAsset} letter Alphabet reference card.
 * @property {string[]} wordPages The five readable word reference pages, in order.
 */

// Must be the directory of the ort.wasm.min.js that index.html pins with SRI:
// a JavaScript and WASM pair from two versions fails at the first model load.
/** @type {string} */
const ORT_WASM_PATHS = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

// The kjua QR encoder, fetched when the QR screen first draws. Pinned: a
// version change needs a new integrity hash.
const QR_LIBRARY_SCRIPT = Object.freeze({
  src: "https://cdn.jsdelivr.net/npm/kjua@0.9.0/dist/kjua.min.js",
  integrity: "sha384-ayVM0To8wzK2eG/sCNqF3XW4aHfJBsYEneUeObYWVZCnBZbscaz45eTQaxEowih9",
});

/** @type {RuntimeConfig} */
const CONFIG = {
  UNKNOWN_THRESHOLD: 0.45,
  CONFIDENT_THRESHOLD: 0.65,
  LETTER_THRESHOLD: 0.6,
  // A word too weak to accept must not read as likely, so the uncertain band
  // ends where acceptance begins: keep the first two equal.
  WORD_UNKNOWN_THRESHOLD: 0.15,
  WORD_CONFIDENT_THRESHOLD: 0.20,
  WORD_ACCEPT_THRESHOLD: 0.15,
  SMOOTHING_ALPHA: 0.4,
  SMOOTHER_WINDOW: 5,
  TOP_K: 3,
  WORD_FRAME_COUNT: 45,
  // Counts 720 ms countdown steps, not seconds.
  COUNTDOWN_SECONDS: 3,
  // A frame is usable only with hand, face and shoulders in view. The first
  // frame gets longer because the hands come up after the countdown; the
  // overall limit catches frames that trickle in just often enough.
  WORD_FIRST_FRAME_TIMEOUT_MS: 6000,
  WORD_NO_HAND_TIMEOUT_MS: 4000,
  WORD_MAX_RECORDING_MS: 15000,
  // One second is about eight letter inference ticks, each just over 120 ms.
  // The hold confidence equals CONFIDENT_THRESHOLD so success matches the
  // "confident" plate; a 240 ms grace, just under two ticks, keeps one noisy
  // frame from resetting a hold.
  COACH_HOLD_MS: 1000,
  COACH_HOLD_CONFIDENCE: 0.65,
  COACH_HOLD_GRACE_MS: 240,
  COACH_RELEASE_MS: 400,
  COACH_MISS_MS: 1500,
  COACH_ADVANCE_MS: 2500,
  COACH_SESSION_SIZE: 10,
  // Enable only on devices that consistently report swapped labels.
  SELFIE_HANDEDNESS_SWAP: false,
  // MediaPipe's defaults. The Python extractors also detect at 0.5 but track
  // at 0.4.
  HAND_DETECTION_CONFIDENCE: 0.5,
  HAND_PRESENCE_CONFIDENCE: 0.5,
  HAND_TRACKING_CONFIDENCE: 0.5,
  // The gate drops a hand MediaPipe is unsure about, in every mode; 0 turns it off.
  LETTER_HANDEDNESS_SCORE_MIN: 0.5,
  HAND_HANDEDNESS_SCORE_MIN: 0.5,
  // Runs after handedness standardization and before normalization.
  LETTER_LANDMARK_SMOOTHING_ENABLED: true,
  LETTER_LANDMARK_SMOOTHING_ALPHA: 0.6,
  // Motion is measured by default but gates predictions only when enabled.
  LETTER_MOTION_DEBUG_ENABLED: true,
  LETTER_MOTION_GATE_ENABLED: false,
  LETTER_MOTION_GATE_THRESHOLD: 0.08,
  DEMO_PUBLIC_URL: "https://asl-assistant.pages.dev/",
};

/**
 * A multi-character coach target is a word context and uses word thresholds.
 *
 * @returns {ThresholdSet}
 */
function _thresholdsForMode() {
  if (state.mode === "word" || (state.mode === "coach" && state.coachTarget?.length > 1)) {
    return {
      unknown: CONFIG.WORD_UNKNOWN_THRESHOLD,
      confident: CONFIG.WORD_CONFIDENT_THRESHOLD,
      accept: CONFIG.WORD_ACCEPT_THRESHOLD,
    };
  }
  return {
    unknown: CONFIG.UNKNOWN_THRESHOLD,
    confident: CONFIG.CONFIDENT_THRESHOLD,
    accept: CONFIG.LETTER_THRESHOLD,
  };
}

// J and Z need motion and are not classes in the published model.
/** @type {string[]} */
const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
];

// Word output order from word_labels.json.
/** @type {string[]} */
const WORDS = [
  "all", "before", "bird", "book", "brother", "brown", "bye", "can",
  "child", "cow", "dad", "dog", "donkey", "drink", "duck", "finish",
  "fireman", "food", "give", "go", "happy", "have", "hear", "hello",
  "home", "hot", "hungry", "like", "lips", "listen", "look", "mom",
  "mouse", "no", "open", "please", "pretend", "sad", "shhh", "sick",
  "sleep", "sleepy", "talk", "thankyou", "toothbrush", "uncle",
  "wait", "water", "who", "yes",
];

// The coach marks these words easy, HARD_WORDS hard and the rest medium. The
// sets are picked by hand and only roughly follow the F1 scores in
// data/per_word_stats.json: happy is easy at 0.69, dog is not hard at 0.59.
/** @type {Set<string>} */
const EASY_WORDS = new Set([
  "water", "sad", "cow", "uncle", "brown", "duck", "donkey", "lips",
  "shhh", "dad", "finish", "home", "food", "like", "no", "sick",
  "have", "happy",
]);

// Marked hard in the coach; see EASY_WORDS.
/** @type {Set<string>} */
const HARD_WORDS = new Set([
  "open", "give", "all", "sleepy", "book", "go", "child", "listen",
  "talk", "sleep", "who", "toothbrush", "can", "hear", "hello",
  "fireman",
]);

// Each label of WORDS belongs to exactly one group, listed in display order.
// Titles are read in the page's language when the list is drawn.
/** @type {{title: string, words: string[]}[]} */
const WORD_CATEGORIES = [
  {
    get title() { return t("word.library.group.everyday"); },
    words: [
      "water", "home", "food", "drink", "book", "finish", "wait", "open",
      "go", "look", "listen", "hear", "talk", "thankyou", "please",
    ],
  },
  {
    get title() { return t("word.library.group.feelings"); },
    words: ["sad", "happy", "sleep", "sleepy", "sick", "hungry", "hot"],
  },
  {
    get title() { return t("word.library.group.animals"); },
    words: ["bird", "cow", "dog", "donkey", "duck", "mouse"],
  },
  {
    get title() { return t("word.library.group.people"); },
    words: ["dad", "mom", "uncle", "brother", "child", "fireman", "who"],
  },
  {
    get title() { return t("word.library.group.other"); },
    words: [
      "all", "before", "brown", "bye", "can", "give", "have", "hello",
      "like", "lips", "no", "pretend", "shhh", "toothbrush", "yes",
    ],
  },
];

/** @type {ReferenceAssets} */
const REFERENCE_ASSETS = {
  letter: {
    src: "./assets/signs/letters.png",
    get alt() { return t("word.reference.letterAlt"); },
  },
  wordPages: [
    "./assets/signs/word-50-1.webp",
    "./assets/signs/word-50-2.webp",
    "./assets/signs/word-50-3.webp",
    "./assets/signs/word-50-4.webp",
    "./assets/signs/word-50-5.webp",
  ],
};

// Ordered fallback list; the first id present in the manifest becomes the default.
/** @type {string[]} */
const PREFERRED_MODEL_TEST_WORD_IDS = [
  "word-bird-01",
  "word-water-01",
  "word-sad-01",
  "word-duck-01",
  "word-brown-01",
  "word-give-01",
];
