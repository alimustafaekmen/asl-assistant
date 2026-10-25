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
 * The name a manifest sample is shown by.
 *
 * The manifest titles its samples in Turkish ("Harf A", "Kelime give #3"),
 * so a Turkish page shows the title and an English page names the sample
 * from its label, keeping a title's sample number.
 *
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} task The model the sample is for.
 * @returns {string} Empty when the item has no title, label or id.
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
 * A manifest sample as its dropdown option reads.
 *
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} task
 * @returns {string}
 */
function modelTestOptionText(item, task) {
  const title = modelTestItemTitle(item, task);
  // A made-up sample's expected confidence is the model's old answer to
  // random numbers, so it is not shown as something to expect.
  if (!Number.isFinite(Number(item.confidence)) || item.kind === MODEL_TEST_SYNTHETIC_KIND) return title;
  return t("info.test.option.expected", {
    title,
    percent: formatWholePercent(Math.round(Number(item.confidence) * 100)),
  });
}

/**
 * Show text the panel made rather than a string, such as a label or a file
 * name. The element stops naming a string, so a language change does not
 * write one back over the text.
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

/**
 * Where the loaded sample came from, kept so a language change can name it
 * again: `name` gives its name in the current language, and `ownSource`
 * says whether the fixture states a source of its own. Null before a
 * sample loads.
 *
 * @type {{name: () => string, ownSource: boolean} | null}
 */
let _modelTestSource = null;

/**
 * The text of the result note, kept so a language change can write it
 * again. Null while the note shows its authored string.
 *
 * @type {(() => string) | null}
 */
let _modelTestNote = null;

/**
 * The answer on screen, kept so a language change can write its figures
 * again; null while none is shown.
 *
 * @type {{confidence: number, alternatives: PredictionCandidate[]} | null}
 */
let _modelTestAnswer = null;

/**
 * The failure of each batch row that failed, kept so a language change can
 * explain it again. @type {WeakMap<ModelTestBatchRow, unknown>}
 */
const _modelTestRowErrors = new WeakMap();

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
 * @property {string} maskLabel Human-readable mask summary, in the language
 *   the sample was loaded in.
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
 * tests and the console; the panel maps the code to a plain sentence.
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
 * @property {string} error What went wrong, as first shown; "" unless the row failed.
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
 * @property {string} error What went wrong, as first shown; "" unless the run could not start.
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
 * Write the dropdown's options in the current language, keeping the one
 * the visitor selected.
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
    showModelTestError(() =>
      t(normalizedTask === "word" ? "info.test.error.noWordSample" : "info.test.error.noLetterSample"),
    );
    return;
  }

  await loadModelTestSampleFromUrl(sample.path, () => modelTestItemTitle(sample, normalizedTask), sample.kind);
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
  setText(els.modelTestDomainHelp, isWord ? "info.test.help.word" : "info.test.help.letter");
  // Run-all runs the selected model, so the line under it names that model,
  // and it promises a count only when some sample is a real recording.
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
 * Fetch and validate a fixture from a URL.
 *
 * @param {string} url Fixture path relative to asl-web/.
 * @param {string | (() => string)} [displayName] The sample's name, or what
 *   gives it in the current language; falls back to the URL.
 * @param {string} [kind] The manifest's kind for the fixture, if it has one.
 * @returns {Promise<void>} Resolves after reporting a fetch or validation
 *   failure to the user.
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
 * Fetch a fixture's JSON, not yet validated.
 *
 * @param {string} url Fixture path relative to asl-web/.
 * @param {() => string} [name] Gives the sample's name for the message when
 *   the fetch fails.
 * @returns {Promise<unknown>}
 * @throws {Error} A ModelTestVisitorError when the request fails or is
 *   refused, or a fixture error with code "bad-json" when the body is not JSON.
 */
async function fetchModelTestJson(url, name = () => url) {
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    // fetch rejects only when no response arrived at all: offline, a dropped
    // connection, a blocked request. Its own text ("Failed to fetch") is for
    // the console.
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
    setModelTestSample(parseModelTestJson(text), () => file.name);
  } catch (err) {
    showModelTestError(() => describeModelTestError(err));
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
 * An error the panel raised itself, carrying a plain sentence for the
 * visitor: a model that did not load, a sample that could not be fetched.
 * The sentence is given in the current language each time it is asked for,
 * so a failure on screen follows a language change. Its message may stay
 * technical, for the console.
 *
 * @typedef {Error & {visitorText: () => string}} ModelTestVisitorError
 */

/**
 * @param {() => string} visitorText Gives what the panel shows.
 * @param {string} [message] What the console shows; defaults to the text
 *   shown when the error was raised.
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
 * Say what went wrong in words a visitor can act on.
 *
 * A fixture error is explained from its code, and an error the panel raised
 * carries its own sentence. Anything else (a runtime error, a bug) is never
 * shown as it is: its text is technical, so the visitor gets a plain message
 * and the caller logs the error itself. The sentence is in the current
 * language.
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
 * Validate a fixture and show its metadata.
 *
 * @param {unknown} rawSample Parsed JSON, not yet trusted.
 * @param {() => string} sourceName Gives where it came from, for the status
 *   line, in the current language.
 * @param {string} [kind] The manifest's kind for the fixture, if it has one.
 * @returns {void}
 * @throws {Error} When validation rejects the fixture; callers report the
 *   message to the user.
 */
function setModelTestSample(rawSample, sourceName, kind) {
  const sample = normalizeModelTestSample(rawSample, sourceName(), kind);
  state.modelTestSample = sample;
  _modelTestSource = { name: sourceName, ownSource: isRecord(rawSample) && Boolean(rawSample.source || rawSample.dataset) };
  // A run still waiting for its model belongs to the sample it started with.
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
 * Name the loaded sample and its source in the current language.
 *
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
 * Write the result note, and keep what gives it for a language change.
 *
 * @param {() => string} text Gives the note in the current language.
 * @returns {void}
 */
function setModelTestNote(text) {
  _modelTestNote = text;
  setModelTestPlainText(els.modelTestResultNote, text());
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
    showModelTestError(() => t("info.test.error.pickFirst"));
    return;
  }

  const stale = () => epoch !== _modelTestSampleEpoch;
  const isWord = sample.task === "word";
  try {
    // A model download is labelled as loading, not as inference.
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
 * Write the answer's figures, its confidence and ranked list, in the
 * current language.
 *
 * @returns {void}
 */
function drawModelTestAnswer() {
  if (!_modelTestAnswer) return;
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = formatPercent(_modelTestAnswer.confidence);
  renderModelTestTop3(_modelTestAnswer.alternatives);
}

/**
 * Ranked candidates in a line: "1. A %90 · 2. B %6" in Turkish,
 * "1. A 90% · 2. B 6%" in English.
 *
 * @param {PredictionCandidate[]} items Ranked candidates, best first.
 * @returns {string}
 */
function formatModelTestTop(items) {
  return items
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.label} ${formatWholePercent(Math.round((item.confidence || 0) * 100))}`)
    .join(" · ");
}

/**
 * A whole percentage in the page's language: "%90" or "90%".
 *
 * @param {number} percent
 * @returns {string}
 */
function formatWholePercent(percent) {
  return t("info.format.percent", { n: percent });
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
    confidence.textContent = formatWholePercent(pct);
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
  _modelTestAnswer = null;
  if (els.modelTestPredictedLabel) els.modelTestPredictedLabel.textContent = "-";
  if (els.modelTestConfidence) els.modelTestConfidence.textContent = "-";
  if (els.modelTestLatency) els.modelTestLatency.textContent = "-";
  renderModelTestTop3([]);
}

/**
 * Report a fixture or inference failure in the result area.
 *
 * @param {() => string} message Gives what the visitor is told, in the
 *   current language.
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
 * Write a measurement in the page's language: one decimal only under 10,
 * where it still tells figures apart, no trailing zero decimal, and the
 * decimal comma Turkish writes ("7,6") or the point English writes ("7.6").
 *
 * @param {number} value
 * @returns {string}
 */
function formatMeasurement(value) {
  // 9.96 rounds to "10.0" at one decimal; the trailing-zero strip leaves "10".
  const text = Math.abs(value) < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return currentLanguage() === "tr" ? text.replace(".", ",") : text;
}

/**
 * Write a probability as a percentage in the page's language: "%7,6" and
 * "%100" in Turkish, "7.6%" and "100%" in English.
 *
 * @param {number} value Probability in [0, 1].
 * @returns {string} The percentage, or "-" when not finite.
 */
function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return t("info.format.percent", { n: formatMeasurement(value * 100) });
}

/**
 * @param {number} ms
 * @returns {string} "0,6 ms" or "0.6 ms", "12 ms"; "-" when not finite.
 */
function formatMilliseconds(ms) {
  return Number.isFinite(ms) ? `${formatMeasurement(ms)} ms` : "-";
}

/**
 * @param {number} ms
 * @returns {string} The time in seconds, "1,9 sn" or "1.9 s"; "-" when not finite.
 */
function formatSeconds(ms) {
  return Number.isFinite(ms) ? t("info.format.seconds", { n: formatMeasurement(ms / 1000) }) : "-";
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
 * Fetch, validate and run one manifest sample.
 *
 * @param {ModelTestManifestItem} item
 * @param {ModelTask} kind The model the batch is running.
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

    // Only the inference is timed: fetching and validating the sample is not it.
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
 * The batch in a sentence or two, in the current language.
 *
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

/** The strings that name the row verdicts. @type {Record<ModelTestBatchRow["verdict"], string>} */
const MODEL_TEST_VERDICT_KEYS = {
  correct: "info.test.verdict.correct",
  wrong: "info.test.verdict.wrong",
  "no-reference": "info.test.noReference",
  error: "info.test.badge.error",
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
  const samples = batch ? getModelTestManifestItems(batch.task) : [];
  for (const item of batch?.rows ?? []) {
    const row = document.createElement("tr");
    row.dataset.verdict = item.verdict;
    if (item.local) row.dataset.local = "true";
    // A made-up sample answered "correctly" is a run check, not a success.
    const verdictLabel = t(
      item.synthetic && item.verdict !== "error" ? "info.test.badge.check" : MODEL_TEST_VERDICT_KEYS[item.verdict],
    );
    // Named again from the manifest, so the name follows a language change.
    const sample = item.id ? samples.find((entry) => entry.id === item.id) : undefined;
    const title = sample && batch ? modelTestItemTitle(sample, batch.task) || item.title : item.title;
    const failure = _modelTestRowErrors.has(item) ? describeModelTestError(_modelTestRowErrors.get(item)) : item.error;
    const cells = [
      item.local ? t("info.test.batch.localTitle", { title }) : title,
      item.expected || "-",
      // A failed row has no answer, so its reason takes the answer's place.
      item.predicted || failure || "-",
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
 * The card the page's figures were filled from, kept so a language change
 * can write them again; null until a card has filled them.
 *
 * @type {unknown}
 */
let _modelCardShown = null;

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
  if (format === "mb") return `${formatMeasurement(value / 1048576)} MB`;
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
  _modelCardShown = card;
  if (els.projectNumbers) els.projectNumbers.hidden = false;
}

/**
 * Write the filled sentences again in the page's language.
 *
 * Their figures make the shown sentences differ from their strings, so the
 * markup pass leaves them as they are: each is rewritten from its string and
 * filled again, its figures now formatted the new language's way.
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

/**
 * Redraw what the information screens drew from state, after a language
 * change has translated their markup.
 *
 * @returns {void}
 */
function renderInfoLanguage() {
  renderProjectLanguage();
  renderModelTestLanguage();
}

/**
 * Write again what the Model Test panel built from state: the dropdown, the
 * loaded sample's name, the answer's figures, the result note and the batch.
 * The status, badge and labels follow the change by themselves, written
 * with setText().
 *
 * @returns {void}
 */
function renderModelTestLanguage() {
  renameModelTestSampleOptions();
  drawModelTestSource();
  drawModelTestAnswer();
  if (_modelTestNote) setModelTestPlainText(els.modelTestResultNote, _modelTestNote());
  renderModelTestBatch();
}
