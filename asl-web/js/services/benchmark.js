// Client-side latency measurements. Each stage keeps a bounded window and
// reports the mean of its latest samples.

/**
 * The stages this module measures.
 *
 * This union is the single list that keeps a call site and its sample window in
 * step: recordBenchmark() drops any stage without a bucket, so a name that
 * appears in only one of the two places is a measurement that silently
 * disappears rather than an error.
 *
 * @typedef {"mediapipe" | "feature" | "feature_sequence" | "onnx" | "total"} BenchmarkStage
 */

/**
 * Formatted stage means for the debug panel. Values carry their unit, so they
 * are display strings rather than numbers.
 *
 * This is deliberately a subset of BenchmarkStage. Every stage is recorded and
 * readable through getAvgBenchmark(); these four are the ones the panel shows.
 *
 * @typedef {Object} BenchmarkSummary
 * @property {string} mediapipe
 * @property {string} feature
 * @property {string} onnx
 * @property {string} total
 */

/** Samples kept per stage; the oldest is dropped once the window is full. */
const BENCHMARK_MAX_SAMPLES = 30;

/**
 * One sample window per stage, pre-allocated so recording never has to create
 * a bucket.
 *
 * @type {Record<BenchmarkStage, number[]>}
 */
const benchmarkData = {
  mediapipe: [],
  feature: [],
  feature_sequence: [],
  onnx: [],
  total: [],
};

/**
 * Record one sample for a stage, dropping the oldest when the window is full.
 *
 * The runtime guard stays even though the parameter is typed: these are classic
 * scripts, so a caller is not obliged to have been type-checked. An unrecognised
 * stage is dropped rather than added, because a bucket nothing reads is the same
 * lost measurement in a different place.
 *
 * @param {BenchmarkStage} stage
 * @param {number} ms Elapsed time in milliseconds.
 * @returns {void}
 */
function recordBenchmark(stage, ms) {
  const samples = benchmarkData[stage];
  if (!samples) return;
  samples.push(ms);
  if (samples.length > BENCHMARK_MAX_SAMPLES) {
    samples.shift();
  }
}

/**
 * @param {BenchmarkStage} stage
 * @returns {number} Mean of the stage's current window, or 0 when it is empty
 *   or the stage is unknown.
 */
function getAvgBenchmark(stage) {
  const samples = benchmarkData[stage];
  if (!samples || samples.length === 0) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * @returns {BenchmarkSummary} Stage means formatted for display.
 */
function getBenchmarkSummary() {
  return {
    mediapipe: getAvgBenchmark("mediapipe").toFixed(1) + " ms",
    feature: getAvgBenchmark("feature").toFixed(1) + " ms",
    onnx: getAvgBenchmark("onnx").toFixed(1) + " ms",
    total: getAvgBenchmark("total").toFixed(1) + " ms",
  };
}

/**
 * Clear every sample window.
 *
 * It walks the buckets rather than naming them, so a new stage cannot be left
 * out.
 *
 * @returns {void}
 */
function resetBenchmark() {
  for (const samples of Object.values(benchmarkData)) {
    samples.length = 0;
  }
}
