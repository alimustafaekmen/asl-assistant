// The letter screen in English, state by state.
//
// An English visitor must meet no Turkish on the letter screen, in any state
// it can be in: the first visit (before and after the app starts), a camera
// that cannot open with its help steps, the camera starting, the camera-free
// demo from loading to its end, a letter result in each confidence band, a
// word result on the shared plate, and the transcript's toasts. Spoken names
// and tooltips count as much as text.
//
// The faults these tests kill:
// - a marked string missing from the markup, or a script writing a Turkish
//   literal (the plate, the demo panel, the stage chip, the camera button,
//   a toast, an announcement, the word result guide);
// - a percentage in the Turkish order ("%90") on an English page;
// - the transcript placeholder in Turkish, or marked as Turkish, on an
//   English page;
// - a lookup of a key nobody registered, which shows nothing.
//
// The parts other areas translate (the word recording readout and steps, the
// coach's tile, session and controls, the reference and word cards) are left
// to their own tests. The browser's languages, the camera, the clipboard,
// the network, the clock and ONNX Runtime are faked at their boundaries; the
// markup and the scripts are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoApp, demoRecording, flush } from "./helpers/demo-app.mjs";
import { appWithFakeCamera } from "./helpers/fake-camera.mjs";
import { jsonResponse } from "./helpers/fake-ort.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";
import { mediaPipeFrame, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const ENGLISH = ["en-US", "en"];
const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/** The camera screens' parts the letter area writes, by selector. */
const LETTER_PARTS = [
  "#cameraEmpty",
  "#latencyBadge",
  "#cameraToggle",
  "#demoPanel",
  "#demoStop",
  "#feedbackBar",
  "#toast",
  ".plate__visual",
  ".plate__level",
  "#plateNear",
  "#confidenceMessage",
  "#wordResultGuide",
  ".strip",
  "#removeLastChar",
  "#insertSpace",
  "#manualAddLetter",
  ".ranked",
];

/** The letter area's parts of the page, the shortcuts card included. */
function letterParts(app) {
  const document = app.evaluate("document");
  const parts = LETTER_PARTS.map((selector) => {
    const part = document.querySelector(selector);
    assert.ok(part, `the page has ${selector}`);
    return part;
  });
  parts.push(document.getElementById("shortcutsTitle").parentElement);
  return parts;
}

/** Turkish the letter area still shows, in text or in a spoken attribute. */
function turkishOnLetterScreen(app, options) {
  // The action bar's own name; its other buttons belong to the word and coach screens.
  const dockName = app.evaluate('document.createElement("div")');
  dockName.setAttribute("aria-label", app.evaluate('document.getElementById("controlBar").getAttribute("aria-label")'));
  return [...letterParts(app), dockName].flatMap((part) => turkishLeft(part, options));
}

const missing = (app) => [...app.get("I18N_PROBLEMS").missing];
const text = (app, id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`).textContent.trim();
const announced = (app) => app.evaluate("els.announcer.textContent").trim();

async function bootedApp(options = {}) {
  const app = loadWebApp({
    boot: true,
    ...options,
    globals: { console: quietConsole, kjua: () => ({}), ...options.globals },
  });
  await app.ready;
  return app;
}

/** The camera faked at every boundary, with the page's own bindings, switched to English. */
function englishCamera(options) {
  const fake = appWithFakeCamera(options);
  fake.app.get("bindEvents")();
  fake.app.get("setLanguage")("en");
  return fake;
}

/** A result through the app's own entry point, as live inference hands it over. */
function showResult(app, label, confidence, alternatives = [{ label, confidence }]) {
  app.get("updatePrediction")({ label, confidence, alternatives });
}

test("before the app starts, an English visitor's letter screen is already in English", () => {
  // The scripts before the CDN translate the page; init() has not run.
  const app = loadWebApp({ languages: ENGLISH, globals: { console: quietConsole } });

  // The plate's hidden "Harf" (letter) label is the shell's, which init() writes.
  assert.deepEqual(turkishOnLetterScreen(app, { allow: ["Harf"] }), []);
  for (const id of ["cameraHelp", "cameraRetry", "cameraNoCamera", "demoPanel", "demoStop"]) {
    assert.deepEqual(turkishLeft(app.evaluate(`document.getElementById("${id}")`), { includeHidden: true }), [], `#${id}, shown later`);
  }
  assert.equal(text(app, "transcriptText"), "Text shows here|");
  assert.equal(app.evaluate('document.getElementById("transcriptText").getAttribute("lang")'), "en");
  assert.equal(text(app, "confidenceMessage"), "Turn on the camera to see the result here.");
  assert.equal(app.evaluate('document.getElementById("controlBar").getAttribute("aria-label")'), "Actions");
  assert.deepEqual(missing(app), []);
});

test("booted in English, the idle letter screen has no Turkish, and the empty list says why", async () => {
  const app = await bootedApp({ languages: ENGLISH });

  assert.deepEqual(turkishOnLetterScreen(app), []);
  assert.equal(text(app, "top3List"), "Once the camera is on, the most likely results show up here.");
  assert.equal(text(app, "decisionLabel"), "Waiting");
  assert.equal(app.evaluate("els.transcriptText.lang"), "en", "the placeholder is English");
  assert.equal(text(app, "manualAddLetter"), "Add Space");
  assert.deepEqual(missing(app), []);
});

test("a camera that cannot open shows its help in English, every browser's steps included", async () => {
  const { app } = englishCamera();
  app.evaluate("globalThis.isSecureContext = false; navigator.mediaDevices = undefined;");
  await app.get("toggleCamera")();

  assert.equal(app.evaluate("els.cameraProblem.hidden"), false, "precondition: the problem is shown");
  assert.deepEqual(turkishLeft(app.evaluate("els.cameraEmpty")), []);
  assert.equal(text(app, "cameraNoCamera"), "Watch the demo");
  assert.match(app.evaluate('document.querySelector("[data-browser=ios-safari]").textContent'), /Website Settings → Camera → Allow/);
  assert.equal(app.evaluate('document.querySelectorAll("#cameraHelpSteps strong").length') > 6, true, "the steps keep their emphasis");
  assert.match(text(app, "confidenceMessage"), /^The camera cannot open at this address\. /);
  assert.deepEqual(missing(app), []);
});

test("a camera that is starting shows its badge and its close button in English", async () => {
  // The word screen's camera, which also loads the pose and face tasks.
  const fake = englishCamera({ mode: "word", hold: { pose: true } });
  const { app } = fake;
  await app.get("toggleCamera")();
  await flush();

  assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the camera is on");
  assert.equal(text(app, "latencyBadge"), "Hand tracking ready");
  assert.equal(text(app, "cameraToggle"), "Turn off camera");
  assert.ok(fake.created("pose").length, "precondition: the pose task is loading");
  fake.created("pose").forEach((creation) => creation.resolve());
  await flush(30);
  assert.equal(text(app, "latencyBadge"), "Preparing (3/3)");
  // The plate's hidden "Harf" (letter) label is the shell's: init() writes it,
  // and this harness does not run init().
  assert.deepEqual(turkishOnLetterScreen(app, { allow: ["Harf"] }), []);
  assert.deepEqual(missing(app), []);
});

test("a letter result is worded in English in every band, with the percentage after the number", async () => {
  const app = await bootedApp({ languages: ENGLISH });
  const config = app.get("CONFIG");
  const bands = [
    [config.UNKNOWN_THRESHOLD / 2, "Not sure", /^Not sure\. Try more light, or bring your hand a little closer\.$/],
    [(config.UNKNOWN_THRESHOLD + config.CONFIDENT_THRESHOLD) / 2, "Likely", /^Probably B\. Hold it a little steadier\.$/],
    [0.99, "Sure", /^B is clear\.$/],
  ];
  for (const [confidence, decision, message] of bands) {
    showResult(app, "B", confidence, [{ label: "B", confidence }, { label: "D", confidence: 0.004 }]);
    const pct = Math.round(confidence * 100);

    assert.equal(text(app, "decisionLabel"), decision);
    assert.match(text(app, "confidenceMessage"), message);
    assert.equal(text(app, "confidenceText"), `${pct}%`, "English writes the sign after the number");
    const rows = [...app.evaluate("els.top3List.children")].map((row) => row.textContent);
    assert.deepEqual(rows, [`1.B${pct}%`, "2.D0%"]);
    assert.deepEqual(turkishOnLetterScreen(app), []);
  }
  assert.deepEqual(missing(app), []);
});

test("the demo is in English from loading to its end", async () => {
  let deliver;
  const demo = await demoApp({
    languages: ENGLISH,
    respond: () => new Promise((resolve) => { deliver = () => resolve(jsonResponse(demoRecording("FLY"))); }),
  });
  const { app } = demo;
  const starting = demo.start();

  await flush();
  assert.equal(text(app, "demoText"), "Preparing the demo…");
  assert.equal(text(app, "latencyBadge"), "Preparing demo");
  assert.equal(text(app, "demoStop"), "Stop");
  assert.equal(text(app, "confidenceMessage"), "Preparing the demo…");
  assert.deepEqual(turkishOnLetterScreen(app), []);

  deliver();
  await starting;
  await demo.play(600);
  assert.equal(demo.plate(), "F", "precondition: the plate reads the first letter");
  assert.equal(text(app, "demoText"), "Tap Add or press Space to add the letter shown to your text.");
  assert.equal(text(app, "latencyBadge"), "Demo playing");
  assert.equal(text(app, "demoSkip"), "Skip");
  assert.match(text(app, "confidenceText"), /^\d+%$/);
  assert.match(text(app, "confidenceMessage"), /^(F is clear\.|Probably F\. Hold it a little steadier\.)$/);
  assert.deepEqual(turkishOnLetterScreen(app), []);

  demo.press(" ");
  assert.equal(announced(app), "F added");
  await demo.play(1100);
  for (const letter of ["L", "Y"]) {
    assert.equal(demo.plate(), letter, `precondition: the plate reads ${letter}`);
    demo.click(demo.byId("demoSkip"));
    await demo.play(1100);
  }

  assert.equal(app.evaluate("state.demo"), "done", "precondition: the demo is over");
  assert.equal(text(app, "demoText"), "Demo finished. Now turn on the camera and try it with your own hand.");
  assert.equal(announced(app), "Demo finished. Now turn on the camera and try it with your own hand.");
  assert.equal(text(app, "latencyBadge"), "Demo finished");
  assert.equal(text(app, "demoStop"), "Close");
  assert.equal(text(app, "demoCamera"), "Turn on camera");
  assert.deepEqual(turkishOnLetterScreen(app), []);
  assert.deepEqual(missing(app), []);
});

test("a demo that cannot load, or whose model cannot, says so in English", async () => {
  const unloadable = await demoApp({ languages: ENGLISH, respond: () => jsonResponse({}, 404) });
  await unloadable.start();
  assert.equal(text(unloadable.app, "confidenceMessage"), "The demo could not load. Check your connection and try again.");
  assert.equal(announced(unloadable.app), "The demo could not load. Check your connection and try again.");
  assert.equal(text(unloadable.app, "latencyBadge"), "Ready");

  const modelless = await demoApp({ languages: ENGLISH });
  modelless.app.evaluate("__ort.fail = true");
  await modelless.start();
  await modelless.play(300);
  assert.equal(
    text(modelless.app, "confidenceMessage"),
    "Letter recognition could not load. Check your connection and restart the demo.",
  );
  assert.deepEqual(turkishOnLetterScreen(modelless.app), []);
});

test("the transcript's toasts and announcements are in English", async () => {
  const clipboard = { fail: false, writeText: async () => { if (clipboard.fail) throw new Error("denied"); } };
  const app = await bootedApp({ languages: ENGLISH, globals: { navigator: { clipboard } } });
  const toast = () => [text(app, "toastText"), app.evaluate("els.toastAction.hidden") ? null : text(app, "toastAction")];

  await app.get("copyTranscript")();
  assert.deepEqual(toast(), ["No text to copy", null]);

  showResult(app, "A", 0.99);
  app.get("appendCurrentLetter")();
  assert.equal(announced(app), "A added");
  await app.get("copyTranscript")();
  assert.deepEqual(toast(), ["Text copied", null]);
  assert.equal(announced(app), "Text copied");
  clipboard.fail = true;
  await app.get("copyTranscript")();
  assert.deepEqual(toast(), ["Couldn't copy. You can select the text and copy it yourself.", null]);

  app.get("clearTranscript")();
  assert.deepEqual(toast(), ["Text cleared", "Undo"]);
  assert.deepEqual(turkishOnLetterScreen(app), []);
  app.evaluate("els.toastAction").onclick();
  assert.equal(app.evaluate("state.transcript"), "A");
  assert.equal(announced(app), "Text restored");
  assert.deepEqual(missing(app), []);
});

test("a word result's guide, plate and quality warning are in English, and so is its toast", async () => {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, winner: "water" });
  const { app } = ctx;
  await app.ready;
  app.evaluate('document.querySelector(\'button[data-mode="word"]\')').dispatchEvent({ type: "click", detail: 1 });
  app.get("setLanguage")("en");

  const starting = app.get("startWordRecording")();
  await ctx.timers.advance(app.evaluate("CONFIG.COUNTDOWN_SECONDS") * 720);
  await starting;
  // Frames without shoulders between the recorded ones: the shoulders are in
  // too few of the frames the camera saw, a quality warning.
  let stamp = 5000;
  const feed = async (frame) => {
    app.evaluate(`__clock += 50; latestMediaPipeResult = ${JSON.stringify({ ...frame, timestamp: stamp++ })};`);
    await app.get("realInference")(app.evaluate("__clock"));
  };
  let rejected = 0;
  for (let t = 0; t < RECORDING_FRAMES; t++) {
    await feed(mediaPipeFrame(t));
    const owed = Math.round(((t + 1) * 68) / RECORDING_FRAMES) - rejected;
    for (let i = 0; i < owed; i++, rejected++) await feed({ ...mediaPipeFrame(t), poseLandmarks: null });
  }
  assert.equal(app.evaluate("state.wordState"), "RESULT", "precondition: a finished recording");
  assert.deepEqual([...app.evaluate("state.wordQualityWarnings")], ["pose"], "precondition: one quality warning");

  assert.equal(text(app, "feedbackBar"), "Your shoulders were hardly in view.");
  assert.equal(text(app, "wordResultDecision"), "Check before adding");
  assert.equal(text(app, "wordResultAction"), "Your shoulders were hardly in view. Check the result before you add it.");
  assert.match(text(app, "plateNear"), /^Other results: \S+ \d+% · \S+ \d+%$/);
  assert.match(text(app, "confidenceText"), /^\d+%$/);
  for (const id of ["feedbackBar", "wordResultGuide", "plateNear", "top3List"]) {
    assert.deepEqual(turkishLeft(app.evaluate(`document.getElementById("${id}")`)), [], `#${id}`);
  }
  assert.deepEqual(turkishLeft(app.evaluate('document.querySelector(".plate__level")')), []);

  app.evaluate("__clock += 1000;");
  app.evaluate("els.appendWordResult").dispatchEvent({ type: "click", detail: 0 });
  const word = app.evaluate("state.prediction");
  assert.equal(text(app, "toastText"), `“${word}” added to your text`);
  assert.equal(text(app, "toastAction"), "Undo");
  app.evaluate("els.toastAction").onclick();
  assert.equal(announced(app), `“${word}” removed from your text`);
});
