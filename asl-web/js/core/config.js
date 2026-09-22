// Browser runtime configuration and fixed domain lists.
//
// The web app uses classic scripts that share one global scope. This file must
// load before any script that reads CONFIG, the label lists, or the reference
// asset map. It performs no work at load time.
//
// Letter and word label order mirrors letter_labels.json and word_labels.json
// and is part of the model contract; changing it silently breaks every
// prediction.

/**
 * Thresholds and feature flags the browser runtime reads at call time.
 *
 * Letter and word thresholds are deliberately on different scales: the 50-class
 * word model produces low top-1 confidence even when it is right.
 *
 * @typedef {Object} RuntimeConfig
 * @property {number} UNKNOWN_THRESHOLD Below this a letter result is uncertain.
 * @property {number} CONFIDENT_THRESHOLD Above this a letter result is confident.
 * @property {number} LETTER_THRESHOLD Minimum confidence to append a letter.
 * @property {number} WORD_UNKNOWN_THRESHOLD Below this a word result is uncertain.
 * @property {number} WORD_CONFIDENT_THRESHOLD Above this a word result is confident.
 * @property {number} WORD_ACCEPT_THRESHOLD Minimum confidence to offer a word for acceptance.
 * @property {number} SMOOTHING_ALPHA Prediction smoothing weight.
 * @property {number} SMOOTHER_WINDOW Letter label smoothing window, in frames.
 * @property {number} TOP_K Number of alternatives shown to the user.
 * @property {number} WORD_FRAME_COUNT Frames in one word recording; the model input depends on this.
 * @property {number} COUNTDOWN_SECONDS Countdown step count, not a duration.
 * @property {boolean} SELFIE_HANDEDNESS_SWAP Swap left/right on devices that report the opposite convention.
 * @property {number} HAND_DETECTION_CONFIDENCE MediaPipe hand detection threshold.
 * @property {number} HAND_PRESENCE_CONFIDENCE MediaPipe hand presence threshold.
 * @property {number} HAND_TRACKING_CONFIDENCE MediaPipe hand tracking threshold.
 * @property {number} LETTER_HANDEDNESS_SCORE_MIN Minimum handedness score for letter inference.
 * @property {number} HAND_HANDEDNESS_SCORE_MIN Legacy fallback for the handedness gate.
 * @property {boolean} LETTER_LANDMARK_SMOOTHING_ENABLED Enable letter-only landmark EMA.
 * @property {number} LETTER_LANDMARK_SMOOTHING_ALPHA Letter landmark EMA weight.
 * @property {boolean} LETTER_MOTION_DEBUG_ENABLED Publish letter motion diagnostics.
 * @property {boolean} LETTER_MOTION_GATE_ENABLED Skip unstable letter frames.
 * @property {number} LETTER_MOTION_GATE_THRESHOLD Mean absolute delta above which a frame is skipped.
 * @property {string} DEMO_PUBLIC_URL Published demo URL used when no shareable origin exists.
 * @property {boolean} DEBUG_MODE Reserved debug flag.
 */

/**
 * The three thresholds that apply to the active letter or word context.
 *
 * @typedef {Object} ThresholdSet
 * @property {number} unknown Below this the result is reported as uncertain.
 * @property {number} confident At or above this the result is reported as confident.
 * @property {number} accept Minimum confidence for the accept action.
 */

/**
 * @typedef {Object} ReferenceAsset
 * @property {string} src Image path relative to asl-web/.
 * @property {string} alt Turkish alt text shown to the user.
 */

/**
 * @typedef {Object} ReferenceAssets
 * @property {ReferenceAsset} letter Alphabet reference card.
 * @property {ReferenceAsset} wordPoster Combined 50-word poster.
 * @property {string[]} wordPages The five readable word reference pages, in order.
 */

/** @type {RuntimeConfig} */
const CONFIG = {
  // Letter-mode thresholds for the 24-class static model.
  UNKNOWN_THRESHOLD: 0.45,
  CONFIDENT_THRESHOLD: 0.65,
  LETTER_THRESHOLD: 0.6,
  // Word-mode thresholds are intentionally lower. The 50-class model often
  // produces low top-1 confidence even for a correct prediction.
  WORD_UNKNOWN_THRESHOLD: 0.10,
  WORD_CONFIDENT_THRESHOLD: 0.20,
  WORD_ACCEPT_THRESHOLD: 0.15,
  // Temporal smoothing and display limits.
  SMOOTHING_ALPHA: 0.4,
  SMOOTHER_WINDOW: 5,
  TOP_K: 3,
  WORD_FRAME_COUNT: 45,
  // The recording countdown shows three 720 ms steps. This value is a step
  // count retained for compatibility; it is not a duration in seconds.
  COUNTDOWN_SECONDS: 3,
  // MediaPipe normally reports handedness from the user's perspective. Enable
  // this only on devices where left and right labels are consistently swapped.
  SELFIE_HANDEDNESS_SWAP: false,
  // MediaPipe hand thresholds. These defaults are aligned with the Python
  // preprocessing configuration; lower them only after testing the target camera.
  HAND_DETECTION_CONFIDENCE: 0.5,
  HAND_PRESENCE_CONFIDENCE: 0.5,
  HAND_TRACKING_CONFIDENCE: 0.5,
  // Minimum handedness score for letter inference. The legacy key remains as a
  // compatibility fallback; set the values to 0 to disable this quality gate.
  LETTER_HANDEDNESS_SCORE_MIN: 0.5,
  HAND_HANDEDNESS_SCORE_MIN: 0.5,
  // Letter-only EMA smoothing. It runs after handedness standardization and
  // before normalization, then resets on mode changes, camera resets, or hand loss.
  LETTER_LANDMARK_SMOOTHING_ENABLED: true,
  LETTER_LANDMARK_SMOOTHING_ALPHA: 0.6,
  // Letter motion is observable by default but does not gate predictions. When
  // enabled, the gate skips frames whose mean absolute delta exceeds the limit.
  LETTER_MOTION_DEBUG_ENABLED: true,
  LETTER_MOTION_GATE_ENABLED: false,
  LETTER_MOTION_GATE_THRESHOLD: 0.08,
  DEMO_PUBLIC_URL: "https://asl-demo.netlify.app/",
  DEBUG_MODE: false,
};

/**
 * Resolve thresholds for the active letter or word context.
 *
 * A multi-character coach target is a word context, so it follows the word
 * thresholds even though the mode is "coach".
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

// Static letter domain. The output order matches letter_labels.json; J and Z
// require motion and are not classes in the published model.
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

// Higher-performing words from the published evaluation report (F1 >= 0.75).
/** @type {Set<string>} */
const EASY_WORDS = new Set([
  "water", "sad", "cow", "uncle", "brown", "duck", "donkey", "lips",
  "shhh", "dad", "finish", "home", "food", "like", "no", "sick",
  "have", "happy",
]);

// Lower-performing words from the published evaluation report (F1 < 0.65).
/** @type {Set<string>} */
const HARD_WORDS = new Set([
  "open", "give", "all", "sleepy", "book", "go", "child", "listen",
  "talk", "sleep", "who", "toothbrush", "can", "hear", "hello",
  "fireman",
]);

/** @type {ReferenceAssets} */
const REFERENCE_ASSETS = {
  letter: {
    src: "./assets/signs/letters.png",
    alt: "ASL harf referans görseli",
  },
  wordPoster: {
    src: "./assets/signs/kelime.png",
    alt: "ASL 50 kelime genel referans posteri",
  },
  wordPages: [
    "./assets/signs/word-1.png",
    "./assets/signs/word-2.png",
    "./assets/signs/word-3.png",
    "./assets/signs/word-4.png",
    "./assets/signs/word-5.png",
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
