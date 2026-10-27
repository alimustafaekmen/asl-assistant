// The coach screen's controls: what each one does when it is pressed, and what
// assistive technology is told about it.
//
// The document is the real index.html, so a control that is missing from the
// markup, or present and wired to nothing, fails here. Every test acts through
// the coach's own controls with the fake camera, hand and letter model of
// helpers/coach-app.mjs, and reads what the controls then show.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp } from "./helpers/coach-app.mjs";

const grid = (coach) => coach.el("coachGrid").children;
const gridButton = (coach, letter) => [...grid(coach)].find((button) => button.dataset.letter === letter);
const flowRadio = (coach, flow) =>
  coach.app.evaluate(`document.querySelector('[data-coach-flow="${flow}"]')`);
const holdMs = (coach) => coach.app.evaluate("CONFIG.COACH_HOLD_MS");

/** The coach with its camera on and the target shown correctly, just counted. */
async function justSucceeded(coach, target = "L") {
  const select = coach.el("coachTarget");
  select.value = target;
  select.dispatchEvent({ type: "change" });
  await coach.startCamera();
  coach.show(target, 0.9);
  await coach.play(holdMs(coach) + 300);
  assert.equal(coach.text("decisionLabel"), "Doğru!", "precondition: the hold counted");
}

// The target tile

test("the target tile shows the target, and a new target replaces it", async () => {
  const coach = await coachApp({ hash: "#coach" });
  const tile = coach.el("coachTargetTile");
  assert.ok(tile, "the coach has a target tile");
  assert.equal(coach.el("coachTargetGlyph").getAttribute("lang"), "en", "a letter is read as English");

  coach.click(gridButton(coach, "K"));

  assert.equal(coach.text("coachTargetGlyph"), "K");
  assert.equal(coach.app.evaluate("state.coachTarget"), "K");
});

test("the reference button on the tile opens the reference image full screen", async () => {
  const coach = await coachApp({ hash: "#coach" });
  // The viewer is a native modal dialog; the stub DOM has no dialog API, so
  // it is faked at that browser boundary.
  coach.app.evaluate(`
    const dialog = document.getElementById("lightbox");
    dialog.showModal = () => dialog.setAttribute("open", "");
    dialog.close = () => dialog.removeAttribute("open");
  `);
  const lightbox = coach.el("lightbox");
  assert.equal(lightbox.hasAttribute("open"), false, "precondition: the viewer is closed");

  coach.click(coach.el("coachReference"));

  assert.equal(lightbox.hasAttribute("open"), true);
});

// The letter grid

test("the grid has one button per letter, and exactly one is the current target", async () => {
  const coach = await coachApp({ hash: "#coach" });
  const letters = coach.app.evaluate("LETTERS");

  assert.deepEqual([...grid(coach)].map((button) => button.textContent), [...letters]);
  const current = () => [...grid(coach)].filter((button) => button.getAttribute("aria-current") === "true");
  assert.equal(current().length, 1);
  assert.equal(current()[0].dataset.letter, coach.app.evaluate("state.coachTarget"));
  assert.match(current()[0].getAttribute("aria-label"), /^[A-Z], şimdiki hedef$/);

  coach.click(gridButton(coach, "W"));
  assert.equal(current().length, 1, "the old current mark was left behind");
  assert.equal(current()[0].dataset.letter, "W");
});

test("a letter shown correctly is labelled as done, and the others are plain", async () => {
  const coach = await coachApp({ hash: "#coach" });
  await justSucceeded(coach, "L");
  coach.click(gridButton(coach, "B"));

  assert.equal(gridButton(coach, "L").getAttribute("aria-label"), "L, tamamlandı");
  assert.equal(gridButton(coach, "L").dataset.state, "done");
  assert.equal(gridButton(coach, "M").getAttribute("aria-label"), "M");
  assert.equal(gridButton(coach, "M").dataset.state, "todo");
  assert.equal(coach.text("coachDone"), "1/24");
});

test("rebuilding the grid does not add buttons", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.app.evaluate("buildCoachGrid(); buildCoachGrid();");
  assert.equal(grid(coach).length, coach.app.evaluate("LETTERS.length"));
});

test("a quiz does not let the learner pick a letter", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(flowRadio(coach, "quiz"));
  const before = coach.app.evaluate("state.coachTarget");

  assert.equal(coach.el("coachGrid").getAttribute("aria-disabled"), "true");
  assert.equal(coach.text("coachGridNote"), "Sınav sırasında harf seçilemez.");
  assert.equal(coach.el("coachGridNote").hidden, false, "the grid says why it takes no pick");
  coach.click(gridButton(coach, before === "W" ? "B" : "W"));

  assert.equal(coach.app.evaluate("state.coachTarget"), before);
});

// Radios

test("the flow radios say which flow is on, and only that one is in the tab order", async () => {
  const coach = await coachApp({ hash: "#coach" });
  for (const flow of ["learn", "practice", "quiz"]) {
    coach.click(flowRadio(coach, flow));
    for (const other of ["learn", "practice", "quiz"]) {
      const radio = flowRadio(coach, other);
      assert.equal(radio.getAttribute("role"), "radio");
      assert.equal(radio.getAttribute("aria-checked"), String(other === flow), `${other} while ${flow}`);
      assert.equal(radio.getAttribute("tabindex"), other === flow ? "0" : "-1");
    }
  }
});

test("an arrow key moves the flow to the next radio", async () => {
  const coach = await coachApp({ hash: "#coach" });
  const group = coach.el("coachFlowGroup");
  assert.equal(group.getAttribute("role"), "radiogroup");

  group.dispatchEvent({ type: "keydown", key: "ArrowRight", target: flowRadio(coach, "learn"), preventDefault() {} });

  assert.equal(coach.app.evaluate("state.coachFlow"), "practice");
});

test("the content radios switch between letters and words, and each shows its own picker", async () => {
  const coach = await coachApp({ hash: "#coach" });
  assert.equal(coach.el("coachLettersOnly").getAttribute("aria-checked"), "true");
  assert.equal(coach.el("coachLetterPicker").hidden, false);
  assert.equal(coach.el("coachWordPicker").hidden, true);

  coach.click(coach.el("coachWordsOnly"));

  assert.equal(coach.el("coachWordsOnly").getAttribute("aria-checked"), "true");
  assert.equal(coach.el("coachLettersOnly").getAttribute("aria-checked"), "false");
  assert.equal(coach.el("coachLetterPicker").hidden, true);
  assert.equal(coach.el("coachWordPicker").hidden, false);
  assert.equal(coach.el("coachCheck").hidden, false, "a word is checked with the button");
  assert.equal(coach.el("coachCheck").disabled, false);
});

// Session dots

test("the dots say how far the session has got", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(flowRadio(coach, "practice"));
  const dots = coach.el("coachProgress");
  const goal = coach.app.evaluate("state.coachGoal");
  assert.equal(dots.getAttribute("role"), "img");
  assert.equal(dots.getAttribute("aria-label"), `Oturum: ${goal} hedeften 0 tamamlandı`);

  await justSucceeded(coach, "L");

  assert.equal(dots.getAttribute("aria-label"), `Oturum: ${goal} hedeften 1 tamamlandı`);
  assert.equal(coach.text("coachScore"), `1/${goal}`);
});

// The verdict

test("the verdict is a status region that is written when the phase changes, not on every tick", async () => {
  const coach = await coachApp({ hash: "#coach" });
  const verdict = coach.el("coachVerdict");
  assert.equal(verdict.getAttribute("role"), "status");
  assert.equal(verdict.getAttribute("aria-atomic"), "true");
  coach.app.evaluate(`(() => {
    const el = document.getElementById("coachVerdict");
    let text = el.textContent;
    globalThis.__verdictWrites = 0;
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get: () => text,
      set: (value) => { text = value; globalThis.__verdictWrites += 1; },
    });
  })()`);

  await justSucceeded(coach, "L");
  coach.hideHand();
  const written = coach.app.evaluate("__verdictWrites");
  await coach.play(10 * 120);

  assert.match(verdict.textContent, /^Doğru!/);
  assert.equal(coach.app.evaluate("__verdictWrites"), written, "the verdict was written again with nothing new to say");
});

test("success says so to a screen reader, and a miss names what is seen", async () => {
  const coach = await coachApp({ hash: "#coach" });
  assert.equal(coach.el("coachVerdict").textContent, "", "nothing to say before the camera");

  await justSucceeded(coach, "L");
  assert.ok(coach.text("coachVerdict").includes("L harfini net gösterdiniz."), coach.text("coachVerdict"));

  coach.click(gridButton(coach, "T"));
  coach.show("S", 0.9);
  await coach.play(coach.app.evaluate("CONFIG.COACH_MISS_MS") + 600);
  assert.ok(coach.text("coachVerdict").startsWith("Henüz olmadı."), coach.text("coachVerdict"));
  assert.ok(coach.text("coachVerdict").includes("Şu an S görünüyor."), coach.text("coachVerdict"));

  coach.show("T", 0.9);
  await coach.play(800);
  assert.equal(coach.text("coachVerdict"), "", "the verdict goes when the phase that it describes does");
});

// Staying, repeating and moving on

test("while the next target is coming up, Burada kal is on offer, and pressing it stays", async () => {
  const coach = await coachApp({ hash: "#coach" });
  assert.equal(coach.el("coachAdvance").hidden, true, "no wait to stay from before a success");
  await justSucceeded(coach, "L");
  coach.hideHand();

  assert.equal(coach.el("coachAdvance").hidden, false);
  assert.equal(coach.el("coachStay").textContent, "Burada kal");
  assert.equal(coach.el("coachAdvanceBar").getAttribute("role"), "progressbar");
  coach.click(coach.el("coachStay"));
  await coach.play(coach.app.evaluate("CONFIG.COACH_ADVANCE_MS") + 1000);

  assert.equal(coach.app.evaluate("state.coachTarget"), "L");
  assert.equal(coach.el("coachAdvance").hidden, true, "the wait is over, so its bar goes");
});

test("Sonraki moves to the next letter, and Tekrar keeps the letter and stops the wait", async () => {
  const next = await coachApp({ hash: "#coach" });
  await justSucceeded(next, "L");
  const advancing = next.app.evaluate("state.coach.advancing");
  assert.equal(advancing, true, "precondition: the next target is on its way");
  assert.equal(next.el("coachNext").hidden, false);
  assert.equal(next.el("coachHintButton").hidden, true, "the hint is for a letter not yet shown");
  next.click(next.el("coachNext"));
  assert.notEqual(next.app.evaluate("state.coachTarget"), "L");

  const again = await coachApp({ hash: "#coach" });
  await justSucceeded(again, "L");
  again.hideHand();
  again.click(again.el("coachRepeat"));
  await again.play(again.app.evaluate("CONFIG.COACH_ADVANCE_MS") + 1000);
  assert.equal(again.app.evaluate("state.coachTarget"), "L");
  assert.equal(again.app.evaluate("state.coach.advancing"), false);
});

test("Atla moves on, and Ipucu opens the hint, which a quiz has none of", async () => {
  const coach = await coachApp({ hash: "#coach" });
  coach.click(flowRadio(coach, "practice"));
  const first = coach.app.evaluate("state.coachTarget");

  coach.click(coach.el("coachHintButton"));
  assert.ok(coach.text("coachHint").startsWith(`İpucu: ${first}.`), coach.text("coachHint"));
  assert.equal(coach.el("coachHint").hidden, false);

  coach.click(coach.el("coachNextTarget"));
  assert.notEqual(coach.app.evaluate("state.coachTarget"), first);

  coach.click(flowRadio(coach, "quiz"));
  assert.equal(coach.el("coachHintButton").disabled, true);
});

test("the check button is for words: a letter has none", async () => {
  const coach = await coachApp({ hash: "#coach" });
  assert.equal(coach.el("coachCheck").hidden, true);
  assert.equal(coach.el("coachCheck").disabled, true);
});

// Progress

test("resetting progress from the grid card clears the letters and offers an undo", async () => {
  const coach = await coachApp({ hash: "#coach" });
  await justSucceeded(coach, "L");
  assert.equal(coach.text("coachDone"), "1/24", "precondition: a letter is done");

  coach.click(coach.el("coachReset"));

  assert.equal(coach.text("coachDone"), "0/24");
  assert.equal(coach.text("toastText"), "İlerleme sıfırlandı");
  // The toast binds its action as onclick, which the harness's dispatch does not run.
  coach.app.evaluate("els.toastAction.onclick()");
  assert.equal(coach.text("coachDone"), "1/24");
});

test("the note says where progress is kept, or that it cannot be", async () => {
  const kept = await coachApp({ hash: "#coach" });
  assert.equal(kept.text("coachStorageNote"), "İlerlemeniz yalnızca bu cihazda saklanır, kimseyle paylaşılmaz.");

  const refusing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  const lost = await coachApp({ hash: "#coach", storage: refusing });
  assert.equal(lost.text("coachStorageNote"), "İlerleme bu tarayıcıda saklanamıyor; sayfayı kapatınca sıfırlanır.");
});

// The camera

test("the camera is started by the stage button and stopped by the shared toggle", async () => {
  const coach = await coachApp({ hash: "#coach" });
  await coach.startCamera();
  assert.equal(coach.app.evaluate("state.cameraOn"), true);

  coach.click(coach.el("cameraToggle"));
  await coach.play(100);

  assert.equal(coach.app.evaluate("state.cameraOn"), false);
});

test("what the coach screen leaves out is the coach's own markup, not the camera's", async () => {
  const coach = await coachApp({ hash: "#coach" });
  // The mode rule hides a part from a mode unless the part names that mode.
  const shownInCoach = (id) => {
    const classes = coach.el(id).className.split(/\s+/);
    return !classes.includes("mode-only") || classes.includes("coach-only");
  };
  for (const id of ["cameraToggle", "coachTargetTile", "coachVerdict", "coachHintButton", "coachNext"]) {
    assert.ok(shownInCoach(id), `${id} must be shown in the coach`);
  }
  for (const id of ["coachStart", "coachVideoLink"]) {
    assert.equal(coach.el(id), null, `${id} was replaced by the stage buttons and the reference tile`);
  }
});

test("Space on the dock takes what the coach offers: the next letter after a success", async () => {
  const coach = await coachApp({ hash: "#coach" });
  await justSucceeded(coach, "L");

  coach.press(" ");

  assert.notEqual(coach.app.evaluate("state.coachTarget"), "L");
});
