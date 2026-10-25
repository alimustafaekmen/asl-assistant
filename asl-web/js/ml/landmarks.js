// MediaPipe results to the 321D holistic frame the word model reads.
//
// The order must match the training notebook: a vector of the right length in
// the wrong order still runs and predicts nonsense.
//
//   [0..62]    right hand  (21 landmarks x 3)
//   [63..125]  left hand   (21 landmarks x 3)
//   [126..245] face        (40 selected landmarks x 3)
//   [246..320] pose        (25 selected landmarks x 3)
//
// FACE_INDICES and POSE_INDICES come from notebooks/word_50_training.ipynb and
// are part of the model contract. Python reference: asl_features.word.

/**
 * Exactly 321 values; JSDoc cannot express the length.
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

console.assert(FACE_INDICES.length === 40, "FACE_INDICES must have 40 entries");
console.assert(POSE_INDICES.length === 25, "POSE_INDICES must have 25 entries");

/**
 * Hand results are nested per detected hand; pose and face are already flat.
 *
 * @param {LandmarkList | LandmarkList[] | null | undefined} maybeNested
 * @returns {LandmarkList | null} Null when nothing was detected.
 */
function _firstList(maybeNested) {
  if (!maybeNested) return null;
  if (Array.isArray(maybeNested) && maybeNested.length > 0) {
    if (Array.isArray(maybeNested[0])) return maybeNested[0];
    // Already flat; a type guard cannot classify an array by one element.
    return /** @type {LandmarkList} */ (maybeNested);
  }
  return null;
}

/**
 * A missing or short group stays zero-filled rather than shifting the following
 * groups, as training represents an undetected body part.
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
 * Centre on the shoulder midpoint and scale by shoulder width. Zero landmarks
 * stay zero, so an undetected group is not moved to a spurious position.
 * Without usable shoulders the notebook's min-max fallback runs.
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
 * The notebook's path for a frame without usable shoulders. Zeros are missing
 * landmarks and stay zero; the result is always finite.
 *
 * @param {Frame321D} frame321d
 * @returns {Frame321D} A new frame; the input is not modified.
 */
function normalizeShouldersFallbackMinMax(frame321d) {
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
