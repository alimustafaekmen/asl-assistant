// A word model download that fails costs one press of the record button, not
// the page.
//
// The word model downloads the first time something needs it. When that
// download fails, the next press must download again and record, and the
// user must be told once, in words that say what to do: try again. Before
// this, the message said to reload the page, which is never needed (the
// shared load forgets a failure), and a second press while the failing
// download was still under way reported the same failure a second time.
//
// Only the boundaries are faked: ONNX Runtime's session creation (which is
// what fetches the model file), MediaPipe's results and the countdown clock.

import assert from "node:assert/strict";
import { test } from "node:test";

import { feedFrames, wordModeApp, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

const STEP_MS = 720;
const read = (app, expression) => app.evaluate(expression);

/**
 * A booted word app with the camera on whose next `failures` model downloads
 * fail. After `hold()` a download waits until `settle()` lets it finish.
 */
async function appWithFailingDownloads(failures) {
  const ctx = wordModeApp({ boot: true, fakeTimers: true });
  await ctx.app.ready;
  ctx.app.evaluate(`
    // The camera session a start leaves; a stop releases it.
    state.stream = { getTracks: () => [] };
    globalThis.__downloads = 0;
    globalThis.__failuresLeft = ${failures};
    globalThis.__gate = null;
    globalThis.__open = () => {};
    const create = ort.InferenceSession.create;
    ort.InferenceSession.create = async (...args) => {
      __downloads += 1;
      if (__gate) await __gate;
      if (__failuresLeft > 0) {
        __failuresLeft -= 1;
        throw new TypeError("Failed to fetch");
      }
      return create(...args);
    };
  `);
  return {
    ...ctx,
    hold: () => ctx.app.evaluate("__gate = new Promise((resolve) => (__open = resolve));"),
    settle: () => ctx.app.evaluate("__gate = null; __open();"),
    downloads: () => read(ctx.app, "__downloads"),
  };
}

/** Every text the live region is given, in order. */
function recordAnnouncements(app) {
  app.evaluate(`
    globalThis.__announced = [];
    (() => {
      const el = els.announcer;
      let owner = Object.getPrototypeOf(el);
      let accessor;
      while (owner && !(accessor = Object.getOwnPropertyDescriptor(owner, "textContent"))) {
        owner = Object.getPrototypeOf(owner);
      }
      Object.defineProperty(el, "textContent", {
        configurable: true,
        get: () => accessor.get.call(el),
        set: (value) => {
          __announced.push(String(value).trim());
          accessor.set.call(el, value);
        },
      });
    })();
  `);
  return () => [...read(app, "__announced")];
}

function pressRecord(app) {
  const button = app.evaluate("els.recordWord");
  assert.equal(button.disabled, false, "the record button can be pressed");
  button.dispatchEvent({ type: "click", detail: 1 });
}

test("a failed word download says to try again, and the next press downloads and records", async () => {
  const { app, timers, downloads } = await appWithFailingDownloads(1);
  app.get("syncRecordButton")();
  const announced = recordAnnouncements(app);

  pressRecord(app);
  await timers.advance(0);
  assert.equal(downloads(), 1, "the press downloads the word model");
  assert.equal(read(app, "state.wordState"), "IDLE", "no countdown without the model");
  assert.equal(read(app, "state.wordEnd"), "download-failed");
  const message = read(app, "els.confidenceMessage.textContent");
  assert.match(message, /yeniden deneyin/, `the user is asked to try again: ${message}`);
  assert.doesNotMatch(message, /yenileyin/, "a reload is never needed");
  assert.deepEqual(announced(), [message], "the failure is announced once");
  assert.equal(read(app, "els.recordWord.disabled"), false, "the record button stays available");

  pressRecord(app);
  await timers.advance(0);
  assert.equal(downloads(), 2, "the second press downloads again");
  assert.equal(read(app, "state.wordState"), "COUNTDOWN", "and the recording starts");
  assert.equal(read(app, "state.wordEnd"), null, "the failure is no longer the latest news");
  await timers.advance(STEP_MS * read(app, "CONFIG.COUNTDOWN_SECONDS"));
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.equal(read(app, "state.wordState"), "RESULT");
  assert.equal(read(app, "state.prediction"), "book");
});

test("a second press while the download is still failing reports the failure once", async () => {
  const { app, timers, hold, settle, downloads } = await appWithFailingDownloads(1);
  app.get("syncRecordButton")();
  hold();
  pressRecord(app);
  await timers.advance(0);
  pressRecord(app);
  await timers.advance(0);
  assert.equal(downloads(), 1, "both presses wait on the one download");

  const announced = recordAnnouncements(app);
  settle();
  await timers.advance(0);
  assert.equal(read(app, "state.wordState"), "IDLE");
  assert.equal(announced().length, 1, `one announcement for one failure: ${JSON.stringify(announced())}`);
});

test("a download that fails after the camera stopped reports nothing", async () => {
  const { app, timers, hold, settle } = await appWithFailingDownloads(1);
  app.get("syncRecordButton")();
  hold();
  pressRecord(app);
  await timers.advance(0);
  app.get("toggleCamera")();
  const shown = read(app, "els.confidenceMessage.textContent");

  const announced = recordAnnouncements(app);
  settle();
  await timers.advance(0);
  assert.deepEqual(announced(), [], "the stop already put the screen at rest");
  assert.equal(read(app, "els.confidenceMessage.textContent"), shown);
  assert.equal(read(app, "state.wordEnd"), null);
});
