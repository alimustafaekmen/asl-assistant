// Letter and word feature construction.
//
// Feature order and length are the model input contract shared with the Python
// training pipeline, so these tests pin shape, finiteness, and the few
// behavioural invariants that are easy to break by accident: which hand is
// chosen, when motion is zero, and what temporal reset clears. They do not
// re-derive the feature maths, which is covered by the Python parity checks.

import test from "node:test";
import assert from "node:assert/strict";

let app;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

/** A plausible, non-degenerate 21-landmark hand written into one 63D slot. */
function fillHand(frame, offset, seed) {
  for (let i = 0; i < 21; i += 1) {
    frame[offset + i * 3] = seed + Math.cos(i) * 0.05;
    frame[offset + i * 3 + 1] = seed + Math.sin(i) * 0.05;
    frame[offset + i * 3 + 2] = seed / 10 + i / 500;
  }
  return frame;
}

/** A frame with a right hand, a face, and shoulders in place. */
function wordFrame(seed = 0.5) {
  const frame = new Float32Array(321);
  fillHand(frame, 0, seed);
  for (let i = 126; i < 246; i += 1) frame[i] = seed / 2 + i / 5000;
  for (let i = 246; i < 321; i += 1) frame[i] = seed / 3 + i / 6000;
  return frame;
}

const finite = (values) => [...values].every(Number.isFinite);

test("a compact word frame is 168 values in the documented order", () => {
  const compact = app.get("buildCompactFeatures")(wordFrame(), null);

  assert.equal(compact.length, 168);
  assert.ok(finite(compact));
  // Motion occupies 105..167 and is zero without a previous frame.
  for (let i = 105; i < 168; i += 1) assert.equal(compact[i], 0);
});

test("motion is the delta against the previous frame", () => {
  const buildCompactFeatures = app.get("buildCompactFeatures");
  const previous = wordFrame(0.5);
  const current = wordFrame(0.6);

  const moved = buildCompactFeatures(current, previous);
  const still = buildCompactFeatures(current, current);

  assert.ok([...moved.slice(105)].some((value) => value !== 0));
  for (let i = 105; i < 168; i += 1) assert.equal(still[i], 0);
});

test("a sequence keeps one compact frame per input frame", () => {
  const buildCompactSequenceFeatures = app.get("buildCompactSequenceFeatures");
  const frames = [wordFrame(0.4), wordFrame(0.5), wordFrame(0.6)];

  const sequence = buildCompactSequenceFeatures(frames);

  assert.equal(sequence.length, frames.length);
  for (const compact of sequence) {
    assert.equal(compact.length, 168);
    assert.ok(finite(compact));
  }
  // The first frame has no predecessor, so its motion segment is zero.
  for (let i = 105; i < 168; i += 1) assert.equal(sequence[0][i], 0);
  assert.ok([...sequence[1].slice(105)].some((value) => value !== 0));
});

test("an empty sequence produces no frames", () => {
  const buildCompactSequenceFeatures = app.get("buildCompactSequenceFeatures");

  assert.deepEqual([...buildCompactSequenceFeatures([])], []);
  assert.deepEqual([...buildCompactSequenceFeatures(null)], []);
});

test("the dominant hand is chosen once for the whole recording", () => {
  const computeDominantHand = app.get("computeDominantHand");
  const computeDominantHandSequence = app.get("computeDominantHandSequence");

  // Right hand visible only in the first frame, left hand in the other two.
  const first = new Float32Array(321);
  fillHand(first, 0, 0.5);
  const second = fillHand(new Float32Array(321), 63, 0.5);
  const third = fillHand(new Float32Array(321), 63, 0.6);

  const sequence = computeDominantHandSequence([first, second, third]);

  assert.equal(sequence.length, 3);
  // Per-frame selection would pick the right hand for the first frame; the
  // sequence-level rule follows the recording and reads the left slot, which is
  // empty in that frame. This difference is the training parity contract.
  assert.ok([...computeDominantHand(first)].some((value) => value !== 0));
  assert.ok([...sequence[0]].every((value) => value === 0));
  assert.ok([...sequence[1]].some((value) => value !== 0));
});

test("a dominant left hand is mirrored into the right-hand convention", () => {
  const computeDominantHand = app.get("computeDominantHand");

  const frame = fillHand(new Float32Array(321), 63, 0.5);
  const dominant = computeDominantHand(frame);

  assert.equal(dominant.length, 63);
  assert.ok(finite(dominant));
  // The word contract mirrors by negating x and keeping y and z.
  for (let i = 0; i < 63; i += 3) {
    assert.ok(Math.abs(dominant[i] + frame[63 + i]) < 1e-6);
    assert.ok(Math.abs(dominant[i + 1] - frame[63 + i + 1]) < 1e-6);
    assert.ok(Math.abs(dominant[i + 2] - frame[63 + i + 2]) < 1e-6);
  }
});

test("the letter path mirrors a left hand across the normalized frame", () => {
  const selectPrimaryHandForLetter = app.get("selectPrimaryHandForLetter");

  const frame = fillHand(new Float32Array(321), 63, 0.5);
  const primary = selectPrimaryHandForLetter(frame);

  assert.equal(primary.length, 63);
  // MediaPipe x is normalized to [0,1], so the letter contract uses 1 - x
  // rather than the word contract's negation.
  for (let i = 0; i < 63; i += 3) {
    assert.ok(Math.abs(primary[i] - (1 - frame[63 + i])) < 1e-6);
  }
});

test("the letter path keeps an absent hand zero-filled", () => {
  const selectPrimaryHandForLetter = app.get("selectPrimaryHandForLetter");

  const primary = selectPrimaryHandForLetter(new Float32Array(321));

  assert.equal(primary.length, 63);
  assert.ok([...primary].every((value) => value === 0));
});

test("_nonZeroTriplets counts visible landmarks, not coordinates", () => {
  const nonZeroTriplets = app.get("_nonZeroTriplets");

  const hand = new Float32Array(63);
  assert.equal(nonZeroTriplets(hand), 0);
  hand[0] = 0.5;
  assert.equal(nonZeroTriplets(hand), 1);
  hand[1] = 0.5;
  hand[2] = 0.5;
  assert.equal(nonZeroTriplets(hand), 1);
  hand[3] = 0.5;
  assert.equal(nonZeroTriplets(hand), 2);
});

test("letter features are 93 values and stay finite", () => {
  const computeLetterFeatures = app.get("computeLetterFeatures");
  app.get("resetLetterLandmarkSmoother")();

  const features = computeLetterFeatures(wordFrame());

  assert.equal(features.length, 93);
  assert.ok(finite(features));
});

test("letter features stay finite for a degenerate frame", () => {
  const computeLetterFeatures = app.get("computeLetterFeatures");
  app.get("resetLetterLandmarkSmoother")();

  const features = computeLetterFeatures(new Float32Array(321));

  assert.equal(features.length, 93);
  assert.ok(finite(features));
});

test("resetting the letter smoother clears motion and EMA state", () => {
  const computeLetterFeatures = app.get("computeLetterFeatures");
  const resetLetterLandmarkSmoother = app.get("resetLetterLandmarkSmoother");
  const getLetterSmoothingState = app.get("getLetterSmoothingState");
  const getLastLetterMotion = app.get("getLastLetterMotion");

  resetLetterLandmarkSmoother();
  assert.equal(getLastLetterMotion(), null);
  assert.equal(getLetterSmoothingState().prevSet, false);

  computeLetterFeatures(wordFrame(0.5));
  computeLetterFeatures(wordFrame(0.6));
  assert.equal(getLetterSmoothingState().prevSet, true);
  assert.ok(getLastLetterMotion().meanAbsDelta > 0);

  resetLetterLandmarkSmoother();
  assert.equal(getLastLetterMotion(), null);
  assert.equal(getLetterSmoothingState().prevSet, false);
});

test("a hand that disappears resets the EMA rather than smoothing into zero", () => {
  const computeLetterFeatures = app.get("computeLetterFeatures");
  const resetLetterLandmarkSmoother = app.get("resetLetterLandmarkSmoother");
  const getLetterSmoothingState = app.get("getLetterSmoothingState");

  resetLetterLandmarkSmoother();
  computeLetterFeatures(wordFrame(0.5));
  computeLetterFeatures(wordFrame(0.6));
  assert.equal(getLetterSmoothingState().prevSet, true);

  computeLetterFeatures(new Float32Array(321));
  assert.equal(getLetterSmoothingState().prevSet, false);
});

test("the geometry blocks keep their documented sizes", () => {
  const hand = new Float32Array(wordFrame().slice(0, 63));

  assert.equal(app.get("computeShapeFeatures")(hand).length, 30);
  assert.equal(app.get("computeLetterShapeFeatures")(hand).length, 30);
  assert.equal(app.get("computeHandBodyRelations")(wordFrame()).length, 12);
  assert.equal(app.get("normalizeHandForLetter")(hand).length, 63);
  // 63 hand + 30 shape = 93 letter; 63 + 30 + 12 + 63 motion = 168 word.
  assert.equal(63 + 30, 93);
  assert.equal(63 + 30 + 12 + 63, 168);
});

test("the geometry blocks stay finite for an empty hand", () => {
  const empty = new Float32Array(63);

  assert.ok(finite(app.get("computeShapeFeatures")(empty)));
  assert.ok(finite(app.get("computeLetterShapeFeatures")(empty)));
  assert.ok(finite(app.get("computeHandBodyRelations")(new Float32Array(321))));
  assert.ok(finite(app.get("normalizeHandForLetter")(empty)));
});

test("the geometric helpers never return NaN for degenerate vectors", () => {
  const dist3d = app.get("dist3d");
  const safeNorm = app.get("safeNorm");
  const jointAngle = app.get("jointAngle");
  const wordJointAngle = app.get("wordJointAngle");
  const origin = [0, 0, 0];

  assert.equal(dist3d(origin, origin), 0);
  assert.equal(dist3d([0, 3, 4], origin), 5);
  // safeNorm floors the magnitude so callers can divide by it.
  assert.ok(safeNorm(origin) > 0);
  assert.equal(safeNorm([0, 3, 4]), 5);
  // The letter contract reports a degenerate joint as zero.
  assert.equal(jointAngle(origin, origin, origin), 0);
  assert.ok(Number.isFinite(wordJointAngle(origin, origin, origin)));
  assert.ok(Math.abs(jointAngle([1, 0, 0], origin, [0, 1, 0]) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(wordJointAngle([1, 0, 0], origin, [0, 1, 0]) - Math.PI / 2) < 1e-9);
});
