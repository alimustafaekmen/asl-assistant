// Every way out of the demo releases everything it started.
//
// The demo starts one frame loop on a timer, and nothing else that keeps
// running: the render loop it feeds is the app's own and runs either way.
// Stopping it, starting the real camera, changing mode, following a route and
// the page going to the background must each end the loop and take the
// recorded hand off the stage. A demo never runs beside the camera, and a
// restart leaves exactly one loop.
//
// A running loop always has one timer pending, so "nothing left running" is
// tested as: after the clock has run far past every delay the app uses, no
// timer is pending, and the only animation frame queued is the render loop's.
//
// The faults these kill: a stop that forgets the timer (frames keep coming
// after the stage looks idle), a route or mode change that only hides the
// stage, a hidden page that keeps playing, a camera start that leaves the
// demo publishing over the camera's frames, a demo start that leaves the
// camera on, and a restart that stacks loops.

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoApp, demoRecording, flush } from "./helpers/demo-app.mjs";

/** Assert the demo is gone: no frame loop, no hand, no panel. */
async function assertReleased(demo, context) {
  assert.equal(demo.byId("demoPanel").hidden, true, `${context}: the demo panel is hidden`);
  // Long past every delay the app uses (the toast's 6 s included).
  demo.timers.advance(10_000);
  assert.equal(demo.pendingTimers(), 0, `${context}: no timer is left running`);
  assert.equal(demo.app.pendingFrames(), 1, `${context}: only the render loop's frame is queued`);
  assert.notEqual(demo.app.evaluate("latestMediaPipeResult?.aspect"), 1, `${context}: no demo frame is left on the stage`);
}

/** The demo, playing its first letter, with its one loop checked. */
async function playingDemo(options) {
  const demo = await demoApp(options);
  await demo.start();
  await demo.play(300);
  assert.equal(demo.publishedLetter(), "F", "precondition: the demo is playing");
  assert.equal(demo.pendingTimers(), 1, "precondition: one frame loop is running");
  assert.equal(demo.app.pendingFrames(), 1, "precondition: the demo adds no animation frame");
  return demo;
}

test("the stop button ends the demo and puts the stage back at rest", async () => {
  const demo = await playingDemo();
  const stop = demo.byId("demoStop");
  assert.equal(stop.hidden, false, "the demo offers a stop");
  demo.click(stop);

  await assertReleased(demo, "stop");
  assert.equal(demo.byId("cameraEmpty").hidden, false, "the first-visit stage is back");
  assert.equal(demo.plate(), "?", "the plate no longer shows the demo's letter");
});

test("starting the camera ends the demo first", async () => {
  const demo = await playingDemo();
  // Not awaited: the start waits on the MediaPipe download, which the test
  // never answers; the camera is on before that wait.
  demo.app.get("toggleCamera")();
  await flush();

  assert.equal(demo.camera.requests, 1, "precondition: the camera was asked for");
  assert.equal(demo.app.evaluate("els.cameraStage.dataset.camera"), "on", "the camera is on");
  await assertReleased(demo, "camera start");
});

test("starting the demo releases a camera that is on", async () => {
  const demo = await demoApp();
  // Not awaited: the start waits on the MediaPipe download, which the test
  // never answers; the camera is on before that wait.
  demo.app.get("toggleCamera")();
  await flush();
  assert.equal(demo.app.evaluate("state.cameraOn"), true, "precondition: the camera is on");

  await demo.start();
  await demo.play(300);
  assert.equal(demo.app.evaluate("state.cameraOn"), false, "the camera is off");
  assert.equal(demo.tracks.every((track) => track.stopped), true, "and its tracks are stopped");
  assert.equal(demo.publishedLetter(), "F", "the demo plays instead");
});

test("changing mode ends the demo", async () => {
  const demo = await playingDemo();
  const tab = demo.app
    .evaluate('Array.from(document.querySelectorAll("[data-ui=mode-tab]"))')
    .find((candidate) => candidate.dataset.mode === "coach");
  demo.click(tab);
  assert.equal(demo.app.evaluate("state.mode"), "coach");
  await assertReleased(demo, "mode change");
});

for (const hash of ["#word", "#qr", "#test"]) {
  test(`following a route to ${hash} ends the demo`, async () => {
    const demo = await playingDemo();
    demo.location.hash = hash;
    demo.app.windowHandler("hashchange")({ type: "hashchange" });
    await assertReleased(demo, `route ${hash}`);
  });
}

test("the brand link, which goes home, ends the demo", async () => {
  const demo = await playingDemo();
  demo.app.evaluate('document.querySelector("[data-home-link]")').dispatchEvent({ type: "click", detail: 1 });
  await assertReleased(demo, "home");
});

test("a page sent to the background ends the demo", async () => {
  const demo = await playingDemo();
  demo.app.evaluate('document.visibilityState = "hidden"; document.dispatchEvent({ type: "visibilitychange" });');
  await assertReleased(demo, "hidden page");
});

test("a stop while the recording is still loading leaves nothing behind when it arrives", async () => {
  let answer;
  const pending = new Promise((resolve) => {
    answer = resolve;
  });
  const demo = await demoApp({ respond: () => pending });
  const started = demo.app.get("startDemo")();
  await flush();
  demo.click(demo.byId("demoStop"));
  answer({ ok: true, status: 200, json: async () => demoRecording() });
  await started;
  await flush(20);

  assert.equal(demo.publishedHand(), null, "the cancelled start publishes nothing");
  await assertReleased(demo, "stop while loading");
});

test("a restart leaves exactly one frame loop", async () => {
  const demo = await playingDemo();
  await demo.start();
  await demo.play(300);
  assert.equal(demo.pendingTimers(), 1, "a second start does not add a loop");

  demo.click(demo.byId("demoStop"));
  await demo.start();
  await demo.play(300);
  assert.equal(demo.pendingTimers(), 1, "a start after a stop runs one loop");
  assert.equal(demo.publishedLetter(), "F", "and plays from the first letter");
});
