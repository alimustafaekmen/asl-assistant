// Client-side latency: each stage keeps a bounded window and reports its mean.

/**
 * recordBenchmark() drops a stage without a bucket, so a name missing here is
 * a measurement that silently disappears.
 *
 * @typedef {"mediapipe" | "feature" | "feature_sequence" | "onnx" | "total"} BenchmarkStage
 */

/**
 * Display strings with units, for the four stages the debug panel shows.
 *
 * @typedef {Object} BenchmarkSummary
 * @property {string} mediapipe
 * @property {string} feature
 * @property {string} onnx
 * @property {string} total
 */

const BENCHMARK_MAX_SAMPLES = 30;

/**
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
 * The runtime guard stays despite the type: classic-script callers are not
 * necessarily type-checked.
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
