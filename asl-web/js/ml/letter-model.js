// ─── ONNX Harf Modeli ────────────────────────────────────────
// LightGBM: input(1,93) → output(1,24)

let letterSession = null;
let letterLabels = [];
const DEFAULT_LETTER_LABELS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
];
const LETTER_MODEL_URL = "./models/letter_model.onnx?v=20260430-nozipmap";
// Aktif web ONNX çıkışı:
//   label tensor(int64)[N], probabilities tensor(float)[N,24]
// Eski LightGBM export'ları probabilities'i ZipMap seq(map) olarak verebilir;
// fallback kodu geriye uyumluluk için korunur.
let letterProbOutputName = null;

async function loadLetterModel() {
  // Yeniden yüklemede ZipMap fallback bayraklarını sıfırla.
  // Aksi halde önceki oturumdaki "fallback aktif" durumu sabit kalır.
  _letterProbsFailed = false;
  try {
    if (typeof ort === "undefined") {
      console.error("ort (onnxruntime-web) yüklenmemiş");
      return false;
    }

    if (ort.env && ort.env.wasm) {
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    }

    letterSession = await ort.InferenceSession.create(
      LETTER_MODEL_URL,
      { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
    );

    console.log("Letter ONNX inputs:", letterSession.inputNames);
    console.log("Letter ONNX outputs:", letterSession.outputNames);

    // Etiketleri yükle
    try {
      const res = await fetch("./data/letter_labels.json");
      const data = await res.json();
      letterLabels = new Array(Object.keys(data).length);
      for (const [letter, idx] of Object.entries(data)) {
        letterLabels[Number(idx)] = letter;
      }
    } catch (e) {
      console.warn("letter_labels.json okunamadı, dahili 24 harf listesi kullanılıyor");
      letterLabels = [...DEFAULT_LETTER_LABELS];
    }

    // İkinci çıkışı tercih et (LightGBM probabilities)
    letterProbOutputName =
      letterSession.outputNames.length > 1
        ? letterSession.outputNames[1]
        : letterSession.outputNames[0];

    console.log(`Harf modeli yüklendi. ${letterLabels.length} sınıf, prob output: ${letterProbOutputName}`);
    return true;
  } catch (err) {
    console.error("Harf modeli yüklenemedi:", err);
    letterSession = null;
    return false;
  }
}

// ORT Web'in ZipMap (seq(map)) output'unu extract ederken `wasm-core-impl.ts:725`
// içinde "Reading data from non-tensor typed value is not supported" hatası
// fırlatabilir (özellikle 1.20.x'te). Bu durumda fallback: sadece "label"
// output'unu (argmax int64) çek. Confidence kaybediliyor ama tahmin çalışır.
let _letterProbsFailed = false;

async function predictLetter(features93) {
  if (!letterSession) return null;

  const t0 = performance.now();

  const input = new ort.Tensor("float32", features93, [1, 93]);
  const feeds = {};
  feeds[letterSession.inputNames[0]] = input;

  // Önce full run + probability tensor/ZipMap parse dene (top-3 + confidence)
  if (!_letterProbsFailed) {
    try {
      const results = await letterSession.run(feeds);
      const out = results[letterProbOutputName];
      const probs = _extractLetterProbs(out, letterLabels.length);
      if (probs) {
        const t1 = performance.now();
        if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

        const indexed = probs.map((p, i) => ({
          label: letterLabels[i] || `cls_${i}`,
          confidence: p,
        }));
        indexed.sort((a, b) => b.confidence - a.confidence);
        const topK = typeof CONFIG !== "undefined" ? CONFIG.TOP_K : 3;
        return {
          label: indexed[0].label,
          confidence: indexed[0].confidence,
          alternatives: indexed.slice(0, topK),
        };
      } else {
        console.warn("[Letter] probs extract null döndü, label-only fallback'e geçiliyor");
        _letterProbsFailed = true;
      }
    } catch (err) {
      console.warn(
        "[Letter] full run fail, label-only fallback aktif:",
        err?.message || err,
      );
      _letterProbsFailed = true;
    }
  }

  // FALLBACK: sadece "label" output'unu çek (sequence output bypass)
  try {
    const labelName = letterSession.outputNames[0]; // "label"
    const results = await letterSession.run(feeds, [labelName]);
    const labelOut = results[labelName];

    let labelIdx = -1;
    try {
      const d = labelOut?.data;
      if (d && d.length > 0) labelIdx = Number(d[0]);
    } catch (e) {
      console.warn("[Letter] label tensor data fail:", e.message);
      return null;
    }

    if (labelIdx < 0 || labelIdx >= letterLabels.length) {
      console.warn(`[Letter] geçersiz label index: ${labelIdx}`);
      return null;
    }

    const t1 = performance.now();
    if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

    const letter = letterLabels[labelIdx] || `cls_${labelIdx}`;
    // ZipMap (seq(map)) ORT Web'de tüm sürümlerde okunamıyor (1.20-1.22 hepsi
    // "Reading data from non-tensor typed value" atıyor). Tek frame için per-class
    // probability extracting yok. ÇÖZÜM: confidence=1.0 (raw "label geldi" sinyali).
    // Gerçek confidence smoother tarafında temporal stability ile hesaplanır:
    // 5 frame'de N kez aynı label gelirse → confidence = N/5.
    return {
      label: letter,
      confidence: 1.0,
      alternatives: [{ label: letter, confidence: 1.0 }],
    };
  } catch (err) {
    console.error("[Letter] label-only fallback de fail:", err);
    return null;
  }
}

function _mapToProbsArray(map, size) {
  const arr = new Array(size).fill(0);
  for (const [key, val] of map.entries()) {
    const idx = Number(key);
    if (!Number.isNaN(idx) && idx >= 0 && idx < size) {
      arr[idx] = Number(val);
    }
  }
  return arr;
}

function _objToProbsArray(obj, size) {
  const arr = new Array(size).fill(0);
  for (const [k, v] of Object.entries(obj)) {
    const idx = Number(k);
    if (!Number.isNaN(idx) && idx >= 0 && idx < size) arr[idx] = Number(v);
  }
  return arr;
}

function _extractLetterProbs(out, size) {
  if (!out) return null;

  // 1. Array<Map> — seq(map) — ORT Web typical output for ZipMap
  if (Array.isArray(out) && out.length > 0) {
    const first = out[0];
    if (first instanceof Map) return _mapToProbsArray(first, size);
    if (first && typeof first === "object") return _objToProbsArray(first, size);
  }

  // 2. Tek Map (map(int64, float))
  if (out instanceof Map) return _mapToProbsArray(out, size);

  // 3. Iterable (OnnxSequenceImpl, NodeList-tarzı objeler)
  // Array değil ama iterate edilebilir.
  if (out && typeof out !== "string" && typeof out[Symbol.iterator] === "function") {
    try {
      const arr = [];
      for (const item of out) {
        arr.push(item);
        if (arr.length >= 10) break; // güvenlik
      }
      if (arr.length > 0) {
        const first = arr[0];
        if (first instanceof Map) return _mapToProbsArray(first, size);
        if (first && typeof first === "object") return _objToProbsArray(first, size);
        if (typeof first === "number") {
          // Direkt prob array'i
          return arr.map(Number);
        }
      }
    } catch (e) {
      // not iterable, devam
    }
  }

  // 4. Index erişimi: out[0], out[1], ... (length varsa)
  if (typeof out === "object" && typeof out.length === "number" && out.length > 0) {
    try {
      const first = out[0];
      if (first instanceof Map) return _mapToProbsArray(first, size);
      if (first && typeof first === "object") return _objToProbsArray(first, size);
    } catch (e) {
      // skip
    }
  }

  // 5. Plain object {key: val}
  if (out && typeof out === "object" && out.constructor === Object) {
    const keys = Object.keys(out);
    if (keys.length > 0 && !Number.isNaN(Number(keys[0]))) {
      return _objToProbsArray(out, size);
    }
  }

  // 6. EN SON: Tensor { data }. Non-tensor'da throw atar — try/catch.
  try {
    const d = out.data;
    if (d instanceof Float32Array || (Array.isArray(d) && typeof d[0] === "number")) {
      return Array.from(d);
    }
    if (Array.isArray(d) && d[0] instanceof Map) {
      return _mapToProbsArray(d[0], size);
    }
    if (d instanceof Map) return _mapToProbsArray(d, size);
  } catch (e) {
    // Non-tensor: silent, devam
  }

  // Hiçbir yöntem işlemedi
  return null;
}

async function warmupLetterModel() {
  if (!letterSession) return;
  try {
    const dummy = new Float32Array(93);
    const t0 = performance.now();
    await predictLetter(dummy);
    console.log(`Letter model warmup: ${(performance.now() - t0).toFixed(1)} ms`);
  } catch (err) {
    console.warn("Letter warmup başarısız:", err);
  }
}
