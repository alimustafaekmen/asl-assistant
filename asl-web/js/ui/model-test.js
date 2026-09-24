// Model Test screen: run the published ONNX models against offline fixtures.
//
// This is the demo surface that shows the model working without a camera. It
// accepts a fixture from the bundled manifest, a URL, a file picker, or a drop
// target, validates it, runs the matching model, and reports the prediction
// against the fixture's expected label.
//
// Validation is the only guard between hand-written JSON and an ONNX session,
// so the shapes it enforces are the published model contract: 93 features for a
// letter, 45 x 168 features plus a 45-entry mask for a word, where a true mask
// entry marks a real frame and false marks padding.
//
// runOfflineCheck() is the narrower sibling: a fixed smoke fixture used to
// compare browser output against the Python pipeline.

/**
 * One entry of the bundled fixture manifest. These fields come straight from
 * JSON, so every one is treated as optional until it is read.
 *
 * @typedef {Object} ModelTestManifestItem
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} [title]
 * @property {string} [path] Fixture path relative to asl-web/.
 * @property {string} [expected_label]
 * @property {number | string} [confidence] Expected confidence, as published.
 */

/**
 * @typedef {Object} ModelTestManifest
 * @property {ModelTestManifestItem[]} [letters]
 * @property {ModelTestManifestItem[]} [words]
 */

/**
 * Fields both validated fixture kinds carry.
 *
 * @typedef {Object} ModelTestSampleMeta
 * @property {string} sampleId
 * @property {string} expectedLabel Empty string when the fixture has no reference.
 * @property {number} expectedConfidence NaN when the fixture declares none.
 * @property {unknown} expectedTop3 Carried through unvalidated; not read back.
 * @property {string} schemaVersion
 * @property {string} source
 * @property {string} shapeLabel Human-readable input shape.
 * @property {string} maskLabel Human-readable mask summary.
 */

/**
 * A validated letter fixture. This is not the raw JSON: normalizeModelTestSample()
 * has already checked the feature count.
 *
 * @typedef {ModelTestSampleMeta & {task: "letter", features: LetterFeatures93, mask: null}} LetterModelTestSample
 */

/**
 * A validated word fixture, with its features flattened and its mask checked.
 *
 * @typedef {ModelTestSampleMeta & {task: "word", features: WordFeatures45x168, mask: WordMask45}} WordModelTestSample
 */

/**
 * A fixture that passed validation. The task field discriminates the union, so
 * a word sample always has a mask and a letter sample never does.
 *
 * @typedef {LetterModelTestSample | WordModelTestSample} ModelTestSample
 */

/**
 * How far a fixture has got through the panel's four process steps. "error"
 * clears them all rather than marking a step.
 *
 * @typedef {"idle" | "loading" | "validated" | "running" | "done" | "error"} ModelTestProcessStatus
 */

/**
 * Switch the panel between the letter and word models.
 *
 * @param {string} task Anything other than "word" selects the letter model.
 * @returns {void}
 */
function setModelTestTask(task) {
  state.modelTestTask = task === "word" ? "word" : "letter";
  queryElements("[data-model-test-task]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.modelTestTask === state.modelTestTask);
  });
  renderModelTestSampleOptions();
  updateModelTestDomainHelp();
}

/**
 * Load the bundled fixture manifest.
 *
 * A missing or unreadable manifest falls back to one built-in fixture per task,
 * so the demo screen still works offline.
 *
 * @returns {Promise<void>}
 */
async function loadModelTestManifest() {
  try {
    const res = await fetch("./data/model-test-samples/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    state.modelTestManifest = await res.json();
  } catch (err) {
    console.warn("Model Test fixture manifest okunamadı:", err?.message || err);
    state.modelTestManifest = {
      letters: [
        {
          id: "legacy-letter-a",
          label: "A",
          title: "Harf A",
          path: "./data/letter_test_sample.json",
          expected_label: "A",
        },
      ],
      words: [
        {
          id: "legacy-word-give",
          label: "give",
          title: "Kelime give",
          path: "./data/test_sample.json",
          expected_label: "give",
        },
      ],
    };
  }
  renderModelTestSampleOptions();
}

/**
 * @param {ModelTask} [task] Defaults to the task the panel is showing.
 * @returns {ModelTestManifestItem[]} Empty when the manifest has no entries.
 */
function getModelTestManifestItems(task = state.modelTestTask) {
  const manifest = state.modelTestManifest || {};
  return task === "word" ? (manifest.words || []) : (manifest.letters || []);
}

/**
 * Rebuild the fixture dropdown for the active task.
 *
 * For words the first preferred fixture present in the manifest is selected, so
 * the demo does not open on a weak case.
 *
 * @returns {void}
 */
function renderModelTestSampleOptions() {
  if (!els.modelTestSampleSelect) return;
  const items = getModelTestManifestItems();
  els.modelTestSampleSelect.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.modelTestTask === "word"
      ? "Hazır kelime fixture yok"
      : "Hazır harf fixture yok";
    els.modelTestSampleSelect.appendChild(option);
    if (els.loadSelectedModelTestSample) els.loadSelectedModelTestSample.disabled = true;
    return;
  }

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.path;
    const conf = Number.isFinite(Number(item.confidence))
      ? ` · beklenen %${Math.round(Number(item.confidence) * 100)}`
      : "";
    option.textContent = `${item.title || item.label || item.id}${conf}`;
    option.dataset.sampleId = item.id || "";
    option.dataset.label = item.expected_label || item.label || "";
    els.modelTestSampleSelect.appendChild(option);
  });
  if (state.modelTestTask === "word") {
    const options = Array.from(els.modelTestSampleSelect.options);
    const preferred = PREFERRED_MODEL_TEST_WORD_IDS
      .map((id) => options.find((option) => option.dataset.sampleId === id))
      .find(Boolean);
    if (preferred) preferred.selected = true;
  }
  if (els.loadSelectedModelTestSample) els.loadSelectedModelTestSample.disabled = false;
}

/**
 * Load the best available demo fixture for a task.
 *
 * @param {string} task Anything other than "word" selects the letter model.
 * @returns {Promise<void>} Resolves after reporting an error when no fixture
 *   is available.
 */
async function loadPreferredModelTestSample(task) {
  const normalizedTask = task === "word" ? "word" : "letter";
  setModelTestTask(normalizedTask);
  const items = getModelTestManifestItems(normalizedTask);
  const preferredIds = normalizedTask === "word" ? PREFERRED_MODEL_TEST_WORD_IDS : ["letter-a"];
  const sample =
    preferredIds.map((id) => items.find((item) => item.id === id)).find(Boolean) || items[0];

  if (!sample?.path) {
    showModelTestError(
      normalizedTask === "word"
        ? "Hazır kelime demo fixture bulunamadı."
        : "Hazır harf demo fixture bulunamadı.",
    );
    return;
  }

  await loadModelTestSampleFromUrl(sample.path, sample.title || sample.label || sample.id);
}

/**
 * Load the preferred fixture for a task and run it.
 *
 * The run is skipped when loading produced a fixture for a different task, so a
 * failed load cannot run the previous sample.
 *
 * @param {string} task Anything other than "word" selects the letter model.
 * @returns {Promise<void>}
 */
async function loadAndRunPreferredModelTestSample(task) {
  const normalizedTask = task === "word" ? "word" : "letter";
  await loadPreferredModelTestSample(normalizedTask);
  if (state.modelTestSample?.task === normalizedTask) {
    await runModelTestSample();
  }
}

/**
 * Explain what the active model evaluates.
 *
 * @returns {void}
 */
function updateModelTestDomainHelp() {
  if (!els.modelTestDomainHelp) return;
  if (state.modelTestTask === "word") {
    els.modelTestDomainHelp.textContent =
      "Kelime modu hareketi değerlendirir: 45 frame boyunca çıkarılan özellikler ve gerçek frame maskesi modele verilir. Bu yüzden tek fotoğraf değil, kısa bir hareket dizisi test edilir.";
  } else {
    els.modelTestDomainHelp.textContent =
      "Harf modu statik el pozunu değerlendirir: tek frame üzerinden 93 sayısal özellik çıkarılır ve 24 harf sınıfından biri tahmin edilir.";
  }
}

/**
 * Load whichever fixture the dropdown is showing.
 *
 * @returns {Promise<void>}
 */
async function loadSelectedModelTestSample() {
  const option = els.modelTestSampleSelect?.selectedOptions?.[0];
  if (!option?.value) {
    showModelTestError("Bu domain için hazır fixture bulunamadı.");
    return;
  }
  await loadModelTestSampleFromUrl(option.value, option.textContent.trim());
}

/**
 * Fetch and validate a fixture from a URL.
 *
 * @param {string} url Fixture path relative to asl-web/.
 * @param {string} [displayName] Label for the status line; falls back to the URL.
 * @returns {Promise<void>} Resolves after reporting a fetch or validation
 *   failure to the user.
 */
async function loadModelTestSampleFromUrl(url, displayName) {
  try {
    if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Örnek yükleniyor";
    updateModelTestProcess("loading");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${displayName} alınamadı (HTTP ${res.status})`);
    const sample = await res.json();
    setModelTestSample(sample, displayName || url);
  } catch (err) {
    showModelTestError(err.message);
    console.error(err);
  }
}

/**
 * Handle a fixture chosen through the file picker.
 *
 * @param {Event & {target: HTMLInputElement}} event Change event from the
 *   fixture file input this handler is bound to.
 * @returns {Promise<void>}
 */
async function handleModelTestSampleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await readModelTestSampleFile(file);
}

/**
 * Handle a fixture dropped onto the drop zone.
 *
 * @param {DragEvent} event
 * @returns {Promise<void>}
 */
async function handleModelTestSampleDrop(event) {
  event.preventDefault();
  els.modelTestDropZone?.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await readModelTestSampleFile(file);
}

/**
 * Read and validate a fixture from a local file.
 *
 * @param {File} file
 * @returns {Promise<void>} Resolves after reporting a parse or validation
 *   failure to the user.
 */
async function readModelTestSampleFile(file) {
  try {
    updateModelTestProcess("loading");
    const text = await file.text();
    const sample = JSON.parse(text);
    setModelTestSample(sample, file.name);
  } catch (err) {
    showModelTestError(`JSON okunamadı: ${err.message}`);
  }
}

/**
 * Validate a fixture and show its metadata.
 *
 * @param {unknown} rawSample Parsed JSON, not yet trusted.
 * @param {string} sourceName Where it came from, for the status line.
 * @returns {void}
 * @throws {Error} When validation rejects the fixture; callers report the
 *   message to the user.
 */
function setModelTestSample(rawSample, sourceName) {
  const sample = normalizeModelTestSample(rawSample, sourceName);
  state.modelTestSample = sample;
  setModelTestTask(sample.task);
  updateModelTestProcess("validated");

  if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Örnek hazır";
  if (els.modelTestFileName) els.modelTestFileName.textContent = sourceName || sample.source || "Yüklenen JSON";
  if (els.runModelTestSample) els.runModelTestSample.disabled = false;
  if (els.modelTestTaskLabel) els.modelTestTaskLabel.textContent = sample.task === "word" ? "Kelime modeli" : "Harf modeli";
  if (els.modelTestSourceLabel) els.modelTestSourceLabel.textContent = sample.source || sourceName || "JSON fixture";
  if (els.modelTestSchemaLabel) els.modelTestSchemaLabel.textContent = sample.schemaVersion;
  if (els.modelTestShapeLabel) els.modelTestShapeLabel.textContent = sample.shapeLabel;
  if (els.modelTestMaskLabel) els.modelTestMaskLabel.textContent = sample.maskLabel;
  if (els.modelTestExpectedLabel) els.modelTestExpectedLabel.textContent = sample.expectedLabel || "Referans yok";
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = "-";
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = "-";
  if (els.modelTestLatency) els.modelTestLatency.textContent = "-";
  if (els.modelTestMatchBadge) {
    els.modelTestMatchBadge.textContent = "Çalıştırılmadı";
    els.modelTestMatchBadge.dataset.match = "unknown";
  }
  if (els.modelTestResultNote) {
    els.modelTestResultNote.textContent =
      sample.task === "word"
        ? "Kelime örneği 45 frame hareket bilgisinden hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek."
        : "Harf örneği tek el pozundan hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek.";
  }
  renderModelTestTop3([]);
}

/**
 * Turn unvalidated JSON into a fixture that is safe to feed a model.
 *
 * The input is unknown on purpose: it may come from a URL, a file picker, or a
 * drop target. The task is taken from the task field, or inferred from the
 * presence of a mask, and then the shapes the published models require are
 * enforced -- 93 features for a letter, 45 x 168 features and a 45-entry mask
 * for a word.
 *
 * @param {unknown} rawSample
 * @param {string} [sourceName] Fallback source label.
 * @returns {ModelTestSample} A validated, discriminated fixture.
 * @throws {Error} With a Turkish message naming what was wrong.
 */
function normalizeModelTestSample(rawSample, sourceName) {
  if (!isRecord(rawSample)) {
    throw new Error("Fixture JSON object olmalı");
  }

  const inferredTask = rawSample.task || (Array.isArray(rawSample.mask) ? "word" : "letter");
  const task = inferredTask === "word" ? "word" : "letter";
  const rawFeatures = rawSample.features || rawSample.input || rawSample.feature_vector;
  if (!Array.isArray(rawFeatures)) {
    throw new Error("features alanı array olmalı");
  }
  const features = flattenNumericArray(rawFeatures, "features");

  // Fixtures are hand-written, so a label may arrive as a number. Reading it as
  // text here keeps the rest of the panel working with strings.
  const expectedLabel = String(
    rawSample.expected_label ||
      rawSample.expected_word ||
      rawSample.expected_letter ||
      rawSample.label ||
      "",
  );

  if (task === "word") {
    const mask = normalizeMask(rawSample.mask);
    if (features.length !== 45 * 168) {
      throw new Error(`Kelime fixture features[7560] bekler, ${features.length} geldi`);
    }
    if (mask.length !== 45) {
      throw new Error(`Kelime fixture mask[45] bekler, ${mask.length} geldi`);
    }
    const realFrames = mask.filter(Boolean).length;
    return {
      task,
      sampleId: String(rawSample.sample_id || ""),
      features: Float32Array.from(features),
      mask,
      expectedLabel,
      expectedConfidence: Number(rawSample.expected_confidence ?? NaN),
      expectedTop3: rawSample.expected_top3 || [],
      schemaVersion: String(rawSample.schema_version || "legacy-word-test-sample"),
      source: String(rawSample.source || rawSample.dataset || sourceName || "word fixture"),
      shapeLabel: "45 × 168 = 7560 float",
      maskLabel: `${realFrames}/45 real frame`,
    };
  }

  if (features.length !== 93) {
    throw new Error(`Harf fixture features[93] bekler, ${features.length} geldi`);
  }
  return {
    task,
    sampleId: String(rawSample.sample_id || ""),
    features: Float32Array.from(features),
    mask: null,
    expectedLabel,
    expectedConfidence: Number(rawSample.expected_confidence ?? NaN),
    expectedTop3: rawSample.expected_top3 || [],
    schemaVersion: String(rawSample.schema_version || "asl-sample-v1"),
    source: String(rawSample.source || rawSample.dataset || sourceName || "letter fixture"),
    shapeLabel: "93 float",
    maskLabel: "Yok",
  };
}

/**
 * Flatten a nested numeric array in row order.
 *
 * Word fixtures are published either flat or as 45 frames of 168 values, and
 * both must produce the same input.
 *
 * @param {unknown[]} value
 * @param {string} fieldName Field name used in the error message.
 * @returns {number[]}
 * @throws {Error} When any leaf is not a finite number.
 */
function flattenNumericArray(value, fieldName) {
  const out = [];
  const stack = [...value].reverse();
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i--) stack.push(item[i]);
      continue;
    }
    const num = Number(item);
    if (!Number.isFinite(num)) {
      throw new Error(`${fieldName} içinde sayısal olmayan değer var`);
    }
    out.push(num);
  }
  return out;
}

/**
 * Read a padding mask in any of its published spellings.
 *
 * Booleans, 0/1, and their string forms are all accepted, because fixtures have
 * been exported from several tools. True means a real frame.
 *
 * @param {unknown} value
 * @returns {WordMask45} The length is checked by the caller.
 * @throws {Error} When the value is not an array, or an entry is not a
 *   recognised boolean spelling.
 */
function normalizeMask(value) {
  if (!Array.isArray(value)) {
    throw new Error(`Kelime fixture mask[45] bekler, ${value == null ? 0 : "geçersiz"} geldi`);
  }
  return value.map((item) => {
    if (item === true || item === 1 || item === "1") return true;
    if (item === false || item === 0 || item === "0") return false;
    if (typeof item === "string") {
      const lowered = item.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
    }
    throw new Error("mask sadece bool, 0/1 veya true/false string değerleri içermeli");
  });
}

/**
 * Run the loaded fixture against its model.
 *
 * A run is a first need for its model, so the model loads here when nothing
 * has loaded it yet. The download is kept out of the measured time, which
 * reports inference alone.
 *
 * @returns {Promise<void>} Resolves after reporting a failure to the user.
 */
async function runModelTestSample() {
  const sample = state.modelTestSample;
  if (!sample) {
    showModelTestError("Önce JSON fixture yükle veya hazır örnek seç.");
    return;
  }

  const isWord = sample.task === "word";
  try {
    // The download is not inference, so it is named as what it is.
    if (els.modelTestSampleStatus) {
      els.modelTestSampleStatus.textContent =
        (isWord ? wordSession : letterSession) ? "Model çalışıyor" : "Model yükleniyor";
    }
    if (els.runModelTestSample) {
      els.runModelTestSample.disabled = true;
      els.runModelTestSample.textContent = "Model Çalışıyor";
    }
    updateModelTestProcess("running");

    if (!(await (isWord ? ensureWordModel() : ensureLetterModel()))) {
      throw new Error(isWord ? "Kelime modeli yüklenemedi" : "Harf modeli yüklenemedi");
    }
    if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Model çalışıyor";

    let result = null;
    const t0 = performance.now();
    if (isWord) {
      if (typeof predictWord !== "function") throw new Error("word-model.js yüklenmemiş");
      result = await predictWord(sample.features, sample.mask);
    } else {
      if (typeof predictLetter !== "function") throw new Error("letter-model.js yüklenmemiş");
      result = await predictLetter(sample.features);
    }
    const elapsed = performance.now() - t0;
    if (!result) throw new Error("Model tahmin döndürmedi");

    renderModelTestResult(sample, result, elapsed);
  } catch (err) {
    showModelTestError(err.message);
    console.error(err);
  } finally {
    if (els.runModelTestSample) {
      els.runModelTestSample.disabled = false;
      els.runModelTestSample.textContent = "Seçili Örneği Tekrar Çalıştır";
    }
  }
}

/**
 * Show a fixture's prediction against its expected label.
 *
 * @param {ModelTestSample} sample
 * @param {PredictionResult} result
 * @param {number} elapsed Inference time in milliseconds.
 * @returns {void}
 */
function renderModelTestResult(sample, result, elapsed) {
  const expected = sample.expectedLabel || "";
  const matched = expected ? result.label === expected : null;
  const alternatives = result.alternatives?.length
    ? result.alternatives
    : [{ label: result.label, confidence: result.confidence || 0 }];
  if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Tamamlandı";
  updateModelTestProcess("done");
  if (els.modelTestMatchBadge) {
    els.modelTestMatchBadge.textContent =
      matched === null ? "Referans yok" : matched ? "Eşleşti" : "Eşleşmedi";
    els.modelTestMatchBadge.dataset.match = matched === null ? "unknown" : matched ? "yes" : "no";
  }
  if (els.modelTestExpectedLabel) els.modelTestExpectedLabel.textContent = expected || "Referans yok";
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = result.label;
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = formatPercent(result.confidence);
  if (els.modelTestLatency) els.modelTestLatency.textContent = `${elapsed.toFixed(0)} ms`;
  renderModelTestTop3(alternatives);

  if (els.modelTestResultNote) {
    const topText = formatTopPredictions(alternatives);
    const matchText =
      matched === null
        ? "Bu fixture için referans etiket yok."
        : matched
          ? "Tahmin beklenen etiketle eşleşti. Bu, seçilen test girdisinde modelin doğru sınıfı seçtiğini gösterir."
          : "Tahmin beklenen etiketten farklı. Bu durumda top-3 listesi modelin hangi sınıfları karıştırdığını gösterir.";
    els.modelTestResultNote.textContent = `${matchText} Top-3: ${topText}.`;
  }
}

/**
 * Rebuild the panel's ranked alternatives list.
 *
 * @param {PredictionCandidate[]} items Ranked candidates, best first.
 * @returns {void}
 */
function renderModelTestTop3(items) {
  if (!els.modelTestTop3List) return;
  els.modelTestTop3List.innerHTML = "";
  const rows = items.length ? items.slice(0, 3) : [{ label: "-", confidence: 0 }];
  rows.forEach((item, index) => {
    const pct = clampPercent((item.confidence || 0) * 100);
    const row = document.createElement("div");
    row.className = "top3-row";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${index + 1}`;
    const label = document.createElement("b");
    label.textContent = item.label;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const confidence = document.createElement("span");
    confidence.textContent = `${pct}%`;
    row.append(rank, label, bar, confidence);
    els.modelTestTop3List.appendChild(row);
  });
}

/**
 * Report a fixture or inference failure in the result area.
 *
 * @param {string} message Turkish text shown to the user.
 * @returns {void}
 */
function showModelTestError(message) {
  if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Hata";
  updateModelTestProcess("error");
  if (els.modelTestMatchBadge) {
    els.modelTestMatchBadge.textContent = "Hata";
    els.modelTestMatchBadge.dataset.match = "no";
  }
  if (els.modelTestResultNote) els.modelTestResultNote.textContent = message;
}

/**
 * One step of the Model Test progress strip, as its data-step value.
 *
 * @typedef {"sample" | "validate" | "inference" | "result"} ModelTestProcessStep
 */

/**
 * Mark how far the fixture has progressed through the four process steps.
 *
 * @param {ModelTestProcessStatus} status
 * @returns {void}
 */
function updateModelTestProcess(status) {
  if (!els.modelTestProcessSteps) return;
  /** @type {Record<ModelTestProcessStatus, ModelTestProcessStep[]>} */
  const activeByStatus = {
    idle: [],
    loading: ["sample"],
    validated: ["sample", "validate"],
    running: ["sample", "validate", "inference"],
    done: ["sample", "validate", "inference", "result"],
    error: [],
  };
  // Held as strings because membership is tested against dataset values.
  /** @type {Set<string>} */
  const active = new Set(activeByStatus[status] || []);
  els.modelTestProcessSteps.dataset.status = status;
  queryElements("[data-step]", els.modelTestProcessSteps).forEach((step) => {
    step.dataset.state = active.has(step.dataset.step ?? "") ? "done" : "";
  });
}

/**
 * @param {number} value Probability in [0, 1].
 * @returns {string} A percentage with one decimal, or "-" when not finite.
 */
function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `%${(value * 100).toFixed(1)}`;
}

/**
 * Run the fixed smoke fixture and report browser output against the expected
 * values.
 *
 * This is the narrow sibling of the fixture panel: one deterministic sample
 * used to compare the browser against the Python pipeline. Detailed values go
 * to the console for that comparison.
 *
 * @returns {Promise<void>} Resolves after reporting a failure to the user.
 */
async function runOfflineCheck() {
  els.offlineTest.textContent = "Test ediliyor...";
  try {
    if (typeof loadWordModel !== "function" || typeof predictWord !== "function") {
      throw new Error("word-model.js yüklenmemiş");
    }

    // The check is a first need for the word model.
    if (!(await loadModelsWithStatus({ word: true }))) throw new Error("Model yüklenemedi");

    // Load the deterministic runtime smoke fixture.
    const sampleRes = await fetch("./data/test_sample.json", { cache: "no-store" });
    if (!sampleRes.ok) throw new Error(`test_sample.json alınamadı (HTTP ${sampleRes.status})`);
    const sample = await sampleRes.json();

    if (!Array.isArray(sample.features) || sample.features.length !== 45 * 168) {
      throw new Error(`features uzunluğu 7560 olmalı, ${sample.features?.length} alındı`);
    }
    if (!Array.isArray(sample.mask) || sample.mask.length !== 45) {
      throw new Error(`mask uzunluğu 45 olmalı, ${sample.mask?.length} alındı`);
    }

    const features = Float32Array.from(sample.features);
    const mask = sample.mask;

    const t0 = performance.now();
    const result = await predictWord(features, mask);
    const elapsed = performance.now() - t0;
    if (!result) throw new Error("Inference döndürmedi");

    const expected = sample.expected_word;
    const match = result.label === expected;
    const confDelta = Math.abs(result.confidence - (sample.expected_confidence ?? 0));

    // Format the top-three predictions for the status message.
    const top3Str = result.alternatives
      .map((a, i) => `${i + 1}. ${a.label} %${(a.confidence * 100).toFixed(1)}`)
      .join(" · ");

    const sign = match ? "✓" : "✗";
    els.offlineTest.textContent = `${sign} ${match ? "Eşleşiyor" : "Eşleşmiyor"}`;
    setMessage(
      `Beklenen: ${expected} · ONNX: ${result.label} (%${(result.confidence * 100).toFixed(1)}) ` +
        `· Δconf=${confDelta.toExponential(2)} · ${elapsed.toFixed(0)}ms · ${top3Str}`,
      match ? "good" : "low",
    );

    // Keep detailed values in the console for Python/browser parity checks.
    console.log("=== Offline test ===");
    console.log(`expected_word: ${expected} (conf ${sample.expected_confidence?.toFixed(4)})`);
    console.log(`web onnx     : ${result.label} (conf ${result.confidence.toFixed(4)})`);
    console.log("expected top-3:", sample.expected_top3);
    console.log("web top-3:", result.alternatives);
    if (sample.expected_logits && Array.isArray(sample.expected_logits)) {
      console.log(`temperature kullanılan: ${typeof temperature !== "undefined" ? temperature : "?"}`);
    }
  } catch (err) {
    els.offlineTest.textContent = "Offline test";
    setMessage("Test hatası: " + err.message, "low");
    console.error(err);
  }
}
