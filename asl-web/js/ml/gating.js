// Confidence smoothing and word-level evaluation feedback.

/**
 * One published confusion pair in object form.
 *
 * The bundled data has used two object spellings over time -- {word_a, word_b}
 * and {a, b}. Every field is optional because none of them is validated on load.
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
 * One published confusion pair, in any spelling the reader accepts.
 *
 * The third published spelling is a bare two-element array. The reader has
 * always handled it, so it belongs in the type rather than only in prose.
 *
 * @typedef {ConfusionPairObject | [string, string]} ConfusionPairRaw
 */

/**
 * A published confusion pair reduced to the fields this app uses.
 *
 * @typedef {Object} ConfusionPair
 * @property {string} a Empty when the pair names no first word.
 * @property {string} b Empty when the pair names no second word.
 * @property {number} count Observed confusions; 0 when the pair carries none.
 */

/**
 * The evaluation fields this module reads for one word. Other fields may be
 * present in the published JSON and are ignored.
 *
 * @typedef {Object} PerWordStat
 * @property {string} [difficulty] Published label; preferred over the F1 fallback.
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
 * Load the published confusion pairs and per-word statistics.
 *
 * Both files are optional guidance, so each falls back to empty rather than
 * failing the app.
 *
 * @returns {Promise<boolean>} True when both fetches completed.
 */
async function loadGatingData() {
  try {
    const tasks = [
      fetch("./data/confusion_pairs.json").then((r) => r.json()).catch(() => []),
      fetch("./data/per_word_stats.json").then((r) => r.json()).catch(() => ({})),
    ];
    const [conf, stats] = await Promise.all(tasks);
    confusionPairs = Array.isArray(conf) ? conf : [];
    perWordStats = stats || {};
    console.log(
      `Gating yüklendi: ${confusionPairs.length} confusion pair, ${Object.keys(perWordStats).length} word stats`,
    );
    return true;
  } catch (err) {
    console.warn("Gating verileri yüklenemedi:", err);
    return false;
  }
}

/**
 * Read one published confusion pair, whichever spelling it uses.
 *
 * The array spelling has to be separated before the object fields are read: a
 * two-element array has no word_a to fall through from. Keeping that in one
 * place is what stops the live warning and the coach panel from accepting
 * different subsets of the published data, which is what they did while each
 * unpacked the pair itself.
 *
 * Missing words become empty strings rather than null, so callers can test them
 * without a nullability branch. A pair with an empty word matches nothing.
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
 * Warn when the top two labels are a known confusion pair and the call is close.
 *
 * @param {PredictionCandidate | null} top1
 * @param {PredictionCandidate | null} top2
 * @returns {string | null} Turkish guidance, or null when the margin is
 *   comfortable or the pair is not a published one.
 */
function getConfusionFeedback(top1, top2) {
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
    return `⚠ ${top1.label} / ${top2.label} sık karışır. Hareketi daha belirgin yapın.`;
  }
  return null;
}

/**
 * Report how hard the published evaluation found a word.
 *
 * A published label is used when it is one this module understands. Any other
 * value falls through to the F1 thresholds, so an unexpected string in the
 * bundled JSON cannot reach callers as a difficulty.
 *
 * @param {string} word
 * @returns {WordDifficulty} "unknown" when the word has no published entry.
 */
function getWordDifficulty(word) {
  const stats = perWordStats[word];
  if (!stats) return "unknown";
  // Only a label this module understands is taken at face value; anything else
  // falls through to the F1 thresholds rather than reaching callers unchecked.
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
 * @returns {string | null} Turkish guidance for a hard word, otherwise null.
 */
function getDifficultyMessage(word) {
  const diff = getWordDifficulty(word);
  if (diff === "hard") {
    return `⚠ "${word}" model için zor sınıfta. Tahmini dikkatli yorumlayın.`;
  }
  return null;
}

// Letter-mode temporal smoother.
//
// Select the most frequent label in the recent window. Reported confidence is
// label dominance multiplied by that label's mean raw confidence. This remains
// meaningful when the ONNX compatibility path returns labels without a full
// probability vector.
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
    // Aggregate count and raw confidence by label.
    /** @type {Record<string, number>} */
    const counts = {};
    /** @type {Record<string, number>} */
    const confSum = {};
    let best = null;
    let bestCount = 0;
    for (const p of this.buffer) {
      counts[p.label] = (counts[p.label] || 0) + 1;
      confSum[p.label] = (confSum[p.label] || 0) + (p.confidence ?? 0);
      if (counts[p.label] > bestCount) {
        bestCount = counts[p.label];
        best = p.label;
      }
    }
    // Mean raw confidence for the dominant label.
    const rawAvg = bestCount > 0 ? confSum[best] / bestCount : 0;
    // Fraction of the window occupied by the dominant label.
    const dominance = bestCount / window;
    // Combine temporal stability with model confidence.
    const smoothedConf = dominance * rawAvg;
    // Keep the latest alternatives for top-three display.
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
 * Add one raw prediction and report the smoothed view of the window.
 *
 * Confidence is window dominance multiplied by the dominant label's mean raw
 * confidence. That keeps the number meaningful on the label-only ONNX path,
 * where every raw confidence is 1.0 and stability is the only signal.
 *
 * The result is never null: the prediction is pushed before the window is read.
 *
 * @param {PredictionResult} prediction
 * @returns {PredictionResult}
 */
function smoothLetterPrediction(prediction) {
  _smoother.push(prediction);
  return _smoother.get();
}

/**
 * Clear the smoothing window.
 *
 * Called on mode changes, camera resets, and hand loss so a previous sign
 * cannot influence the next one.
 *
 * @returns {void}
 */
function resetSmoother() {
  _smoother.reset();
}
