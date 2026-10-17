// A probability vector is read whole, or not at all.
//
// ONNX Runtime can hand the letter graph's probabilities back as a tensor
// with a data buffer, or, depending on the export and the runtime version, as
// the bare numeric array itself. Two faults this file kills:
//
// - A bare Float32Array or number array read only partly. The adapter used
//   to read unknown iterables ten entries deep, so a bare 24-class vector
//   became ten classes and L through Y could never be shown.
// - A vector of the wrong length ranked as it came. Classes past the label
//   list became invented names ("cls_27") on the stage, and a short vector
//   hid the classes it lacked. A vector that does not have one entry per
//   label says nothing reliable about which class it favours, so the frame
//   uses the label output alone, as for any other unreadable output.
//
// Frames go in through the render loop with a hand in view; ONNX Runtime is
// replaced only at its boundary, by a session whose label output names the
// class the test picks and whose probability output the test shapes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_LABELS, appWithFakeOrt } from "./helpers/fake-ort.mjs";

const V = LETTER_LABELS.indexOf("V");

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

/**
 * The booted app with the letter model loaded, the camera on and a hand in
 * view. The session's label output is class `label`; its probability output
 * is what `probabilities` builds, evaluated inside the app's realm so its
 * arrays are the app's own types.
 *
 * @param {{label: number, probabilities: string}} model
 */
async function appWithLetterOutput({ label, probabilities }) {
  const app = await appWithFakeOrt({ boot: true });
  app.evaluate(`__ort.chosen = ${label}; __ort.letterProbabilities = ${probabilities};`);
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
  `);
  assert.equal(app.runFrame(1000), 1, "the render loop must be running");
  await flush();
  return app;
}

/** The ranked rows on screen as [letter, percent text]. */
function rankedRows(app) {
  return JSON.parse(
    app.evaluate(
      `JSON.stringify(Array.from(els.top3List.children, (row) => [row.children[1].textContent, row.children[3].textContent]))`,
    ),
  );
}

/** Source for a bare `kind` of `length` probabilities whose largest is at `best`. */
const vector = (kind, length, best) => `() => {
  const p = new ${kind}(${length}).fill(0.01);
  p[${best}] = 0.8;
  return p;
}`;

for (const kind of ["Float32Array", "Array"]) {
  test(`a bare ${kind} of 24 probabilities is read in full: V can win`, async () => {
    // The label output says A, so a V on the stage can only come from the
    // probabilities.
    const app = await appWithLetterOutput({ label: 0, probabilities: vector(kind, 24, V) });

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), "V");
    assert.equal(app.evaluate("els.confidenceText.textContent"), "%80");
    assert.equal(rankedRows(app)[0][0], "V");
  });

  test(`a bare ${kind} of the wrong length falls back to the label alone`, async () => {
    // 30 entries for 24 labels; the largest is past the label list.
    const app = await appWithLetterOutput({ label: V, probabilities: vector(kind, 30, 27) });

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), "V");
    assert.deepEqual(rankedRows(app), [["V", "%100"]]);
  });
}

for (const length of [30, 12]) {
  test(`a tensor of ${length} probabilities for 24 labels falls back to the label alone`, async () => {
    // The largest entry is the last one: past the label list for the long
    // vector, and a real class (M) the short vector would rank alone.
    const app = await appWithLetterOutput({
      label: V,
      probabilities: `() => {
        const p = new Float32Array(${length}).fill(0.01);
        p[${length - 1}] = 0.8;
        return { data: p, dims: [1, ${length}] };
      }`,
    });

    assert.equal(app.evaluate("els.primaryPrediction.textContent"), "V");
    const rows = rankedRows(app);
    assert.deepEqual(rows, [["V", "%100"]]);
    assert.ok(rows.every(([letter]) => LETTER_LABELS.includes(letter)), "no invented class names");
  });
}
