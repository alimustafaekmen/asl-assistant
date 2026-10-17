// The browser's feature vectors against the numbers Python makes.
//
// fixtures/feature-golden.json holds synthetic hands and short word sequences
// together with the outputs of the Python feature code (asl-features for the 93-D
// letter vector, the training notebook's port for the 168-D word frames); the
// Python suite fails if the file stops matching Python. Here the real
// features.js and landmarks.js run on the same inputs. A reordered group, a
// flipped flag or a changed scale still gives a vector of the right length and
// finite values, so only the numbers can tell. Nothing is mocked.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "feature-golden.json"), "utf8"),
);
const app = loadWebApp();

/** Fail with the first index that differs by more than the golden's tolerance. */
function assertClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i += 1) {
    const diff = Math.abs(actual[i] - expected[i]);
    assert.ok(diff <= golden.tolerance, `${label}[${i}]: got ${actual[i]}, Python makes ${expected[i]}`);
  }
}

/** A 321-D frame with the two hand slots filled and everything else empty. */
function handsFrame(right, left) {
  const frame = new Float32Array(321);
  frame.set(right, 0);
  frame.set(left, 63);
  return frame;
}

/** The letter vector for one frame, from a cold smoother, as the first frame of a sign. */
function letterVector(frame) {
  app.get("resetLetterLandmarkSmoother")();
  return app.get("computeLetterFeatures")(frame);
}

const letterCase = (name) => golden.letter.cases.find((c) => c.name === name);

for (const c of golden.letter.cases) {
  test(`letter vector for ${c.name} equals the Python 93-D vector (${c.note})`, () => {
    const vector = letterVector(handsFrame(c.right, c.left));

    assert.equal(vector.length, 93);
    assertClose(vector, c.expect, c.name);
  });
}

test("an open palm raises all five extension flags and a fist raises none", () => {
  const open = letterCase("open_palm_right");
  const fist = letterCase("fist_right");

  const openFlags = [...letterVector(handsFrame(open.right, open.left)).slice(88, 93)];
  const fistFlags = [...letterVector(handsFrame(fist.right, fist.left)).slice(88, 93)];

  assert.deepEqual(openFlags, [1, 1, 1, 1, 1]);
  assert.deepEqual(fistFlags, [0, 0, 0, 0, 0]);
});

test("the hand is centred on the wrist with the middle-finger base at unit distance", () => {
  const c = letterCase("open_palm_right");

  const vector = letterVector(handsFrame(c.right, c.left));

  assert.deepEqual([...vector.slice(0, 3)], [0, 0, 0]);
  const [x, y, z] = vector.slice(27, 30);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6, `landmark 9 is ${Math.hypot(x, y, z)} from the wrist`);
});

test("a hand far from the camera is scaled up, not discarded", () => {
  const far = letterCase("far_open_palm_right");

  const farVector = letterVector(handsFrame(far.right, far.left));

  assert.ok(farVector.some((value) => value !== 0), "a hand 0.05 across came out as zeros");
  const [x, y, z] = farVector.slice(27, 30);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6);
});

for (const sequence of golden.word.sequences) {
  const normalized = () =>
    sequence.frames.map((frame) => app.get("normalizeShoulders")(new Float32Array(frame)));

  test(`word sequence ${sequence.name} equals the Python 168-D frames (${sequence.note})`, () => {
    const compact = app.get("buildCompactSequenceFeatures")(normalized());

    assert.equal(compact.length, sequence.frames.length);
    compact.forEach((row, t) => assertClose(row, sequence.expect[t], `${sequence.name} frame ${t}`));
  });

  // The per-frame builder picks the hand frame by frame, so it agrees with the
  // whole-recording one only where the same hand is dominant throughout.
  if (sequence.dominant === "right") {
    test(`word frames built one by one agree with Python for ${sequence.name}`, () => {
      const frames = normalized();

      frames.forEach((frame, t) => {
        const row = app.get("buildCompactFeatures")(frame, t > 0 ? frames[t - 1] : null);
        assertClose(row, sequence.expect[t], `${sequence.name} frame ${t}`);
      });
    });
  }
}
