// What the word screen shows at each step of a recording.
//
// The stylesheet decides which parts of the stage and the dock are visible
// from one attribute, data-word-step, so the scripts must write it for every
// step; and the readout at the top of the stage (percent, progress bar) and
// the dock's labels must follow the recording. The harness has no layout, so
// these tests read the attributes and texts the app writes, and the
// screenshots check how they look. Only the ONNX runtime,
// the clock and MediaPipe's results are fake.

import assert from "node:assert/strict";
import { test } from "node:test";

import { RECORDING_FRAMES, feedFrames, wordModeApp } from "./helpers/word-recording.mjs";

const read = (app, expression) => app.evaluate(expression);
const step = (app) => read(app, "els.cameraStage.dataset.wordStep");
const dockStep = (app) => read(app, "els.controlBar.dataset.wordStep");
const label = (app, id) => read(app, `document.getElementById("${id}").querySelector("[data-label]").textContent`);

test("every recording step is written to the stage and the dock", async () => {
  const { app, timers, hold, release } = wordModeApp({ boot: true, fakeTimers: true });
  await app.ready;
  app.evaluate('document.querySelector(\'button[data-mode="word"]\')').dispatchEvent({ type: "click", detail: 1 });
  assert.equal(step(app), "idle");
  assert.equal(dockStep(app), "idle");

  const starting = app.get("startWordRecording")();
  await timers.advance(0);
  assert.equal(step(app), "countdown");

  await timers.advance(720 * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await starting;
  assert.equal(step(app), "recording");
  assert.equal(dockStep(app), "recording");

  hold();
  const last = feedFrames(app, 0, RECORDING_FRAMES);
  await timers.advance(0);
  assert.equal(step(app), "processing");

  release();
  await last;
  assert.equal(step(app), "result");
  assert.equal(dockStep(app), "result");

  app.get("cancelWordRecording")();
  assert.equal(step(app), "result", "a finished result is not a recording to leave");
});

test("the readout at the top of the stage follows the progress of the recording", async () => {
  const { app } = wordModeApp();
  await app.get("startWordRecording")();
  assert.equal(read(app, 'document.getElementById("wordHudPercent").textContent'), "%0");
  assert.equal(read(app, 'document.getElementById("wordHudStep").textContent'), "Kayıt");

  await feedFrames(app, 0, 20);
  assert.equal(read(app, 'document.getElementById("wordHudPercent").textContent'), "%44");
  assert.equal(read(app, 'document.getElementById("wordProgress").getAttribute("aria-valuenow")'), "44");
  assert.equal(read(app, "els.frameProgress.style.width"), "44%");
});

test("the dock labels say what each press does, in plain siz Turkish", async () => {
  const { app } = wordModeApp({ winner: "book" });
  app.evaluate("updateWordState();");
  assert.equal(label(app, "recordWord"), "Kaydı başlat");
  assert.equal(label(app, "retryWord"), "Yeniden kaydet");
  assert.equal(label(app, "appendWordResult"), "Metne ekle");

  await app.get("startWordRecording")();
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(read(app, "state.wordState"), "RESULT");

  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(label(app, "appendWordResult"), "Eklendi");
  assert.equal(label(app, "recordWord"), "Yeni kayıt");
  assert.equal(read(app, 'els.controlBar.dataset.wordAccepted'), "true");
  assert.equal(read(app, "els.appendWordResult.disabled"), true);
});

test("the plate names the nearest alternatives of a result, not the winner again", async () => {
  const { app } = wordModeApp({ winner: "water", runnerUp: { label: "drink", logit: 9 } });
  assert.equal(read(app, 'document.getElementById("plateNear").hidden'), true);

  await app.get("startWordRecording")();
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(read(app, "state.wordState"), "RESULT");

  const near = read(app, 'document.getElementById("plateNear").textContent');
  assert.match(near, /^Yakın: drink %\d+/);
  assert.doesNotMatch(near, /water/);

  app.get("retryWordRecording")();
  assert.equal(read(app, 'document.getElementById("plateNear").hidden'), true, "a new recording clears it");
});
