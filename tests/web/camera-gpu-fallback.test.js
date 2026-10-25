// A GPU hand task that fails on every frame (WebGL 1 only, a blocklisted
// GPU) is rebuilt on the CPU; when the CPU fails too, the visitor is told
// that tracking failed instead of being asked to show a hand.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FRAME_MS, coachApp } from "./helpers/coach-app.mjs";

/**
 * The booted app whose hand tasks throw on every frame for the delegates in
 * `broken`, and whose CPU task creation fails when `cpuCreateFails` is set.
 */
async function appWithBrokenDelegate({ broken, cpuCreateFails = false, hash = "#letter" }) {
  const coach = await coachApp({ hash });
  const vision = coach.app.evaluate("__vision");
  const create = vision.HandLandmarker.createFromOptions;
  const tasks = [];
  vision.HandLandmarker.createFromOptions = async (resolver, options) => {
    const delegate = options?.baseOptions?.delegate;
    if (delegate === "CPU" && cpuCreateFails) throw new Error("no CPU build");
    const task = await create(resolver, options);
    const record = { delegate, canvas: options?.canvas, closed: 0, detections: 0 };
    tasks.push(record);
    return {
      detectForVideo(...frame) {
        record.detections += 1;
        if (broken.includes(delegate)) throw new Error(`${delegate} graph aborted`);
        return task.detectForVideo(...frame);
      },
      close() {
        record.closed += 1;
      },
    };
  };
  const t = (key) => coach.app.evaluate(`t(${JSON.stringify(key)})`);
  const message = () => coach.text("confidenceMessage");
  return { ...coach, tasks, t, message };
}

const handPublished = (coach) =>
  coach.app.evaluate("Boolean(latestMediaPipeResult?.rightHandLandmarks || latestMediaPipeResult?.leftHandLandmarks)");

test("a GPU hand task that keeps failing is rebuilt on the CPU", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU"] });
  await coach.startCamera();
  coach.show("L", 0.9);
  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU"], "precondition: tracking starts on the GPU");

  await coach.play(60 * FRAME_MS);

  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU", "CPU"], "no CPU task after 60 failed frames");
  assert.equal(coach.tasks[0].closed, 1, "the failing GPU task was not closed");
  assert.equal(coach.tasks[1].closed, 0);
  assert.equal(handPublished(coach), true, "the CPU task does not reach the app");

  await coach.play(6000);
  assert.notEqual(coach.message(), coach.t("shell.hand.missing"), "a tracked hand was reported missing");
  assert.equal(coach.text("latencyBadge"), coach.t("shell.badge.handDetected"));
  assert.equal(coach.app.evaluate("handLandmarker") !== null, true);
});

test("a few failed GPU frames do not give up the GPU", async () => {
  const broken = ["GPU"];
  const coach = await appWithBrokenDelegate({ broken });
  await coach.startCamera();
  coach.show("L", 0.9);

  await coach.play(20 * FRAME_MS);
  broken.length = 0;
  await coach.play(20 * FRAME_MS);
  broken.push("GPU");
  await coach.play(20 * FRAME_MS);

  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU"], "a GPU that recovers in between was replaced");
});

test("when the CPU task fails too, the visitor is told tracking failed", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU", "CPU"] });
  await coach.startCamera();
  coach.show("L", 0.9);

  await coach.play(80 * FRAME_MS);

  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU", "CPU"], "the CPU was tried once");
  assert.equal(coach.message(), coach.t("shell.tracking.failed"));
});

test("when no CPU task can be made, the visitor is told tracking failed", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU"], cpuCreateFails: true });
  await coach.startCamera();
  coach.show("L", 0.9);

  await coach.play(40 * FRAME_MS);

  assert.equal(coach.message(), coach.t("shell.tracking.failed"));
  assert.equal(coach.tasks[0].closed, 0, "the only hand task was closed without a replacement");
});

test("a stop while the CPU task loads closes it when it arrives", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU"] });
  const vision = coach.app.evaluate("__vision");
  const create = vision.HandLandmarker.createFromOptions;
  let release = null;
  vision.HandLandmarker.createFromOptions = (resolver, options) =>
    options?.baseOptions?.delegate === "CPU"
      ? new Promise((resolve) => (release = () => resolve(create(resolver, options))))
      : create(resolver, options);
  await coach.startCamera();
  await coach.play(40 * FRAME_MS);
  assert.ok(release, "precondition: the CPU task is loading");

  coach.click(coach.el("cameraToggle"));
  release();
  await coach.play(5 * FRAME_MS);

  assert.equal(coach.app.evaluate("state.cameraOn"), false);
  assert.equal(coach.app.evaluate("handLandmarker"), null, "the late CPU task was kept after the stop");
  assert.deepEqual(coach.tasks.map((task) => task.closed), [1, 1], "every hand task created must be closed");
  assert.equal(coach.app.evaluate("mpRunning"), false);
});

test("a restarted camera tries the GPU again and can move to the CPU again", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU"] });
  await coach.startCamera();
  await coach.play(40 * FRAME_MS);
  assert.equal(coach.tasks.at(-1).delegate, "CPU", "precondition: the session moved to the CPU");

  coach.click(coach.el("cameraToggle"));
  await coach.startCamera();
  assert.equal(coach.tasks.at(-1).delegate, "GPU");
  await coach.play(40 * FRAME_MS);

  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU", "CPU", "GPU", "CPU"]);
  assert.notEqual(coach.message(), coach.t("shell.tracking.failed"));
});

test("the replaced GPU task's canvas no longer restarts tracking", async () => {
  const coach = await appWithBrokenDelegate({ broken: ["GPU"] });
  await coach.startCamera();
  await coach.play(40 * FRAME_MS);
  assert.deepEqual(coach.tasks.map((task) => task.delegate), ["GPU", "CPU"], "precondition: the session moved to the CPU");

  const lose = (canvas) => canvas.dispatchEvent({ type: "webglcontextlost", target: canvas });
  lose(coach.tasks[0].canvas);
  await coach.play(5 * FRAME_MS);
  assert.equal(coach.tasks.length, 2, "the closed GPU task's context restarted tracking");

  lose(coach.tasks[1].canvas);
  await coach.play(5 * FRAME_MS);
  assert.equal(coach.tasks.length, 3, "a loss on the CPU task's context did not restart tracking");
});
