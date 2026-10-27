// One confidence decision, shown the same way on the stage and on the plate.
//
// A result enters the UI through updatePrediction(). From one confidence it
// derives the stage's data-state (what the camera frame is painted as), the
// ring's level and score, the percentage, the decision word under the label,
// the plate's message and its level, and the top-3 bars. They have to agree:
// a stage that says "good" next to a plate that says "Emin değil" is a lie,
// and the thresholds that split the bands differ between letters and words.
//
// The thresholds are read from CONFIG, so retuning one moves the test's
// boundary with it; the bands themselves (below unknown, between, at
// confident) are the contract. The app is the real one, booted against the
// harness fakes; the camera cases use the fake camera boundaries.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeCamera, flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

async function bootedApp() {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  return app;
}

/** The ring's --score custom property, which the harness's style object drops. */
function recordRingScore(app) {
  const scores = [];
  app.evaluate("els.confidenceRing").style.setProperty = (name, value) => {
    if (name === "--score") scores.push(value);
  };
  return scores;
}

/** What the stage and the plate show right now. */
function shown(app) {
  const text = (id) => app.evaluate(`els.${id}.textContent`);
  return {
    stage: app.evaluate("els.cameraStage.dataset.state"),
    kind: app.evaluate("els.cameraStage.dataset.kind"),
    ring: app.evaluate("els.confidenceRing.className"),
    percent: text("confidenceText"),
    decision: text("decisionLabel"),
    label: text("primaryPrediction"),
    messageLevel: app.evaluate("els.confidenceMessage.dataset.level"),
  };
}

const candidates = (...pairs) => pairs.map(([label, confidence]) => ({ label, confidence }));

// Letter mode

test("a letter result is banded by the letter thresholds on the stage, ring, decision and message", async () => {
  const app = await bootedApp();
  const config = app.get("CONFIG");
  const unknown = config.UNKNOWN_THRESHOLD;
  const confident = config.CONFIDENT_THRESHOLD;
  const update = app.get("updatePrediction");
  assert.equal(app.evaluate("state.mode"), "letter");

  const bands = [
    ["just below unknown", unknown - 0.01, "low", "Emin değil"],
    ["exactly unknown", unknown, "maybe", "Büyük olasılıkla"],
    ["just below confident", confident - 0.01, "maybe", "Büyük olasılıkla"],
    ["exactly confident", confident, "good", "Emin"],
    ["certain", 1, "good", "Emin"],
  ];
  for (const [name, confidence, level, decision] of bands) {
    update({ label: "B", confidence, alternatives: candidates(["B", confidence], ["C", 0]) });
    const now = shown(app);
    const why = `${name} (${confidence})`;
    assert.equal(now.stage, level, `stage state, ${why}`);
    assert.equal(now.ring, `confidence-ring ${level}`, `ring level, ${why}`);
    assert.equal(now.decision, decision, `decision word, ${why}`);
    assert.equal(now.messageLevel, level, `plate message level, ${why}`);
    assert.equal(now.label, "B", why);
  }
});

test("the plate message says what the band means, in the letter's own words", async () => {
  const app = await bootedApp();
  const { UNKNOWN_THRESHOLD, CONFIDENT_THRESHOLD } = app.get("CONFIG");
  const update = app.get("updatePrediction");
  const message = () => app.evaluate("els.confidenceMessage.textContent");

  update({ label: "K", confidence: UNKNOWN_THRESHOLD - 0.01, alternatives: [] });
  assert.match(message(), /^Emin olunamadı/);
  update({ label: "K", confidence: CONFIDENT_THRESHOLD - 0.01, alternatives: [] });
  assert.match(message(), /^Büyük olasılıkla K\./);
  update({ label: "K", confidence: CONFIDENT_THRESHOLD, alternatives: [] });
  assert.equal(message(), "K harfi net görünüyor.");
});

test("the percentage is the rounded confidence, and a dash when there is none", async () => {
  const app = await bootedApp();
  const update = app.get("updatePrediction");
  const scores = recordRingScore(app);

  update({ label: "A", confidence: 0.873, alternatives: [] });
  assert.equal(shown(app).percent, "%87");
  update({ label: "A", confidence: 0.876, alternatives: [] });
  assert.equal(shown(app).percent, "%88", "rounded, not truncated");
  update({ label: "A", confidence: 1, alternatives: [] });
  assert.equal(shown(app).percent, "%100");
  assert.deepEqual(scores, ["87", "88", "100"], "the ring is filled to the same number");

  update({ label: "?", confidence: 0, alternatives: [] });
  assert.equal(shown(app).percent, "--");
  update({ label: "A", confidence: 0, alternatives: [] });
  assert.equal(shown(app).percent, "--", "no confidence is a dash even with a label");
  assert.equal(scores.at(-1), "0");
});

test("no prediction waits for a sign instead of judging one", async () => {
  const app = await bootedApp();
  app.get("updatePrediction")({ label: "A", confidence: 0.9, alternatives: [] });

  app.get("updatePrediction")({ label: "?", confidence: 0, alternatives: [] });

  const now = shown(app);
  assert.equal(now.label, "?");
  assert.equal(now.percent, "--");
  assert.equal(now.decision, "Bekleniyor");
  assert.equal(now.stage, "low");
  assert.equal(now.kind, "letter", "the placeholder is sized as a letter, not as a word");
});

test("the stage sizes a single letter as a letter and a longer label as a word", async () => {
  const app = await bootedApp();
  const update = app.get("updatePrediction");

  update({ label: "A", confidence: 0.9, alternatives: [] });
  assert.equal(shown(app).kind, "letter");
  update({ label: "water", confidence: 0.9, alternatives: [] });
  assert.equal(shown(app).kind, "word");
  update({ label: "?", confidence: 0, alternatives: [] });
  assert.equal(shown(app).kind, "letter");
});

test("a recording in progress shows as recording whatever the confidence", async () => {
  const app = await bootedApp();
  const update = app.get("updatePrediction");
  app.evaluate('state.mode = "word"; state.wordState = "RECORDING";');

  for (const confidence of [0, 0.12, 0.9]) {
    update({ label: "water", confidence, alternatives: [] });
    assert.equal(shown(app).stage, "recording", `confidence ${confidence}`);
  }

  // The same result outside a recording is a plain band again.
  app.evaluate('state.wordState = "RESULT";');
  update({ label: "water", confidence: 0.9, alternatives: [] });
  assert.equal(shown(app).stage, "good");
});

test("fixed sample confidences land in the bands users were promised, whatever CONFIG says", async () => {
  // The tests above follow CONFIG, so retuning a threshold moves them with it.
  // These literals are the shipped scale: a letter at 70 % is sure, at 50 %
  // likely, at 30 % unsure; a word needs far less (25 %, 15 %, 5 %).
  const app = await bootedApp();
  const update = app.get("updatePrediction");
  const expectBands = (samples) => {
    for (const [confidence, level] of samples) {
      update({ label: app.evaluate("state.mode") === "word" ? "water" : "B", confidence, alternatives: [] });
      assert.equal(shown(app).stage, level, `${app.evaluate("state.mode")} mode at ${confidence}`);
    }
  };

  expectBands([[0.7, "good"], [0.5, "maybe"], [0.3, "low"]]);
  app.get("setMode")("word");
  expectBands([[0.25, "good"], [0.15, "maybe"], [0.05, "low"]]);
});

// Word mode

test("a word result is banded by the lower word thresholds", async () => {
  const app = await bootedApp();
  const { WORD_UNKNOWN_THRESHOLD, WORD_CONFIDENT_THRESHOLD, UNKNOWN_THRESHOLD } = app.get("CONFIG");
  app.get("setMode")("word");
  const update = app.get("updatePrediction");
  assert.ok(WORD_CONFIDENT_THRESHOLD < UNKNOWN_THRESHOLD, "the word scale sits under the letter scale");

  const bands = [
    [WORD_UNKNOWN_THRESHOLD - 0.01, "low", "Emin değil"],
    [WORD_UNKNOWN_THRESHOLD, "maybe", "Büyük olasılıkla"],
    [WORD_CONFIDENT_THRESHOLD - 0.01, "maybe", "Büyük olasılıkla"],
    [WORD_CONFIDENT_THRESHOLD, "good", "Emin"],
  ];
  for (const [confidence, level, decision] of bands) {
    // A wide margin to the runner-up keeps the "too close" rule out of this.
    update({ label: "water", confidence, alternatives: candidates(["water", confidence], ["book", 0]) });
    const now = shown(app);
    assert.equal(now.stage, level, `stage state at ${confidence}`);
    assert.equal(now.ring, `confidence-ring ${level}`, `ring at ${confidence}`);
    assert.equal(now.decision, decision, `decision at ${confidence}`);
    assert.equal(now.kind, "word");
  }
  // A confidence a letter would call unsure is confident for a word.
  update({ label: "water", confidence: UNKNOWN_THRESHOLD, alternatives: candidates(["water", UNKNOWN_THRESHOLD]) });
  assert.equal(shown(app).stage, "good");
});

test("a word whose runner-up is within three points is called too close", async () => {
  const app = await bootedApp();
  app.get("setMode")("word");
  const update = app.get("updatePrediction");

  update({ label: "water", confidence: 0.5, alternatives: candidates(["water", 0.5], ["book", 0.49]) });
  assert.equal(shown(app).decision, "Çok yakın");
  assert.equal(shown(app).stage, "good", "closeness changes the decision word, not the band");

  update({ label: "water", confidence: 0.5, alternatives: candidates(["water", 0.5], ["book", 0.4]) });
  assert.equal(shown(app).decision, "Emin");
});

// Top-3

test("each alternative is a ranked row with its label, a bar and a percentage", async () => {
  const app = await bootedApp();
  app.get("updatePrediction")({
    label: "A",
    confidence: 0.7,
    alternatives: candidates(["A", 0.7], ["B", 0.213], ["C", 0.05]),
  });

  const rows = app.evaluate("els.top3List").children;
  assert.equal(rows.length, 3);
  const read = (row) => {
    const [rank, label, bar, percent] = row.children;
    return [rank.textContent, label.textContent, bar.children[0].style.width, percent.textContent];
  };
  assert.deepEqual(rows.map(read), [
    ["1.", "A", "70%", "%70"],
    ["2.", "B", "21%", "%21"],
    ["3.", "C", "5%", "%5"],
  ]);
});

test("a bar never leaves its track, whatever number the model sent", async () => {
  const app = await bootedApp();
  app.get("updatePrediction")({
    label: "A",
    confidence: 0.9,
    alternatives: candidates(["A", 1.4], ["B", Number.NaN], ["C", -0.2], ["D", Infinity]),
  });

  const rows = app.evaluate("els.top3List").children;
  const widths = rows.map((row) => row.children[2].children[0].style.width);
  const labels = rows.map((row) => row.children[3].textContent);
  assert.deepEqual(widths, ["100%", "0%", "0%", "0%"]);
  assert.deepEqual(labels, ["%100", "%0", "%0", "%0"]);
});

test("without alternatives the list explains itself instead of showing a fake row", async () => {
  const app = await bootedApp();
  app.get("updatePrediction")({ label: "?", confidence: 0, alternatives: [] });

  const rows = app.evaluate("els.top3List").children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].textContent, "Kamera açılınca en olası sonuçlar burada görünür.");
});

// The stage around the camera

test("the empty stage gives way to the camera when it starts and returns when it stops", async () => {
  const camera = appWithFakeCamera();
  const { app } = camera;
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false, "a fresh page shows the empty stage");

  await app.get("toggleCamera")();
  await flush();
  assert.equal(app.evaluate("state.cameraOn"), true, "precondition: the fake camera was granted");
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), true, "the live video replaces the empty stage");
  assert.equal(app.evaluate("els.cameraToggle.textContent"), "Kamerayı kapat");

  app.get("toggleCamera")();
  assert.equal(app.evaluate("state.cameraOn"), false);
  assert.equal(app.evaluate("els.cameraEmpty.hidden"), false, "stopping brings the empty stage back");
  assert.equal(app.evaluate("els.cameraToggle.textContent"), "Kamerayı aç");
});

test("stopping the camera leaves the stage idle, not painted with the last result", async () => {
  const camera = appWithFakeCamera();
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  app.get("updatePrediction")({ label: "A", confidence: 0.9, alternatives: [] });
  assert.equal(shown(app).stage, "good", "precondition: the stage shows the result");

  app.get("toggleCamera")();

  assert.equal(shown(app).stage, "idle");
});

test("a recording that was running when the camera stops no longer paints the stage", async () => {
  const camera = appWithFakeCamera({ mode: "word" });
  const { app } = camera;
  await app.get("toggleCamera")();
  await flush();
  app.evaluate('state.wordState = "RECORDING";');
  app.get("updatePrediction")({ label: "water", confidence: 0.9, alternatives: [] });
  assert.equal(shown(app).stage, "recording", "precondition");

  app.get("toggleCamera")();
  app.get("updatePrediction")({ label: "water", confidence: 0.9, alternatives: [] });

  assert.equal(shown(app).stage, "good", "the stop cancelled the recording, so the band shows again");
});
