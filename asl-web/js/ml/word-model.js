// ─── ONNX Kelime Modeli ──────────────────────────────────────
// SignTransformer: input(1,45,168) + mask(1,45) → output(1,50)
// Tarayıcıda WASM backend ile çalışır.

let wordSession = null;
let temperature = 1.0;
let wordLabels = [];
let wordMaskDtype = "bool"; // bool|uint8|int64 — runtime'da belirlenir
const WORD_MASK_DTYPES = ["bool", "uint8", "int64"];

async function loadWordModel() {
  try {
    if (typeof ort === "undefined") {
      console.error("ort (onnxruntime-web) yüklenmemiş");
      return false;
    }

    // WASM dosya yollarını CDN'e yönlendir (worker dosyaları için gerekli)
    if (ort.env && ort.env.wasm) {
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    }

    wordSession = await ort.InferenceSession.create("./models/word_model.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    console.log("Word ONNX inputs:", wordSession.inputNames);
    console.log("Word ONNX outputs:", wordSession.outputNames);

    // Temperature
    try {
      const tempRes = await fetch("./data/temperature.json");
      if (!tempRes.ok) throw new Error(`HTTP ${tempRes.status}`);
      const tempData = await tempRes.json();
      const parsedTemperature = Number(tempData.T ?? tempData.temperature ?? 1.0);
      temperature = Number.isFinite(parsedTemperature) && parsedTemperature > 0
        ? parsedTemperature
        : 1.0;
    } catch (e) {
      console.warn("temperature.json okunamadı, T=1 kullanılıyor:", e.message);
      temperature = 1.0;
    }

    // Label mapping
    const labelsRes = await fetch("./data/word_labels.json");
    if (!labelsRes.ok) throw new Error(`word_labels.json HTTP ${labelsRes.status}`);
    const labelsData = await labelsRes.json();
    wordLabels = new Array(Object.keys(labelsData).length);
    for (const [word, idx] of Object.entries(labelsData)) {
      wordLabels[Number(idx)] = word;
    }

    console.log(
      `Kelime modeli yüklendi. T=${temperature}, ${wordLabels.length} kelime`,
    );
    return true;
  } catch (err) {
    console.error("Kelime modeli yüklenemedi:", err);
    wordSession = null;
    return false;
  }
}

function _buildMaskTensor(mask45, dtype = wordMaskDtype) {
  if (dtype === "bool") return new ort.Tensor("bool", mask45.map(Boolean), [1, 45]);
  if (dtype === "uint8") {
    const u = new Uint8Array(mask45.map((v) => (v ? 1 : 0)));
    return new ort.Tensor("uint8", u, [1, 45]);
  }
  const i = new BigInt64Array(mask45.map((v) => (v ? 1n : 0n)));
  return new ort.Tensor("int64", i, [1, 45]);
}

function _advanceMaskDtype() {
  const idx = WORD_MASK_DTYPES.indexOf(wordMaskDtype);
  if (idx < 0 || idx >= WORD_MASK_DTYPES.length - 1) return false;
  wordMaskDtype = WORD_MASK_DTYPES[idx + 1];
  return true;
}

async function predictWord(features45x168, mask45) {
  if (!wordSession) return null;
  if (!features45x168 || features45x168.length !== 45 * 168) {
    throw new Error(`word input 7560 float bekler, ${features45x168?.length ?? 0} geldi`);
  }
  if (!mask45 || mask45.length !== 45) {
    throw new Error(`word mask 45 değer bekler, ${mask45?.length ?? 0} geldi`);
  }

  const t0 = performance.now();

  const inputTensor = new ort.Tensor("float32", features45x168, [1, 45, 168]);
  let results = null;
  let lastRunError = null;

  while (!results) {
    try {
      const feeds = {};
      feeds[wordSession.inputNames[0]] = inputTensor;
      if (wordSession.inputNames.length > 1) {
        feeds[wordSession.inputNames[1]] = _buildMaskTensor(mask45);
      }
      results = await wordSession.run(feeds);
    } catch (err) {
      lastRunError = err;
      if (wordSession.inputNames.length <= 1 || !_advanceMaskDtype()) {
        throw lastRunError;
      }
      console.warn(
        `Word mask dtype başarısız, ${wordMaskDtype} deneniyor:`,
        err?.message || err,
      );
    }
  }
  const logits = results[wordSession.outputNames[0]].data;

  const t1 = performance.now();
  if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

  // Temperature → softmax → top-K
  const calibrated = Array.from(logits).map((x) => x / temperature);
  const probs = stableSoftmax(calibrated);

  const indexed = probs.map((p, i) => ({
    label: wordLabels[i] || `cls_${i}`,
    confidence: p,
  }));
  indexed.sort((a, b) => b.confidence - a.confidence);

  const topK = typeof CONFIG !== "undefined" ? CONFIG.TOP_K : 3;
  return {
    label: indexed[0].label,
    confidence: indexed[0].confidence,
    alternatives: indexed.slice(0, topK),
  };
}

function stableSoftmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

async function warmupWordModel() {
  if (!wordSession) return;
  try {
    const dummy = new Float32Array(45 * 168);
    const dummyMask = new Array(45).fill(true);
    const t0 = performance.now();
    await predictWord(dummy, dummyMask);
    console.log(`Word model warmup: ${(performance.now() - t0).toFixed(1)} ms`);
  } catch (err) {
    console.warn("Warmup başarısız:", err);
  }
}
