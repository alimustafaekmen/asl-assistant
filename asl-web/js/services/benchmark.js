// ─── Performans Ölçümü ───────────────────────────────────────
// performance.now() ile her aşamayı ayrı ayrı ölç.
// Son 30 örneklemin ortalamasını döndürür.

const benchmarkData = {
  mediapipe: [],
  feature: [],
  onnx: [],
  postprocess: [],
  total: [],
  _maxSamples: 30,
};

function recordBenchmark(stage, ms) {
  if (!benchmarkData[stage]) return;
  benchmarkData[stage].push(ms);
  if (benchmarkData[stage].length > benchmarkData._maxSamples) {
    benchmarkData[stage].shift();
  }
}

function getAvgBenchmark(stage) {
  const arr = benchmarkData[stage];
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getBenchmarkSummary() {
  return {
    mediapipe: getAvgBenchmark("mediapipe").toFixed(1) + " ms",
    feature: getAvgBenchmark("feature").toFixed(1) + " ms",
    onnx: getAvgBenchmark("onnx").toFixed(1) + " ms",
    total: getAvgBenchmark("total").toFixed(1) + " ms",
  };
}

function resetBenchmark() {
  benchmarkData.mediapipe.length = 0;
  benchmarkData.feature.length = 0;
  benchmarkData.onnx.length = 0;
  benchmarkData.postprocess.length = 0;
  benchmarkData.total.length = 0;
}
