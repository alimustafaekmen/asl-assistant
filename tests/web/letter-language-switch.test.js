// A language switch while the letter screen shows something.
//
// The switch reloads nothing: whatever the screen is showing is written
// again in the new language, from the state that drew it, and the camera,
// the demo, the transcript and a pending undo carry on as they were.
//
// The faults these tests kill:
// - a plate message, the decision word, a percentage, the ranked list, the
//   word result guide, the feedback bar, a toast or the transcript
//   placeholder left in the old language after a switch;
// - a plate message the shell wrote (a camera problem, models downloading)
//   left in the old language;
// - the demo panel or the stage chip left behind, or the demo stopped or
//   restarted by the switch;
// - a switch that restarts the camera, loses the transcript or drops an
//   undo the toast still offers;
// - Turkish that is not the authored text after switching to English and
//   back.
//
// The browser's languages, the camera, the network, the clock and ONNX
// Runtime are faked at their boundaries; the markup and the scripts are the
// app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoApp, flush } from "./helpers/demo-app.mjs";
import { appWithFakeCamera } from "./helpers/fake-camera.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";
import { mediaPipeFrame, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

const text = (app, id) => app.evaluate(`document.getElementById(${JSON.stringify(id)})`).textContent.trim();
const switchTo = (app, language) => app.get("setLanguage")(language);

/** What the plate and the ranked list show. */
function plate(app) {
  return {
    decision: text(app, "decisionLabel"),
    percent: text(app, "confidenceText"),
    message: text(app, "confidenceMessage"),
    ranked: [...app.evaluate("els.top3List.children")].map((row) => row.textContent),
  };
}

async function bootedApp(options = {}) {
  const app = loadWebApp({ boot: true, ...options, globals: { console: quietConsole, kjua: () => ({}), ...options.globals } });
  await app.ready;
  return app;
}

test("a switch while the demo plays rewrites the panel and the plate, and the demo plays on", async () => {
  const demo = await demoApp();
  const { app } = demo;
  await demo.start();
  await demo.play(600);
  demo.press(" ");
  await demo.play(1100);
  assert.equal(demo.plate(), "L", "precondition: F was added and the plate reads L");
  const turkish = { plate: plate(app), panel: text(app, "demoText"), badge: text(app, "latencyBadge"), stop: text(app, "demoStop") };
  assert.match(turkish.plate.percent, /^%\d+$/, "precondition: a Turkish percentage");

  switchTo(app, "en");
  const pct = turkish.plate.percent.slice(1);
  assert.equal(text(app, "confidenceText"), `${pct}%`, "the same number, in the English order");
  assert.match(text(app, "confidenceMessage"), /^(L is clear\.|Probably L\. Hold it a little steadier\.)$/);
  assert.match(text(app, "decisionLabel"), /^(Sure|Likely)$/);
  assert.equal(text(app, "demoText"), "Tap Add or press Space to add the letter shown to your text.");
  assert.equal(text(app, "latencyBadge"), "Demo playing");
  assert.equal(text(app, "demoStop"), "Stop");
  for (const row of plate(app).ranked) assert.match(row, /\d+%$/);
  for (const selector of ["#latencyBadge", "#demoPanel", "#demoStop", ".plate__visual", ".plate__level", "#confidenceMessage", ".ranked", ".strip"]) {
    assert.deepEqual(turkishLeft(app.evaluate(`document.querySelector(${JSON.stringify(selector)})`)), [], selector);
  }

  assert.equal(app.evaluate("state.demo"), "playing", "the demo was not stopped");
  assert.equal(demo.transcript(), "F", "the transcript is kept");
  assert.ok(demo.pendingTimers() > 0, "its frame loop still runs");
  assert.equal(demo.camera.requests, 0, "and no camera was asked for");

  switchTo(app, "tr");
  assert.deepEqual(
    { plate: plate(app), panel: text(app, "demoText"), badge: text(app, "latencyBadge"), stop: text(app, "demoStop") },
    turkish,
    "back in Turkish, everything reads as before",
  );

  await demo.play(300);
  assert.equal(demo.publishedLetter(), "L", "the recorded hand is still on L");
  assert.deepEqual([...app.get("I18N_PROBLEMS").missing], []);
});

test("a toast on screen is rewritten by a switch, and its undo still works", async () => {
  const app = await bootedApp();
  app.evaluate('state.transcript = "HELLO "');
  app.get("clearTranscript")();
  assert.equal(text(app, "toastText"), "Metin temizlendi", "precondition: the toast is shown");
  assert.equal(text(app, "toastAction"), "Geri al");

  switchTo(app, "en");
  assert.equal(text(app, "toastText"), "Text cleared");
  assert.equal(text(app, "toastAction"), "Undo");
  assert.equal(app.evaluate("els.toast.hidden"), false, "the switch does not hide it");

  app.evaluate("els.toastAction").onclick();
  assert.equal(app.evaluate("state.transcript"), "HELLO ", "the undo still brings the text back");
  assert.equal(app.evaluate("els.announcer.textContent").trim(), "Text restored");
});

test("the transcript placeholder follows a switch, and typed letters stay marked as English", async () => {
  const app = await bootedApp();
  assert.equal(text(app, "transcriptText"), "Metin burada görünür|", "precondition: the Turkish placeholder");
  assert.equal(app.evaluate("els.transcriptText.lang"), "tr");

  switchTo(app, "en");
  assert.equal(text(app, "transcriptText"), "Text shows here|");
  assert.equal(app.evaluate("els.transcriptText.lang"), "en");

  app.evaluate('state.transcript = "AB"');
  app.get("renderTranscript")();
  switchTo(app, "tr");
  assert.equal(text(app, "transcriptText"), "AB|", "the typed text is kept");
  assert.equal(app.evaluate("els.transcriptText.lang"), "en", "fingerspelled letters stay English on a Turkish page");
});

test("a word result's guide, near results and quality warning follow a switch", async () => {
  const ctx = wordModeApp({ boot: true, fakeTimers: true, winner: "water" });
  const { app } = ctx;
  await app.ready;
  app.evaluate('document.querySelector(\'button[data-mode="word"]\')').dispatchEvent({ type: "click", detail: 1 });
  const starting = app.get("startWordRecording")();
  await ctx.timers.advance(app.evaluate("CONFIG.COUNTDOWN_SECONDS") * 720);
  await starting;
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
  assert.equal(text(app, "feedbackBar"), "Omuzlarınız az göründü.", "precondition: the warning in Turkish");
  assert.match(text(app, "plateNear"), /^Yakın: /);

  switchTo(app, "en");
  assert.equal(text(app, "feedbackBar"), "Your shoulders were hardly in view.");
  assert.equal(text(app, "wordResultDecision"), "Check before adding");
  assert.equal(text(app, "wordResultAction"), "Your shoulders were hardly in view. Check the result before you add it.");
  assert.match(text(app, "plateNear"), /^Other results: \S+ \d+% · \S+ \d+%$/);
  assert.equal(app.evaluate("state.wordResultAssessment.canAppend"), true, "the switch decides nothing anew");
  assert.equal(app.evaluate("els.appendWordResult.disabled"), false, "and the result can still be added");
});

/** The camera faked at every boundary, with the page's own bindings. */
function camera(options) {
  const fake = appWithFakeCamera(options);
  fake.app.get("bindEvents")();
  return fake;
}

test("a plate message the shell wrote follows a switch", async () => {
  const insecure = camera().app;
  insecure.evaluate("globalThis.isSecureContext = false; navigator.mediaDevices = undefined;");
  await insecure.get("toggleCamera")();
  assert.match(text(insecure, "confidenceMessage"), /^Bu adreste kamera açılamıyor\. /, "precondition: the problem on the plate");
  switchTo(insecure, "en");
  assert.equal(
    text(insecure, "confidenceMessage"),
    "The camera cannot open at this address. Browsers allow the camera only on secure (https) addresses. Open the site at https://asl-assistant.netlify.app.",
  );

  const downloading = camera({ hold: { onnx: true } }).app;
  await downloading.get("toggleCamera")();
  await flush();
  assert.equal(text(downloading, "confidenceMessage"), "Modeller indiriliyor…", "precondition: the models are downloading");
  switchTo(downloading, "en");
  assert.equal(text(downloading, "confidenceMessage"), "Downloading the models…");
});

test("the camera's badge and close button follow a switch, and the camera keeps running", async () => {
  const fake = camera({ mode: "word" });
  const { app } = fake;
  app.evaluate('state.transcript = "HI "');
  await app.get("toggleCamera")();
  await flush(30);
  assert.equal(text(app, "latencyBadge"), "Hazırlanıyor (3/3)", "precondition: every task is ready");
  assert.equal(text(app, "cameraToggle"), "Kamerayı kapat");

  switchTo(app, "en");
  assert.equal(text(app, "latencyBadge"), "Preparing (3/3)");
  assert.equal(text(app, "cameraToggle"), "Turn off camera");
  assert.equal(fake.streams.length, 1, "no second camera was asked for");
  assert.equal(fake.streams[0].tracks[0].stops, 0, "the camera was not stopped");
  assert.equal(fake.alive("hand"), 1, "one hand tracker, as before");
  assert.equal(app.evaluate("state.transcript"), "HI ");
});

test("switching to English and back leaves the letter screen's Turkish as authored", async () => {
  const app = await bootedApp();
  const document = app.evaluate("document");
  const parts = ["#cameraEmpty", ".stage__top", "#toast", "#resultPlate", ".strip", "#controlBar", ".ranked"]
    .map((selector) => document.querySelector(selector));
  parts.push(document.getElementById("shortcutsTitle").parentElement);
  // Each part's markup, and the names and language set on the parts themselves.
  const shown = () => parts.map((part) => [part.innerHTML, part.getAttribute("aria-label"), part.getAttribute("lang")]);
  const before = shown();

  switchTo(app, "en");
  assert.notDeepEqual(shown(), before, "precondition: English differs");
  switchTo(app, "tr");
  assert.deepEqual(shown(), before);
});
