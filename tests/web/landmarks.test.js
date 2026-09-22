// MediaPipe results to the fixed 321D word-model frame.
//
// The layout is a published model contract: right hand 0..62, left hand
// 63..125, face 126..245, pose 246..320. A vector with the right length but the
// wrong order still runs and still produces nonsense, so these tests pin the
// slots and the zero-fill behaviour rather than any numeric output.

const test = require("node:test");
const assert = require("node:assert/strict");

let app;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

/** One landmark list with distinguishable, non-zero coordinates. */
function landmarkList(count, seed) {
  return Array.from({ length: count }, (_, i) => ({
    x: seed + i / 1000,
    y: seed + i / 2000,
    z: seed / 10 + i / 4000,
  }));
}

const SLOTS = {
  rightHand: [0, 63],
  leftHand: [63, 126],
  face: [126, 246],
  pose: [246, 321],
};

/** Indices outside `slot` that are non-zero. */
function nonZeroOutside(vector, slot) {
  const [from, to] = SLOTS[slot];
  const stray = [];
  for (let i = 0; i < vector.length; i += 1) {
    if (i >= from && i < to) continue;
    if (vector[i] !== 0) stray.push(i);
  }
  return stray;
}

function countNonZero(vector, slot) {
  const [from, to] = SLOTS[slot];
  let count = 0;
  for (let i = from; i < to; i += 1) if (vector[i] !== 0) count += 1;
  return count;
}

test("a missing result produces a zero-filled 321D frame", () => {
  const landmarksTo321D = app.get("landmarksTo321D");

  for (const empty of [null, undefined, {}]) {
    const frame = landmarksTo321D(empty);
    assert.ok(frame instanceof app.get("Float32Array"));
    assert.equal(frame.length, 321);
    assert.ok([...frame].every((value) => value === 0));
  }
});

test("each landmark group is written to its own slot", () => {
  const landmarksTo321D = app.get("landmarksTo321D");

  const cases = [
    ["rightHand", { rightHandLandmarks: [landmarkList(21, 0.5)] }],
    ["leftHand", { leftHandLandmarks: [landmarkList(21, 0.5)] }],
    ["face", { faceLandmarks: landmarkList(468, 0.5) }],
    ["pose", { poseLandmarks: landmarkList(33, 0.5) }],
  ];

  for (const [slot, result] of cases) {
    const frame = landmarksTo321D(result);
    assert.equal(frame.length, 321);
    assert.deepEqual(nonZeroOutside(frame, slot), [], `${slot} wrote outside its slot`);
    assert.ok(countNonZero(frame, slot) > 0, `${slot} slot stayed empty`);
  }
});

test("hand landmarks are accepted nested or flat", () => {
  const landmarksTo321D = app.get("landmarksTo321D");
  const hand = landmarkList(21, 0.5);

  // MediaPipe nests by detected person; this single-user app takes the first.
  const nested = landmarksTo321D({ rightHandLandmarks: [hand] });
  const flat = landmarksTo321D({ rightHandLandmarks: hand });

  assert.deepEqual([...nested], [...flat]);
});

test("a second detected person is ignored", () => {
  const landmarksTo321D = app.get("landmarksTo321D");
  const first = landmarkList(21, 0.5);
  const second = landmarkList(21, 0.9);

  const both = landmarksTo321D({ rightHandLandmarks: [first, second] });
  const only = landmarksTo321D({ rightHandLandmarks: [first] });

  assert.deepEqual([...both], [...only]);
});

test("_firstList resolves the shapes MediaPipe actually returns", () => {
  const firstList = app.get("_firstList");
  const hand = landmarkList(21, 0.5);

  assert.equal(firstList(null), null);
  assert.equal(firstList(undefined), null);
  assert.equal(firstList([]), null);
  assert.deepEqual(firstList(hand), hand);
  assert.deepEqual(firstList([hand]), hand);
});

test("a shorter landmark list leaves the rest of its slot zeroed", () => {
  const landmarksTo321D = app.get("landmarksTo321D");

  // A truncated hand must not shift coordinates into the next group.
  const frame = landmarksTo321D({ rightHandLandmarks: [landmarkList(5, 0.5)] });

  assert.deepEqual(nonZeroOutside(frame, "rightHand"), []);
  for (let i = 15; i < 63; i += 1) assert.equal(frame[i], 0);
});

test("shoulder normalization keeps the frame length and stays finite", () => {
  const landmarksTo321D = app.get("landmarksTo321D");
  const normalizeShoulders = app.get("normalizeShoulders");

  const frame = landmarksTo321D({
    rightHandLandmarks: [landmarkList(21, 0.5)],
    poseLandmarks: landmarkList(33, 0.5),
  });
  const normalized = normalizeShoulders(frame);

  assert.equal(normalized.length, 321);
  assert.ok([...normalized].every(Number.isFinite));
});

test("shoulder normalization centres on the shoulder midpoint", () => {
  const normalizeShoulders = app.get("normalizeShoulders");

  // Pose landmark 11 (left shoulder) starts at 279, landmark 12 at 282.
  const frame = new Float32Array(321);
  frame[279] = 0.4; frame[280] = 0.5; frame[281] = 0;
  frame[282] = 0.6; frame[283] = 0.5; frame[284] = 0;
  // A point exactly on the midpoint should normalize to the origin.
  frame[0] = 0.5; frame[1] = 0.5; frame[2] = 0;

  const out = normalizeShoulders(frame);

  assert.ok(Math.abs(out[0]) < 1e-6);
  assert.ok(Math.abs(out[1]) < 1e-6);
  // Shoulder width becomes the unit of scale.
  const width = Math.hypot(out[282] - out[279], out[283] - out[280], out[284] - out[281]);
  assert.ok(Math.abs(width - 1) < 1e-6, `expected unit shoulder width, got ${width}`);
});

test("normalization leaves missing landmarks at zero", () => {
  const normalizeShoulders = app.get("normalizeShoulders");

  const frame = new Float32Array(321);
  frame[279] = 0.4; frame[280] = 0.5;
  frame[282] = 0.6; frame[283] = 0.5;
  frame[0] = 0.3; frame[1] = 0.7; frame[2] = 0.1;

  const out = normalizeShoulders(frame);

  // The left hand was never detected and must stay zero-filled.
  for (let i = 63; i < 126; i += 1) assert.equal(out[i], 0);
});

test("a frame without shoulders falls back to min-max scaling", () => {
  const normalizeShoulders = app.get("normalizeShoulders");
  const fallback = app.get("normalizeShouldersFallbackMinMax");

  const frame = new Float32Array(321);
  for (let i = 0; i < 63; i += 1) frame[i] = 0.2 + i / 500;

  assert.deepEqual([...normalizeShoulders(frame)], [...fallback(frame)]);
});

test("the min-max fallback is finite for degenerate frames", () => {
  const fallback = app.get("normalizeShouldersFallbackMinMax");

  const empty = fallback(new Float32Array(321));
  assert.equal(empty.length, 321);
  assert.ok([...empty].every((value) => value === 0));

  // A frame whose non-zero values are all identical has no range to scale by.
  const flat = new Float32Array(321);
  for (let i = 0; i < 63; i += 1) flat[i] = 0.25;
  const scaled = fallback(flat);
  assert.ok([...scaled].every(Number.isFinite));
  assert.deepEqual([...scaled], [...flat]);
});

test("the published index tables keep their documented sizes", () => {
  assert.equal(app.get("FACE_INDICES").length, 40);
  assert.equal(app.get("POSE_INDICES").length, 25);
  // 21*3 hands twice, 40*3 face, 25*3 pose.
  assert.equal(63 + 63 + 120 + 75, 321);
});
