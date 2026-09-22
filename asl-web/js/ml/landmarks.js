// MediaPipe results to the fixed 321D word-model landmark vector.
//
// Feature order must match the final training notebook. A dimensionally valid
// vector with a different order will still run but produce invalid predictions.
//
// Layout:
//   [0..62]    right hand  (21 landmarks x 3)
//   [63..125]  left hand   (21 landmarks x 3)
//   [126..245] face        (40 selected landmarks x 3)
//   [246..320] pose        (25 selected landmarks x 3)
//
// FACE_INDICES is copied from notebooks/word_50_training.ipynb and belongs to
// the published 50-word model contract.

/**
 * One normalized holistic frame in the published 321D layout.
 *
 * JSDoc cannot express the length, so it stays a runtime invariant: the value
 * is always a Float32Array of exactly 321 values, laid out as right hand 0..62,
 * left hand 63..125, face 126..245, pose 246..320.
 *
 * @typedef {Float32Array} Frame321D
 */

/** @type {number[]} */
const FACE_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375,    // Outer lips (10)
  78, 191, 80, 13, 312, 308,                       // Inner lips (6)
  33, 133, 159, 145, 263, 362, 386, 374,           // Eyes (8)
  70, 63, 105, 66, 300, 293, 334, 296,             // Eyebrows (8)
  1, 2, 98, 327, 168, 197, 195, 5,                 // Nose and forehead (8)
];

/** @type {number[]} */
const POSE_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  23, 24, 25, 26, 27, 28, 29, 30,
];

console.assert(FACE_INDICES.length === 40, "FACE_INDICES 40 eleman olmalı");
console.assert(POSE_INDICES.length === 25, "POSE_INDICES 25 eleman olmalı");

/**
 * Resolve one landmark list from either shape MediaPipe returns.
 *
 * Hand results are nested by detected person; pose and face results are already
 * flat. This single-user app always takes the first detected person.
 *
 * @param {LandmarkList | LandmarkList[] | null | undefined} maybeNested
 * @returns {LandmarkList | null} Null when nothing was detected.
 */
function _firstList(maybeNested) {
  if (!maybeNested) return null;
  if (Array.isArray(maybeNested) && maybeNested.length > 0) {
    // Nested array: select the first detected person.
    if (Array.isArray(maybeNested[0])) return maybeNested[0];
    // A non-array first element means this is already a flat landmark list.
    // Inspecting one element to classify the whole array is not something a
    // type guard can express, so the narrowing is stated here.
    return /** @type {LandmarkList} */ (maybeNested);
  }
  return null;
}

/**
 * Flatten a MediaPipe frame into the published 321D layout.
 *
 * Every group is optional. A missing or short group stays zero-filled rather
 * than shifting the following groups, which is how the training pipeline
 * represents an undetected body part.
 *
 * @param {Partial<MediaPipeFrameResult> | null | undefined} holisticResult
 * @returns {Frame321D} Always 321 values, even for an empty result.
 */
function landmarksTo321D(holisticResult) {
  const vec = new Float32Array(321);
  if (!holisticResult) return vec;

  const rh = _firstList(holisticResult.rightHandLandmarks);
  if (rh) {
    for (let i = 0; i < 21 && i < rh.length; i++) {
      vec[i * 3] = rh[i].x ?? 0;
      vec[i * 3 + 1] = rh[i].y ?? 0;
      vec[i * 3 + 2] = rh[i].z ?? 0;
    }
  }

  const lh = _firstList(holisticResult.leftHandLandmarks);
  if (lh) {
    for (let i = 0; i < 21 && i < lh.length; i++) {
      vec[63 + i * 3] = lh[i].x ?? 0;
      vec[63 + i * 3 + 1] = lh[i].y ?? 0;
      vec[63 + i * 3 + 2] = lh[i].z ?? 0;
    }
  }

  const face = _firstList(holisticResult.faceLandmarks);
  if (face) {
    for (let j = 0; j < FACE_INDICES.length; j++) {
      const fi = FACE_INDICES[j];
      if (fi < face.length) {
        vec[126 + j * 3] = face[fi].x ?? 0;
        vec[126 + j * 3 + 1] = face[fi].y ?? 0;
        vec[126 + j * 3 + 2] = face[fi].z ?? 0;
      }
    }
  }

  const pose = _firstList(holisticResult.poseLandmarks);
  if (pose) {
    for (let j = 0; j < POSE_INDICES.length; j++) {
      const pi = POSE_INDICES[j];
      if (pi < pose.length) {
        vec[246 + j * 3] = pose[pi].x ?? 0;
        vec[246 + j * 3 + 1] = pose[pi].y ?? 0;
        vec[246 + j * 3 + 2] = pose[pi].z ?? 0;
      }
    }
  }

  return vec;
}

/**
 * Centre visible landmarks on the shoulder midpoint and scale by shoulder width.
 *
 * Zero-valued landmarks are left at zero, so an undetected group stays
 * undetected instead of being translated to a spurious position. When the
 * shoulders are missing or coincident, the notebook-compatible min-max fallback
 * runs instead.
 *
 * @param {Frame321D} frame321d
 * @returns {Frame321D} A new frame; the input is not modified.
 */
function normalizeShoulders(frame321d) {
  // Pose 11 (left shoulder) starts at 279; pose 12 (right) starts at 282.
  const LS_OFF = 279;
  const RS_OFF = 282;

  const ls = [frame321d[LS_OFF], frame321d[LS_OFF + 1], frame321d[LS_OFF + 2]];
  const rs = [frame321d[RS_OFF], frame321d[RS_OFF + 1], frame321d[RS_OFF + 2]];

  const lsOk = ls.some((v) => Math.abs(v) > 1e-6);
  const rsOk = rs.some((v) => Math.abs(v) > 1e-6);
  if (!lsOk || !rsOk) return normalizeShouldersFallbackMinMax(frame321d);

  const cx = (ls[0] + rs[0]) / 2;
  const cy = (ls[1] + rs[1]) / 2;
  const cz = (ls[2] + rs[2]) / 2;
  const w = Math.sqrt(
    (ls[0] - rs[0]) ** 2 + (ls[1] - rs[1]) ** 2 + (ls[2] - rs[2]) ** 2,
  );
  if (w < 1e-6) return normalizeShouldersFallbackMinMax(frame321d);

  const out = new Float32Array(321);
  for (let i = 0; i < 321; i += 3) {
    const nonZero =
      Math.abs(frame321d[i]) > 1e-8 ||
      Math.abs(frame321d[i + 1]) > 1e-8 ||
      Math.abs(frame321d[i + 2]) > 1e-8;
    if (nonZero) {
      out[i] = (frame321d[i] - cx) / w;
      out[i + 1] = (frame321d[i + 1] - cy) / w;
      out[i + 2] = (frame321d[i + 2] - cz) / w;
    }
  }
  return out;
}

/**
 * Scale a frame by the min-max range of its non-zero values.
 *
 * This is the notebook-compatible path used when shoulders are unavailable. A
 * frame with no visible landmarks returns all zeros, and a frame whose values
 * share one magnitude is passed through unscaled, so the result is always
 * finite.
 *
 * @param {Frame321D} frame321d
 * @returns {Frame321D} A new frame; the input is not modified.
 */
function normalizeShouldersFallbackMinMax(frame321d) {
  // Preserve zero-valued missing landmarks while scaling non-zero values.
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < frame321d.length; i++) {
    const v = frame321d[i];
    if (Math.abs(v) > 1e-8) {
      if (v < minValue) minValue = v;
      if (v > maxValue) maxValue = v;
    }
  }

  const out = new Float32Array(frame321d.length);
  if (minValue === Infinity) return out;

  const range = maxValue - minValue;
  if (range <= 1e-6) {
    out.set(frame321d);
    return out;
  }

  for (let i = 0; i < frame321d.length; i++) {
    const v = frame321d[i];
    out[i] = Math.abs(v) > 1e-8 ? (v - minValue) / range : 0;
  }
  return out;
}
