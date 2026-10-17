// Model Test screen: run the published ONNX models against offline fixtures,
// which shows the models working without a camera.
//
// A fixture comes from the bundled manifest, a URL, the file picker, or a
// drop, and is validated, run through the matching model, and reported
// against its expected label.
//
// Validation is the only guard between hand-written JSON and an ONNX session,
// so it enforces the published model contract: 93 features for a letter;
// 45 x 168 features plus a 45-entry mask for a word, where true marks a real
// frame and false marks padding.

/**
 * One entry of the bundled fixture manifest. The fields come straight from
 * JSON, so every one is optional.
 *
 * @typedef {Object} ModelTestManifestItem
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} [title]
 * @property {string} [path] Fixture path relative to asl-web/.
 * @property {string} [expected_label]
 * @property {number | string} [confidence] Expected confidence, as published.
 * @property {string} [kind] "deterministic-smoke" marks a made-up input that
 *   proves the pipeline runs and says nothing about accuracy.
 */

/**
 * Fixtures under this path are exported from the competition data, which may
 * not be redistributed: the folder is git-ignored and must not be deployed.
 */
const MODEL_TEST_LOCAL_PATH = "./data/model-test-samples/local/";
/** The manifest kind of a sample that is made up, not recorded. */
const MODEL_TEST_SYNTHETIC_KIND = "deterministic-smoke";

/**
 * @param {ModelTestManifestItem} item
 * @returns {boolean} True for a sample that exists only on this computer.
 */
function isLocalModelTestItem(item) {
  return typeof item.path === "string" && item.path.startsWith(MODEL_TEST_LOCAL_PATH);
}

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
 * @property {boolean} synthetic Made up to prove the pipeline runs: shown as a
 *   check, never scored against its expected label.
 */

/**
 * A letter fixture whose feature count normalizeModelTestSample() has checked.
 *
 * @typedef {ModelTestSampleMeta & {task: "letter", features: LetterFeatures93, mask: null}} LetterModelTestSample
 */

/**
 * A validated word fixture, with its features flattened and its mask checked.
 *
 * @typedef {ModelTestSampleMeta & {task: "word", features: WordFeatures45x168, mask: WordMask45}} WordModelTestSample
 */

/**
 * A fixture that passed validation. The task field discriminates the union:
 * a word sample always has a mask and a letter sample never does.
 *
 * @typedef {LetterModelTestSample | WordModelTestSample} ModelTestSample
 */

/**
 * What was wrong with a fixture. The validator's messages stay technical, for
 * tests and the console; the panel maps the code to plain Turkish.
 *
 * @typedef {"unreadable" | "bad-json" | "not-object" | "no-features" | "letter-length" |
 *   "word-length" | "mask-length" | "mask-value" | "not-number" | "mask-empty"} ModelTestErrorCode
 */

/**
 * The error a fixture that cannot be used throws.
 *
 * @typedef {Error & {code: ModelTestErrorCode, count?: number}} ModelTestFixtureError
 */

/**
 * One sample's line in a batch run.
 *
 * @typedef {Object} ModelTestBatchRow
 * @property {string} id The manifest id.
 * @property {string} title
 * @property {string} expected The reference label; "" when the sample has none.
 * @property {string} predicted What the model answered; "" when the row failed.
 * @property {"correct" | "wrong" | "no-reference" | "error"} verdict
 * @property {number} confidence NaN when the row failed.
 * @property {number} ms Inference time alone; NaN when the row failed.
 * @property {string} error Plain Turkish, "" unless the row failed.
 * @property {boolean} local From the unpublished local fixtures.
 * @property {boolean} synthetic Made up to prove the pipeline runs; it measures nothing.
 */

/**
 * What a finished batch adds up to. Only samples that have a reference count
 * towards accuracy, and a failed one counts as not correct.
 *
 * @typedef {Object} ModelTestBatchSummary
 * @property {number} total Samples run, failed ones included.
 * @property {number} counted Samples that count towards accuracy.
 * @property {number} correct
 * @property {number | null} accuracy correct / counted; null when nothing counted.
 * @property {number | null} medianMs Median inference time; null when no inference ran.
 * @property {number | null} prepMs Time to prepare the model, once; null when it was ready.
 * @property {number} failed Samples whose row is an error.
 * @property {boolean} synthetic Whether any sample was made up. Those run but do not count.
 * @property {boolean} hasLocal Whether any sample is local-only.
 */

/**
 * A batch run over every sample of one kind, as the panel shows it.
 *
 * @typedef {Object} ModelTestBatch
 * @property {ModelTask} task
 * @property {"preparing" | "running" | "done" | "error"} status
 * @property {number} total Samples the run will go through.
 * @property {ModelTestBatchRow[]} rows Finished rows, in manifest order.
 * @property {ModelTestBatchSummary | null} summary Set when the run is done.
 * @property {string} error Plain Turkish, "" unless the run could not start.
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
  const next = task === "word" ? "word" : "letter";
  // Results belong to the samples they were run on, so another kind has none.
  if (next !== state.modelTestTask) resetModelTestBatch();
  state.modelTestTask = next;
  queryElements("[data-model-test-task]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.modelTestTask === state.modelTestTask);
  });
  // The ranked list is styled for the model's labels: words need more room.
  if (els.modelTestTop3List) els.modelTestTop3List.dataset.task = next;
  renderModelTestSampleOptions();
  updateModelTestDomainHelp();
}

/** The published manifest's load, shared by every caller; null before it starts. @type {Promise<void> | null} */
let _modelTestManifestLoad = null;
/** The local fixtures' load, started when Model Test opens; null before. @type {Promise<void> | null} */
let _localModelTestFixturesLoad = null;

/**
 * Load every fixture the panel can offer: the published manifest, then any
 * local word fixtures.
 *
 * @returns {Promise<void>} Never rejects.
 */
async function loadModelTestManifest() {
  await loadPublishedModelTestManifest();
  await loadLocalModelTestFixtures();
}

/**
 * Load the bundled fixture manifest, once.
 *
 * init() starts this after the route and the render loop, so a slow answer
 * delays nothing on screen. A missing or unreadable manifest falls back to
 * one built-in fixture per task, so the demo screen still works offline.
 *
 * @returns {Promise<void>} Never rejects.
 */
function loadPublishedModelTestManifest() {
  _modelTestManifestLoad ??= (async () => {
    try {
      const res = await fetch("./data/model-test-samples/manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      state.modelTestManifest = await res.json();
    } catch (err) {
      console.warn("Could not read the Model Test manifest; using the built-in fixtures:", err?.message || err);
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
    updateModelTestDomainHelp();
  })();
  return _modelTestManifestLoad;
}

/**
 * Add the local word fixtures to the panel, once, when Model Test opens.
 *
 * The local folder exists only on a machine the fixtures were exported to,
 * so anywhere else the request is a 404; it is made on this screen only, not
 * on every page load.
 *
 * @returns {Promise<void>} Never rejects.
 */
function loadLocalModelTestFixtures() {
  _localModelTestFixturesLoad ??= (async () => {
    await loadPublishedModelTestManifest();
    if (!state.modelTestManifest) return;
    await appendLocalWordFixtures(state.modelTestManifest);
    renderModelTestSampleOptions();
    updateModelTestDomainHelp();
  })();
  return _localModelTestFixturesLoad;
}

/**
 * Add the word fixtures of the local manifest, when there is one. A clone has
 * no local folder, and its absence is not an error.
 *
 * @param {ModelTestManifest} manifest Published manifest, extended in place.
 * @returns {Promise<void>}
 */
async function appendLocalWordFixtures(manifest) {
  /** @type {ModelTestManifest | undefined} */
  let local;
  try {
    const res = await fetch("./data/model-test-samples/local/manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    local = await res.json();
  } catch {
    return;
  }
  const localWords = local?.words;
  if (!Array.isArray(localWords)) return;
  const words = Array.isArray(manifest.words) ? manifest.words : [];
  const known = new Set(words.map((item) => item.id));
  manifest.words = words.concat(localWords.filter((item) => !known.has(item.id)));
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
 * For words the first preferred fixture in the manifest is selected, so the
 * demo does not open on a weak case.
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
    // A made-up sample's expected confidence is the model's old answer to
    // random numbers, so it is not shown as something to expect.
    const conf = Number.isFinite(Number(item.confidence)) && item.kind !== MODEL_TEST_SYNTHETIC_KIND
      ? ` · beklenen %${Math.round(Number(item.confidence) * 100)}`
      : "";
    option.textContent = `${item.title || item.label || item.id}${conf}`;
    option.dataset.sampleId = item.id || "";
    option.dataset.label = item.expected_label || item.label || "";
    option.dataset.kind = item.kind || "";
    if (isLocalModelTestItem(item)) option.dataset.local = "true";
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

  await loadModelTestSampleFromUrl(sample.path, sample.title || sample.label || sample.id, sample.kind);
}

/**
 * Load the preferred fixture for a task and run it. The run is skipped when
 * the loaded fixture is for another task, so a failed load cannot run the
 * previous sample.
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
 * Describe the selected model, and the run-all button that runs it.
 *
 * @returns {void}
 */
function updateModelTestDomainHelp() {
  const isWord = state.modelTestTask === "word";
  if (els.modelTestDomainHelp) {
    els.modelTestDomainHelp.textContent = isWord
      ? "Kelime modeli, 45 kareden oluşan kısa bir hareket dizisine bakıp 50 kelimeden birini seçer."
      : "Harf modeli, tek bir el duruşuna bakıp 24 harften birini seçer.";
  }
  // Run-all runs the selected model, so the line under it names that model,
  // and it promises a count only when some sample is a real recording.
  if (els.modelTestBatchHint) {
    const model = isWord ? "Kelime" : "Harf";
    const countable = getModelTestManifestItems().some((item) => item.kind !== MODEL_TEST_SYNTHETIC_KIND);
    els.modelTestBatchHint.textContent = countable
      ? `${model} modelinin hazır örneklerini sırayla çalıştırır ve kaçının doğru olduğunu sayar.`
      : isWord
        ? "Kelime modelinin hazır örneğini çalıştırır. Gerçek kelime kayıtları yarışma kuralları gereği paylaşılamadığından doğruluk sayılmaz."
        : `${model} modelinin hazır örneklerini çalıştırır; hepsi uydurma olduğundan doğruluk sayılmaz.`;
  }
}

/** @returns {Promise<void>} */
async function loadSelectedModelTestSample() {
  const option = els.modelTestSampleSelect?.selectedOptions?.[0];
  if (!option?.value) {
    showModelTestError("Bu domain için hazır fixture bulunamadı.");
    return;
  }
  await loadModelTestSampleFromUrl(option.value, option.textContent.trim(), option.dataset.kind);
}

/**
 * Fetch and validate a fixture from a URL.
 *
 * @param {string} url Fixture path relative to asl-web/.
 * @param {string} [displayName] Label for the status line; falls back to the URL.
 * @param {string} [kind] The manifest's kind for the fixture, if it has one.
 * @returns {Promise<void>} Resolves after reporting a fetch or validation
 *   failure to the user.
 */
async function loadModelTestSampleFromUrl(url, displayName, kind) {
  try {
    if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Örnek yükleniyor";
    updateModelTestProcess("loading");
    setModelTestSample(await fetchModelTestJson(url, displayName), displayName || url, kind);
  } catch (err) {
    showModelTestError(describeModelTestError(err));
    console.error(err);
  }
}

/**
 * Fetch a fixture's JSON, not yet validated.
 *
 * @param {string} url Fixture path relative to asl-web/.
 * @param {string} [displayName] Name for the message when the fetch fails.
 * @returns {Promise<unknown>}
 * @throws {Error} A ModelTestVisitorError when the request fails or is
 *   refused, or a fixture error with code "bad-json" when the body is not JSON.
 */
async function fetchModelTestJson(url, displayName) {
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    // fetch rejects only when no response arrived at all: offline, a dropped
    // connection, a blocked request. Its own text ("Failed to fetch") is for
    // the console.
    throw modelTestVisitorError(MODEL_TEST_CONNECTION_TEXT, `${url}: ${errorMessage(cause)}`);
  }
  if (!res.ok) throw modelTestVisitorError(`${displayName || url} alınamadı (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (cause) {
    throw modelTestFixtureError("bad-json", `JSON okunamadı: ${errorMessage(cause)}`);
  }
}

/**
 * @param {Event & {target: HTMLInputElement}} event Change event from the
 *   fixture file input.
 * @returns {Promise<void>}
 */
async function handleModelTestSampleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await readModelTestSampleFile(file);
}

/**
 * @param {DragEvent} event A drop on the fixture drop zone.
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
    /** @type {string} */
    let text;
    try {
      text = await file.text();
    } catch (cause) {
      throw modelTestFixtureError("unreadable", `dosya okunamadı: ${errorMessage(cause)}`);
    }
    setModelTestSample(parseModelTestJson(text), file.name);
  } catch (err) {
    showModelTestError(describeModelTestError(err));
    console.error(err);
  }
}

/**
 * Parse fixture text, reporting a failure as "bad-json".
 *
 * @param {string} text
 * @returns {unknown}
 * @throws {ModelTestFixtureError} With code "bad-json" when the text is not JSON.
 */
function parseModelTestJson(text) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw modelTestFixtureError("bad-json", `JSON okunamadı: ${errorMessage(cause)}`);
  }
}

/**
 * @param {unknown} err Anything a catch clause receives.
 * @returns {string} The error's message, or its text form.
 */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the error an unusable fixture throws.
 *
 * @param {ModelTestErrorCode} code
 * @param {string} message Technical text, kept for tests and the console.
 * @param {number} [count] The size found, for the codes that report one.
 * @returns {ModelTestFixtureError}
 */
function modelTestFixtureError(code, message, count) {
  return Object.assign(new Error(message), { code, count });
}

/**
 * @param {unknown} err
 * @returns {err is ModelTestFixtureError}
 */
function isModelTestFixtureError(err) {
  // Testing the code against the union's members makes the predicate true for
  // every error modelTestFixtureError() builds, and for nothing else.
  return err instanceof Error && "code" in err && typeof err.code === "string" && MODEL_TEST_ERROR_CODES.has(err.code);
}

/** Every code a fixture error can carry; keep in step with ModelTestErrorCode. @type {ReadonlySet<string>} */
const MODEL_TEST_ERROR_CODES = new Set([
  "unreadable", "bad-json", "not-object", "no-features", "letter-length",
  "word-length", "mask-length", "mask-value", "not-number", "mask-empty",
]);

/**
 * An error the panel raised itself, carrying a plain Turkish sentence for the
 * visitor: a model that did not load, a sample that could not be fetched. Its
 * message may stay technical, for the console.
 *
 * @typedef {Error & {visitorText: string}} ModelTestVisitorError
 */

/** Shown when a sample could not be downloaded at all. */
const MODEL_TEST_CONNECTION_TEXT = "Örnek indirilemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.";
/** Shown for any failure the panel did not raise itself, such as a runtime error. */
const MODEL_TEST_FAILURE_TEXT = "Model çalıştırılamadı. Sayfayı yenileyip yeniden deneyin.";

/**
 * @param {string} visitorText What the panel shows.
 * @param {string} [message] What the console shows; defaults to the same text.
 * @returns {ModelTestVisitorError}
 */
function modelTestVisitorError(visitorText, message = visitorText) {
  return Object.assign(new Error(message), { visitorText });
}

/**
 * @param {unknown} err
 * @returns {err is ModelTestVisitorError}
 */
function isModelTestVisitorError(err) {
  return err instanceof Error && "visitorText" in err && typeof err.visitorText === "string";
}

/**
 * Say what went wrong in words a visitor can act on.
 *
 * A fixture error is explained from its code, and an error the panel raised
 * carries its own sentence. Anything else (a runtime error, a bug) is never
 * shown as it is: its text is English and technical, so the visitor gets a
 * plain message and the caller logs the error itself.
 *
 * @param {unknown} err
 * @returns {string}
 */
function describeModelTestError(err) {
  if (isModelTestVisitorError(err)) return err.visitorText;
  if (!isModelTestFixtureError(err)) return MODEL_TEST_FAILURE_TEXT;
  const found = err.count ?? 0;
  switch (err.code) {
    case "unreadable":
      return "Dosya okunamadı.";
    case "bad-json":
      return "Dosya okunamadı: geçerli bir JSON değil.";
    case "not-object":
    case "no-features":
      return "Bu dosyada örnek verisi bulunamadı.";
    case "letter-length":
      return `Harf örneği 93 sayı içermeli; bu dosyada ${found} sayı var.`;
    case "word-length":
      return `Kelime örneği 7560 sayı (45 × 168) içermeli; bu dosyada ${found} var.`;
    case "mask-length":
      return `Maske 45 değer içermeli; bu dosyada ${found} var.`;
    case "mask-value":
      return "Maske yalnızca doğru/yanlış (true/false ya da 1/0) değerleri içerebilir.";
    case "not-number":
      return "Dosyada sayı olmayan bir değer var.";
    case "mask-empty":
      return "Bu örnekte gerçek kare yok; kelime modeli çalıştırılamaz.";
  }
}

/**
 * Validate a fixture and show its metadata.
 *
 * @param {unknown} rawSample Parsed JSON, not yet trusted.
 * @param {string} sourceName Where it came from, for the status line.
 * @param {string} [kind] The manifest's kind for the fixture, if it has one.
 * @returns {void}
 * @throws {Error} When validation rejects the fixture; callers report the
 *   message to the user.
 */
function setModelTestSample(rawSample, sourceName, kind) {
  const sample = normalizeModelTestSample(rawSample, sourceName, kind);
  state.modelTestSample = sample;
  // A run still waiting for its model belongs to the sample it started with.
  _modelTestSampleEpoch += 1;
  setModelTestTask(sample.task);
  updateModelTestProcess("validated");

  if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Örnek hazır";
  if (els.modelTestFileName) els.modelTestFileName.textContent = sourceName || sample.source || "Yüklenen JSON";
  if (els.runModelTestSample) {
    els.runModelTestSample.disabled = false;
    els.runModelTestSample.textContent = "Seçili örneği yeniden çalıştır";
  }
  if (els.modelTestTaskLabel) els.modelTestTaskLabel.textContent = sample.task === "word" ? "Kelime modeli" : "Harf modeli";
  if (els.modelTestSourceLabel) els.modelTestSourceLabel.textContent = sample.source || sourceName || "JSON fixture";
  if (els.modelTestSchemaLabel) els.modelTestSchemaLabel.textContent = sample.schemaVersion;
  if (els.modelTestShapeLabel) els.modelTestShapeLabel.textContent = sample.shapeLabel;
  if (els.modelTestMaskLabel) els.modelTestMaskLabel.textContent = sample.maskLabel;
  if (els.modelTestExpectedLabel) {
    els.modelTestExpectedLabel.textContent = (!sample.synthetic && sample.expectedLabel) || "Referans yok";
  }
  clearModelTestResult();
  if (els.modelTestMatchBadge) {
    els.modelTestMatchBadge.textContent = "Çalıştırılmadı";
    els.modelTestMatchBadge.dataset.match = "unknown";
  }
  if (els.modelTestResultNote) {
    els.modelTestResultNote.textContent = sample.synthetic
      ? "Bu örnek gerçek bir işaret kaydı değil; modelin çalıştığını göstermek için rastgele üretildi."
      : sample.task === "word"
        ? "Kelime örneği 45 frame hareket bilgisinden hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek."
        : "Harf örneği tek el pozundan hazırlanmıştır. Model çalıştırıldığında tahmin ve top-3 burada görünecek.";
  }
}

/**
 * Turn unvalidated JSON from a URL, the file picker, or a drop into a fixture
 * that is safe to feed a model.
 *
 * The task comes from the task field, or from the presence of a mask; then
 * the published shapes are enforced: 93 features for a letter, 45 x 168
 * features and a 45-entry mask for a word.
 *
 * @param {unknown} rawSample
 * @param {string} [sourceName] Fallback source label.
 * @param {string} [kind] The manifest's kind; a fixture may also carry its own.
 * @returns {ModelTestSample} A validated, discriminated fixture.
 * @throws {Error} With a Turkish message naming what was wrong.
 */
function normalizeModelTestSample(rawSample, sourceName, kind) {
  if (!isRecord(rawSample)) {
    throw modelTestFixtureError("not-object", "Fixture JSON object olmalı");
  }
  const synthetic = (kind || rawSample.kind) === MODEL_TEST_SYNTHETIC_KIND;

  const inferredTask = rawSample.task || (Array.isArray(rawSample.mask) ? "word" : "letter");
  const task = inferredTask === "word" ? "word" : "letter";
  const rawFeatures = rawSample.features || rawSample.input || rawSample.feature_vector;
  if (!Array.isArray(rawFeatures)) {
    throw modelTestFixtureError("no-features", "features alanı array olmalı");
  }
  const features = flattenNumericArray(rawFeatures, "features");

  // A hand-written fixture may give the label as a number; the panel works
  // with strings.
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
      throw modelTestFixtureError(
        "word-length", `Kelime fixture features[7560] bekler, ${features.length} geldi`, features.length,
      );
    }
    if (mask.length !== 45) {
      throw modelTestFixtureError("mask-length", `Kelime fixture mask[45] bekler, ${mask.length} geldi`, mask.length);
    }
    const realFrames = mask.filter(Boolean).length;
    // With no real frame the word model would still answer, with a word and a
    // confidence that mean nothing.
    if (realFrames === 0) {
      throw modelTestFixtureError("mask-empty", "Kelime fixture mask içinde gerçek frame yok");
    }
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
      synthetic,
    };
  }

  if (features.length !== 93) {
    throw modelTestFixtureError(
      "letter-length", `Harf fixture features[93] bekler, ${features.length} geldi`, features.length,
    );
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
    synthetic,
  };
}

/**
 * Flatten a nested numeric array in row order, so a word fixture published
 * flat and one published as 45 frames of 168 values give the same input.
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
      throw modelTestFixtureError("not-number", `${fieldName} içinde sayısal olmayan değer var`);
    }
    out.push(num);
  }
  return out;
}

/**
 * Read a padding mask in any of its published spellings: booleans, 0/1, and
 * their string forms, because fixtures have been exported from several tools.
 * True means a real frame.
 *
 * @param {unknown} value
 * @returns {WordMask45} The length is checked by the caller.
 * @throws {Error} When the value is not an array, or an entry is not a
 *   recognised boolean spelling.
 */
function normalizeMask(value) {
  if (!Array.isArray(value)) {
    throw modelTestFixtureError(
      "mask-length", `Kelime fixture mask[45] bekler, ${value == null ? 0 : "geçersiz"} geldi`, 0,
    );
  }
  return value.map((item) => {
    if (item === true || item === 1 || item === "1") return true;
    if (item === false || item === 0 || item === "0") return false;
    if (typeof item === "string") {
      const lowered = item.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
    }
    throw modelTestFixtureError("mask-value", "mask sadece bool, 0/1 veya true/false string değerleri içermeli");
  });
}

/**
 * Counts the samples loaded so far. A run that finishes at a different count
 * than it started at belongs to a sample no longer on screen.
 */
let _modelTestSampleEpoch = 0;

/**
 * The run in flight for the sample on screen, so a second press joins it
 * instead of running the sample again. @type {{epoch: number, done: Promise<void>} | null}
 */
let _modelTestRun = null;

/**
 * Run the loaded fixture against its model.
 *
 * The model loads here if nothing has loaded it yet; the download is kept
 * out of the measured time, which is inference alone.
 *
 * Pressing Run during the sample's run joins it. A run whose sample was
 * replaced while it waited reports nothing.
 *
 * @returns {Promise<void>} Resolves after reporting a failure to the user.
 */
function runModelTestSample() {
  if (_modelTestRun && _modelTestRun.epoch === _modelTestSampleEpoch) return _modelTestRun.done;
  const epoch = _modelTestSampleEpoch;
  const done = executeModelTestRun(epoch).finally(() => {
    if (_modelTestRun?.done === done) _modelTestRun = null;
  });
  _modelTestRun = { epoch, done };
  return done;
}

/**
 * @param {number} epoch The sample count the run was started at.
 * @returns {Promise<void>}
 */
async function executeModelTestRun(epoch) {
  const sample = state.modelTestSample;
  if (!sample) {
    showModelTestError("Önce bir örnek seçin ya da JSON dosyası yükleyin.");
    return;
  }

  const stale = () => epoch !== _modelTestSampleEpoch;
  const isWord = sample.task === "word";
  try {
    // A model download is labelled as loading, not as inference.
    if (els.modelTestSampleStatus) {
      els.modelTestSampleStatus.textContent =
        (isWord ? wordSession : letterSession) ? "Model çalışıyor" : "Model yükleniyor";
    }
    if (els.runModelTestSample) {
      els.runModelTestSample.disabled = true;
      els.runModelTestSample.textContent = "Model çalışıyor";
    }
    updateModelTestProcess("running");

    const loaded = await (isWord ? ensureWordModel() : ensureLetterModel());
    if (stale()) return;
    if (!loaded) {
      throw modelTestVisitorError(isWord ? "Kelime modeli yüklenemedi" : "Harf modeli yüklenemedi");
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
    if (stale()) return;
    if (!result) throw modelTestVisitorError("Model tahmin döndürmedi");

    renderModelTestResult(sample, result, elapsed);
  } catch (err) {
    if (stale()) return;
    showModelTestError(describeModelTestError(err));
    console.error(err);
  } finally {
    if (!stale() && els.runModelTestSample) {
      els.runModelTestSample.disabled = false;
      els.runModelTestSample.textContent = "Seçili örneği yeniden çalıştır";
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
  // A made-up sample's expected label is the model's own earlier answer to
  // random numbers: matching it proves the pipeline ran, not that it is right.
  const expected = sample.synthetic ? "" : sample.expectedLabel || "";
  const matched = expected ? result.label === expected : null;
  const alternatives = result.alternatives?.length
    ? result.alternatives
    : [{ label: result.label, confidence: result.confidence || 0 }];
  if (els.modelTestSampleStatus) els.modelTestSampleStatus.textContent = "Tamamlandı";
  updateModelTestProcess("done");
  if (els.modelTestMatchBadge) {
    els.modelTestMatchBadge.textContent = sample.synthetic
      ? "Çalışma kontrolü"
      : matched === null ? "Referans yok" : matched ? "Eşleşti" : "Eşleşmedi";
    els.modelTestMatchBadge.dataset.match = matched === null ? "unknown" : matched ? "yes" : "no";
  }
  if (els.modelTestExpectedLabel) els.modelTestExpectedLabel.textContent = expected || "Referans yok";
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = result.label;
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = formatPercent(result.confidence);
  if (els.modelTestLatency) els.modelTestLatency.textContent = `${elapsed.toFixed(0)} ms`;
  renderModelTestTop3(alternatives);

  if (els.modelTestResultNote && sample.synthetic) {
    els.modelTestResultNote.textContent =
      "Bu örnek gerçek bir işaret kaydı değil; modelin tarayıcıda çalıştığını göstermek için rastgele üretildi, bu yüzden doğruluk ölçmez." +
      (sample.task === "word"
        ? " Gerçek kelime kayıtları yarışma kuralları gereği paylaşılamıyor; kelime modunu kamerayla deneyebilirsiniz."
        : "");
  } else if (els.modelTestResultNote) {
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
    confidence.textContent = `%${pct}`;
    row.append(rank, label, bar, confidence);
    els.modelTestTop3List.appendChild(row);
  });
}

/**
 * Empty the answer fields, so an earlier run's prediction never sits beside a
 * sample or an error it does not belong to.
 *
 * @returns {void}
 */
function clearModelTestResult() {
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = "-";
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = "-";
  if (els.modelTestLatency) els.modelTestLatency.textContent = "-";
  renderModelTestTop3([]);
}

/**
 * Report a fixture or inference failure in the result area.
 *
 * @param {string} message Turkish text shown to the user.
 * @returns {void}
 */
function showModelTestError(message) {
  clearModelTestResult();
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
 * Mark how far the fixture has got through the four process steps.
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
  // Typed as strings because dataset values are tested against it.
  /** @type {Set<string>} */
  const active = new Set(activeByStatus[status] || []);
  els.modelTestProcessSteps.dataset.status = status;
  queryElements("[data-step]", els.modelTestProcessSteps).forEach((step) => {
    step.dataset.state = active.has(step.dataset.step ?? "") ? "done" : "";
  });
}

/**
 * Write a number the way Turkish writes a measurement: a decimal comma, one
 * decimal only under 10, where it still tells figures apart, and no trailing
 * ",0".
 *
 * @param {number} value
 * @returns {string}
 */
function formatTurkishNumber(value) {
  // 9.96 rounds to "10.0" at one decimal; the trailing-zero strip leaves "10".
  const text = Math.abs(value) < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return text.replace(".", ",");
}

/**
 * Write a probability the way Turkish writes a percentage: "%7,6", "%46",
 * "%100".
 *
 * @param {number} value Probability in [0, 1].
 * @returns {string} The percentage, or "-" when not finite.
 */
function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `%${formatTurkishNumber(value * 100)}`;
}

/**
 * @param {number} ms
 * @returns {string} "0,6 ms", "12 ms"; "-" when not finite.
 */
function formatMilliseconds(ms) {
  return Number.isFinite(ms) ? `${formatTurkishNumber(ms)} ms` : "-";
}

/**
 * @param {number} ms
 * @returns {string} The time in seconds, "1,9 sn"; "-" when not finite.
 */
function formatSeconds(ms) {
  return Number.isFinite(ms) ? `${formatTurkishNumber(ms / 1000)} sn` : "-";
}

/**
 * Counts the times the batch was reset. A run that wakes up at a different
 * count than it started at was abandoned.
 */
let _modelTestBatchEpoch = 0;

/** The batch in flight, so a second press joins it. @type {Promise<void> | null} */
let _modelTestBatchRun = null;

/**
 * Drop the batch and any run still going, so numbers never stay on screen for
 * samples they were not run on.
 *
 * @returns {void}
 */
function resetModelTestBatch() {
  _modelTestBatchEpoch += 1;
  _modelTestBatchRun = null;
  state.modelTestBatch = null;
  renderModelTestBatch();
}

/**
 * Run every bundled sample of one kind through its model, one at a time.
 *
 * Each sample becomes a row as it finishes, and the run ends with a summary.
 * Model preparation is timed apart, so a row's time is inference alone. The
 * camera and MediaPipe are never involved.
 *
 * Pressing again during a run joins it. Switching to the other kind abandons
 * it: the run stops at its next step and shows nothing.
 *
 * @param {string} [task] Anything other than "word" runs the letters. Defaults
 *   to the kind the panel is showing.
 * @returns {Promise<void>} Never rejects; a failure is in the batch.
 */
function runModelTestBatch(task = state.modelTestTask) {
  const kind = task === "word" ? "word" : "letter";
  setModelTestTask(kind);
  if (_modelTestBatchRun) return _modelTestBatchRun;
  const done = executeModelTestBatch(kind, _modelTestBatchEpoch).finally(() => {
    if (_modelTestBatchRun === done) _modelTestBatchRun = null;
  });
  _modelTestBatchRun = done;
  return done;
}

/**
 * @param {ModelTask} kind
 * @param {number} epoch The reset count the run was started at.
 * @returns {Promise<void>}
 */
async function executeModelTestBatch(kind, epoch) {
  const stale = () => epoch !== _modelTestBatchEpoch;
  // The list may still be loading, as when the screen was opened by a link.
  await loadModelTestManifest();
  if (stale()) return;

  const items = getModelTestManifestItems(kind);
  /** @type {ModelTestBatch} */
  const batch = { task: kind, status: "preparing", total: items.length, rows: [], summary: null, error: "" };
  state.modelTestBatch = batch;
  renderModelTestBatch();

  const isWord = kind === "word";
  const wasReady = Boolean(isWord ? wordSession : letterSession);
  const prepStart = performance.now();
  const ready = await (isWord ? ensureWordModel() : ensureLetterModel());
  if (stale()) return;
  if (!ready) {
    batch.status = "error";
    batch.error = isWord ? "Kelime modeli yüklenemedi" : "Harf modeli yüklenemedi";
    renderModelTestBatch();
    return;
  }
  const prepMs = wasReady ? null : performance.now() - prepStart;

  batch.status = "running";
  for (const item of items) {
    const row = await runModelTestBatchItem(item, kind);
    if (stale()) return;
    batch.rows.push(row);
    renderModelTestBatch();
  }
  batch.summary = summarizeModelTestBatch(batch.rows, prepMs);
  batch.status = "done";
  renderModelTestBatch();
  announce(describeModelTestBatch(batch));
}

/**
 * Fetch, validate and run one manifest sample.
 *
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} kind The model the batch is running.
 * @returns {Promise<ModelTestBatchRow>} Never rejects; a failure is an "error" row.
 */
async function runModelTestBatchItem(item, kind) {
  const title = item.title || item.label || item.id || "Örnek";
  /** @type {ModelTestBatchRow} */
  const row = {
    id: item.id || "",
    title,
    expected: item.expected_label || item.label || "",
    predicted: "",
    verdict: "error",
    confidence: NaN,
    ms: NaN,
    error: "",
    local: isLocalModelTestItem(item),
    synthetic: item.kind === MODEL_TEST_SYNTHETIC_KIND,
  };
  try {
    if (!item.path) throw modelTestVisitorError(`${title} için dosya yolu yok`);
    const sample = normalizeModelTestSample(await fetchModelTestJson(item.path, title), title);
    row.expected = sample.expectedLabel;
    if (sample.task !== kind) throw modelTestVisitorError(`${title} bu modele uygun değil`);

    // Only the inference is timed: fetching and validating the sample is not it.
    const t0 = performance.now();
    const result = sample.task === "word"
      ? await predictWord(sample.features, sample.mask)
      : await predictLetter(sample.features);
    const elapsed = performance.now() - t0;
    if (!result) throw modelTestVisitorError("Model tahmin döndürmedi");

    row.predicted = result.label;
    row.confidence = result.confidence;
    row.ms = elapsed;
    row.verdict = !row.expected ? "no-reference" : result.label === row.expected ? "correct" : "wrong";
  } catch (err) {
    row.error = describeModelTestError(err);
    console.error(err);
  }
  return row;
}

/**
 * Total a finished batch.
 *
 * @param {ModelTestBatchRow[]} rows
 * @param {number | null} prepMs
 * @returns {ModelTestBatchSummary}
 */
function summarizeModelTestBatch(rows, prepMs) {
  // A failed sample still has its reference, so it counts as not correct:
  // leaving it out would flatter the model. A made-up sample runs, but
  // answering it right proves nothing about accuracy.
  const counted = rows.filter((row) => row.expected !== "" && !row.synthetic);
  const correct = counted.filter((row) => row.verdict === "correct").length;
  const times = rows.map((row) => row.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const medianMs = times.length === 0 ? null : times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
  return {
    total: rows.length,
    counted: counted.length,
    correct,
    accuracy: counted.length ? correct / counted.length : null,
    medianMs,
    prepMs,
    failed: rows.filter((row) => row.verdict === "error").length,
    synthetic: rows.some((row) => row.synthetic),
    hasLocal: rows.some((row) => row.local),
  };
}

/**
 * The batch in a sentence or two of plain Turkish.
 *
 * @param {ModelTestBatch} batch
 * @returns {string}
 */
function describeModelTestBatch(batch) {
  if (batch.status === "error") return batch.error;
  if (batch.status === "preparing") return "Model hazırlanıyor…";
  if (batch.status === "running") return `Çalışıyor: ${batch.rows.length} / ${batch.total}`;
  const summary = batch.summary;
  if (!summary || summary.total === 0) return "Çalıştırılacak örnek bulunamadı.";

  const parts = [];
  if (summary.accuracy === null && summary.synthetic) {
    parts.push("Model çalıştı. Örnek yapay olduğundan doğruluk hesaplanmadı; bu yalnızca modelin baştan sona çalıştığını gösterir.");
  } else if (summary.accuracy === null) {
    parts.push(`Model ${summary.total} örnek üzerinde çalıştı; referans etiketi olmadığı için doğruluk hesaplanmadı.`);
  } else {
    parts.push(
      `${summary.counted} örnekten ${summary.correct} tanesi doğru (${formatPercent(summary.accuracy)}).`,
    );
  }
  if (summary.medianMs !== null) parts.push(`Ortanca süre ${formatMilliseconds(summary.medianMs)}.`);
  if (summary.prepMs !== null) {
    parts.push(`Model hazırlığı ${formatSeconds(summary.prepMs)} sürdü; bu süre örneklerin süresine eklenmedi.`);
  }
  if (summary.failed > 0) parts.push(`${summary.failed} örnek çalışmadı.`);
  if (summary.hasLocal) {
    parts.push("Yerel örnekler bu bilgisayara özeldir; siteyle birlikte yayınlanmamalıdır.");
  }
  return parts.join(" ");
}

/** Display names of the row verdicts. @type {Record<ModelTestBatchRow["verdict"], string>} */
const MODEL_TEST_VERDICT_LABELS = {
  correct: "Doğru",
  wrong: "Yanlış",
  "no-reference": "Referans yok",
  error: "Hata",
};

/**
 * Show the batch: its summary line and one table row per finished sample.
 *
 * @returns {void}
 */
function renderModelTestBatch() {
  const batch = state.modelTestBatch;
  if (els.modelTestBatch) els.modelTestBatch.hidden = !batch;
  // What the samples can show differs by model, so only the note for the
  // model that ran is shown.
  if (els.modelTestNoteLetter) els.modelTestNoteLetter.hidden = batch?.task !== "letter";
  if (els.modelTestNoteWord) els.modelTestNoteWord.hidden = batch?.task !== "word";
  if (els.modelTestSummary) els.modelTestSummary.textContent = batch ? describeModelTestBatch(batch) : "";
  if (!els.modelTestRows) return;
  els.modelTestRows.innerHTML = "";
  for (const item of batch?.rows ?? []) {
    const row = document.createElement("tr");
    row.dataset.verdict = item.verdict;
    if (item.local) row.dataset.local = "true";
    // A made-up sample answered "correctly" is a run check, not a success.
    const verdictLabel = item.synthetic && item.verdict !== "error" ? "Çalışma kontrolü" : MODEL_TEST_VERDICT_LABELS[item.verdict];
    const cells = [
      item.local ? `${item.title} · Yerel` : item.title,
      item.expected || "-",
      // A failed row has no answer, so its reason takes the answer's place.
      item.predicted || item.error || "-",
      formatPercent(item.confidence),
      formatMilliseconds(item.ms),
      verdictLabel,
    ];
    cells.forEach((text, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = text;
      row.appendChild(cell);
    });
    els.modelTestRows.appendChild(row);
  }
}

// Project page: the model card. The page's figures are read from
// data/model-card.json when it opens rather than typed into the markup, where
// they would go stale at the next retraining. This lives here because it
// shares the number formatters above.

/**
 * The card's load, so a second visit does not fetch again. Null before the
 * first visit and after a failure, so the next visit retries.
 *
 * @type {Promise<void> | null}
 */
let _modelCardLoad = null;

/**
 * Look up a figure of the card by its dotted path.
 *
 * @param {unknown} card
 * @param {string} path For example "word.accuracy".
 * @returns {number | null} Null when the path leads nowhere or to a non-number.
 */
function modelCardFigure(card, path) {
  /** @type {unknown} */
  let value = card;
  for (const key of path.split(".")) value = isRecord(value) ? value[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Write a figure the way the page states it.
 *
 * @param {number} value
 * @param {string | undefined} format "percent", "mb" (a size in bytes) or, by
 *   default, a whole number.
 * @returns {string}
 */
function formatModelCardFigure(value, format) {
  if (format === "percent") return formatPercent(value);
  if (format === "mb") return `${formatTurkishNumber(value / 1048576)} MB`;
  return String(value);
}

/**
 * Fill the page's figures from a card, all or none: a sentence with one
 * figure missing would read as nonsense, so the block then stays hidden.
 *
 * @param {unknown} card
 * @returns {void}
 */
function renderProjectModelCard(card) {
  const slots = queryElements("[data-card]").map((element) => ({
    element,
    value: modelCardFigure(card, element.dataset.card ?? ""),
  }));
  if (slots.some((slot) => slot.value === null)) {
    console.warn("model-card.json lacks a figure the page needs; the numbers stay hidden");
    return;
  }
  for (const { element, value } of slots) {
    element.textContent = formatModelCardFigure(/** @type {number} */ (value), element.dataset.format);
  }
  if (els.projectNumbers) els.projectNumbers.hidden = false;
}

/**
 * @returns {Promise<unknown>}
 */
async function fetchModelCard() {
  const response = await fetch("./data/model-card.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Read the model card and fill the project page from it.
 *
 * @returns {Promise<void>} Never rejects; on a failure the numbers stay hidden.
 */
function loadProjectModelCard() {
  if (_modelCardLoad) return _modelCardLoad;
  const load = fetchModelCard()
    .then(renderProjectModelCard)
    .catch((err) => {
      console.warn("model-card.json could not be read:", err);
      if (_modelCardLoad === load) _modelCardLoad = null;
    });
  _modelCardLoad = load;
  return load;
}
