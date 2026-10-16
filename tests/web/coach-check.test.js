// What the coach counts as a correct letter, and what it shows while it decides.
//
// The coach compares the learner's hand with a target letter. The plate under
// the camera is where the learner looks, so it must show what the camera
// sees, never the target pretending to be a detection; the target has its
// own place in the coach card.
//
// Every test plays the app's own render loop with the fake camera, hand and
// letter model of helpers/coach-app.mjs, and acts through the coach's own
// buttons.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coachApp, flush } from "./helpers/coach-app.mjs";
import { WEB_DIR } from "./helpers/web-app-context.mjs";

const modeTab = (coach, mode) =>
  coach.app.evaluate(`document.querySelector('[data-ui="mode-tab"][data-mode="${mode}"]')`);

/** The coach with its camera on and a hand showing `letter`. */
async function coachSeeing(letter, confidence = 0.9) {
  const coach = await coachApp({ hash: "#coach" });
  await coach.startCamera();
  assert.equal(coach.app.evaluate("state.cameraOn"), true, "precondition: the camera started");
  coach.show(letter, confidence);
  await coach.play(400);
  return coach;
}

/** What the plate and the coach card show. */
function shown(coach) {
  return {
    glyph: coach.text("primaryPrediction"),
    decision: coach.text("decisionLabel"),
    percent: coach.text("confidenceText"),
    target: coach.text("coachTargetBig"),
  };
}

// The target is never a detection ---------------------------------------------

test("opening the coach shows its target in the coach card and nothing detected on the plate", async () => {
  const coach = await coachApp({ hash: "#letter" });

  coach.click(modeTab(coach, "coach"));

  const target = coach.app.evaluate("state.coachTarget");
  assert.equal(coach.app.evaluate("state.mode"), "coach", "precondition: the coach opened");
  assert.equal(shown(coach).target, target);
  assert.equal(shown(coach).glyph, "?", "the target must not appear as a detected letter");
  assert.equal(shown(coach).decision, "Bekleniyor");
  assert.equal(shown(coach).percent, "--");
});

test("the next target is shown as the target, and the plate waits for what the camera sees", async () => {
  // W is late in every order the coach uses, so it is never the next target.
  const coach = await coachSeeing("W");
  assert.equal(shown(coach).glyph, "W", "precondition: the plate shows the hand");
  const before = coach.app.evaluate("state.coachTarget");

  coach.click(coach.el("coachNextTarget"));

  const target = coach.app.evaluate("state.coachTarget");
  assert.notEqual(target, before, "precondition: the target moved on");
  assert.equal(shown(coach).target, target);
  assert.equal(shown(coach).glyph, "?", "the new target must not appear as a detected letter");
  assert.equal(shown(coach).percent, "--");

  await coach.play(400);
  assert.equal(shown(coach).glyph, "W", "the plate shows the hand again, not the target");
});

// A hand that leaves takes its letter with it ---------------------------------

/** The coach in practice with `target` chosen in the target list. */
async function practising(target) {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(coach.app.evaluate(`document.querySelector('[data-coach-flow="practice"]')`));
  const select = coach.el("coachTarget");
  select.value = target;
  select.dispatchEvent({ type: "change" });
  assert.equal(coach.app.evaluate("state.coachTarget"), target, "precondition: the target is chosen");
  await coach.startCamera();
  return coach;
}

/** The number of targets the coach card counts as done or scored. */
const scored = (coach) => Number(coach.text("coachScore").split("/")[0]);

test("a letter that has left the camera cannot be counted for the target", async () => {
  const coach = await practising("L");
  coach.show("L", 0.9);
  await coach.play(400);
  assert.equal(shown(coach).glyph, "L", "precondition: the plate shows the target letter");

  coach.hideHand();
  await coach.play(300);
  assert.equal(shown(coach).glyph, "?", "the plate no longer shows a letter nobody is holding");
  assert.equal(coach.text("confidenceMessage"), "Elinizi kadrajın ortasına getirin.");

  // Whatever could count it, pressed while no hand is in view.
  for (let press = 0; press < 3; press++) coach.click(coach.el("coachCheck"));
  await coach.play(2000);

  assert.equal(scored(coach), 0, "a letter nobody is holding was counted");
  assert.equal(coach.app.evaluate("state.coachStep"), 0);
});

test("on the letter screen the last letter stays when the hand leaves", async () => {
  // Owner decision: letter mode keeps its behaviour on hand loss (backlog
  // #29 is open); only the coach handles it.
  const coach = await coachApp({ hash: "#letter" });
  await coach.startCamera();
  coach.show("L", 0.9);
  await coach.play(400);

  coach.hideHand();
  await coach.play(300);

  assert.equal(shown(coach).glyph, "L");
  assert.equal(coach.app.evaluate("state.prediction"), "L");
});

// Holding is the check ---------------------------------------------------------

/** The quiz with its camera on, and the letter it asks for. */
async function quizzing() {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(coach.app.evaluate(`document.querySelector('[data-coach-flow="quiz"]')`));
  await coach.startCamera();
  assert.equal(coach.app.evaluate("state.coachFlow"), "quiz", "precondition: the quiz is on");
  return { coach, target: coach.app.evaluate("state.coachTarget"), holdMs: coach.app.evaluate("CONFIG.COACH_HOLD_MS") };
}

test("holding the target counts it once, however long it is held and however often the check is pressed", async () => {
  const { coach, target, holdMs } = await quizzing();

  coach.show(target, 0.9);
  await coach.play(holdMs + 400);
  assert.equal(scored(coach), 1, "a steady hold of the target counts");

  // Keep holding, and press the check on top.
  for (let press = 0; press < 5; press++) {
    coach.click(coach.el("coachCheck"));
    await coach.play(600);
  }
  assert.equal(scored(coach), 1, "one held pose was counted more than once");
});

test("the check counts nothing until the target has been held for the hold time", async () => {
  const { coach, target, holdMs } = await quizzing();

  coach.show(target, 0.9);
  await coach.play(300);
  for (let press = 0; press < 5; press++) coach.click(coach.el("coachCheck"));
  assert.equal(scored(coach), 0, "a press counted a letter that was not yet held");

  // A hold that ends early counts nothing either.
  await coach.play(holdMs - 600);
  coach.hideHand();
  await coach.play(1500);
  assert.equal(scored(coach), 0, "a hold shorter than the hold time counted");
});

test("a quiz question scores once, even when its letter is let go and held again", async () => {
  const { coach, target, holdMs } = await quizzing();
  const releaseMs = coach.app.evaluate("CONFIG.COACH_RELEASE_MS");

  coach.show(target, 0.9);
  await coach.play(holdMs + 200);
  assert.equal(scored(coach), 1, "precondition: the hold counted");

  // Let go long enough to release the hold, then hold the same letter again.
  coach.hideHand();
  await coach.play(releaseMs + 100);
  coach.show(target, 0.9);
  await coach.play(holdMs + 200);

  assert.equal(scored(coach), 1, "a second hold of the same question scored again");
});

test("the target shown below the confident threshold is never counted", async () => {
  const { coach, target } = await quizzing();
  const confident = coach.app.evaluate("CONFIG.CONFIDENT_THRESHOLD");

  coach.show(target, confident - 0.05);
  await coach.play(4000);

  assert.equal(scored(coach), 0, "an uncertain letter counted as held");
});

// The stage locks on a success, not on a confident letter ---------------------

/** Record the hold ring's --score, which the harness's style object drops. */
function recordRingScore(coach) {
  const scores = [];
  coach.el("confidenceRing").style.setProperty = (name, value) => {
    if (name === "--score") scores.push(Number(value));
  };
  return scores;
}

const stage = (coach) => coach.app.evaluate("els.cameraStage.dataset.state");

test("a confident wrong letter does not lock the stage; a completed hold of the target does", async () => {
  const coach = await practising("L");
  const holdMs = coach.app.evaluate("CONFIG.COACH_HOLD_MS");
  const ring = recordRingScore(coach);

  coach.show("K", 0.9);
  await coach.play(600);
  assert.equal(shown(coach).glyph, "K", "precondition: the plate shows the hand");
  assert.notEqual(stage(coach), "good", "a confident K locked the stage while the target is L");
  assert.equal(stage(coach), "maybe");
  assert.notEqual(shown(coach).decision, "Emin", "the coach judges the target, not the model's certainty");
  assert.equal(shown(coach).decision, "Hedef: L");
  assert.equal(ring.at(-1), 0, "nothing of the target is held");

  // The smoothing window needs about half a second to let go of the K.
  coach.show("L", 0.9);
  await coach.play(800);
  assert.equal(stage(coach), "maybe", "a hold in progress is not yet a success");
  assert.equal(shown(coach).decision, "Tutun…");
  assert.ok(ring.at(-1) > 0 && ring.at(-1) < 100, `the ring fills with the hold: ${ring.at(-1)}`);

  await coach.play(holdMs);
  assert.equal(stage(coach), "good", "a completed hold locks the stage");
  assert.equal(shown(coach).decision, "Doğru!");
  assert.equal(coach.text("confidenceMessage"), "L harfini net gösterdiniz.");
  assert.equal(ring.at(-1), 100);
});

test("with no hand in view the stage waits, whatever the last letter was", async () => {
  const coach = await practising("L");
  coach.show("K", 0.95);
  await coach.play(400);

  coach.hideHand();
  await coach.play(300);

  assert.equal(stage(coach), "low");
  assert.equal(shown(coach).decision, "Bekleniyor");
});

// A miss names what the camera sees and what tells it from the target ---------

const CURRICULUM = JSON.parse(readFileSync(join(WEB_DIR, "data", "letter_curriculum.json"), "utf8"));
const CONFUSION = JSON.parse(readFileSync(join(WEB_DIR, "data", "letter_confusion.json"), "utf8"));
const cueOf = (letter) => CURRICULUM.letters.find((entry) => entry.letter === letter).cue_tr;
const groupOf = (...letters) => CONFUSION.groups.find((group) => letters.every((l) => group.letters.includes(l)));

/** Practise `target` while the camera shows `seen` at `confidence` for `ms`. */
async function seeingInstead(target, seen, confidence, ms) {
  const coach = await practising(target);
  await flush();
  coach.show(seen, confidence);
  await coach.play(ms);
  return coach;
}

test("another letter held long enough is named, with the target's cue", async () => {
  const missMs = 1500;
  const early = await seeingInstead("L", "K", 0.7, missMs - 300);
  assert.equal(early.app.evaluate("CONFIG.COACH_MISS_MS"), missMs, "precondition: the spec's miss time");
  assert.equal(shown(early).decision, "Hedef: L", "the coach does not nag while the hand is still forming");

  const coach = await seeingInstead("L", "K", 0.7, missMs + 300);
  assert.equal(shown(coach).decision, "Henüz olmadı");
  assert.equal(stage(coach), "maybe", "a miss is a hint, not a red verdict");
  // No group holds both K and L, so the curriculum's cue for L is shown.
  assert.equal(groupOf("K", "L"), undefined, "precondition");
  assert.equal(coach.text("confidenceMessage"), `Şu an K görünüyor. L: ${cueOf("L")}`);
});

test("a look-alike of the target is named with what tells the two apart", async () => {
  const coach = await seeingInstead("T", "S", 0.9, 1800);

  const group = groupOf("S", "T");
  assert.equal(shown(coach).decision, "Henüz olmadı");
  assert.equal(coach.text("confidenceMessage"), `Şu an S görünüyor. ${group.reason_tr} T: ${group.cues.T}`);
});

test("the cue comes from the group the two letters share, not from another group of the target", async () => {
  // T is in two groups, with a different cue in each.
  const coach = await seeingInstead("T", "M", 0.9, 1800);

  const group = groupOf("M", "T");
  assert.notEqual(group.cues.T, groupOf("S", "T").cues.T, "precondition: the two cues differ");
  assert.equal(coach.text("confidenceMessage"), `Şu an M görünüyor. ${group.reason_tr} T: ${group.cues.T}`);
});

test("a hand the model cannot read is met with the framing tip", async () => {
  const unknown = 0.45;
  const coach = await seeingInstead("L", "K", unknown - 0.05, 1800);

  assert.equal(coach.app.evaluate("CONFIG.UNKNOWN_THRESHOLD"), unknown, "precondition");
  assert.equal(shown(coach).decision, "Henüz olmadı");
  assert.equal(
    coach.text("confidenceMessage"),
    "El şekli net seçilemedi. Kol boyu uzaklık, iyi ışık, eliniz kadrajın ortasında.",
  );
});

test("a miss is only a hint: holding the target afterwards still succeeds", async () => {
  const coach = await seeingInstead("L", "K", 0.9, 1800);
  assert.equal(shown(coach).decision, "Henüz olmadı", "precondition: the miss is shown");

  coach.show("L", 0.9);
  await coach.play(600 + coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 300);

  assert.equal(shown(coach).decision, "Doğru!");
});

test("after a miss, holding the target shows the hold, and the target near the hold is never a miss", async () => {
  const coach = await seeingInstead("L", "K", 0.9, 1800);
  assert.equal(shown(coach).decision, "Henüz olmadı", "precondition: the miss is shown");
  coach.show("L", 0.9);
  await coach.play(800);
  assert.equal(shown(coach).decision, "Tutun…", "the hold replaces the miss");

  const close = await seeingInstead("L", "L", 0.55, 2500);
  assert.equal(shown(close).decision, "Hedef: L", "the target below the hold confidence is close, not a miss");
});

test("a lost hand clears the miss", async () => {
  const coach = await seeingInstead("L", "K", 0.9, 1800);
  assert.equal(shown(coach).decision, "Henüz olmadı", "precondition: the miss is shown");

  coach.hideHand();
  await coach.play(300);
  assert.equal(coach.text("confidenceMessage"), "Elinizi kadrajın ortasına getirin.");

  // A new sighting of the other letter has to last the miss time again.
  coach.show("K", 0.9);
  await coach.play(600);
  assert.equal(shown(coach).decision, "Hedef: L");
});

// After a success the next target comes up on its own, unless the learner stays

/** Learning L, with the camera on, just after a counted hold of it. */
async function justSucceeded() {
  const coach = await coachApp({ hash: "#coach" });
  await flush();
  const select = coach.el("coachTarget");
  select.value = "L";
  select.dispatchEvent({ type: "change" });
  await coach.startCamera();
  coach.show("L", 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_HOLD_MS") + 300);
  assert.equal(shown(coach).decision, "Doğru!", "precondition: the hold counted");
  coach.hideHand();
  const order = CURRICULUM.suggested_order;
  return { coach, next: order[order.indexOf("L") + 1], advanceMs: coach.app.evaluate("CONFIG.COACH_ADVANCE_MS") };
}

test("after a success the next target comes up on its own, and says which it will be", async () => {
  const { coach, next, advanceMs } = await justSucceeded();
  assert.equal(coach.text("confidenceMessage"), `L harfini net gösterdiniz. Sıradaki: ${next}`);

  await coach.play(advanceMs - 300);
  assert.equal(shown(coach).target, "L", "the success stays up long enough to be seen");

  await coach.play(600);
  assert.equal(shown(coach).target, next);
  assert.equal(shown(coach).glyph, "?");
});

test("Escape keeps the target, and the plate says how to move on", async () => {
  const { coach, advanceMs } = await justSucceeded();

  coach.press("Escape");
  await coach.play(advanceMs + 1000);

  assert.equal(shown(coach).target, "L");
  assert.equal(shown(coach).decision, "Doğru!");
  assert.equal(coach.text("confidenceMessage"), "Hazır olduğunuzda Sonraki'ye basın.");
});

for (const [way, leave] of [
  ["stopping the camera", (coach) => coach.click(coach.el("coachStart"))],
  ["changing screen", (coach) => coach.click(modeTab(coach, "letter"))],
  ["the page going to the background", (coach) => {
    coach.app.evaluate("document").visibilityState = "hidden";
    coach.app.evaluate("document").dispatchEvent({ type: "visibilitychange" });
  }],
  ["moving focus into the coach's buttons", (coach) => coach.el("controlBar").dispatchEvent({ type: "focusin" })],
]) {
  test(`${way} stops the next target from coming up`, async () => {
    const { coach, advanceMs } = await justSucceeded();

    leave(coach);
    await coach.wait(advanceMs + 1000);

    assert.equal(coach.app.evaluate("state.coachTarget"), "L");
    assert.equal(coach.timers.size, 0, "a coach timer was left running");
  });
}
