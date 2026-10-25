// Static-letter ONNX adapter. LightGBM contract: input (1,93), output
// probabilities (1,24).

/**
 * The part of an ONNX Runtime Web session both model adapters use.
 *
 * @typedef {Object} OnnxSessionLike
 * @property {string[]} inputNames
 * @property {string[]} outputNames
 * @property {(feeds: Record<string, unknown>, fetches?: string[]) => Promise<Record<string, OnnxTensorLike>>} run
 */

/**
 * Older exports can return something else entirely, so _extractLetterProbs()
 * takes unknown. The letter label output is int64 (BigInt64Array); callers
 * convert with Number().
 *
 * @typedef {Object} OnnxTensorLike
 * @property {ArrayLike<number | bigint>} data
 */

/**
 * One entry per class in the loaded label list.
 *
 * @typedef {number[]} ProbabilityVector
 */

/** @type {OnnxSessionLike | null} */
let letterSession = null;
/** @type {string[]} */
let letterLabels = [];
/** @type {string[]} */
const DEFAULT_LETTER_LABELS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
];
const LETTER_MODEL_VERSION = "20260430-nozipmap";
const LETTER_MODEL_URL = `./models/letter_model.onnx?v=${LETTER_MODEL_VERSION}`;
// About 2.1 MB on the wire instead of 12.6 MB, because the static host serves
// .onnx uncompressed. The raw file stays deployed as the fallback.
const LETTER_MODEL_GZ_URL = `./models/letter_model.onnx.gz?v=${LETTER_MODEL_VERSION}`;
// Published export: label int64[N], probabilities float[N,24]. Older ZipMap
// exports are covered by the label-only fallback in predictLetter().
/** @type {string | null} */
let letterProbOutputName = null;
/** The one shared load; see ensureLetterModel(). @type {Promise<boolean> | null} */
let _letterModelLoad = null;

/**
 * @typedef {Object} FrameWarning
 * @property {(level: "warn" | "error", message: string, ...details: unknown[]) => void} note
 *   Count one failing frame; log the first and then every FRAME_WARNING_REPEAT-th.
 * @property {() => void} clear A frame worked: the next failure is a first again.
 */

// At about eight letter frames a second, 100 frames is about 12 seconds.
const FRAME_WARNING_REPEAT = 100;

/**
 * @returns {FrameWarning}
 */
function createFrameWarning() {
  let frames = 0;
  return {
    note(level, message, ...details) {
      frames += 1;
      if (frames === 1) console[level](message, ...details);
      else if (frames % FRAME_WARNING_REPEAT === 0) {
        console[level](`${message} (${frames} frames in a row)`, ...details);
      }
    },
    clear() {
      frames = 0;
    },
  };
}

// Each cause is cleared by the step that proves it gone, so a lasting
// unreadable output stays quiet while the label-only path keeps working.
const _letterRunWarning = createFrameWarning();
const _letterProbsWarning = createFrameWarning();
const _letterLabelWarning = createFrameWarning();

/**
 * Every caller shares one promise. A failed load is forgotten, so the next need
 * tries again. The warmup is part of the promise, so no caller runs the session
 * while it is warming up.
 *
 * @returns {Promise<boolean>} True when the session is ready. Never rejects.
 */
function ensureLetterModel() {
  if (!_letterModelLoad) {
    _letterModelLoad = loadLetterModel().then(async (ok) => {
      if (ok) await warmupLetterModel();
      else _letterModelLoad = null;
      return ok;
    });
  }
  return _letterModelLoad;
}

/**
 * A host that sends Content-Encoding: gzip has the bytes decoded by fetch
 * already, so the gzip magic is checked before decompressing again.
 *
 * @returns {Promise<Uint8Array>} The ONNX model, ready for InferenceSession.create().
 * @throws {Error} When DecompressionStream is missing, the download fails, or
 *   the stream is not valid gzip. The caller falls back to the raw file.
 */
async function fetchLetterModelBytes() {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not supported");
  }
  const res = await fetch(LETTER_MODEL_GZ_URL);
  if (!res.ok) throw new Error(`${LETTER_MODEL_GZ_URL} HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body[0] !== 0x1f || body[1] !== 0x8b) return body;

  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Never throws: the app keeps running with whichever models did load.
 *
 * @returns {Promise<boolean>} True when the session and labels are ready.
 */
async function loadLetterModel() {
  try {
    if (typeof ort === "undefined") {
      console.error("ort (onnxruntime-web) is not loaded");
      return false;
    }

    if (ort.env && ort.env.wasm) ort.env.wasm.wasmPaths = ORT_WASM_PATHS;

    const sessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    try {
      letterSession = await ort.InferenceSession.create(
        await fetchLetterModelBytes(),
        sessionOptions,
      );
    } catch (err) {
      // The raw file is deployed beside the gzipped one.
      console.warn("Gzipped letter model unusable, loading the raw file:", err?.message || err);
      letterSession = await ort.InferenceSession.create(LETTER_MODEL_URL, sessionOptions);
    }

    console.log("Letter ONNX inputs:", letterSession.inputNames);
    console.log("Letter ONNX outputs:", letterSession.outputNames);

    try {
      const res = await fetch("./data/letter_labels.json");
      // A missing file can come back as a JSON error body.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      letterLabels = new Array(Object.keys(data).length);
      for (const [letter, idx] of Object.entries(data)) {
        letterLabels[Number(idx)] = letter;
      }
    } catch (e) {
      console.warn("letter_labels.json unreadable, using the built-in 24-letter list:", e?.message || e);
      letterLabels = [...DEFAULT_LETTER_LABELS];
    }

    // The published export's outputs are [label, probabilities].
    letterProbOutputName =
      letterSession.outputNames.length > 1
        ? letterSession.outputNames[1]
        : letterSession.outputNames[0];

    console.log(`Letter model loaded: ${letterLabels.length} classes, probability output: ${letterProbOutputName}`);
    return true;
  } catch (err) {
    console.error("Letter model failed to load:", err);
    letterSession = null;
    return false;
  }
}

/**
 * When the probability output is unreadable (older ZipMap export, unexpected
 * shape) that call asks for the label alone, at confidence 1.0; the smoother
 * turns repeats into a temporal confidence. Nothing is latched: a run that
 * throws is a failed frame, and latching the fallback would report every
 * later letter at 100 %.
 *
 * @param {LetterFeatures93} features93 Letter features; length must be 93.
 * @returns {Promise<PredictionResult | null>} Null when no model is loaded,
 *   the run failed, or neither output path produced a usable label.
 */
async function predictLetter(features93) {
  if (!letterSession) return null;

  const t0 = performance.now();

  const input = new ort.Tensor("float32", features93, [1, 93]);
  /** @type {Record<string, unknown>} */
  const feeds = {};
  feeds[letterSession.inputNames[0]] = input;

  try {
    const results = await letterSession.run(feeds);
    _letterRunWarning.clear();
    const out = results[letterProbOutputName];
    const probs = _extractLetterProbs(out, letterLabels.length);
    if (probs) {
      _letterProbsWarning.clear();
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
    }
    _letterProbsWarning.note("warn", "[Letter] probability output unreadable, using the label alone for this frame");
  } catch (err) {
    _letterRunWarning.note("warn", "[Letter] model run failed, frame dropped:", err?.message || err);
    return null;
  }

  // Fetch the label alone, so the run skips the output it could not read.
  try {
    const labelName = letterSession.outputNames[0]; // "label"
    const results = await letterSession.run(feeds, [labelName]);
    const labelOut = results[labelName];

    let labelIdx = -1;
    try {
      const d = labelOut?.data;
      if (d && d.length > 0) labelIdx = Number(d[0]);
    } catch (e) {
      _letterLabelWarning.note("warn", "[Letter] label tensor unreadable:", e.message);
      return null;
    }

    if (labelIdx < 0 || labelIdx >= letterLabels.length) {
      _letterLabelWarning.note("warn", `[Letter] invalid label index: ${labelIdx}`);
      return null;
    }
    _letterLabelWarning.clear();

    const t1 = performance.now();
    if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

    const letter = letterLabels[labelIdx] || `cls_${labelIdx}`;
    return {
      label: letter,
      confidence: 1.0,
      alternatives: [{ label: letter, confidence: 1.0 }],
    };
  } catch (err) {
    _letterLabelWarning.note("error", "[Letter] label-only fallback failed too:", err);
    return null;
  }
}

/**
 * @param {Map<unknown, unknown>} map
 * @param {number} size Number of classes.
 * @returns {ProbabilityVector} Zero-filled for any class the map omits.
 */
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

/**
 * @param {Record<string, unknown>} obj
 * @param {number} size Number of classes.
 * @returns {ProbabilityVector} Zero-filled for any class the object omits.
 */
function _objToProbsArray(obj, size) {
  const arr = new Array(size).fill(0);
  for (const [k, v] of Object.entries(obj)) {
    const idx = Number(k);
    if (!Number.isNaN(idx) && idx >= 0 && idx < size) arr[idx] = Number(v);
  }
  return arr;
}

/**
 * @param {unknown} value
 * @returns {value is Float32Array | number[]} True for a float32 tensor buffer
 *   or a plain array of numbers.
 */
function _isNumericVector(value) {
  // The published output is float32 throughout, so the first entry stands for the rest.
  return value instanceof Float32Array || (Array.isArray(value) && typeof value[0] === "number");
}

/**
 * @param {ArrayLike<number>} values
 * @param {number} size Number of classes.
 * @returns {ProbabilityVector | null} Null unless there is one entry per class:
 *   a longer vector would rank unnamed classes, a shorter one hide some.
 */
function _fullProbsVector(values, size) {
  if (values.length !== size) return null;
  return Array.from(values, Number);
}

/**
 * The output shape varies with the ONNX export and the runtime version, so it
 * is narrowed by inspection. Iterables other than a numeric vector are read
 * only a few entries deep, so an unexpected shape cannot stall the frame.
 *
 * @param {unknown} out One named output of a session run.
 * @param {number} size Number of classes.
 * @returns {ProbabilityVector | null} Null when no supported shape matched;
 *   predictLetter() then uses the label alone.
 */
function _extractLetterProbs(out, size) {
  if (!out) return null;

  // 0. A bare numeric vector, read in full before the bounded read below.
  if (_isNumericVector(out)) return _fullProbsVector(out, size);

  // 1. Array<Map>: ZipMap sequence.
  if (Array.isArray(out) && out.length > 0) {
    const first = out[0];
    if (first instanceof Map) return _mapToProbsArray(first, size);
    if (first && typeof first === "object") return _objToProbsArray(first, size);
  }

  // 2. A single map(int64,float).
  if (out instanceof Map) return _mapToProbsArray(out, size);

  // 3. Generic iterable. The cast stays inside the condition so the guards
  // before it short-circuit.
  if (
    out &&
    typeof out !== "string" &&
    typeof (/** @type {Record<symbol, unknown>} */ (out))[Symbol.iterator] === "function"
  ) {
    try {
      const arr = [];
      for (const item of /** @type {Iterable<unknown>} */ (out)) {
        arr.push(item);
        if (arr.length >= 10) break; // Bound inspection of unknown iterables.
      }
      if (arr.length > 0) {
        const first = arr[0];
        if (first instanceof Map) return _mapToProbsArray(first, size);
        if (isRecord(first)) return _objToProbsArray(first, size);
        if (typeof first === "number") {
          // A read cut short at the bound is not a full vector and is rejected.
          return _fullProbsVector(arr.map(Number), size);
        }
      }
    } catch (e) {
      // The iterator threw; try the remaining shapes.
    }
  }

  // 4. Array-like with a length.
  if (isRecord(out) && typeof out.length === "number" && out.length > 0) {
    try {
      const first = out[0];
      if (first instanceof Map) return _mapToProbsArray(first, size);
      if (isRecord(first)) return _objToProbsArray(first, size);
    } catch (e) {
      // An index accessor threw; try the remaining shapes.
    }
  }

  // 5. Plain object keyed by class index.
  if (isRecord(out) && out.constructor === Object) {
    const keys = Object.keys(out);
    if (keys.length > 0 && !Number.isNaN(Number(keys[0]))) {
      return _objToProbsArray(out, size);
    }
  }

  // 6. Tensor-like {data}; last because non-tensor access may throw.
  try {
    const d = isRecord(out) ? out.data : undefined;
    if (_isNumericVector(d)) return _fullProbsVector(d, size);
    if (Array.isArray(d) && d[0] instanceof Map) {
      return _mapToProbsArray(d[0], size);
    }
    if (d instanceof Map) return _mapToProbsArray(d, size);
  } catch (e) {
    // Unsupported non-tensor output.
  }

  return null;
}

/**
 * A throwaway run, so the first real frame is not slowed by lazy WASM init.
 *
 * @returns {Promise<void>} Resolves even when the warmup itself fails.
 */
async function warmupLetterModel() {
  if (!letterSession) return;
  try {
    const dummy = new Float32Array(93);
    const t0 = performance.now();
    await predictLetter(dummy);
    console.log(`Letter model warmup: ${(performance.now() - t0).toFixed(1)} ms`);
  } catch (err) {
    console.warn("Letter model warmup failed:", err);
  }
  // The warmup is not a signed frame; the first live failure is reported in full.
  _letterRunWarning.clear();
  _letterProbsWarning.clear();
  _letterLabelWarning.clear();
}
