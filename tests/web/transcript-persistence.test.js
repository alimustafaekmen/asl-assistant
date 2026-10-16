// The transcript strip: what the user wrote survives a reload, is drawn as
// text, and a clear can be taken back.
//
// The user builds a sentence letter by letter, so losing it to a reload, or
// getting an older copy back after an undo, costs real work. Each test boots
// the real app (index.html, every script, the real init()) and drives it the
// way the page is driven: the keyboard map and the buttons. Only the edges are
// faked: a storage that outlives one page load, the clock, and the console.
// A reload is a second loadWebApp() sharing that storage; no test names the
// key the app stores under, so a renamed key still passes and a key the
// restore does not read still fails.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/** localStorage that outlives a page load, like the browser's. */
function persistentStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

/** A clock the test advances by hand; timers run in due order, cleared ones never. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay = 0) {
      const id = nextId++;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Move time forward, running every timer that falls due on the way. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
  };
}

/** One page load of the booted app over a shared storage and clock. */
async function openPage({ storage = persistentStorage(), clock = fakeClock() } = {}) {
  const app = loadWebApp({
    boot: true,
    globals: {
      console: quietConsole,
      localStorage: storage,
      performance: { now: clock.now },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  });
  await app.ready;
  const page = app.makeTarget({ tagName: "DIV" });
  const onKeyDown = app.windowHandler("keydown");
  const key = (name) =>
    onKeyDown({
      key: name === "Space" ? " " : name,
      code: name === "Space" ? "Space" : name,
      target: page,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
    });
  const click = (id) => app.evaluate(`els.${id}`).dispatchEvent({ type: "click", detail: 0 });
  /** The current letter is `letter`, confidently; one Space adds it, 300 ms apart. */
  const typeLetter = (letter) => {
    app.evaluate(`state.mode = "letter"; state.prediction = ${JSON.stringify(letter)}; state.confidence = 0.95;`);
    clock.advance(300);
    key("Space");
  };
  /** What the strip shows, without the decorative caret. */
  const shown = () => app.evaluate("els.transcriptText.textContent").replace(/\|$/, "");
  const isEmptyMarked = () => app.evaluate("els.transcriptText.dataset.empty");
  return { app, storage, clock, key, click, typeLetter, shown, isEmptyMarked };
}

test("a sentence built by keyboard is still there after a reload", async () => {
  const first = await openPage();
  first.typeLetter("H");
  first.typeLetter("I");
  first.key("Enter");
  first.typeLetter("A");
  assert.equal(first.shown(), "HI A");

  const second = await openPage({ storage: first.storage });

  assert.equal(second.shown(), "HI A");
  assert.equal(second.app.evaluate("state.transcript"), "HI A");
  assert.equal(second.isEmptyMarked(), "false");
});

test("every edit is saved: a letter, a space, a deletion", async () => {
  const first = await openPage();
  first.typeLetter("A");
  assert.equal((await openPage({ storage: first.storage })).shown(), "A");

  first.typeLetter("B");
  first.key("Enter");
  assert.equal((await openPage({ storage: first.storage })).app.evaluate("state.transcript"), "AB ");

  first.key("Backspace");
  first.key("Backspace");
  assert.equal((await openPage({ storage: first.storage })).shown(), "A");
});

test("a first visit starts with the placeholder, marked as empty", async () => {
  const page = await openPage();

  assert.equal(page.app.evaluate("state.transcript"), "");
  assert.equal(page.shown(), "Metin burada görünür");
  assert.equal(page.isEmptyMarked(), "true");
  assert.equal(page.app.evaluate("els.transcriptText.lang"), "tr");
});

test("the empty mark follows the text: off with a letter, on again when it is deleted", async () => {
  const page = await openPage();

  page.typeLetter("A");
  assert.equal(page.isEmptyMarked(), "false");
  assert.equal(page.app.evaluate("els.transcriptText.lang"), "en", "typed text is English letters");

  page.key("Backspace");
  assert.equal(page.isEmptyMarked(), "true");
  assert.equal(page.shown(), "Metin burada görünür");

  // Spaces alone are no text either.
  page.typeLetter("A");
  page.key("Backspace");
  page.key("Enter");
  assert.equal(page.isEmptyMarked(), "true");
});

test("Enter ends the word with one space, however many are already there", async () => {
  const page = await openPage();
  page.typeLetter("A");
  page.typeLetter("B");

  page.key("Enter");
  assert.equal(page.app.evaluate("state.transcript"), "AB ");
  page.key("Enter");
  page.key("Enter");
  assert.equal(page.app.evaluate("state.transcript"), "AB ", "a second Enter does not double the space");

  // The button does the same as the key, and a stored double space is tidied.
  page.click("insertSpace");
  assert.equal(page.app.evaluate("state.transcript"), "AB ");
  page.app.evaluate('state.transcript = "AB   ";');
  page.key("Enter");
  assert.equal(page.app.evaluate("state.transcript"), "AB ");
  assert.equal((await openPage({ storage: page.storage })).app.evaluate("state.transcript"), "AB ");
});

test("Enter on an empty transcript leaves it empty", async () => {
  const page = await openPage();

  page.key("Enter");
  assert.equal(page.app.evaluate("state.transcript"), "");
  assert.equal(page.isEmptyMarked(), "true");

  page.typeLetter("A");
  page.key("Backspace");
  page.key("Enter");
  assert.equal(page.app.evaluate("state.transcript"), "");
});

test("clearing empties the strip and the saved copy", async () => {
  const first = await openPage();
  first.typeLetter("O");
  first.typeLetter("K");

  first.click("clearText");

  assert.equal(first.shown(), "Metin burada görünür");
  assert.equal(first.isEmptyMarked(), "true");
  assert.equal((await openPage({ storage: first.storage })).app.evaluate("state.transcript"), "");
});

test("undo after a clear brings the text back, on screen and across a reload", async () => {
  const first = await openPage();
  first.typeLetter("H");
  first.typeLetter("I");
  first.click("clearText");
  assert.equal(first.app.evaluate("els.toastText.textContent"), "Metin temizlendi");
  assert.equal(first.app.evaluate("els.toastAction.textContent"), "Geri al");

  first.app.evaluate("els.toastAction.onclick()");

  assert.equal(first.shown(), "HI", "the strip is redrawn, not only the state");
  assert.equal(first.isEmptyMarked(), "false");
  assert.equal(first.app.evaluate("els.announcer.textContent"), "Metin geri alındı");
  const reloaded = await openPage({ storage: first.storage });
  assert.equal(reloaded.shown(), "HI", "the restored text is saved again");
});

test("a letter added after the clear stays after the restored text", async () => {
  const page = await openPage();
  page.typeLetter("H");
  page.typeLetter("I");
  page.click("clearText");
  page.typeLetter("X");
  assert.equal(page.shown(), "X");

  page.app.evaluate("els.toastAction.onclick()");

  assert.equal(page.shown(), "HIX");
  assert.equal((await openPage({ storage: page.storage })).shown(), "HIX");
});

test("only an undo toast shows the undo action", async () => {
  const page = await openPage();
  page.typeLetter("A");
  page.click("clearText");
  assert.equal(page.app.evaluate("els.toastAction.hidden"), false, "the clear toast offers undo");

  // A plain confirmation replaces it and must not keep a dead button.
  page.app.evaluate('showToast("Metin kopyalandı");');
  assert.equal(page.app.evaluate("els.toastText.textContent"), "Metin kopyalandı");
  assert.equal(page.app.evaluate("els.toast.hidden"), false);
  assert.equal(page.app.evaluate("els.toastAction.hidden"), true);
});

test("an undo toast stays long enough to reach, a plain one is brief", async () => {
  const { app, clock, typeLetter, click } = await openPage();
  typeLetter("A");
  click("clearText");

  clock.advance(3000);
  assert.equal(app.evaluate("els.toast.hidden"), false, "still there after three seconds");
  clock.advance(2900);
  assert.equal(app.evaluate("els.toast.hidden"), false, "still there just before six");
  clock.advance(200);
  assert.equal(app.evaluate("els.toast.hidden"), true, "gone once its time is up");

  app.evaluate('showToast("Metin kopyalandı");');
  clock.advance(2900);
  assert.equal(app.evaluate("els.toast.hidden"), false);
  clock.advance(200);
  assert.equal(app.evaluate("els.toast.hidden"), true);
});
