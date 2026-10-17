// A model is warmed up before anything uses it.
//
// A fresh ONNX Runtime session initialises lazily on its first run, so the
// app runs one throwaway input (all zeros) through it before it reports the
// model ready. A live frame or a recording that ran beside that warm-up would
// race the same session and pay the start-up cost the warm-up exists to take,
// so the load is only ready once the warm-up has finished.
//
// ONNX Runtime is the boundary and is faked (helpers/fake-ort.mjs). The test
// holds the warm-up run open at that boundary and drives the app's own live
// paths: a letter frame through realInference(), a word recording from
// startWordRecording(). The MediaPipe results the camera would publish are
// set directly, as in the other live-inference tests.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { appWithFakeOrt } from "./helpers/fake-ort.mjs";
import { feedFrames, mediaPipeFrame, RECORDING_FRAMES } from "./helpers/word-recording.mjs";

/**
 * Hold every warm-up run until the test releases it, and log the order in
 * which runs start and warm-ups finish. A run is a warm-up when its input is
 * all zeros, as fake-ort.mjs counts it.
 */
function holdWarmups(app) {
  app.evaluate(`
    globalThis.__events = [];
    globalThis.__releaseWarmups = () => {};
    const gate = new Promise((resolve) => { __releaseWarmups = resolve; });
    for (const session of [__letterSession, __wordSession]) {
      const run = session.run;
      session.run = async (feeds, fetches) => {
        if (!feeds.input.data.every((value) => value === 0)) {
          __events.push("live run");
          return run(feeds, fetches);
        }
        __events.push("warm-up started");
        await gate;
        const result = await run(feeds, fetches);
        __events.push("warm-up finished");
        return result;
      };
    }
  `);
  return {
    events: () => Array.from(app.evaluate("__events")),
    release: () => app.evaluate("__releaseWarmups()"),
  };
}

/** The app with the camera on in `mode` and MediaPipe running, as a start leaves it. */
async function liveApp(mode) {
  const app = await appWithFakeOrt();
  app.evaluate(`
    globalThis.__clock = 0;
    globalThis.performance = { now: () => __clock };
    CONFIG.COUNTDOWN_SECONDS = 0;
    state.mode = ${JSON.stringify(mode)};
    state.cameraOn = true;
    mpRunning = true;
    poseLandmarker = { close() {} };
    faceLandmarker = { close() {} };
  `);
  return app;
}

test("a live letter frame waits until the letter model's warm-up has finished", async () => {
  const app = await liveApp("letter");
  const warmups = holdWarmups(app);
  app.evaluate(`latestMediaPipeResult = ${JSON.stringify(mediaPipeFrame(0))};`);

  const loading = app.get("ensureLetterModel")();
  await flush();
  assert.deepEqual(warmups.events(), ["warm-up started"], "precondition: the warm-up is running");

  // A frame arrives while the session is warming up.
  const frame = app.get("realInference")(0);
  await flush();
  assert.deepEqual(warmups.events(), ["warm-up started"], "no live run while the warm-up runs");

  warmups.release();
  assert.equal(await loading, true);
  await frame;
  assert.deepEqual(warmups.events(), ["warm-up started", "warm-up finished", "live run"]);
});

test("a word recording waits until the word model's warm-up has finished", async () => {
  const app = await liveApp("word");
  const warmups = holdWarmups(app);

  const starting = app.get("startWordRecording")();
  await flush();
  assert.deepEqual(warmups.events(), ["warm-up started"], "precondition: the warm-up is running");

  // A whole recording's worth of frames arrives while the session warms up.
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.deepEqual(warmups.events(), ["warm-up started"], "no live run while the warm-up runs");

  warmups.release();
  await starting;
  assert.equal(app.evaluate("state.wordState"), "RECORDING", "the recording starts once the model is ready");
  await feedFrames(app, 0, RECORDING_FRAMES);
  assert.deepEqual(warmups.events(), ["warm-up started", "warm-up finished", "live run"]);
});
