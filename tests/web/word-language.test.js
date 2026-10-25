// The word screen in English, and a switch while a recording is on screen.
//
// The faults these tests kill:
// - Turkish left on the word screen of an English visitor at any step of a
//   recording: the readout at the top of the stage, its quality pills and
//   hint, the plate's steps, the dock's labels and tooltips, the side cards,
//   and the messages a recording ends with;
// - a percentage in the Turkish order ("%44") on an English page, or in the
//   English order on a Turkish one;
// - a step on screen that keeps the old language after a switch, or a switch
//   that ends, restarts or empties the recording, or loses the transcript;
// - a message the word screen wrote that a switch leaves in the old
//   language, and one that a switch rewrites after another script has
//   written over it.
//
// ONNX Runtime, MediaPipe's results, the clock and the browser's languages
// are faked at their boundaries (helpers/word-recording.mjs); everything
// else is the app's own code and markup.

import assert from "node:assert/strict";
import { test } from "node:test";

import { turkishLeft } from "./helpers/turkish-left.mjs";
import { RECORDING_FRAMES, feedFrames, mediaPipeFrame, wordModeApp } from "./helpers/word-recording.mjs";

const ENGLISH = ["en-US", "en"];
const STEP_MS = 720;

const read = (app, expression) => app.evaluate(expression);
// Through a spread, because an array made inside the app's context is not an
// array of this one.
const list = (app, expression) => [...app.evaluate(expression)];
const byId = (app, id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`);
const label = (app, id) => read(app, `document.getElementById("${id}").querySelector("[data-label]").textContent`);
const title = (app, id) => read(app, `document.getElementById("${id}").getAttribute("title")`);

/**
 * The parts of the page the word screen draws, each walked for Turkish: the
 * readout on the stage, the plate's steps, the word dock, the camera button
 * it labels, and the side cards that only the word screen shows. The
 * library's entries and the easy-word counter are built by the coach, and
 * the plate's result text by the result display; each has its own owner.
 * The library's group titles are this screen's strings, but the coach draws
 * them, so they are checked as an English visitor first sees them.
 */
const WORD_PARTS = [
  "#wordHud",
  ".plate__head",
  "#recordWord",
  "#retryWord",
  "#appendWordResult",
  "#cancelWord",
  "#actionVideoLink",
  "#cameraToggle",
  "#wordStateCard",
  "#wordDemoCard .word-guide__summary h2",
  "#wordDemoCard .word-guide__body > .panel__note",
  "#wordDemoList",
  "#wordConfusionTitle",
  ".word-library-card .word-guide__summary",
  ".word-library-card label",
  ".word-library-card .word-guide__body > .panel__note",
];

/** Turkish found in the word screen's parts, hidden ones included. */
function turkishOnWordScreen(app) {
  const findings = [];
  for (const selector of WORD_PARTS) {
    for (const element of read(app, `[...document.querySelectorAll(${JSON.stringify(selector)})]`)) {
      findings.push(...turkishLeft(element, { includeHidden: true }));
    }
  }
  return findings.map(({ text, where, element }) => `${element} ${where}: ${text}`);
}

function openTab(app, mode) {
  read(app, `document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

/** The booted app in word mode, its word model ready; `languages` as the browser's. */
async function wordApp({ languages = ENGLISH, ...options } = {}) {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, winner: "water", languages, ...options });
  await ctx.app.ready;
  openTab(ctx.app, "word");
  // The word tab's own model download settles first.
  await ctx.timers.advance(0);
  return ctx;
}

/**
 * Press record and stop in the countdown. The press's promise comes back
 * wrapped: an async function returning it would wait for the countdown.
 */
async function countdown(ctx) {
  const starting = ctx.app.get("startWordRecording")();
  await ctx.timers.advance(0);
  assert.equal(read(ctx.app, "state.wordState"), "COUNTDOWN", "precondition: counting down");
  return { starting };
}

async function recording(ctx) {
  const { starting } = await countdown(ctx);
  await ctx.timers.advance(STEP_MS * read(ctx.app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  assert.equal(read(ctx.app, "state.wordState"), "RECORDING", "precondition: recording");
}

function noMissingStrings(app) {
  assert.deepEqual([...read(app, "I18N_PROBLEMS.missing")], [], "a string with no English");
  assert.deepEqual([...read(app, "I18N_PROBLEMS.refused")], [], "a string refused at registration");
}

test("an English visitor's idle word screen has no Turkish left", async () => {
  const { app } = await wordApp();

  assert.equal(read(app, 'document.documentElement.getAttribute("lang")'), "en");
  assert.deepEqual(turkishOnWordScreen(app), []);
  assert.equal(read(app, "els.wordStateLabel.textContent"), "Ready");
  assert.equal(label(app, "recordWord"), "Start recording");
  assert.equal(label(app, "retryWord"), "Record again");
  assert.equal(label(app, "appendWordResult"), "Add to text");
  assert.equal(read(app, "els.cameraToggle.textContent"), "Turn off camera", "the camera is on");
  assert.deepEqual(list(app, '[...document.querySelectorAll("#wordLibraryGroups h3")].map((h) => h.textContent)'), [
    "Everyday",
    "Feelings and states",
    "Animals",
    "Family and people",
    "Other",
  ]);
  noMissingStrings(app);
});

test("an English countdown and recording speak English, percentages after the number", async () => {
  const ctx = await wordApp();
  const { app } = ctx;

  const { starting } = await countdown(ctx);
  assert.deepEqual(turkishOnWordScreen(app), [], "countdown");
  assert.equal(byId(app, "wordHudStep").textContent, "Get ready");
  assert.equal(byId(app, "wordHudPercent").textContent, "0%");
  assert.equal(label(app, "recordWord"), "Recording…");
  assert.equal(title(app, "recordWord"), "You can record again when this recording is done.");
  await ctx.timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;

  await feedFrames(app, 0, 20);
  assert.deepEqual(turkishOnWordScreen(app), [], "recording");
  assert.equal(byId(app, "wordHudStep").textContent, "Recording");
  assert.equal(byId(app, "wordHudPercent").textContent, "44%");
  assert.equal(
    read(app, "els.wordStateHint.textContent"),
    "Recording 44%. Finish the sign at a natural pace; the recording stops on its own.",
  );
  assert.deepEqual(list(app, '[...document.querySelectorAll("#wordQualityPills span")].map((s) => s.textContent)'), [
    "Hand ✓",
    "Face ✓",
    "Shoulders ✓",
  ]);

  // A frame without shoulders names what to fix.
  app.evaluate(`latestMediaPipeResult = ${JSON.stringify({ ...mediaPipeFrame(20), poseLandmarks: null, timestamp: 900 })};`);
  await app.get("realInference")(read(app, "__clock += 50"));
  assert.deepEqual(turkishOnWordScreen(app), [], "a frame without shoulders");
  assert.equal(
    read(app, "els.wordStateHint.textContent"),
    "Recording 44%. Your shoulders are not in view; move back a little.",
  );
  assert.equal(
    read(app, "els.confidenceMessage.textContent"),
    "To record a word, your hands, face and shoulders must be in view at the same time. Move back a little.",
  );
  noMissingStrings(app);
});

test("an English result lists the likeliest words with English percentages", async () => {
  const ctx = await wordApp({ runnerUp: { label: "drink", logit: 9 } });
  const { app, hold, release } = ctx;
  await recording(ctx);

  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await ctx.timers.advance(0);
  assert.equal(read(app, "state.wordState"), "PROCESSING");
  assert.deepEqual(turkishOnWordScreen(app), [], "processing");
  assert.equal(read(app, "els.wordStateHint.textContent"), "Recording done; preparing the result.");
  assert.equal(label(app, "recordWord"), "Preparing the result…");
  release();
  await last;

  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.deepEqual(turkishOnWordScreen(app), [], "result");
  const [first, second] = read(app, "state.top3").map((item) => Math.round(item.confidence * 100));
  assert.equal(
    read(app, "els.wordStateHint.textContent"),
    `Most likely: 1. water ${first}% · 2. drink ${second}% · 3. ${read(app, "state.top3[2].label")} ${Math.round(read(app, "state.top3[2].confidence") * 100)}%. If it's right, add it to your text; if not, record again.`,
  );
  assert.equal(read(app, "els.wordStateLabel.textContent"), "Result");
  assert.equal(label(app, "recordWord"), "New recording");
  assert.equal(title(app, "retryWord"), "If the result is wrong, record again.");

  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(read(app, "state.transcript"), "water ");
  assert.deepEqual(turkishOnWordScreen(app), [], "accepted");
  assert.equal(label(app, "appendWordResult"), "Added");
  assert.equal(title(app, "appendWordResult"), "This result was added to your text.");
  noMissingStrings(app);
});

test("a recording that ends early says why in English", async () => {
  const ctx = await wordApp();
  const { app } = ctx;
  await recording(ctx);

  app.get("cancelWordRecording")();
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Recording canceled.");
  assert.equal(read(app, "els.announcer.textContent").trim(), "Recording canceled.");

  await recording(ctx);
  // Nothing usable reaches the recording until it gives up.
  app.get("checkWordRecordingClock")(read(app, "__clock") + read(app, "CONFIG.WORD_FIRST_FRAME_TIMEOUT_MS") + 1);
  app.get("checkWordRecordingClock")(read(app, "__clock") + 2 * read(app, "CONFIG.WORD_FIRST_FRAME_TIMEOUT_MS") + 2);
  assert.equal(read(app, "state.wordEnd"), "timeout");
  assert.equal(
    read(app, "els.confidenceMessage.textContent"),
    "Your hands, face and shoulders were not in view together, so the recording stopped. Try again at arm's length, in good light.",
  );
  assert.deepEqual(turkishOnWordScreen(app), []);
  noMissingStrings(app);
});

test("a word that cannot be recorded yet says so in English", async () => {
  const { app } = await wordApp();
  app.evaluate("state.cameraOn = false;");
  app.get("syncRecordButton")();

  assert.equal(label(app, "recordWord"), "Camera off");
  assert.equal(title(app, "recordWord"), "Turn on the camera to record a word.");
  await app.get("startWordRecording")();
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Turn on the camera first.");

  app.evaluate("state.cameraOn = true; poseLandmarker = null;");
  app.get("syncRecordButton")();
  assert.equal(label(app, "recordWord"), "Loading…");
  assert.equal(title(app, "recordWord"), "Loading face and shoulder tracking…");
  await app.get("startWordRecording")();
  assert.equal(
    read(app, "els.confidenceMessage.textContent"),
    "Recording a word needs face and shoulder tracking, which is not ready yet.",
  );
  assert.deepEqual(turkishOnWordScreen(app), []);
  noMissingStrings(app);
});

test("model guidance after a result is English: a known confusion and a hard word", async () => {
  {
    // listen and hear are a published confusion pair, close enough to warn.
    const ctx = await wordApp({ winner: "listen", runnerUp: { label: "hear", logit: 9.9 } });
    await recording(ctx);
    await feedFrames(ctx.app, 0, RECORDING_FRAMES);
    assert.equal(
      read(ctx.app, "els.feedbackBar.textContent"),
      "listen and hear are often confused; make the sign more distinct.",
    );
  }
  {
    // book is one of the words the evaluation found hard.
    const ctx = await wordApp({ winner: "book" });
    await recording(ctx);
    await feedFrames(ctx.app, 0, RECORDING_FRAMES);
    assert.equal(
      read(ctx.app, "els.feedbackBar.textContent"),
      "“book” is one of the harder words to recognize; check the result carefully.",
    );
    noMissingStrings(ctx.app);
  }
});

test("a close call between two words is written the page's way, before and after a switch", async () => {
  // Two equal logits: the top two are 0 points apart, and neither is a pair or hard.
  const ctx = await wordApp({ languages: ["tr-TR", "tr"], winner: "water", winnerLogit: 9, runnerUp: { label: "dog", logit: 9 } });
  const { app } = ctx;
  await recording(ctx);
  await feedFrames(app, 0, RECORDING_FRAMES);
  const [first, second] = read(app, "state.top3").map((item) => [item.label, Math.round(item.confidence * 100)]);
  const turkish = `İlk iki kelime çok yakın: 1. ${first[0]} %${first[1]} · 2. ${second[0]} %${second[1]}. Aynı işareti daha net ve kadrajı geniş tutarak tekrar deneyin.`;
  assert.equal(read(app, "els.feedbackBar.textContent"), turkish);

  app.get("setLanguage")("en");
  assert.equal(
    read(app, "els.feedbackBar.textContent"),
    `The top two words are very close: 1. ${first[0]} ${first[1]}% · 2. ${second[0]} ${second[1]}%. Sign it again more clearly, and move back a little.`,
  );
  app.get("setLanguage")("tr");
  assert.equal(read(app, "els.feedbackBar.textContent"), turkish);
});

test("a switch in the middle of a recording redraws it and keeps recording", async () => {
  const ctx = await wordApp({ languages: ["tr-TR", "tr"] });
  const { app } = ctx;
  app.evaluate('state.transcript = "HELLO "');
  await recording(ctx);
  await feedFrames(app, 0, 20);
  assert.equal(byId(app, "wordHudPercent").textContent, "%44");
  assert.equal(read(app, "els.wordStateLabel.textContent"), "Kayıt");

  app.get("setLanguage")("en");

  assert.equal(read(app, "state.wordState"), "RECORDING", "the recording goes on");
  assert.equal(read(app, "frameBuffer.length"), 20, "with the frames it had");
  assert.equal(read(app, "state.cameraOn"), true);
  assert.deepEqual(turkishOnWordScreen(app), []);
  assert.equal(byId(app, "wordHudPercent").textContent, "44%");
  assert.equal(byId(app, "wordHudStep").textContent, "Recording");
  assert.equal(read(app, "els.wordStateLabel.textContent"), "Recording");
  assert.equal(
    read(app, "els.wordStateHint.textContent"),
    "Recording 44%. Finish the sign at a natural pace; the recording stops on its own.",
  );
  assert.equal(read(app, '[...document.querySelectorAll("#wordQualityPills span")].map((s) => s.textContent).join(" ")'), "Hand ✓ Face ✓ Shoulders ✓");

  await feedFrames(app, 20, RECORDING_FRAMES - 20);
  assert.equal(read(app, "state.wordState"), "RESULT", "and finishes");
  assert.equal(read(app, "state.prediction"), "water");
  assert.equal(read(app, "state.transcript"), "HELLO ", "the transcript is kept");
  noMissingStrings(app);
});

test("a switch on a result redraws it, and switching back shows the same Turkish", async () => {
  const ctx = await wordApp({ languages: ["tr-TR", "tr"] });
  const { app } = ctx;
  await recording(ctx);
  await feedFrames(app, 0, RECORDING_FRAMES);
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  const snapshot = () =>
    read(app, `JSON.stringify({
      hint: els.wordStateHint.textContent,
      state: els.wordStateLabel.textContent,
      record: els.recordWord.textContent,
      recordTitle: els.recordWord.getAttribute("title"),
      append: els.appendWordResult.textContent,
      appendTitle: els.appendWordResult.getAttribute("title"),
      retryTitle: els.retryWord.getAttribute("title"),
      camera: els.cameraToggle.textContent,
      pills: [...document.querySelectorAll("#wordQualityPills span")].map((s) => s.textContent),
      steps: [...document.querySelectorAll('[data-ui="word-step"]')].map((s) => s.textContent),
    })`);
  const turkish = snapshot();
  assert.equal(label(app, "appendWordResult"), "Eklendi");

  app.get("setLanguage")("en");
  assert.deepEqual(turkishOnWordScreen(app), []);
  assert.equal(label(app, "appendWordResult"), "Added");
  assert.equal(label(app, "recordWord"), "New recording");
  assert.equal(read(app, "els.cameraToggle.textContent"), "Turn off camera");
  assert.match(read(app, "els.wordStateHint.textContent"), /^Most likely: 1\. water \d+% · /);
  assert.equal(read(app, "state.transcript"), "water ", "the accepted word stays");

  app.get("setLanguage")("tr");
  assert.equal(snapshot(), turkish);
});

test("a message a recording left is said again in the new language, unless something has written over it", async () => {
  const ctx = await wordApp({ languages: ["tr-TR", "tr"] });
  const { app } = ctx;
  await recording(ctx);
  app.get("cancelWordRecording")();
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Kayıt iptal edildi.");

  app.get("setLanguage")("en");
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Recording canceled.");
  app.get("setLanguage")("tr");
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Kayıt iptal edildi.");

  app.get("setMessage")("Başka bir ileti", "low");
  app.get("setLanguage")("en");
  assert.equal(read(app, "els.confidenceMessage.textContent"), "Başka bir ileti", "another script's message is its own");
});
