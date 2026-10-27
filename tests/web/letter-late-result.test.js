// A letter result that arrives after the user left the screen it was meant
// for is dropped.
//
// The letter model runs while the render loop moves on. If the user switches
// to word mode, stops the camera or moves the coach to another letter before
// the run settles, the screen has already been reset; the late letter must not
// land on a plate that never asked for it.
//
// Only the boundaries are faked: ONNX Runtime (its runs held until the test
// releases them) and MediaPipe's result.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";

const BEST = 9;

/** A hand of 21 landmarks, wrist at the bottom, fingers fanned upwards. */
function hand() {
  const landmarks = [{ x: 0.5, y: 0.85, z: 0 }];
  for (let finger = 0; finger < 5; finger++) {
    for (let joint = 1; joint <= 4; joint++) {
      landmarks.push({ x: 0.4 + finger * 0.05 + joint * 0.004 * finger, y: 0.8 - joint * 0.1 - finger * 0.01, z: -0.01 * joint });
    }
  }
  return landmarks;
}

function openTab(app, mode) {
  app.evaluate(`document.querySelector('button[data-mode="${mode}"]')`).dispatchEvent({ type: "click", detail: 1 });
}

/** The given letter screen, camera on, a hand in view and the model's run held back. */
async function letterRunInFlight(mode) {
  const app = await appWithFakeOrt({ boot: true });
  openTab(app, mode);
  app.evaluate(`__ort.chosen = ${BEST};`);
  assert.equal(await app.get("ensureLetterModel")(), true);
  app.evaluate(`
    state.cameraOn = true;
    latestMediaPipeResult = {
      rightHandLandmarks: ${JSON.stringify(hand())},
      leftHandLandmarks: null,
      poseLandmarks: null,
      faceLandmarks: null,
      timestamp: 1,
    };
    __ort.holdRuns();
  `);
  assert.equal(app.runFrame(1000), 1, "the render loop must be running");
  await flush();
  assert.equal(app.evaluate("__ort.runs"), 1, "precondition: the letter model is running");
  return app;
}

const LEAVES = {
  "a switch to word mode": ["letter", (app) => openTab(app, "word")],
  "a camera stop": ["letter", (app) => app.get("toggleCamera")()],
  "a new coach letter": ["coach", (app) => {
    const next = app.evaluate("state.coachTarget") === "B" ? "C" : "B";
    app.get("_showCoachTarget")(next);
  }],
};

for (const [name, [mode, leave]] of Object.entries(LEAVES)) {
  test(`a letter result that arrives after ${name} is not shown`, async () => {
    const app = await letterRunInFlight(mode);
    leave(app);
    const plateAfterLeaving = app.evaluate("els.primaryPrediction.textContent");

    app.evaluate("__ort.releaseRuns();");
    await flush();

    assert.notEqual(app.evaluate("state.prediction"), LETTER_LABELS[BEST], "the late letter is not the prediction");
    assert.equal(app.evaluate("els.primaryPrediction.textContent"), plateAfterLeaving, "the plate keeps what the switch left");
  });
}

test("a letter result that arrives while the user stayed is shown", async () => {
  const app = await letterRunInFlight("letter");
  app.evaluate("__ort.releaseRuns();");
  await flush();

  assert.equal(app.evaluate("state.prediction"), LETTER_LABELS[BEST]);
  assert.equal(app.evaluate("els.primaryPrediction.textContent"), LETTER_LABELS[BEST]);
});
