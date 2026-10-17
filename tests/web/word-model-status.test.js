// The status line while the word model downloads and a record press waits on
// it.
//
// With the camera on, entering word mode starts the word model's download and
// reports its outcome. A press of the record button in that wait asks for the
// same download and reports the outcome in words of its own: a refusal such as
// "wait for hand tracking", or "try again" when the download fails. The two
// must not talk over each other: the status report must not overwrite the
// press's refusal with "Hazır", must not report the same failure again, and
// must not ask for a reload, which is never needed.
//
// Only the boundaries are faked: ONNX Runtime's session creation, which is
// what fetches the model file, MediaPipe's results and the clock.

import assert from "node:assert/strict";
import { test } from "node:test";

import { wordModeApp } from "./helpers/word-recording.mjs";

const read = (app, expression) => app.evaluate(expression);

/**
 * A booted word app with the camera on, whose next word model download waits
 * until `settle()` and then fails or succeeds as asked.
 */
async function appWithHeldDownload({ fails }) {
  const ctx = wordModeApp({ boot: true, fakeTimers: true });
  await ctx.app.ready;
  ctx.app.evaluate(`
    state.stream = { getTracks: () => [] };
    globalThis.__announced = [];
    const announceBefore = announce;
    announce = (message) => { __announced.push(String(message)); announceBefore(message); };
    globalThis.__gate = new Promise((resolve) => (globalThis.__open = resolve));
    const create = ort.InferenceSession.create;
    ort.InferenceSession.create = async (...args) => {
      await __gate;
      if (${fails}) throw new TypeError("Failed to fetch");
      return create(...args);
    };
  `);
  return {
    ...ctx,
    settle: () => ctx.app.evaluate("__open();"),
    announced: () => JSON.parse(ctx.app.evaluate("JSON.stringify(__announced)")),
  };
}

function pressRecord(app) {
  app.get("syncRecordButton")();
  app.evaluate("els.recordWord").dispatchEvent({ type: "click", detail: 1 });
}

test("a refusal from the record press is not overwritten by the model's 'ready'", async () => {
  const { app, timers, settle } = await appWithHeldDownload({ fails: false });
  // The camera is on and word mode asks for the model, as entering it does.
  const status = app.get("loadModelsWithStatus")({ word: true });
  await timers.advance(0);
  pressRecord(app);
  await timers.advance(0);

  // Hand tracking is lost while the model downloads, so the press must refuse.
  app.evaluate("mpRunning = false;");
  settle();
  await timers.advance(0);
  await status;

  const message = read(app, "els.confidenceMessage.textContent");
  assert.match(message, /el izlemenin hazır olmasını bekleyin/, `the press's refusal stands: ${message}`);
  assert.doesNotMatch(message, /^Hazır/);
});

test("a failed download is reported once, by the press that waited for it", async () => {
  const { app, timers, settle, announced } = await appWithHeldDownload({ fails: true });
  const status = app.get("loadModelsWithStatus")({ word: true });
  await timers.advance(0);
  pressRecord(app);
  await timers.advance(0);

  settle();
  await timers.advance(0);
  await status;

  assert.equal(read(app, "state.wordEnd"), "download-failed");
  assert.equal(announced().length, 1, `one announcement for one failure: ${JSON.stringify(announced())}`);
  assert.doesNotMatch(read(app, "els.confidenceMessage.textContent"), /yenileyin/, "a reload is never needed");
});

test("without a press, a failed download is still reported by the status line", async () => {
  const { app, timers, settle, announced } = await appWithHeldDownload({ fails: true });
  const status = app.get("loadModelsWithStatus")({ word: true });
  await timers.advance(0);

  settle();
  await timers.advance(0);
  await status;

  assert.equal(announced().length, 1, "nobody else reports it");
  assert.match(read(app, "els.confidenceMessage.textContent"), /indirilemedi/);
});
