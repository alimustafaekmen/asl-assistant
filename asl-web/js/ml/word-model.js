// Word-model ONNX adapter.
// SignTransformer contract: input (1,45,168), mask (1,45), output (1,50).
// Inference runs through the ONNX Runtime Web WASM backend.

/**
 * Flattened word model input. Runtime invariant: length is 45 * 168 = 7560,
 * frame-major. predictWord() rejects any other length.
 *
 * @typedef {Float32Array} WordFeatures45x168
 */

/**
 * Word model padding mask. Runtime invariant: length is 45, where true marks a
 * real frame and false marks padding. The exported ONNX graph inverts this
 * itself, so it must not be pre-inverted here.
 *
 * @typedef {boolean[]} WordMask45
 */

/**
 * Mask tensor element type. The published graph varies by export, so the
 * adapter tries these in order until one is accepted.
 *
 * @typedef {"bool" | "uint8" | "int64"} WordMaskDtype
 */

/** @type {OnnxSessionLike | null} */
let wordSession = null;
/** Calibration temperature exported with the model; 1.0 disables calibration. */
let temperature = 1.0;
/** @type {string[]} */
let wordLabels = [];
/** @type {WordMaskDtype} Resolved at runtime by trying each dtype in turn. */
let wordMaskDtype = "bool";
/** @type {WordMaskDtype[]} */
const WORD_MASK_DTYPES = ["bool", "uint8", "int64"];
/** The one shared load; see ensureWordModel(). @type {Promise<boolean> | null} */
let _wordModelLoad = null;

/**
 * Load and warm the word model the first time something needs it.
 *
 * Shared, forgotten on failure, and warmed before it resolves, for the same
 * reasons as ensureLetterModel().
 *
 * @returns {Promise<boolean>} True when the session is ready. Never rejects.
 */
function ensureWordModel() {
  if (!_wordModelLoad) {
    _wordModelLoad = loadWordModel().then(async (ok) => {
      if (ok) await warmupWordModel();
      else _wordModelLoad = null;
      return ok;
    });
  }
  return _wordModelLoad;
}

/**
 * Create the word session and load its calibration temperature and label map.
 *
 * Never throws: a failure is reported as false, and a missing or unusable
 * temperature file falls back to 1.0 so inference still runs.
 *
 * @returns {Promise<boolean>} True when the session and labels are ready.
 */
async function loadWordModel() {
  try {
    if (typeof ort === "undefined") {
      console.error("ort (onnxruntime-web) is not loaded");
      return false;
    }

    if (ort.env && ort.env.wasm) ort.env.wasm.wasmPaths = ORT_WASM_PATHS;

    wordSession = await ort.InferenceSession.create("./models/word_model.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    console.log("Word ONNX inputs:", wordSession.inputNames);
    console.log("Word ONNX outputs:", wordSession.outputNames);

    try {
      const tempRes = await fetch("./data/temperature.json");
      if (!tempRes.ok) throw new Error(`HTTP ${tempRes.status}`);
      const tempData = await tempRes.json();
      const parsedTemperature = Number(tempData.T ?? tempData.temperature ?? 1.0);
      temperature = Number.isFinite(parsedTemperature) && parsedTemperature > 0
        ? parsedTemperature
        : 1.0;
    } catch (e) {
      console.warn("temperature.json unreadable, using T=1:", e.message);
      temperature = 1.0;
    }

    // word_labels.json maps each word to its output index.
    const labelsRes = await fetch("./data/word_labels.json");
    if (!labelsRes.ok) throw new Error(`word_labels.json HTTP ${labelsRes.status}`);
    const labelsData = await labelsRes.json();
    wordLabels = new Array(Object.keys(labelsData).length);
    for (const [word, idx] of Object.entries(labelsData)) {
      wordLabels[Number(idx)] = word;
    }

    console.log(
      `Word model loaded: T=${temperature}, ${wordLabels.length} words`,
    );
    return true;
  } catch (err) {
    console.error("Word model failed to load:", err);
    wordSession = null;
    return false;
  }
}

/**
 * Build the padding mask tensor in the requested element type.
 *
 * The mask is passed through as-is: true marks a real frame. The exported graph
 * performs its own attention-mask inversion, so inverting here would silently
 * feed the model the padding instead of the recording.
 *
 * @param {WordMask45} mask45 Padding mask; length must be 45.
 * @param {WordMaskDtype} [dtype] Defaults to the dtype currently in force.
 * @returns {unknown} An ort.Tensor for the session feed.
 */
function _buildMaskTensor(mask45, dtype = wordMaskDtype) {
  if (dtype === "bool") return new ort.Tensor("bool", mask45.map(Boolean), [1, 45]);
  if (dtype === "uint8") {
    const u = new Uint8Array(mask45.map((v) => (v ? 1 : 0)));
    return new ort.Tensor("uint8", u, [1, 45]);
  }
  const i = new BigInt64Array(mask45.map((v) => (v ? 1n : 0n)));
  return new ort.Tensor("int64", i, [1, 45]);
}

/**
 * Classify one word recording.
 *
 * The input length and mask length are checked here rather than trusted from
 * the type, because a wrong shape would otherwise reach the session and fail
 * with an opaque runtime error.
 *
 * If a run fails, the other mask element types are tried for this call, and
 * the remembered type changes only when another one succeeds. The published
 * graph varies by export, so this is a compatibility path; a run that fails
 * for another reason fails with every type and leaves the remembered one as
 * it was, so the next recording is not sent a type the graph rejects.
 *
 * @param {WordFeatures45x168} features45x168 Flattened input; length must be 7560.
 * @param {WordMask45} mask45 Padding mask; length must be 45.
 * @returns {Promise<PredictionResult | null>} Null when no model is loaded.
 * @throws {Error} When the input or mask length is wrong, or when the session
 *   fails with every supported mask element type.
 */
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
  const session = wordSession;
  const usesMask = session.inputNames.length > 1;
  // The type in force first, then the others in their usual order. A graph
  // without a mask input runs once.
  /** @type {(WordMaskDtype | null)[]} */
  const attempts = usesMask
    ? [wordMaskDtype, ...WORD_MASK_DTYPES.filter((dtype) => dtype !== wordMaskDtype)]
    : [null];
  /** @type {Record<string, OnnxTensorLike> | null} */
  let results = null;
  /** @type {unknown} */
  let lastRunError = null;
  for (const dtype of attempts) {
    try {
      /** @type {Record<string, unknown>} */
      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;
      if (dtype !== null) feeds[session.inputNames[1]] = _buildMaskTensor(mask45, dtype);
      results = await session.run(feeds);
      if (dtype !== null) wordMaskDtype = dtype;
      break;
    } catch (err) {
      lastRunError = err;
      if (dtype !== null) {
        console.warn(`Word model run failed with mask dtype ${dtype}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  if (!results) throw lastRunError;
  const logits = results[session.outputNames[0]].data;

  const t1 = performance.now();
  if (typeof recordBenchmark === "function") recordBenchmark("onnx", t1 - t0);

  // Number() because the element type follows the ONNX dtype; for this
  // float32 graph it is the identity.
  const calibrated = Array.from(logits, (x) => Number(x) / temperature);
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

/**
 * Softmax with the maximum subtracted first, so large logits cannot overflow.
 *
 * @param {number[]} logits Temperature-calibrated logits.
 * @returns {number[]} Probabilities summing to 1.
 */
function stableSoftmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

/**
 * Run one throwaway inference so the first real recording is not slowed by lazy
 * WASM initialization.
 *
 * @returns {Promise<void>} Resolves even when the warmup itself fails.
 */
async function warmupWordModel() {
  if (!wordSession) return;
  try {
    const dummy = new Float32Array(45 * 168);
    const dummyMask = new Array(45).fill(true);
    const t0 = performance.now();
    await predictWord(dummy, dummyMask);
    console.log(`Word model warmup: ${(performance.now() - t0).toFixed(1)} ms`);
  } catch (err) {
    console.warn("Word model warmup failed:", err);
  }
}
