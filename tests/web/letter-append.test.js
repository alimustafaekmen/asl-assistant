// Which letters the keyboard may add to the transcript, and when.
//
// Space adds the letter on the stage, but only a letter the model is sure of:
// the "no result" mark, a word, or a guess below the letter threshold never
// reaches the text. A key held down repeats, and one press must add one letter.
// The transcript keys (Space, Enter, Backspace) act in letter mode only; on
// every other screen they belong to the page, so they neither edit the text
// nor have their default action cancelled. In letter mode Space and Backspace
// must have their default action cancelled, or the page scrolls and, in older
// browsers, goes back.
//
// The key goes in through the keydown handler the app binds on window. The
// clock is the only thing faked, for the repeat window; the prediction enters
// through updatePrediction(), the one place a model result reaches the UI.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const KEY_CODES = { " ": "Space", Enter: "Enter", Backspace: "Backspace" };

/** The booted app, a clock the test sets, and a way to press keys. */
async function bootedApp() {
  const clock = { now: 0 };
  const app = loadWebApp({
    boot: true,
    globals: {
      console: { ...console, log() {}, warn() {} },
      performance: { now: () => clock.now },
    },
  });
  await app.ready;
  const onKeyDown = app.windowHandler("keydown");
  assert.ok(onKeyDown, "init() must bind the keyboard map");
  const page = app.makeTarget({ tagName: "DIV" });

  /**
   * Press a key and report whether the app cancelled its default action.
   *
   * @param {string} key
   * @param {Record<string, boolean>} [modifiers]
   */
  const press = (key, modifiers = {}) => {
    let prevented = 0;
    onKeyDown({
      key,
      code: KEY_CODES[key] ?? `Key${key.toUpperCase()}`,
      target: page,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
      preventDefault: () => (prevented += 1),
    });
    return prevented;
  };
  const transcript = () => app.evaluate("state.transcript");
  /** Show a model result on the stage. */
  const show = (label, confidence) =>
    app.get("updatePrediction")({ label, confidence, alternatives: [{ label, confidence }] });
  return { app, clock, press, transcript, show };
}

test("a letter just below the threshold is not added, one at the threshold is", async () => {
  const { app, press, transcript, show } = await bootedApp();
  const threshold = app.evaluate("CONFIG.LETTER_THRESHOLD");

  show("A", threshold - 0.001);
  press(" ");
  assert.equal(transcript(), "", "a guess below the threshold must not reach the text");

  show("A", threshold);
  press(" ");
  assert.equal(transcript(), "A");
});

test("a letter the stage calls uncertain is never added", async () => {
  // The bar for adding a letter may be tuned, but it can never sit below the
  // point where the plate itself says the model is not sure.
  const { app, press, transcript, show } = await bootedApp();
  const uncertain = app.evaluate("CONFIG.UNKNOWN_THRESHOLD") - 0.001;

  show("A", uncertain);
  assert.equal(app.evaluate("els.decisionLabel.textContent"), "Emin değil", "precondition");
  press(" ");

  assert.equal(transcript(), "");
});

test("the Add button follows the same rules as Space, and only on the letter screen", async () => {
  const { app, press, transcript, show } = await bootedApp();
  const add = () => app.evaluate("els.manualAddLetter").dispatchEvent({ type: "click", detail: 1 });
  const threshold = app.evaluate("CONFIG.LETTER_THRESHOLD");

  show("A", threshold - 0.001);
  add();
  assert.equal(transcript(), "", "below the threshold");

  show("A", 0.95);
  add();
  assert.equal(transcript(), "A");

  app.get("setMode")("word");
  show("B", 0.95);
  add();
  press(" ");
  assert.equal(transcript(), "A", "a click that reaches the button outside letter mode adds nothing");
});

test("the no-result mark and a word are never added by Space", async () => {
  const { press, transcript, show } = await bootedApp();

  show("?", 0.99);
  press(" ");
  show("HELLO", 0.99);
  press(" ");

  assert.equal(transcript(), "");
});

test("a held Space adds one letter, the next press after the repeat window adds another", async () => {
  const { clock, press, transcript, show } = await bootedApp();
  show("A", 0.95);

  for (const now of [0, 30, 60, 200]) {
    clock.now = now;
    press(" ");
  }
  assert.equal(transcript(), "A", "key repeat inside the window must not add the letter again");

  clock.now = 300;
  press(" ");
  assert.equal(transcript(), "AA");
});

test("a different letter pressed straight after is not taken for a repeat", async () => {
  const { clock, press, transcript, show } = await bootedApp();

  clock.now = 0;
  show("A", 0.95);
  press(" ");
  clock.now = 30;
  show("B", 0.95);
  press(" ");

  assert.equal(transcript(), "AB");
});

test("an added letter is announced, a repeat of it is not announced again", async () => {
  const { app, clock, press, show } = await bootedApp();

  clock.now = 0;
  show("A", 0.95);
  press(" ");
  assert.equal(app.evaluate("els.announcer.textContent"), "A eklendi");

  app.evaluate('els.announcer.textContent = ""');
  clock.now = 30;
  press(" ");
  assert.equal(app.evaluate("els.announcer.textContent"), "", "a suppressed repeat must stay silent");
});

// Word mode has keys of its own (Enter records, Space accepts, Escape
// cancels); word-keys.test.js holds what it must not do with the letter keys.
for (const mode of ["coach", "test", "qr", "project"]) {
  test(`Space, Enter and Backspace do nothing on the ${mode} screen`, async () => {
    const { app, press, transcript, show } = await bootedApp();
    app.evaluate('state.transcript = "AB";');
    app.get("setMode")(mode);
    assert.equal(app.evaluate("state.mode"), mode, "precondition: the screen changed");
    show("A", 0.95);

    for (const key of [" ", "Enter", "Backspace"]) {
      assert.equal(press(key), 0, `${JSON.stringify(key)} must keep its default action on ${mode}`);
    }

    assert.equal(transcript(), "AB");
  });
}

test("Space and Backspace cancel their default action in letter mode, Enter too", async () => {
  const { app, press, show } = await bootedApp();
  app.evaluate('state.transcript = "AB";');
  show("C", 0.95);

  assert.equal(press(" "), 1, "Space would scroll the page");
  assert.equal(press("Backspace"), 1, "Backspace would navigate back in older browsers");
  assert.equal(press("Enter"), 1, "Enter would also act on whichever control the browser focuses");
});

test("a modified key, or any other key, keeps its default action in letter mode", async () => {
  const { app, press, transcript, show } = await bootedApp();
  app.evaluate('state.transcript = "AB";');
  show("C", 0.95);

  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    assert.equal(press("Backspace", { [modifier]: true }), 0, `${modifier} with Backspace`);
    assert.equal(press(" ", { [modifier]: true }), 0, `${modifier} with Space`);
  }
  assert.equal(press("a"), 0);
  assert.equal(transcript(), "AB");
});
