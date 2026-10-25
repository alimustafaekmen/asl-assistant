// Feature engineering for the 168D word and 93D letter model inputs. Segment
// order is the training order and part of the model contract. Python
// references: asl_features.word, asl_features.landmarks and asl_features.letter;
// `make test` compares them.
//
// 168D word layout:
//   [0..62]    dominant-hand landmarks  63D
//   [63..92]   hand-shape features      30D
//   [93..104]  hand-to-face distances   12D
//   [105..167] motion vectors           63D
//
// The 93D letter layout opens the letter section below.

/**
 * @typedef {[number, number, number] | number[]} Vec3
 */

/**
 * 21 landmarks x 3 coordinates; length 63.
 *
 * @typedef {Float32Array} Hand63
 */

/**
 * Length 93: normalized hand 0..62, then the 30D geometry block.
 *
 * @typedef {Float32Array} LetterFeatures93
 */

/**
 * Length 168: dominant hand 0..62, shape 63..92, hand-to-face 93..104, motion 105..167.
 *
 * @typedef {Float32Array} WordFeatures168
 */

/**
 * Measured on raw standardized landmarks, so it is independent of the EMA state.
 *
 * @typedef {Object} LetterMotionStats
 * @property {number} meanAbsDelta Mean absolute change against the previous frame.
 * @property {number} ts Measurement timestamp in milliseconds.
 */

/**
 * Read-only view of the letter landmark smoother, for the debug API.
 * @typedef {Object} LetterSmoothingState
 * @property {boolean} enabled
 * @property {number} alpha EMA weight given to the current frame.
 * @property {boolean} prevSet Whether a previous frame is being smoothed against.
 */

/**
 * Motion is the delta against the previous frame; zero on the first frame.
 *
 * @param {Frame321D} frame321d Normalized holistic frame; length must be 321.
 * @param {Frame321D | null} prevFrame321d Previous normalized frame, or null.
 * @returns {WordFeatures168} Compact feature vector; length is 168.
 */
function buildCompactFeatures(frame321d, prevFrame321d) {
  const t0 = performance.now();

  const dominant = computeDominantHand(frame321d);
  const shape = computeShapeFeatures(dominant);
  const handBody = computeHandBodyRelations(frame321d);

  const motion = new Float32Array(63);
  if (prevFrame321d) {
    const prevDom = computeDominantHand(prevFrame321d);
    for (let i = 0; i < 63; i++) {
      motion[i] = dominant[i] - prevDom[i];
    }
  }

  const compact = new Float32Array(168);
  compact.set(dominant, 0);
  compact.set(shape, 63);
  compact.set(handBody, 93);
  compact.set(motion, 105);

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature", performance.now() - t0);
  }
  return compact;
}

/**
 * Chooses the dominant hand once for the whole recording, as training does;
 * per-frame selection could switch hands mid-sign.
 *
 * @param {Frame321D[]} seq321dFrames Normalized frames in recording order.
 * @returns {WordFeatures168[]} One compact frame per input frame; empty for an
 *   empty or missing sequence.
 */
function buildCompactSequenceFeatures(seq321dFrames) {
  const t0 = performance.now();
  if (!Array.isArray(seq321dFrames) || seq321dFrames.length === 0) return [];

  const dominantSeq = computeDominantHandSequence(seq321dFrames);
  const compactSeq = [];

  for (let t = 0; t < seq321dFrames.length; t++) {
    const dominant = dominantSeq[t];
    const shape = computeShapeFeatures(dominant);
    const handBody = computeHandBodyRelations(seq321dFrames[t]);

    const motion = new Float32Array(63);
    if (t > 0) {
      const prevDom = dominantSeq[t - 1];
      for (let i = 0; i < 63; i++) {
        motion[i] = dominant[i] - prevDom[i];
      }
    }

    const compact = new Float32Array(168);
    compact.set(dominant, 0);
    compact.set(shape, 63);
    compact.set(handBody, 93);
    compact.set(motion, 105);
    compactSeq.push(compact);
  }

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature_sequence", performance.now() - t0);
  }
  return compactSeq;
}

/**
 * A dominant left hand is mirrored by negating x, as the word model was
 * trained; the letter path mirrors differently.
 *
 * @param {Frame321D} frame321d
 * @returns {Hand63} The dominant hand; length is 63.
 */
function computeDominantHand(frame321d) {
  const right = frame321d.slice(0, 63);
  const left = frame321d.slice(63, 126);

  let rZeros = 0;
  let lZeros = 0;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(right[i]) < 1e-8) rZeros++;
    if (Math.abs(left[i]) < 1e-8) lZeros++;
  }

  if (rZeros <= lZeros) return new Float32Array(right);

  const mirrored = new Float32Array(63);
  for (let i = 0; i < 63; i += 3) {
    mirrored[i] = -left[i];
    mirrored[i + 1] = left[i + 1];
    mirrored[i + 2] = left[i + 2];
  }
  return mirrored;
}

/**
 * The side comes from visibility totals over every frame, so a hand that
 * disappears briefly does not flip the choice.
 *
 * @param {Frame321D[]} seq321dFrames
 * @returns {Hand63[]} One hand per input frame, all from the same side.
 */
function computeDominantHandSequence(seq321dFrames) {
  let rightZeros = 0;
  let leftZeros = 0;
  let total = 0;

  for (const frame321d of seq321dFrames) {
    for (let i = 0; i < 63; i++) {
      if (Math.abs(frame321d[i]) < 1e-8) rightZeros++;
      if (Math.abs(frame321d[63 + i]) < 1e-8) leftZeros++;
      total++;
    }
  }

  const useRight = total === 0 || rightZeros <= leftZeros;
  return seq321dFrames.map((frame321d) => {
    if (useRight) return new Float32Array(frame321d.slice(0, 63));

    const mirrored = new Float32Array(63);
    for (let i = 0; i < 63; i += 3) {
      mirrored[i] = -frame321d[63 + i];
      mirrored[i + 1] = frame321d[63 + i + 1];
      mirrored[i + 2] = frame321d[63 + i + 2];
    }
    return mirrored;
  });
}

/**
 * As asl_features.word.compute_per_frame_shape_features: centred on the wrist
 * and scaled by the wrist-to-middle-MCP distance.
 *
 * @param {Hand63} hand63
 * @returns {Float32Array} Geometry block; length is 30.
 */
function computeShapeFeatures(hand63) {
  const result = new Float32Array(30);

  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const TIPS = [4, 8, 12, 16, 20];
  const MCPS = [1, 5, 9, 13, 17];
  const wrist = pts[0];
  const palmSize = Math.max(dist3d(pts[9], wrist), 1e-8);
  const norm = pts.map((p) => [
    (p[0] - wrist[0]) / palmSize,
    (p[1] - wrist[1]) / palmSize,
    (p[2] - wrist[2]) / palmSize,
  ]);

  let idx = 0;

  // Five fingertip-to-wrist distances.
  for (const t of TIPS) result[idx++] = safeNorm(norm[t]);

  // Four adjacent-fingertip distances.
  for (let i = 0; i < TIPS.length - 1; i++) {
    result[idx++] = dist3d(norm[TIPS[i]], norm[TIPS[i + 1]]);
  }

  // Ten pairwise fingertip distances.
  for (let i = 0; i < TIPS.length; i++) {
    for (let j = i + 1; j < TIPS.length; j++) {
      result[idx++] = dist3d(norm[TIPS[i]], norm[TIPS[j]]);
    }
  }

  // Five binary finger-extension flags.
  for (let i = 0; i < 5; i++) {
    const tipDist = safeNorm(norm[TIPS[i]]);
    const mcpDist = safeNorm(norm[MCPS[i]]);
    result[idx++] = tipDist > mcpDist ? 1.0 : 0.0;
  }

  // Three PIP angles for the index, middle, and ring fingers.
  const angleTriples = [
    [5, 6, 7],    // Index PIP
    [9, 10, 11],  // Middle PIP
    [13, 14, 15], // Ring PIP
  ];
  for (const [a, b, c] of angleTriples) {
    result[idx++] = wordJointAngle(norm[a], norm[b], norm[c]);
  }

  // Bounding-box aspect ratio and area over visible normalized x/y points.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let visibleCount = 0;
  for (const p of norm) {
    // A point is visible when at least one normalized coordinate is non-zero.
    if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) {
      visibleCount++;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (visibleCount > 2) {
    const bw = maxX - minX;
    const bh = maxY - minY;
    result[idx++] = bw / Math.max(bh, 1e-8);
    result[idx++] = bw * bh;
  } else {
    result[idx++] = 0;
    result[idx++] = 0;
  }

  // Mean normalized fingertip distance.
  let sumTip = 0;
  for (const t of TIPS) sumTip += safeNorm(norm[t]);
  result[idx++] = sumTip / 5;

  return result;
}

/**
 * Each hand's index fingertip and wrist against the nose, mouth and forehead.
 *
 * @param {Frame321D} frame321d
 * @returns {Float32Array} Six values per hand, right then left; length is 12.
 */
function computeHandBodyRelations(frame321d) {
  // Offsets follow the FACE_INDICES order:
  // nose 1 -> 222, mouth 13 -> 165, forehead 168 -> 234.
  const nose = [frame321d[222], frame321d[223], frame321d[224]];
  const mouth = [frame321d[165], frame321d[166], frame321d[167]];
  const forehead = [frame321d[234], frame321d[235], frame321d[236]];

  const result = new Float32Array(12);

  // Right index fingertip is at 24..26; right wrist is at 0..2.
  const rTip = [frame321d[24], frame321d[25], frame321d[26]];
  const rWrist = [frame321d[0], frame321d[1], frame321d[2]];
  result[0] = dist3d(rTip, nose);
  result[1] = dist3d(rTip, mouth);
  result[2] = dist3d(rTip, forehead);
  result[3] = dist3d(rWrist, nose);
  result[4] = rTip[1] - nose[1];
  result[5] = dist3d(rTip, rWrist);

  // Left hand uses the same local offsets after the 63D right-hand segment.
  const lTip = [frame321d[63 + 24], frame321d[63 + 25], frame321d[63 + 26]];
  const lWrist = [frame321d[63], frame321d[64], frame321d[65]];
  result[6] = dist3d(lTip, nose);
  result[7] = dist3d(lTip, mouth);
  result[8] = dist3d(lTip, forehead);
  result[9] = dist3d(lWrist, nose);
  result[10] = lTip[1] - nose[1];
  result[11] = dist3d(lTip, lWrist);

  return result;
}

// 93D letter layout, matching asl_features.landmarks.normalize_landmarks
// followed by asl_features.letter.extract_features:
//   [0..62]    wrist-centered hand scaled by middle-MCP distance
//   [63..67]   fingertip-to-wrist distances (5)
//   [68..71]   adjacent-fingertip distances (4)
//   [72..85]   finger-joint angles (14)
//   [86..87]   hand bounding-box aspect ratio and area (2)
//   [88..92]   finger-extension flags (5)
//
// Letter-only EMA and motion state; word features do not use it.
/** @type {Hand63 | null} */
let _letterPrevHandSmoothed = null;
/** @type {LetterMotionStats | null} */
let _letterLastMotion = null;

/**
 * An all-zero hand means tracking was lost, so the smoother resets instead of
 * easing toward a pose that was never made.
 *
 * @param {Hand63} current63
 * @returns {Hand63} The smoothed hand, or the input when smoothing is off or
 *   there is nothing to smooth against.
 */
function _smoothLetterHand63(current63) {
  const enabled =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED
      : true;
  const alpha =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA
      : 0.6;

  let allZero = true;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(current63[i]) > 1e-8) { allZero = false; break; }
  }
  if (allZero) {
    _letterPrevHandSmoothed = null;
    return current63;
  }

  if (!enabled) {
    _letterPrevHandSmoothed = new Float32Array(current63);
    return current63;
  }

  if (!_letterPrevHandSmoothed || _letterPrevHandSmoothed.length !== 63) {
    _letterPrevHandSmoothed = new Float32Array(current63);
    return current63;
  }

  const out = new Float32Array(63);
  for (let i = 0; i < 63; i++) {
    out[i] = alpha * current63[i] + (1 - alpha) * _letterPrevHandSmoothed[i];
  }
  _letterPrevHandSmoothed = out;
  return out;
}

/**
 * Mean absolute delta between unsmoothed hands, with its own previous frame.
 *
 * @param {Hand63} current63
 * @returns {LetterMotionStats} Zero delta on the first frame after a reset.
 */
function _computeLetterMotion63(current63) {
  if (!_letterPrevHandRawForMotion || _letterPrevHandRawForMotion.length !== 63) {
    _letterPrevHandRawForMotion = new Float32Array(current63);
    return { meanAbsDelta: 0, ts: performance.now() };
  }
  let sum = 0;
  for (let i = 0; i < 63; i++) {
    sum += Math.abs(current63[i] - _letterPrevHandRawForMotion[i]);
  }
  _letterPrevHandRawForMotion = new Float32Array(current63);
  return { meanAbsDelta: sum / 63, ts: performance.now() };
}
/** @type {Hand63 | null} */
let _letterPrevHandRawForMotion = null;

/**
 * @returns {LetterMotionStats | null} Null until a letter frame has been
 *   processed, and again after a reset.
 */
function getLastLetterMotion() {
  return _letterLastMotion;
}

/**
 * @returns {LetterSmoothingState}
 */
function getLetterSmoothingState() {
  const enabled =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED
      : true;
  const alpha =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA
      : 0.6;
  return { enabled, alpha, prevSet: _letterPrevHandSmoothed != null };
}

/**
 * Called on mode changes, camera resets and hand loss, so one sign cannot leak
 * into the next.
 *
 * @returns {void}
 */
function resetLetterLandmarkSmoother() {
  _letterPrevHandSmoothed = null;
  _letterPrevHandRawForMotion = null;
  _letterLastMotion = null;
}

/**
 * Multiplies x and z by `aspect` so one unit is the same length on every axis,
 * as in the square training photographs (asl_features.landmarks.to_square_units).
 *
 * @param {Frame321D} frame321d
 * @param {number} aspect Frame width divided by height.
 * @returns {Frame321D} The same frame when `aspect` is 1 or unusable, else a copy.
 */
function _isotropicHands(frame321d, aspect) {
  if (!(aspect > 0) || aspect === 1 || !Number.isFinite(aspect)) return frame321d;
  const frame = Float32Array.from(frame321d);
  // Right hand 0..62, left hand 63..125: x, y, z per landmark.
  for (let i = 0; i < 126; i += 3) {
    frame[i] *= aspect;
    frame[i + 2] *= aspect;
  }
  return frame;
}

/**
 * Stateful: updates the motion measurement and the EMA. MediaPipe x and y are
 * fractions of width and height, so a 16:9 frame squeezes the hand while the
 * model was trained on square photographs; `aspect` undoes that first.
 *
 * @param {Frame321D} frame321d
 * @param {number} [aspect] Frame width divided by height; 1 for a square frame.
 * @returns {LetterFeatures93} Letter feature vector; length is 93.
 */
function computeLetterFeatures(frame321d, aspect = 1) {
  const t0 = performance.now();
  const frame = _isotropicHands(frame321d, aspect);
  const handPrimary = selectPrimaryHandForLetter(frame);
  _letterLastMotion = _computeLetterMotion63(handPrimary);
  const handSmoothed = _smoothLetterHand63(handPrimary);
  const hand = normalizeHandForLetter(handSmoothed);
  const shape = computeLetterShapeFeatures(hand);

  const out = new Float32Array(93);
  out.set(hand, 0);
  out.set(shape, 63);

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature", performance.now() - t0);
  }
  return out;
}

/**
 * The training data is right-handed, so a left hand is mirrored as 1 - x
 * (MediaPipe x is in [0, 1]); a missing landmark stays zero. With both hands
 * fully visible the clearly raised hand wins, so a left-handed signer's
 * resting right hand is not read; otherwise the tie goes to the right hand.
 *
 * @param {Frame321D} frame321d
 * @returns {Hand63} The primary hand, or 63 zeros when neither hand is visible.
 */
function selectPrimaryHandForLetter(frame321d) {
  const right = frame321d.slice(0, 63);
  const left = frame321d.slice(63, 126);

  const rightVisible = _nonZeroTriplets(right);
  const leftVisible = _nonZeroTriplets(left);

  if (rightVisible === 0 && leftVisible === 0) return new Float32Array(63);
  if (rightVisible > leftVisible) return new Float32Array(right);
  if (rightVisible === leftVisible && !_wristClearlyHigher(left, right)) return new Float32Array(right);

  const mirrored = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    const x = left[i * 3];
    const y = left[i * 3 + 1];
    const z = left[i * 3 + 2];
    const isZero = Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8 && Math.abs(z) < 1e-8;
    mirrored[i * 3] = isZero ? 0 : 1.0 - x;
    mirrored[i * 3 + 1] = y;
    mirrored[i * 3 + 2] = z;
  }
  return mirrored;
}

// How much higher a wrist must be, as a fraction of frame height, to win the tie.
const LETTER_RAISED_HAND_MARGIN = 0.1;

/**
 * Smaller y is higher; both wrists must be present.
 *
 * @param {Hand63} a
 * @param {Hand63} b
 * @returns {boolean}
 */
function _wristClearlyHigher(a, b) {
  /** @param {Hand63} h */
  const present = (h) => Math.abs(h[0]) > 1e-8 || Math.abs(h[1]) > 1e-8 || Math.abs(h[2]) > 1e-8;
  if (!present(a) || !present(b)) return false;
  return b[1] - a[1] > LETTER_RAISED_HAND_MARGIN;
}

/**
 * @param {Hand63} hand63
 * @returns {number} How many of the 21 landmarks have any non-zero coordinate.
 */
function _nonZeroTriplets(hand63) {
  let count = 0;
  for (let i = 0; i < 63; i += 3) {
    if (
      Math.abs(hand63[i]) > 1e-8 ||
      Math.abs(hand63[i + 1]) > 1e-8 ||
      Math.abs(hand63[i + 2]) > 1e-8
    ) {
      count++;
    }
  }
  return count;
}

/**
 * As asl_features.landmarks.normalize_landmarks.
 *
 * @param {Hand63} hand63
 * @returns {Hand63} Normalized hand, or 63 zeros when the reference distance is
 *   degenerate; length is 63.
 */
function normalizeHandForLetter(hand63) {
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const wrist = pts[0];
  const centered = pts.map((p) => [
    p[0] - wrist[0],
    p[1] - wrist[1],
    p[2] - wrist[2],
  ]);
  const refDist = safeNorm(centered[9]);
  if (refDist <= 1e-6) return new Float32Array(63);

  const out = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = centered[i][0] / refDist;
    out[i * 3 + 1] = centered[i][1] / refDist;
    out[i * 3 + 2] = centered[i][2] / refDist;
  }
  return out;
}

/**
 * @param {Hand63} hand63 Already normalized by normalizeHandForLetter().
 * @returns {Float32Array} Geometry block; length is 30.
 */
function computeLetterShapeFeatures(hand63) {
  const result = new Float32Array(30);
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const fingertipIds = [4, 8, 12, 16, 20];
  const adjacentPairs = [[4, 8], [8, 12], [12, 16], [16, 20]];
  const angleTriples = [
    [1, 2, 3], [2, 3, 4],
    [0, 5, 6], [5, 6, 7], [6, 7, 8],
    [0, 9, 10], [9, 10, 11], [10, 11, 12],
    [0, 13, 14], [13, 14, 15], [14, 15, 16],
    [0, 17, 18], [17, 18, 19], [18, 19, 20],
  ];
  const extendedPairs = [[4, 2], [8, 5], [12, 9], [16, 13], [20, 17]];

  let idx = 0;
  const wrist = pts[0];

  for (const tip of fingertipIds) {
    result[idx++] = dist3d(pts[tip], wrist);
  }

  for (const [a, b] of adjacentPairs) {
    result[idx++] = dist3d(pts[a], pts[b]);
  }

  for (const [a, b, c] of angleTriples) {
    result[idx++] = jointAngle(pts[a], pts[b], pts[c]);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  result[idx++] = boxWidth / (boxHeight + 1e-8);
  result[idx++] = boxWidth * boxHeight;

  for (const [tip, mcp] of extendedPairs) {
    result[idx++] = dist3d(pts[tip], wrist) > dist3d(pts[mcp], wrist) ? 1.0 : 0.0;
  }

  return result;
}

/**
 * @param {Vec3} a
 * @param {Vec3} b
 * @returns {number} Euclidean distance.
 */
function dist3d(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Vector magnitude with a floor, so callers can divide by it safely.
 *
 * @param {Vec3} v
 * @returns {number} Magnitude, never zero.
 */
function safeNorm(v) {
  return Math.max(Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]), 1e-8);
}

/**
 * Word contract: degenerate vectors are floored by safeNorm(), so the angle is
 * finite rather than NaN.
 *
 * @param {Vec3} a
 * @param {Vec3} b Vertex.
 * @param {Vec3} c
 * @returns {number} Angle in radians.
 */
function wordJointAngle(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = safeNorm(v1);
  const n2 = safeNorm(v2);
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return Math.acos(cos);
}

/**
 * Letter contract: a missing or degenerate joint is reported as zero.
 *
 * @param {Vec3} a
 * @param {Vec3} b Vertex.
 * @param {Vec3} c
 * @returns {number} Angle in radians, or 0 when degenerate.
 */
function jointAngle(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
  const n2 = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2);
  if (n1 < 1e-8 || n2 < 1e-8) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return Math.acos(cos);
}
