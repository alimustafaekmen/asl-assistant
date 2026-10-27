// Validation is the only guard between hand-written JSON and an ONNX session,
// so it enforces the model contract: 93 letter features; 45 x 168 word
// features and a 45-entry mask where true marks a real frame.

/**
 * Straight from JSON, so every field is optional.
 *
 * @typedef {Object} ModelTestManifestItem
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} [title]
 * @property {string} [path] Relative to asl-web/.
 * @property {string} [expected_label]
 * @property {number | string} [confidence]
 * @property {string} [kind] "deterministic-smoke": a made-up input that says
 *   nothing about accuracy.
 */

// Exported from competition data that may not be redistributed: git-ignored
// and never deployed.
const MODEL_TEST_LOCAL_PATH = "./data/model-test-samples/local/";
const MODEL_TEST_SYNTHETIC_KIND = "deterministic-smoke";

/**
 * @param {ModelTestManifestItem} item
 * @returns {boolean}
 */
function isLocalModelTestItem(item) {
  return typeof item.path === "string" && item.path.startsWith(MODEL_TEST_LOCAL_PATH);
}

/**
 * The manifest titles are Turkish ("Kelime give #3"), so an English page
 * names the sample from its label.
 *
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} task
 * @returns {string}
 */
function modelTestItemTitle(item, task) {
  const title = item.title || item.label || item.id || "";
  if (currentLanguage() === "tr") return title;
  const isWord = task === "word";
  if (item.kind === MODEL_TEST_SYNTHETIC_KIND) {
    return t(isWord ? "info.test.sample.wordCheck" : "info.test.sample.letterCheck");
  }
  const label = item.expected_label || item.label;
  if (!label) return title;
  const number = /\s(#\d+)$/.exec(item.title || "");
  const name = t(isWord ? "info.test.sample.word" : "info.test.sample.letter", { label });
  return number ? `${name} ${number[1]}` : name;
}

/**
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} task
 * @returns {string}
 */
function modelTestOptionText(item, task) {
  const title = modelTestItemTitle(item, task);
  // A made-up sample's confidence is the model's answer to random numbers.
  if (!Number.isFinite(Number(item.confidence)) || item.kind === MODEL_TEST_SYNTHETIC_KIND) return title;
  return t("info.test.option.expected", {
    title,
    percent: formatWholePercent(Math.round(Number(item.confidence) * 100)),
  });
}

/**
 * For text that is not one of our strings, so a language switch leaves it alone.
 *
 * @param {HTMLElement | null | undefined} element
 * @param {string} text
 * @returns {void}
 */
function setModelTestPlainText(element, text) {
  if (!element) return;
  element.removeAttribute("data-i18n");
  element.removeAttribute("data-i18n-params");
  element.textContent = text;
}

// Kept so a language switch can write them again.

/** @type {{name: () => string, ownSource: boolean} | null} */
let _modelTestSource = null;

/** @type {(() => string) | null} */
let _modelTestNote = null;

/** @type {{confidence: number, alternatives: PredictionCandidate[]} | null} */
let _modelTestAnswer = null;

/** @type {WeakMap<ModelTestBatchRow, unknown>} */
const _modelTestRowErrors = new WeakMap();

/**
 * @typedef {Object} ModelTestManifest
 * @property {ModelTestManifestItem[]} [letters]
 * @property {ModelTestManifestItem[]} [words]
 */

/**
 * @typedef {Object} ModelTestSampleMeta
 * @property {string} sampleId
 * @property {string} expectedLabel Empty when the fixture has no reference.
 * @property {number} expectedConfidence NaN when the fixture declares none.
 * @property {unknown} expectedTop3 Carried through unvalidated.
 * @property {string} schemaVersion
 * @property {string} source
 * @property {string} shapeLabel
 * @property {string} maskLabel
 * @property {boolean} synthetic Never scored against its expected label.
 */

/**
 * @typedef {ModelTestSampleMeta & {task: "letter", features: LetterFeatures93, mask: null}} LetterModelTestSample
 */

/**
 * @typedef {ModelTestSampleMeta & {task: "word", features: WordFeatures45x168, mask: WordMask45}} WordModelTestSample
 */

/**
 * @typedef {LetterModelTestSample | WordModelTestSample} ModelTestSample
 */

/**
 * The validator's messages stay technical; the panel maps the code to a
 * plain sentence.
 *
 * @typedef {"unreadable" | "bad-json" | "not-object" | "no-features" | "letter-length" |
 *   "word-length" | "mask-length" | "mask-value" | "not-number" | "mask-empty"} ModelTestErrorCode
 */

/**
 * @typedef {Error & {code: ModelTestErrorCode, count?: number}} ModelTestFixtureError
 */

/**
 * @typedef {Object} ModelTestBatchRow
 * @property {string} id
 * @property {string} title
 * @property {string} expected
 * @property {string} predicted
 * @property {"correct" | "wrong" | "no-reference" | "error"} verdict
 * @property {number} confidence NaN when the row failed.
 * @property {number} ms Inference time alone; NaN when the row failed.
 * @property {string} error
 * @property {boolean} local
 * @property {boolean} synthetic
 */

/**
 * Only samples with a reference count towards accuracy; a failed one counts
 * as not correct.
 *
 * @typedef {Object} ModelTestBatchSummary
 * @property {number} total
 * @property {number} counted
 * @property {number} correct
 * @property {number | null} accuracy
 * @property {number | null} medianMs
 * @property {number | null} prepMs Null when the model was already ready.
 * @property {number} failed
 * @property {boolean} synthetic
 * @property {boolean} hasLocal
 */

/**
 * @typedef {Object} ModelTestBatch
 * @property {ModelTask} task
 * @property {"preparing" | "running" | "done" | "error"} status
 * @property {number} total
 * @property {ModelTestBatchRow[]} rows In manifest order.
 * @property {ModelTestBatchSummary | null} summary
 * @property {string} error
 */

/**
 * @typedef {"idle" | "loading" | "validated" | "running" | "done" | "error"} ModelTestProcessStatus
 */

/**
 * @param {string} task
 * @returns {void}
 */
function setModelTestTask(task) {
  const next = task === "word" ? "word" : "letter";
  if (next !== state.modelTestTask) resetModelTestBatch();
  state.modelTestTask = next;
  queryElements("[data-model-test-task]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.modelTestTask === state.modelTestTask);
  });
  if (els.modelTestTop3List) els.modelTestTop3List.dataset.task = next;
  renderModelTestSampleOptions();
  updateModelTestDomainHelp();
}

/** @type {Promise<void> | null} */
let _modelTestManifestLoad = null;
/** @type {Promise<void> | null} */
let _localModelTestFixturesLoad = null;

/**
 * @returns {Promise<void>} Never rejects.
 */
async function loadModelTestManifest() {
  await loadPublishedModelTestManifest();
  await loadLocalModelTestFixtures();
}

/**
 * Without the manifest the screen falls back to one built-in fixture per task.
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
 * Asked for on this screen only, and only from a local host.
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
 * The only place the git-ignored local folder can be served from.
 *
 * @returns {boolean}
 */
function isLocalDevelopmentHost() {
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

/**
 * A clone has no local folder, and its absence is not an error.
 *
 * @param {ModelTestManifest} manifest Extended in place.
 * @returns {Promise<void>}
 */
async function appendLocalWordFixtures(manifest) {
  if (!isLocalDevelopmentHost()) return;
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
 * @param {ModelTask} [task]
 * @returns {ModelTestManifestItem[]}
 */
function getModelTestManifestItems(task = state.modelTestTask) {
  const manifest = state.modelTestManifest || {};
  return task === "word" ? (manifest.words || []) : (manifest.letters || []);
}

/**
 * For words a preferred fixture is selected, so the demo does not open on a
 * weak case.
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
    option.textContent = t(state.modelTestTask === "word" ? "info.test.option.noWord" : "info.test.option.noLetter");
    els.modelTestSampleSelect.appendChild(option);
    if (els.loadSelectedModelTestSample) els.loadSelectedModelTestSample.disabled = true;
    return;
  }

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.path;
    option.textContent = modelTestOptionText(item, state.modelTestTask);
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
 * Renames in place, so the visitor's selection is kept.
 *
 * @returns {void}
 */
function renameModelTestSampleOptions() {
  if (!els.modelTestSampleSelect) return;
  const items = getModelTestManifestItems();
  for (const option of Array.from(els.modelTestSampleSelect.options)) {
    const item = items.find((entry) => entry.path === option.value);
    if (item) option.textContent = modelTestOptionText(item, state.modelTestTask);
    else if (!items.length) {
      option.textContent = t(state.modelTestTask === "word" ? "info.test.option.noWord" : "info.test.option.noLetter");
    }
  }
}

/**
 * @param {string} task
 * @returns {Promise<void>}
 */
async function loadPreferredModelTestSample(task) {
  const normalizedTask = task === "word" ? "word" : "letter";
  setModelTestTask(normalizedTask);
  const items = getModelTestManifestItems(normalizedTask);
  const preferredIds = normalizedTask === "word" ? PREFERRED_MODEL_TEST_WORD_IDS : ["letter-a"];
  const sample =
    preferredIds.map((id) => items.find((item) => item.id === id)).find(Boolean) || items[0];

  if (!sample?.path) {
    showModelTestError(() =>
      t(normalizedTask === "word" ? "info.test.error.noWordSample" : "info.test.error.noLetterSample"),
    );
    return;
  }

  await loadModelTestSampleFromUrl(sample.path, () => modelTestItemTitle(sample, normalizedTask), sample.kind);
}

/**
 * A failed load cannot run the previous sample: the task must match.
 *
 * @param {string} task
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
 * @returns {void}
 */
function updateModelTestDomainHelp() {
  const isWord = state.modelTestTask === "word";
  setText(els.modelTestDomainHelp, isWord ? "info.test.help.word" : "info.test.help.letter");
  // Promise a count only when some sample is a real recording.
  const countable = getModelTestManifestItems().some((item) => item.kind !== MODEL_TEST_SYNTHETIC_KIND);
  setText(
    els.modelTestBatchHint,
    countable
      ? isWord ? "info.test.all.hint.wordCounted" : "info.test.all.hint.letterCounted"
      : isWord ? "info.test.all.hint.wordUncounted" : "info.test.all.hint.letterUncounted",
  );
}

/** @returns {Promise<void>} */
async function loadSelectedModelTestSample() {
  const option = els.modelTestSampleSelect?.selectedOptions?.[0];
  if (!option?.value) {
    showModelTestError(() => t("info.test.error.noSample"));
    return;
  }
  const task = state.modelTestTask;
  const item = getModelTestManifestItems(task).find((entry) => entry.path === option.value);
  const name = item ? () => modelTestOptionText(item, task) : option.textContent.trim();
  await loadModelTestSampleFromUrl(option.value, name, option.dataset.kind);
}

/**
 * @param {string} url Relative to asl-web/.
 * @param {string | (() => string)} [displayName]
 * @param {string} [kind]
 * @returns {Promise<void>}
 */
async function loadModelTestSampleFromUrl(url, displayName, kind) {
  const name = typeof displayName === "function" ? displayName : () => displayName || url;
  try {
    setText(els.modelTestSampleStatus, "info.test.status.loading");
    updateModelTestProcess("loading");
    setModelTestSample(await fetchModelTestJson(url, name), name, kind);
  } catch (err) {
    showModelTestError(() => describeModelTestError(err));
    console.error(err);
  }
}

/**
 * @param {string} url Relative to asl-web/.
 * @param {() => string} [name]
 * @returns {Promise<unknown>} Not yet validated.
 * @throws {Error}
 */
async function fetchModelTestJson(url, name = () => url) {
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    // No response at all; fetch's own text ("Failed to fetch") is for the console.
    throw modelTestVisitorError(() => t("info.test.error.connection"), `${url}: ${errorMessage(cause)}`);
  }
  const status = res.status;
  if (!res.ok) throw modelTestVisitorError(() => t("info.test.error.http", { name: name() || url, status }));
  try {
    return await res.json();
  } catch (cause) {
    throw modelTestFixtureError("bad-json", `JSON okunamadı: ${errorMessage(cause)}`);
  }
}

/**
 * @param {Event & {target: HTMLInputElement}} event
 * @returns {Promise<void>}
 */
async function handleModelTestSampleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await readModelTestSampleFile(file);
}

/**
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
 * @param {File} file
 * @returns {Promise<void>}
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
    setModelTestSample(parseModelTestJson(text), () => file.name);
  } catch (err) {
    showModelTestError(() => describeModelTestError(err));
    console.error(err);
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 * @throws {ModelTestFixtureError}
 */
function parseModelTestJson(text) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw modelTestFixtureError("bad-json", `JSON okunamadı: ${errorMessage(cause)}`);
  }
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {ModelTestErrorCode} code
 * @param {string} message Technical, for tests and the console.
 * @param {number} [count] The size found.
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
  return err instanceof Error && "code" in err && typeof err.code === "string" && MODEL_TEST_ERROR_CODES.has(err.code);
}

/** Keep in step with ModelTestErrorCode. @type {ReadonlySet<string>} */
const MODEL_TEST_ERROR_CODES = new Set([
  "unreadable", "bad-json", "not-object", "no-features", "letter-length",
  "word-length", "mask-length", "mask-value", "not-number", "mask-empty",
]);

/**
 * visitorText is a function so a failure on screen follows a language switch;
 * the message may stay technical, for the console.
 *
 * @typedef {Error & {visitorText: () => string}} ModelTestVisitorError
 */

/**
 * @param {() => string} visitorText
 * @param {string} [message]
 * @returns {ModelTestVisitorError}
 */
function modelTestVisitorError(visitorText, message = visitorText()) {
  return Object.assign(new Error(message), { visitorText });
}

/**
 * @param {unknown} err
 * @returns {err is ModelTestVisitorError}
 */
function isModelTestVisitorError(err) {
  return err instanceof Error && "visitorText" in err && typeof err.visitorText === "function";
}

/**
 * Any other error (a runtime error, a bug) is never shown as it is; the
 * caller logs it.
 *
 * @param {unknown} err
 * @returns {string}
 */
function describeModelTestError(err) {
  if (isModelTestVisitorError(err)) return err.visitorText();
  if (!isModelTestFixtureError(err)) return t("info.test.error.failed");
  const count = err.count ?? 0;
  switch (err.code) {
    case "unreadable":
      return t("info.test.error.unreadable");
    case "bad-json":
      return t("info.test.error.badJson");
    case "not-object":
    case "no-features":
      return t("info.test.error.noData");
    case "letter-length":
      return t("info.test.error.letterLength", { count });
    case "word-length":
      return t("info.test.error.wordLength", { count });
    case "mask-length":
      return t("info.test.error.maskLength", { count });
    case "mask-value":
      return t("info.test.error.maskValue");
    case "not-number":
      return t("info.test.error.notNumber");
    case "mask-empty":
      return t("info.test.error.maskEmpty");
  }
}

/**
 * @param {unknown} rawSample Not yet trusted.
 * @param {() => string} sourceName
 * @param {string} [kind]
 * @returns {void}
 * @throws {Error}
 */
function setModelTestSample(rawSample, sourceName, kind) {
  const sample = normalizeModelTestSample(rawSample, sourceName(), kind);
  state.modelTestSample = sample;
  _modelTestSource = { name: sourceName, ownSource: isRecord(rawSample) && Boolean(rawSample.source || rawSample.dataset) };
  // A run still waiting for its model belongs to the previous sample.
  _modelTestSampleEpoch += 1;
  setModelTestTask(sample.task);
  updateModelTestProcess("validated");

  setText(els.modelTestSampleStatus, "info.test.status.ready");
  drawModelTestSource();
  if (els.runModelTestSample) {
    els.runModelTestSample.disabled = false;
    setText(els.runModelTestSample, "info.test.runAgain");
  }
  setText(els.modelTestTaskLabel, sample.task === "word" ? "info.test.model.word" : "info.test.model.letter");
  if (els.modelTestSchemaLabel) els.modelTestSchemaLabel.textContent = sample.schemaVersion;
  if (els.modelTestShapeLabel) els.modelTestShapeLabel.textContent = sample.shapeLabel;
  if (sample.mask) setText(els.modelTestMaskLabel, "info.test.facts.realFrames", { n: sample.mask.filter(Boolean).length });
  else setText(els.modelTestMaskLabel, "info.test.facts.noMask");
  if (!sample.synthetic && sample.expectedLabel) setModelTestPlainText(els.modelTestExpectedLabel, sample.expectedLabel);
  else setText(els.modelTestExpectedLabel, "info.test.noReference");
  clearModelTestResult();
  if (els.modelTestMatchBadge) {
    setText(els.modelTestMatchBadge, "info.test.badge.notRun");
    els.modelTestMatchBadge.dataset.match = "unknown";
  }
  const note = sample.synthetic
    ? "info.test.note.synthetic"
    : sample.task === "word" ? "info.test.note.wordReady" : "info.test.note.letterReady";
  setModelTestNote(() => t(note));
}

/**
 * @returns {void}
 */
function drawModelTestSource() {
  const sample = state.modelTestSample;
  if (!sample || !_modelTestSource) return;
  const name = _modelTestSource.name();
  if (name || sample.source) setModelTestPlainText(els.modelTestFileName, name || sample.source);
  else setText(els.modelTestFileName, "info.test.uploadedJson");
  // A fixture without a source of its own is named by where it was loaded from.
  const source = _modelTestSource.ownSource ? sample.source : name || sample.source;
  setModelTestPlainText(els.modelTestSourceLabel, source || "JSON fixture");
}

/**
 * @param {() => string} text
 * @returns {void}
 */
function setModelTestNote(text) {
  _modelTestNote = text;
  setModelTestPlainText(els.modelTestResultNote, text());
}

/**
 * The task comes from the task field, or from the presence of a mask.
 *
 * @param {unknown} rawSample
 * @param {string} [sourceName]
 * @param {string} [kind]
 * @returns {ModelTestSample}
 * @throws {Error}
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
    // With no real frame the model would still answer, meaninglessly.
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
      maskLabel: t("info.test.facts.realFrames", { n: realFrames }),
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
    maskLabel: t("info.test.facts.noMask"),
    synthetic,
  };
}

/**
 * Row order, so a flat word fixture and one as 45 frames of 168 give the same
 * input.
 *
 * @param {unknown[]} value
 * @param {string} fieldName
 * @returns {number[]}
 * @throws {Error}
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
 * Fixtures come from several tools, so booleans, 0/1 and their string forms
 * are all accepted.
 *
 * @param {unknown} value
 * @returns {WordMask45} The caller checks the length.
 * @throws {Error}
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

// A run that finishes at another epoch belongs to a sample no longer on screen.
let _modelTestSampleEpoch = 0;

/**
 * A second press joins the run in flight. @type {{epoch: number, done: Promise<void>} | null}
 */
let _modelTestRun = null;

/**
 * The model download is kept out of the measured time.
 *
 * @returns {Promise<void>}
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
 * @param {number} epoch
 * @returns {Promise<void>}
 */
async function executeModelTestRun(epoch) {
  const sample = state.modelTestSample;
  if (!sample) {
    showModelTestError(() => t("info.test.error.pickFirst"));
    return;
  }

  const stale = () => epoch !== _modelTestSampleEpoch;
  const isWord = sample.task === "word";
  try {
    setText(
      els.modelTestSampleStatus,
      (isWord ? wordSession : letterSession) ? "info.test.status.running" : "info.test.status.loadingModel",
    );
    if (els.runModelTestSample) {
      els.runModelTestSample.disabled = true;
      setText(els.runModelTestSample, "info.test.status.running");
    }
    updateModelTestProcess("running");

    const loaded = await (isWord ? ensureWordModel() : ensureLetterModel());
    if (stale()) return;
    if (!loaded) {
      throw modelTestVisitorError(() => t(isWord ? "info.test.error.wordModel" : "info.test.error.letterModel"));
    }
    setText(els.modelTestSampleStatus, "info.test.status.running");

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
    if (!result) throw modelTestVisitorError(() => t("info.test.error.noPrediction"));

    renderModelTestResult(sample, result, elapsed);
  } catch (err) {
    if (stale()) return;
    showModelTestError(() => describeModelTestError(err));
    console.error(err);
  } finally {
    if (!stale() && els.runModelTestSample) {
      els.runModelTestSample.disabled = false;
      setText(els.runModelTestSample, "info.test.runAgain");
    }
  }
}

/**
 * @param {ModelTestSample} sample
 * @param {PredictionResult} result
 * @param {number} elapsed Milliseconds.
 * @returns {void}
 */
function renderModelTestResult(sample, result, elapsed) {
  // Matching a made-up sample proves the pipeline ran, not that it is right.
  const expected = sample.synthetic ? "" : sample.expectedLabel || "";
  const matched = expected ? result.label === expected : null;
  const alternatives = result.alternatives?.length
    ? result.alternatives
    : [{ label: result.label, confidence: result.confidence || 0 }];
  setText(els.modelTestSampleStatus, "info.test.status.done");
  updateModelTestProcess("done");
  if (els.modelTestMatchBadge) {
    setText(
      els.modelTestMatchBadge,
      sample.synthetic
        ? "info.test.badge.check"
        : matched === null ? "info.test.noReference" : matched ? "info.test.badge.match" : "info.test.badge.noMatch",
    );
    els.modelTestMatchBadge.dataset.match = matched === null ? "unknown" : matched ? "yes" : "no";
  }
  if (expected) setModelTestPlainText(els.modelTestExpectedLabel, expected);
  else setText(els.modelTestExpectedLabel, "info.test.noReference");
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = result.label;
  if (els.modelTestLatency) els.modelTestLatency.textContent = `${elapsed.toFixed(0)} ms`;
  _modelTestAnswer = { confidence: result.confidence, alternatives };
  drawModelTestAnswer();

  if (sample.synthetic) {
    const isWord = sample.task === "word";
    setModelTestNote(() =>
      isWord
        ? `${t("info.test.note.syntheticRun")} ${t("info.test.note.syntheticRunWord")}`
        : t("info.test.note.syntheticRun"),
    );
    return;
  }
  const matchKey =
    matched === null ? "info.test.note.noReference" : matched ? "info.test.note.matched" : "info.test.note.mismatched";
  setModelTestNote(() => `${t(matchKey)} ${t("info.test.note.top", { top: formatModelTestTop(alternatives) })}`);
}

/**
 * @returns {void}
 */
function drawModelTestAnswer() {
  if (!_modelTestAnswer) return;
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = formatPercent(_modelTestAnswer.confidence);
  renderModelTestTop3(_modelTestAnswer.alternatives);
}

/**
 * @param {PredictionCandidate[]} items Best first.
 * @returns {string}
 */
function formatModelTestTop(items) {
  return items
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.label} ${formatWholePercent(Math.round((item.confidence || 0) * 100))}`)
    .join(" · ");
}

/**
 * @param {number} percent
 * @returns {string}
 */
function formatWholePercent(percent) {
  return t("info.format.percent", { n: percent });
}

/**
 * @param {PredictionCandidate[]} items Best first.
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
    confidence.textContent = formatWholePercent(pct);
    row.append(rank, label, bar, confidence);
    els.modelTestTop3List.appendChild(row);
  });
}

/**
 * An earlier prediction must never sit beside a sample or error it does not
 * belong to.
 *
 * @returns {void}
 */
function clearModelTestResult() {
  _modelTestAnswer = null;
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = "-";
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = "-";
  if (els.modelTestLatency) els.modelTestLatency.textContent = "-";
  renderModelTestTop3([]);
}

/**
 * @param {() => string} message
 * @returns {void}
 */
function showModelTestError(message) {
  clearModelTestResult();
  setText(els.modelTestSampleStatus, "info.test.status.error");
  updateModelTestProcess("error");
  if (els.modelTestMatchBadge) {
    setText(els.modelTestMatchBadge, "info.test.badge.error");
    els.modelTestMatchBadge.dataset.match = "no";
  }
  setModelTestNote(message);
}

/**
 * @typedef {"sample" | "validate" | "inference" | "result"} ModelTestProcessStep
 */

/**
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
  /** @type {Set<string>} */
  const active = new Set(activeByStatus[status] || []);
  els.modelTestProcessSteps.dataset.status = status;
  queryElements("[data-step]", els.modelTestProcessSteps).forEach((step) => {
    step.dataset.state = active.has(step.dataset.step ?? "") ? "done" : "";
  });
}

/**
 * One decimal only under 10, where it still tells figures apart; "7,6" in
 * Turkish, "7.6" in English.
 *
 * @param {number} value
 * @returns {string}
 */
function formatMeasurement(value) {
  // 9.96 rounds to "10.0"; the strip leaves "10".
  const text = Math.abs(value) < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return currentLanguage() === "tr" ? text.replace(".", ",") : text;
}

/**
 * @param {number} value Probability in [0, 1].
 * @returns {string}
 */
function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return t("info.format.percent", { n: formatMeasurement(value * 100) });
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatMilliseconds(ms) {
  return Number.isFinite(ms) ? `${formatMeasurement(ms)} ms` : "-";
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatSeconds(ms) {
  return Number.isFinite(ms) ? t("info.format.seconds", { n: formatMeasurement(ms / 1000) }) : "-";
}

// A run that wakes up at another epoch was abandoned.
let _modelTestBatchEpoch = 0;

/** @type {Promise<void> | null} */
let _modelTestBatchRun = null;

/**
 * @returns {void}
 */
function resetModelTestBatch() {
  _modelTestBatchEpoch += 1;
  _modelTestBatchRun = null;
  state.modelTestBatch = null;
  renderModelTestBatch();
}

/**
 * Model preparation is timed apart, so a row's time is inference alone.
 *
 * @param {string} [task]
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
 * @param {number} epoch
 * @returns {Promise<void>}
 */
async function executeModelTestBatch(kind, epoch) {
  const stale = () => epoch !== _modelTestBatchEpoch;
  // The list may still be loading when the screen was opened by a link.
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
    batch.error = t(isWord ? "info.test.error.wordModel" : "info.test.error.letterModel");
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
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} kind
 * @returns {Promise<ModelTestBatchRow>} Never rejects; a failure is an "error" row.
 */
async function runModelTestBatchItem(item, kind) {
  const name = () => modelTestItemTitle(item, kind) || t("info.test.table.sample");
  /** @type {ModelTestBatchRow} */
  const row = {
    id: item.id || "",
    title: name(),
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
    if (!item.path) throw modelTestVisitorError(() => t("info.test.error.noPath", { name: name() }));
    const sample = normalizeModelTestSample(await fetchModelTestJson(item.path, name), row.title);
    row.expected = sample.expectedLabel;
    if (sample.task !== kind) throw modelTestVisitorError(() => t("info.test.error.wrongModel", { name: name() }));

    const t0 = performance.now();
    const result = sample.task === "word"
      ? await predictWord(sample.features, sample.mask)
      : await predictLetter(sample.features);
    const elapsed = performance.now() - t0;
    if (!result) throw modelTestVisitorError(() => t("info.test.error.noPrediction"));

    row.predicted = result.label;
    row.confidence = result.confidence;
    row.ms = elapsed;
    row.verdict = !row.expected ? "no-reference" : result.label === row.expected ? "correct" : "wrong";
  } catch (err) {
    row.error = describeModelTestError(err);
    _modelTestRowErrors.set(row, err);
    console.error(err);
  }
  return row;
}

/**
 * @param {ModelTestBatchRow[]} rows
 * @param {number | null} prepMs
 * @returns {ModelTestBatchSummary}
 */
function summarizeModelTestBatch(rows, prepMs) {
  // A failed sample counts as not correct: leaving it out would flatter the model.
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
 * @param {ModelTestBatch} batch
 * @returns {string}
 */
function describeModelTestBatch(batch) {
  // The only failure that stops a run before its first sample is a model that did not load.
  if (batch.status === "error") return t(batch.task === "word" ? "info.test.error.wordModel" : "info.test.error.letterModel");
  if (batch.status === "preparing") return t("info.test.batch.preparing");
  if (batch.status === "running") return t("info.test.batch.running", { done: batch.rows.length, total: batch.total });
  const summary = batch.summary;
  if (!summary || summary.total === 0) return t("info.test.batch.empty");

  const parts = [];
  if (summary.accuracy === null && summary.synthetic) {
    parts.push(t("info.test.batch.synthetic"));
  } else if (summary.accuracy === null) {
    parts.push(t("info.test.batch.unscored", { count: summary.total }));
  } else {
    parts.push(
      t("info.test.batch.accuracy", {
        count: summary.counted,
        correct: summary.correct,
        percent: formatPercent(summary.accuracy),
      }),
    );
  }
  if (summary.medianMs !== null) parts.push(t("info.test.batch.median", { time: formatMilliseconds(summary.medianMs) }));
  if (summary.prepMs !== null) parts.push(t("info.test.batch.prep", { time: formatSeconds(summary.prepMs) }));
  if (summary.failed > 0) parts.push(t("info.test.batch.failed", { count: summary.failed }));
  if (summary.hasLocal) parts.push(t("info.test.batch.local"));
  return parts.join(" ");
}

/** @type {Record<ModelTestBatchRow["verdict"], string>} */
const MODEL_TEST_VERDICT_KEYS = {
  correct: "info.test.verdict.correct",
  wrong: "info.test.verdict.wrong",
  "no-reference": "info.test.noReference",
  error: "info.test.badge.error",
};

/**
 * @returns {void}
 */
function renderModelTestBatch() {
  const batch = state.modelTestBatch;
  if (els.modelTestBatch) els.modelTestBatch.hidden = !batch;
  if (els.modelTestNoteLetter) els.modelTestNoteLetter.hidden = batch?.task !== "letter";
  if (els.modelTestNoteWord) els.modelTestNoteWord.hidden = batch?.task !== "word";
  if (els.modelTestSummary) els.modelTestSummary.textContent = batch ? describeModelTestBatch(batch) : "";
  if (!els.modelTestRows) return;
  els.modelTestRows.innerHTML = "";
  const samples = batch ? getModelTestManifestItems(batch.task) : [];
  for (const item of batch?.rows ?? []) {
    const row = document.createElement("tr");
    row.dataset.verdict = item.verdict;
    if (item.local) row.dataset.local = "true";
    const verdictLabel = t(
      item.synthetic && item.verdict !== "error" ? "info.test.badge.check" : MODEL_TEST_VERDICT_KEYS[item.verdict],
    );
    // Named again from the manifest, so the name follows a language switch.
    const sample = item.id ? samples.find((entry) => entry.id === item.id) : undefined;
    const title = sample && batch ? modelTestItemTitle(sample, batch.task) || item.title : item.title;
    const failure = _modelTestRowErrors.has(item) ? describeModelTestError(_modelTestRowErrors.get(item)) : item.error;
    const cells = [
      item.local ? t("info.test.batch.localTitle", { title }) : title,
      item.expected || "-",
        item.predicted || failure || "-",
      formatPercent(item.confidence),
      formatMilliseconds(item.ms),
      verdictLabel,
    ];
    // The phone layout drops the header row and shows these in front of the values.
    const labels = [null, t("info.test.result.expected"), t("info.test.result.prediction")];
    cells.forEach((text, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = text;
      if (labels[index]) cell.dataset.label = labels[index];
      row.appendChild(cell);
    });
    els.modelTestRows.appendChild(row);
  }
}

// Project page figures come from data/model-card.json, not the markup, so
// they do not go stale at the next retraining. They share the formatters above.

/**
 * Cleared after a failure, so the next visit retries.
 *
 * @type {Promise<void> | null}
 */
let _modelCardLoad = null;

/**
 * @type {unknown}
 */
let _modelCardShown = null;

/**
 * @param {unknown} card
 * @param {string} path For example "word.accuracy".
 * @returns {number | null}
 */
function modelCardFigure(card, path) {
  /** @type {unknown} */
  let value = card;
  for (const key of path.split(".")) value = isRecord(value) ? value[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {number} value
 * @param {string | undefined} format "percent", "mb" (from bytes) or a whole number.
 * @returns {string}
 */
function formatModelCardFigure(value, format) {
  if (format === "percent") return formatPercent(value);
  if (format === "mb") return `${formatMeasurement(value / 1048576)} MB`;
  return String(value);
}

/**
 * All or none: a sentence with one figure missing would read as nonsense.
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
  _modelCardShown = card;
  if (els.projectNumbers) els.projectNumbers.hidden = false;
}

/**
 * The markup pass skips these sentences because their figures make them
 * differ from their strings.
 *
 * @returns {void}
 */
function renderProjectLanguage() {
  if (_modelCardShown === null || !els.projectNumbers) return;
  for (const element of queryElements("[data-i18n-html]", els.projectNumbers)) {
    element.innerHTML = t(element.getAttribute("data-i18n-html") ?? "");
  }
  renderProjectModelCard(_modelCardShown);
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

/**
 * @returns {void}
 */
function renderInfoLanguage() {
  renderProjectLanguage();
  renderModelTestLanguage();
}

/**
 * @returns {void}
 */
function renderModelTestLanguage() {
  renameModelTestSampleOptions();
  drawModelTestSource();
  drawModelTestAnswer();
  if (_modelTestNote) setModelTestPlainText(els.modelTestResultNote, _modelTestNote());
  renderModelTestBatch();
}
