// The coach in English, and a switch of language while it is on screen.
//
// The faults these tests kill:
// - Turkish left on an English visitor's coach, in any state the learner
//   meets (idle, a hand forming, a miss, a hint, a success and the wait for
//   the next letter, a quiz, word targets, storage that refuses), in text or
//   in the names a screen reader speaks;
// - English cues and look-alike reasons in the teaching data that are never
//   shown, the Turkish shown instead;
// - English counts and percentages in Turkish order ("%44"), or Turkish
//   words for the levels on the word screen's side cards;
// - a switch that leaves the coach's state in the old language, repeats a
//   verdict a screen reader has already spoken, or restarts the camera or the
//   attempt;
// - a switch back that does not give the same Turkish.
//
// The browser's languages, storage, the clock, the camera, MediaPipe and
// ONNX Runtime are faked at their boundaries (helpers/coach-app.mjs); the
// markup and the scripts are the app's own.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coachApp, flush, memoryStorage } from "./helpers/coach-app.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";
import { WEB_DIR, loadWebApp } from "./helpers/web-app-context.mjs";
import { recordWord, wordModeApp } from "./helpers/word-recording.mjs";

const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));
const CURRICULUM = readJson("data/letter_curriculum.json");
const CONFUSION = readJson("data/letter_confusion.json");
const STATS = readJson("data/per_word_stats.json");
const ENGLISH = ["en-US", "en"];
const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

const cueOf = (letter) => CURRICULUM.letters.find((entry) => entry.letter === letter);
const groupOf = (...letters) => CONFUSION.groups.find((group) => letters.every((l) => group.letters.includes(l)));

/** Everything the coach shows or names, wherever it sits on the page. */
const COACH_PARTS = [
  "coachTargetTile",
  "coachHint",
  "coachAdvance",
  "coachVerdict",
  "coachSession",
  "coachStudy",
  "decisionLabel",
  "confidenceMessage",
  "coachNextTarget",
  "coachHintButton",
  "coachRepeat",
  "coachNext",
  "coachCheck",
];

/**
 * Turkish in the coach's parts, hidden ones included. For a word target the
 * plate's headline is the word recording's, not the coach's, and is left out.
 */
const turkishInCoach = (coach, { wordTarget = false } = {}) =>
  COACH_PARTS.filter((id) => !(wordTarget && id === "decisionLabel")).flatMap((id) =>
    turkishLeft(coach.el(id), { includeHidden: true }),
  );

/** The coach opened by a visitor who chose English before. */
const englishCoach = (options = {}) => coachApp({ hash: "#coach", ...options, storage: memoryStorage({ "asl-lang": "en" }) });

const flowRadio = (coach, flow) => coach.app.evaluate(`document.querySelector('[data-coach-flow="${flow}"]')`);
const holdMs = (coach) => coach.app.evaluate("CONFIG.COACH_HOLD_MS");
const missing = (app) => [...app.get("I18N_PROBLEMS").missing];

/** Choose `target` in the coach's target list. */
function choose(coach, target) {
  const select = coach.el("coachTarget");
  select.value = target;
  select.dispatchEvent({ type: "change" });
  assert.equal(coach.app.evaluate("state.coachTarget"), target, "precondition: the target is chosen");
}

/** Practise `target` with the camera on while it sees `seen` long enough for a miss. */
async function practiseMissing(coach, target, seen, confidence = 0.9) {
  coach.click(flowRadio(coach, "practice"));
  choose(coach, target);
  await coach.startCamera();
  coach.show(seen, confidence);
  await coach.play(1800);
}

// An English visitor

test("an English visitor's idle coach is in English, with the first letter's English cue", async () => {
  const coach = await englishCoach();
  await flush();

  assert.deepEqual(turkishInCoach(coach), []);
  const target = coach.app.evaluate("state.coachTarget");
  assert.equal(coach.text("coachHint"), cueOf(target).cue_en);
  assert.equal(coach.text("decisionLabel"), "Waiting");
  assert.equal(coach.text("coachSessionLabel"), "Learn: in order");
  assert.equal(coach.el("coachProgress").getAttribute("aria-label"), "Session: 0 of 5 targets done");
  const current = [...coach.el("coachGrid").children].find((button) => button.dataset.letter === target);
  assert.equal(current.getAttribute("aria-label"), `${target}, current target`);
  assert.equal(coach.el("coachTarget").children[0].label, "Letter targets");
  assert.deepEqual(missing(coach.app), []);
});

test("a look-alike miss is explained with the group's English reason and cue", async () => {
  const coach = await englishCoach();
  await practiseMissing(coach, "T", "S");

  const group = groupOf("S", "T");
  assert.equal(coach.text("decisionLabel"), "Not yet");
  assert.equal(coach.text("confidenceMessage"), `The camera sees S. ${group.reason_en} T: ${group.cues_en.T}`);
  assert.equal(coach.text("coachVerdict"), `Not yet. The camera sees S. ${group.reason_en} T: ${group.cues_en.T}`);
  assert.equal(coach.text("coachSessionLabel"), "Practice: 5 reps");
  assert.deepEqual(turkishInCoach(coach), []);

  // The hint names the letter, its English cue and its look-alikes.
  coach.click(coach.el("coachHintButton"));
  assert.equal(
    coach.text("coachHint"),
    `Hint: T. ${cueOf("T").cue_en} Easy to mix up with ${cueOf("T").confusable_with.join(", ")}.`,
  );
  assert.deepEqual(turkishInCoach(coach), []);
  assert.deepEqual(missing(coach.app), []);
});

test("a miss outside any group, and a hand the model cannot read, are in English", async () => {
  const coach = await englishCoach();
  await practiseMissing(coach, "L", "K");
  assert.equal(coach.text("confidenceMessage"), `The camera sees K. L: ${cueOf("L").cue_en}`);

  const unsure = await englishCoach();
  await practiseMissing(unsure, "L", "K", 0.4);
  assert.equal(
    unsure.text("confidenceMessage"),
    "Your handshape isn't clear yet. Stay an arm's length away, in good light, with your hand in the middle of the frame.",
  );
  assert.deepEqual(turkishInCoach(unsure), []);
});

test("a hand forming, a hold, a success, the wait and staying are in English", async () => {
  const coach = await englishCoach();
  await flush();
  choose(coach, "L");
  await coach.startCamera();
  coach.show("L", 0.5);
  await coach.play(300);
  assert.equal(coach.text("decisionLabel"), "Target: L");
  assert.equal(coach.text("confidenceMessage"), "It's checked on its own when the ring fills.");

  coach.hideHand();
  await coach.play(200);
  assert.equal(coach.text("decisionLabel"), "Waiting");
  assert.equal(coach.text("confidenceMessage"), "Bring your hand to the middle of the frame.");

  coach.show("L", 0.9);
  await coach.play(300);
  assert.equal(coach.text("decisionLabel"), "Hold it…");
  assert.deepEqual(turkishInCoach(coach), []);

  await coach.play(holdMs(coach));
  const next = coach.app.evaluate("_nextCoachLetter()");
  assert.equal(coach.text("decisionLabel"), "Correct!");
  assert.equal(coach.text("confidenceMessage"), `You signed L clearly. Next up: ${next}`);
  assert.equal(coach.el("coachAdvance").hidden, false, "precondition: the wait for the next letter shows");
  assert.deepEqual(turkishInCoach(coach), []);

  coach.press("Escape");
  assert.equal(coach.text("confidenceMessage"), "Press Next when you're ready.");
  assert.equal(coach.text("coachNext").trim().startsWith("Next"), true);
  assert.deepEqual(turkishInCoach(coach), []);
  assert.deepEqual(missing(coach.app), []);
});

test("a quiz, word targets and a word checked before the camera are in English", async () => {
  const coach = await englishCoach();
  await flush();
  coach.click(flowRadio(coach, "quiz"));
  assert.equal(coach.text("coachSessionLabel"), `Quiz: ${coach.app.evaluate("state.quizTotal")} questions`);
  assert.equal(coach.el("coachGridNote").hidden, false, "precondition: the quiz note shows");
  assert.deepEqual(turkishInCoach(coach), []);

  coach.click(coach.el("coachWordsOnly"));
  const options = coach.el("coachTarget").children[0];
  assert.equal(options.label, "Word targets");
  const levels = new Set([...options.children].map((option) => /\((.+)\)$/.exec(option.textContent)[1]));
  assert.deepEqual([...levels].sort(), ["easy", "medium", "tricky"]);
  assert.equal(
    coach.text("coachHint"),
    "Target word: water. Finish the sign in 3 to 5 seconds. Keep your hands, face and shoulders in the frame.",
  );

  coach.click(coach.el("coachCheck"));
  assert.equal(coach.text("confidenceMessage"), "Start the session first.");
  assert.deepEqual(turkishInCoach(coach, { wordTarget: true }), []);
  assert.deepEqual(missing(coach.app), []);
});

test("a word recording's verdict is in English", async () => {
  for (const [winner, verdict] of [
    ["water", "It's a match. Your movement and framing look good."],
    ["book", "That didn't match the target. Sign more slowly, and keep your face and shoulders in view."],
  ]) {
    const { app } = wordModeApp({ winner });
    app.get("setLanguage")("en");
    app.evaluate(`state.mode = "coach"; state.coachTargetType = "word"; state.coachTarget = "water";`);
    await recordWord(app);
    assert.equal(app.evaluate('document.getElementById("coachHint").textContent'), verdict, winner);
  }
});

test("storage that refuses the progress is explained in English, and so is a reset", async () => {
  const refusing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {},
  };
  const coach = await coachApp({
    hash: "#coach",
    storage: refusing,
    globals: { navigator: { languages: ENGLISH, language: "en-US" } },
  });
  await flush();
  assert.equal(
    coach.text("coachStorageNote"),
    "This browser can't save your progress; it resets when you close the page.",
  );

  coach.click(coach.el("coachReset"));
  assert.equal(coach.text("toastText"), "Progress reset");
  assert.equal(coach.text("toastAction").trim(), "Undo");
  assert.deepEqual(turkishInCoach(coach), []);
});

test("a reset toast on screen is redrawn by a switch, and its Undo still brings the progress back", async () => {
  const progress = JSON.stringify({ v: 1, flow: "learn", letters: { A: { ok: 2, hint: 0, skip: 0 } } });
  const storage = memoryStorage({ "asl-coach-v1": progress });
  const coach = await coachApp({ hash: "#coach", storage });
  await flush();
  coach.click(coach.el("coachReset"));
  assert.equal(coach.text("toastText"), "İlerleme sıfırlandı", "precondition: the reset toast shows");
  assert.notEqual(storage.getItem("asl-coach-v1"), progress, "precondition: the progress was reset");

  coach.app.get("setLanguage")("en");
  assert.equal(coach.text("toastText"), "Progress reset");
  assert.equal(coach.text("toastAction").trim(), "Undo");
  assert.equal(coach.el("toast").hidden, false, "the toast is still there to undo with");

  coach.el("toastAction").onclick();
  assert.equal(storage.getItem("asl-coach-v1"), progress, "Undo restores the progress after the switch");
});

test("the study sheet opened on a phone is named in English, and renamed by a switch", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(coach.el("coachSessionButton"));
  assert.equal(coach.el("coachStudy").getAttribute("aria-label"), "Çalışma", "precondition: the sheet is open");

  coach.app.get("setLanguage")("en");
  assert.equal(coach.el("coachStudy").getAttribute("aria-label"), "Study");
});

// A switch while the coach is on screen

test("a switch mid-miss redraws the coach, keeps the camera and the attempt, and says no verdict twice", async () => {
  const coach = await coachApp({ hash: "#coach" });
  await practiseMissing(coach, "T", "S");
  const turkish = {
    decision: coach.text("decisionLabel"),
    message: coach.text("confidenceMessage"),
    session: coach.text("coachSessionLabel"),
    hint: coach.text("coachHint"),
  };
  assert.equal(turkish.decision, "Henüz olmadı", "precondition: the miss is shown");
  assert.notEqual(coach.text("coachVerdict"), "", "precondition: the verdict was spoken");
  const runs = coach.ortCalls.letterRuns;

  coach.app.get("setLanguage")("en");
  await coach.play(200);

  const group = groupOf("S", "T");
  assert.equal(coach.text("decisionLabel"), "Not yet");
  assert.equal(coach.text("confidenceMessage"), `The camera sees S. ${group.reason_en} T: ${group.cues_en.T}`);
  assert.equal(coach.text("coachSessionLabel"), "Practice: 5 reps");
  assert.equal(coach.text("coachVerdict"), "", "a verdict already spoken is not spoken again");
  assert.deepEqual(turkishInCoach(coach), []);
  assert.equal(coach.app.evaluate("state.cameraOn"), true);
  assert.equal(coach.tracks.length, 1, "the camera was not started again");
  assert.equal(coach.tracks[0].stops, 0, "the camera was not stopped");
  assert.ok(coach.ortCalls.letterRuns > runs, "the letter model keeps reading the hand");

  coach.app.get("setLanguage")("tr");
  await coach.play(100);
  assert.deepEqual(
    {
      decision: coach.text("decisionLabel"),
      message: coach.text("confidenceMessage"),
      session: coach.text("coachSessionLabel"),
      hint: coach.text("coachHint"),
    },
    turkish,
    "a switch back gives the same Turkish",
  );
  assert.equal(coach.text("coachVerdict"), "", "nor is it spoken again in Turkish");

  // The attempt went on: holding the target now succeeds, and that is said.
  coach.show("T", 0.9);
  await coach.play(holdMs(coach) + 900);
  assert.equal(coach.text("decisionLabel"), "Doğru!");
  assert.match(coach.text("coachVerdict"), /^Doğru! T harfini net gösterdiniz\./);
  assert.equal(coach.text("coachScore"), "1/5");
});

test("a switch redraws a success's feedback and a word checked before the camera", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(flowRadio(coach, "practice"));
  choose(coach, "L");
  await coach.startCamera();
  coach.show("L", 0.9);
  await coach.play(holdMs(coach) + 300);
  assert.equal(coach.text("coachHint"), "Doğru! L harfini net gösterdiniz.", "precondition: the feedback shows");

  coach.app.get("setLanguage")("en");
  assert.equal(coach.text("coachHint"), "Correct! You signed L clearly.");
  assert.deepEqual(turkishInCoach(coach), []);

  const words = await coachApp({ hash: "#coach" });
  words.click(words.el("coachWordsOnly"));
  words.click(words.el("coachCheck"));
  assert.equal(words.text("confidenceMessage"), "Önce çalışmayı başlatın.", "precondition");
  words.app.get("setLanguage")("en");
  assert.equal(words.text("confidenceMessage"), "Start the session first.");
  assert.equal(words.el("coachTarget").children[0].label, "Word targets");
  assert.deepEqual(turkishInCoach(words, { wordTarget: true }), []);
});

// The word screen's side cards

/** The word screen booted with `options` for loadWebApp(). */
async function wordScreen(options = {}) {
  const app = loadWebApp({
    boot: true,
    ...options,
    globals: { console: quietConsole, location: new URL("https://asl-assistant.pages.dev/#word") },
  });
  await app.ready;
  return app;
}

const read = (app, expression) => JSON.parse(app.evaluate(`JSON.stringify(${expression})`));
const hintOf = (app, word) =>
  app.evaluate(`document.querySelector('#wordLibraryGroups [data-word="${word}"] .word-entry__hint').textContent`);
const sideCardParts = (app) => [
  app.evaluate('document.getElementById("wordDemoCount")'),
  ...app.evaluate('[...document.querySelectorAll(".word-entry__hint, #wordConfusionList .visually-hidden")]'),
];

test("the word side cards count, rate and pair words in English, percent after the number", async () => {
  const app = await wordScreen({ languages: ENGLISH });
  const labels = { easy: "easy", medium: "medium", hard: "hard" };

  assert.equal(hintOf(app, "all"), "hard · 44%");
  for (const [word, stat] of Object.entries(STATS)) {
    assert.equal(hintOf(app, word), `${labels[stat.difficulty]} · ${Math.round(stat.accuracy * 100)}%`, word);
  }
  const easy = read(app, 'document.getElementById("wordDemoList").children.length');
  assert.equal(app.evaluate('document.getElementById("wordDemoCount").textContent'), `${easy} easy words`);
  assert.deepEqual(
    [...new Set(read(app, '[...document.querySelectorAll("#wordConfusionList .visually-hidden")].map((s) => s.textContent)'))],
    [" and "],
  );
  for (const part of sideCardParts(app)) assert.deepEqual(turkishLeft(part), []);
  assert.deepEqual(missing(app), []);
});

test("a switch rewrites the word side cards and a switch back restores the Turkish", async () => {
  const app = await wordScreen();
  assert.equal(hintOf(app, "all"), "zor · %44", "precondition");
  const turkishCount = app.evaluate('document.getElementById("wordDemoCount").textContent');

  app.get("setLanguage")("en");
  assert.equal(hintOf(app, "all"), "hard · 44%");
  assert.match(app.evaluate('document.getElementById("wordDemoCount").textContent'), /^\d+ easy words$/);

  app.get("setLanguage")("tr");
  assert.equal(hintOf(app, "all"), "zor · %44");
  assert.equal(app.evaluate('document.getElementById("wordDemoCount").textContent'), turkishCount);
});

/** fetch() serving asl-web/ from disk, with the word glosses marked reviewed. */
async function fetchWithReviewedGlosses(input) {
  const path = decodeURIComponent(new URL(String(input), "https://asl-assistant.pages.dev/").pathname);
  let body;
  if (path.endsWith("/word_reference.json")) {
    body = JSON.stringify({ ...readJson("data/word_reference.json"), gloss_reviewed: true });
  } else {
    try {
      body = readFileSync(join(WEB_DIR, path), "utf8");
    } catch {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
  }
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
}

test("a reviewed Turkish gloss is left off an English reader's word list, and comes back in Turkish", async () => {
  const app = loadWebApp({
    boot: true,
    languages: ENGLISH,
    globals: {
      console: quietConsole,
      location: new URL("https://asl-assistant.pages.dev/#word"),
      fetch: fetchWithReviewedGlosses,
    },
  });
  await app.ready;
  const gloss = () =>
    app.evaluate(`document.querySelector('#wordLibraryGroups [data-word="bird"] .word-entry__gloss')?.textContent ?? null`);

  assert.equal(gloss(), null);
  app.get("setLanguage")("tr");
  assert.equal(gloss(), " (kuş)", "the Turkish reader sees the gloss");
  app.get("setLanguage")("en");
  assert.equal(gloss(), null);
});
