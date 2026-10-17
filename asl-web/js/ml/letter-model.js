// Static-letter ONNX adapter.
// LightGBM contract: input (1,93), output probabilities (1,24).

/**
 * The part of an ONNX Runtime Web session both model adapters use. The full
 * ORT type tree is deliberately not copied into the source.
 *
 * @typedef {Object} OnnxSessionLike
 * @property {string[]} inputNames
 * @property {string[]} outputNames
 * @property {(feeds: Record<string, unknown>, fetches?: string[]) => Promise<Record<string, OnnxTensorLike>>} run
 */

/**
 * One named session output, as ONNX Runtime Web declares it. Older exports can
 * materialize something else entirely, which is why _extractLetterProbs()
 * takes unknown rather than this type.
 *
 * The element type follows the tensor's ONNX dtype: the letter graph's label
 * output is int64 and arrives as a BigInt64Array, while its probabilities and
 * the word graph's logits are float32. Callers convert with Number().
 *
 * @typedef {Object} OnnxTensorLike
 * @property {ArrayLike<number | bigint>} data
 */

/**
 * Class probabilities in model output order. Runtime invariant: one entry per
 * class in the loaded label list.
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
// The same model gzipped: about 2.1 MB on the wire instead of 12.6 MB, because
// the static host serves .onnx uncompressed. check_runtime_assets.py checks it
// decompresses to exactly the raw file, which stays deployed as the fallback.
const LETTER_MODEL_GZ_URL = `./models/letter_model.onnx.gz?v=${LETTER_MODEL_VERSION}`;
// Published web export:
//   label tensor(int64)[N], probabilities tensor(float)[N,24]
// Older LightGBM exports expose probabilities as a ZipMap seq(map), which the
// label-only fallback in predictLetter() covers.
/** @type {string | null} */
let letterProbOutputName = null;
/** The one shared load; see ensureLetterModel(). @type {Promise<boolean> | null} */
let _letterModelLoad = null;

/**
 * Load and warm the letter model the first time something needs it.
 *
 * Nothing loads it at startup. Every caller shares one promise, so asking twice
 * downloads once and a caller arriving mid-download waits for the same one. A
 * failed load is forgotten once it settles, so the next need tries again
 * rather than inheriting the failure for the rest of the visit. The warmup is
 * part of the promise, so no caller runs the session while it is warming up.
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
 * Download the gzipped letter model and return the model bytes.
 *
 * The gzip magic bytes are checked before decompressing. A host that sends the
 * file with Content-Encoding: gzip has it decoded by fetch already, and those
 * bytes are the model itself; decompressing them again would fail.
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
 * Create the letter session and load its label map.
 *
 * Never throws: a failure is reported as false so the app can keep running with
 * whichever models did load.
 *
 * @returns {Promise<boolean>} True when the session and labels are ready.
 */
async function loadLetterModel() {
  try {
    if (typeof ort === "undefined") {
      console.error("ort (onnxruntime-web) is not loaded");
      return false;
    }

    // Must match the ort.min.js version that index.html loads.
    if (ort.env && ort.env.wasm) {
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    }

    const sessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    try {
      letterSession = await ort.InferenceSession.create(
        await fetchLetterModelBytes(),
        sessionOptions,
      );
    } catch (err) {
      // The raw file is deployed beside the gzipped one, so any failure on the
      // compressed path falls back to it.
      console.warn("Gzipped letter model unusable, loading the raw file:", err?.message || err);
      letterSession = await ort.InferenceSession.create(LETTER_MODEL_URL, sessionOptions);
    }

    console.log("Letter ONNX inputs:", letterSession.inputNames);
    console.log("Letter ONNX outputs:", letterSession.outputNames);

    // letter_labels.json maps each letter to its output index.
    try {
      const res = await fetch("./data/letter_labels.json");
      const data = await res.json();
      letterLabels = new Array(Object.keys(data).length);
      for (const [letter, idx] of Object.entries(data)) {
        letterLabels[Number(idx)] = letter;
      }
    } catch (e) {
      console.warn("letter_labels.json unreadable, using the built-in 24-letter list");
      letterLabels = [...DEFAULT_LETTER_LABELS];
    }

    // The published export's outputs are [label, probabilities]; a graph with
    // one output has no probability tensor to read.
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
 * Classify one letter frame.
 *
 * Two output paths exist. The probability tensor gives real confidences and a
 * top-three list. When a run returns an output the app cannot read as
 * probabilities (an older ZipMap export, an unexpected runtime shape), that
 * call asks for the label alone, which reports confidence 1.0 as a presence
 * signal; the smoother turns those repeats into a temporal confidence.
 *
 * The decision is made per call and nothing is remembered. A run that throws
 * is a failed frame, not a shape problem: it returns null and the next frame
 * tries the probabilities again. Latching the label-only path on the first
 * exception (the warmup can raise one too) would report every later letter at
 * 100 % for the rest of the visit.
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
    }
    console.warn("[Letter] probability output unreadable, using the label alone for this frame");
  } catch (err) {
    console.warn("[Letter] model run failed, frame dropped:", err?.message || err);
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
      console.warn("[Letter] label tensor unreadable:", e.message);
      return null;
    }

    if (labelIdx < 0 || labelIdx >= letterLabels.length) {
      console.warn(`[Letter] invalid label index: ${labelIdx}`);
      return null;
    }

    const t1 = performance.now();
    if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

    const letter = letterLabels[labelIdx] || `cls_${labelIdx}`;
    return {
      label: letter,
      confidence: 1.0,
      alternatives: [{ label: letter, confidence: 1.0 }],
    };
  } catch (err) {
    console.error("[Letter] label-only fallback failed too:", err);
    return null;
  }
}

/**
 * Read a ZipMap-style map keyed by class index.
 *
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
 * Read a plain object keyed by class index.
 *
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
 * Recover class probabilities from whatever shape the session returned.
 *
 * The output is treated as unknown and narrowed by inspection, because it
 * varies with the ONNX export and the runtime version: a ZipMap sequence, a
 * single map, a generic iterable, an array-like, a plain index-keyed object, or
 * a tensor with a data buffer. Unknown iterables are only read a few entries
 * deep so an unexpected shape cannot stall the frame.
 *
 * @param {unknown} out One named output of a session run.
 * @param {number} size Number of classes.
 * @returns {ProbabilityVector | null} Null when no supported shape matched.
 */
function _extractLetterProbs(out, size) {
  if (!out) return null;

  // 1. Array<Map>: common ZipMap sequence representation.
  if (Array.isArray(out) && out.length > 0) {
    const first = out[0];
    if (first instanceof Map) return _mapToProbsArray(first, size);
    if (first && typeof first === "object") return _objToProbsArray(first, size);
  }

  // 2. A single map(int64,float).
  if (out instanceof Map) return _mapToProbsArray(out, size);

  // 3. Generic iterable, such as an internal ONNX sequence wrapper. Reading a
  // symbol off an unknown value needs the index signature spelled out; the
  // cast stays inside the condition so the guards before it short-circuit.
  if (
    out &&
    typeof out !== "string" &&
    typeof (/** @type {Record<symbol, unknown>} */ (out))[Symbol.iterator] === "function"
  ) {
    try {
      const arr = [];
      // The line above established that this value is iterable.
      for (const item of /** @type {Iterable<unknown>} */ (out)) {
        arr.push(item);
        if (arr.length >= 10) break; // Bound inspection of unknown iterables.
      }
      if (arr.length > 0) {
        const first = arr[0];
        if (first instanceof Map) return _mapToProbsArray(first, size);
        if (isRecord(first)) return _objToProbsArray(first, size);
        if (typeof first === "number") {
          // Direct probability array.
          return arr.map(Number);
        }
      }
    } catch (e) {
      // The iterator threw; try the remaining shapes.
    }
  }

  // 4. Array-like index access when a length is exposed.
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

  // 6. Tensor-like {data}; keep last because non-tensor access may throw.
  try {
    const d = isRecord(out) ? out.data : undefined;
    if (d instanceof Float32Array || (Array.isArray(d) && typeof d[0] === "number")) {
      return Array.from(d);
    }
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
 * Run one throwaway inference so the first real frame is not slowed by lazy
 * WASM initialization.
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
}
