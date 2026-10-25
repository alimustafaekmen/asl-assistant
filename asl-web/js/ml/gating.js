// Confidence smoothing and word-level evaluation feedback.

/**
 * Two object spellings are accepted; nothing is validated on load.
 *
 * @typedef {Object} ConfusionPairObject
 * @property {string} [word_a]
 * @property {string} [word_b]
 * @property {string} [a]
 * @property {string} [b]
 * @property {number} [count]
 * @property {number} [confusions]
 */

/**
 * @typedef {ConfusionPairObject | [string, string]} ConfusionPairRaw
 */

/**
 * @typedef {Object} ConfusionPair
 * @property {string} a Empty when the pair names no first word.
 * @property {string} b Empty when the pair names no second word.
 * @property {number} count Observed confusions; 0 when the pair carries none.
 */

/**
 * Other fields in the published JSON are ignored.
 *
 * @typedef {Object} PerWordStat
 * @property {string} [difficulty] Published label; preferred over the F1 fallback.
 * @property {number} [accuracy] Share of the word's test recordings recognised.
 * @property {number} [f1]
 * @property {number} [f1_score]
 * @property {number} [test_f1]
 */

/** How hard the published evaluation found a word. @typedef {"easy" | "medium" | "hard" | "unknown"} WordDifficulty */

/** @type {ConfusionPairRaw[]} */
let confusionPairs = [];
/** @type {Record<string, PerWordStat>} */
let perWordStats = {};

/**
 * @param {Response} res
 * @returns {ReturnType<Response["json"]>} Fetched JSON, unchecked: each reader
 *   guards the shape it uses.
 * @throws {Error} When the response is not ok, so an error page is never read as data.
 */
function _jsonIfOk(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {string} file
 * @param {unknown} err The rejection, whatever was thrown.
 * @returns {void}
 */
function _warnGuidanceUnreadable(file, err) {
  console.warn(`${file} unreadable, word guidance goes on without it:`, err instanceof Error ? err.message : err);
}

/**
 * Both files are optional guidance, so each falls back to empty.
 *
 * @returns {Promise<boolean>} False only when reading the results throws; a
 *   missing or unreadable file loads as empty and still returns true.
 */
async function loadGatingData() {
  try {
    // An uncast empty literal widens to any[], and the guards would check nothing.
    const tasks = [
      fetch("./data/confusion_pairs.json")
        .then(_jsonIfOk)
        .catch((err) => {
          _warnGuidanceUnreadable("confusion_pairs.json", err);
          return /** @type {ConfusionPairRaw[]} */ ([]);
        }),
      fetch("./data/per_word_stats.json")
        .then(_jsonIfOk)
        .catch((err) => {
          _warnGuidanceUnreadable("per_word_stats.json", err);
          return /** @type {Record<string, PerWordStat>} */ ({});
        }),
    ];
    const [conf, stats] = await Promise.all(tasks);
    confusionPairs = Array.isArray(conf) ? conf : [];
    perWordStats = stats || {};
    console.log(
      `Gating data loaded: ${confusionPairs.length} confusion pairs, ${Object.keys(perWordStats).length} word stats`,
    );
    return true;
  } catch (err) {
    console.warn("Gating data could not be loaded:", err);
    return false;
  }
}

/**
 * The live warning and the coach panel both read pairs through here, so they
 * accept the same data. A missing word is "", which matches nothing.
 *
 * @param {ConfusionPairRaw} pair
 * @returns {ConfusionPair}
 */
function readConfusionPair(pair) {
  if (Array.isArray(pair)) {
    return { a: pair[0] || "", b: pair[1] || "", count: 0 };
  }
  return {
    a: pair.word_a || pair.a || "",
    b: pair.word_b || pair.b || "",
    count: Number(pair.count ?? pair.confusions ?? 0),
  };
}

/**
 * @param {PredictionCandidate | null} top1
 * @param {PredictionCandidate | null} top2
 * @returns {string | null} Guidance in the page's language, or null when the
 *   margin is comfortable or the pair is not a published one.
 */
function getConfusionFeedback(top1, top2) {
  const copy = confusionFeedbackCopy(top1, top2);
  return copy ? t(copy.key, copy.params) : null;
}

/**
 * The string getConfusionFeedback() says, by key, so a language change can
 * say it again.
 *
 * @param {PredictionCandidate | null} top1
 * @param {PredictionCandidate | null} top2
 * @returns {{key: string, params: I18nParams} | null}
 */
function confusionFeedbackCopy(top1, top2) {
  if (!top1 || !top2) return null;
  const margin = top1.confidence - top2.confidence;
  if (margin > 0.2) return null;

  const pair = confusionPairs.find((p) => {
    const { a, b } = readConfusionPair(p);
    if (!a || !b) return false;
    return (
      (a === top1.label && b === top2.label) ||
      (a === top2.label && b === top1.label)
    );
  });

  if (pair) {
    return { key: "word.feedback.confusion", params: { first: top1.label, second: top2.label } };
  }
  return null;
}

/**
 * A published label is used only when it is a known one, so an unexpected
 * string in the JSON cannot reach callers as a difficulty.
 *
 * @param {string} word
 * @returns {WordDifficulty} "unknown" when the word has no published entry.
 */
function getWordDifficulty(word) {
  const stats = perWordStats[word];
  if (!stats) return "unknown";
  const published = stats.difficulty;
  if (published === "easy" || published === "medium" || published === "hard") {
    return published;
  }
  const f1 = stats.f1 || stats.f1_score || stats.test_f1 || 0;
  if (f1 >= 0.8) return "easy";
  if (f1 >= 0.6) return "medium";
  return "hard";
}

/**
 * @param {string} word
 * @returns {string | null} Guidance for a hard word in the page's language,
 *   otherwise null.
 */
function getDifficultyMessage(word) {
  const copy = difficultyCopy(word);
  return copy ? t(copy.key, copy.params) : null;
}

/**
 * The string getDifficultyMessage() says, by key.
 *
 * @param {string} word
 * @returns {{key: string, params: I18nParams} | null}
 */
function difficultyCopy(word) {
  if (getWordDifficulty(word) === "hard") return { key: "word.feedback.hard", params: { word } };
  return null;
}

// Letter-mode smoother: the most frequent label in the recent window wins.
const _smoother = {
  /** @type {PredictionResult[]} */
  buffer: [],
  /**
   * @param {PredictionResult} prediction
   * @returns {void}
   */
  push(prediction) {
    this.buffer.push(prediction);
    if (this.buffer.length > (typeof CONFIG !== "undefined" ? CONFIG.SMOOTHER_WINDOW : 5)) {
      this.buffer.shift();
    }
  },
  /**
   * @returns {PredictionResult | null} Null only while the window is empty.
   */
  get() {
    if (this.buffer.length === 0) return null;
    const window = this.buffer.length;
    /** @type {Record<string, number>} */
    const counts = {};
    /** @type {Record<string, number>} */
    const confSum = {};
    let best = null;
    let bestCount = 0;
    // A tie goes to the label that reached the count first.
    for (const p of this.buffer) {
      counts[p.label] = (counts[p.label] || 0) + 1;
      confSum[p.label] = (confSum[p.label] || 0) + (p.confidence ?? 0);
      if (counts[p.label] > bestCount) {
        bestCount = counts[p.label];
        best = p.label;
      }
    }
    const rawAvg = bestCount > 0 ? confSum[best] / bestCount : 0;
    const dominance = bestCount / window;
    const smoothedConf = dominance * rawAvg;
    const matching = this.buffer.filter((p) => p.label === best);
    const last = matching[matching.length - 1];
    return {
      label: best,
      confidence: smoothedConf,
      alternatives: last.alternatives || [],
    };
  },
  /** @returns {void} */
  reset() {
    this.buffer = [];
  },
};

/**
 * Confidence is window dominance times the winner's mean raw confidence, which
 * stays meaningful on the label-only ONNX path where every raw value is 1.0.
 *
 * @param {PredictionResult} prediction
 * @returns {PredictionResult}
 */
function smoothLetterPrediction(prediction) {
  _smoother.push(prediction);
  return _smoother.get();
}

/**
 * Called on mode changes, camera resets and hand loss.
 *
 * @returns {void}
 */
function resetSmoother() {
  _smoother.reset();
}
