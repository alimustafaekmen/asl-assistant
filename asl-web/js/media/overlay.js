// Landmark overlay for the camera canvas. The video is mirrored by CSS only and
// drawn with `object-fit: cover`, while MediaPipe coordinates refer to the
// uncropped frame: every point is mapped through the cover rectangle and then
// flipped, or the whole overlay is misplaced.
//
// Every stroke is drawn twice, a dark halo under a light core, so the skeleton
// keeps 3:1 contrast on light skin or a white wall as well as in a dark room.

/**
 * Under cover one axis overflows the box, so x or y is negative.
 *
 * @typedef {Object} VideoCoverRect
 * @property {number} x Left edge relative to the box; negative when cropped.
 * @property {number} y Top edge relative to the box; negative when cropped.
 * @property {number} width Rendered width, which may exceed the box.
 * @property {number} height Rendered height, which may exceed the box.
 */

/**
 * @typedef {Object} OverlayPalette
 * @property {string} core Bones and joints while the stage is not locked.
 * @property {string} lock The core once the stage is locked on a result.
 * @property {string} guide Pose and face guidance points.
 * @property {string} halo The dark outline under every stroke and dot.
 */

/** @type {OverlayPalette | null} */
let _overlayPalette = null;

/**
 * Read from the tokens.css custom properties, so canvas and stylesheet cannot drift.
 *
 * @returns {OverlayPalette}
 */
function overlayPalette() {
  if (_overlayPalette) return _overlayPalette;
  const styles = getComputedStyle(document.documentElement);
  /** @param {string} name @param {string} fallback */
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  _overlayPalette = {
    core: read("--stage-text", "#f5f4f0"),
    lock: read("--stage-lock", "#f2b705"),
    guide: read("--stage-text-2", "#b8babf"),
    halo: read("--stage-halo", "rgba(0, 0, 0, 0.55)"),
  };
  return _overlayPalette;
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

/**
 * Pose and face guidance points are drawn only in word contexts, where framing
 * is what the user needs to fix.
 *
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {MediaPipeFrameResult | null} result Latest frame, or null to draw nothing.
 * @param {number} width Canvas width in CSS pixels.
 * @param {number} height Canvas height in CSS pixels.
 * @param {HTMLVideoElement | null} [videoEl] Source video, for the cover crop.
 * @param {VideoCoverRect | null} [frameRect] Where the landmark image sits when
 *   no video is shown behind it (the demo); the video's cover rectangle otherwise.
 * @returns {void}
 */
function drawLandmarks(ctx, result, width, height, videoEl = null, frameRect = null) {
  if (!result) return;
  ctx.save();

  const videoRect = frameRect ?? _getVideoCoverRect(videoEl, width, height);
  /**
   * @param {NormalizedLandmark} pt Normalized against the original frame.
   * @returns {{x: number, y: number}} Canvas coordinates, already mirrored.
   */
  const projectPoint = (pt) => {
    const rawX = videoRect.x + pt.x * videoRect.width;
    const rawY = videoRect.y + pt.y * videoRect.height;
    return { x: width - rawX, y: rawY };
  };

  /**
   * @param {NormalizedLandmark | null | undefined} pt Skipped when absent.
   * @param {string} color Any CSS colour.
   * @param {number} [radius]
   * @returns {void}
   */
  const drawDot = (pt, color, radius = 4) => {
    if (!pt) return;
    const { x, y } = projectPoint(pt);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  /**
   * @param {NormalizedLandmark | null | undefined} a
   * @param {NormalizedLandmark | null | undefined} b
   * @param {string} color
   * @param {number} [lineWidth]
   * @returns {void} Nothing is drawn unless both endpoints are present.
   */
  const drawLine = (a, b, color, lineWidth = 2) => {
    if (!a || !b) return;
    const pa = projectPoint(a);
    const pb = projectPoint(b);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  };

  const palette = overlayPalette();
  // The skeleton follows the stage state the prediction code wrote, so both agree.
  const core = els.cameraStage?.dataset.state === "good" ? palette.lock : palette.core;

  /**
   * Every halo first, then every core, so where two hands overlap no halo covers a core.
   *
   * @param {(LandmarkList | null)[]} hands The 21-point hands to draw.
   * @returns {void}
   */
  const drawHands = (hands) => {
    const present = hands.filter((hand) => hand && hand.length);
    for (const pass of [{ color: palette.halo, width: 5 }, { color: core, width: 2.25 }]) {
      for (const hand of present) {
        for (const [a, b] of HAND_CONNECTIONS) {
          if (a < hand.length && b < hand.length) drawLine(hand[a], hand[b], pass.color, pass.width);
        }
      }
    }
    for (const pass of [{ color: palette.halo, radius: 5.5 }, { color: core, radius: 3.2 }]) {
      for (const hand of present) {
        for (const pt of hand) drawDot(pt, pass.color, pass.radius);
      }
    }
  };

  const shouldDrawHolistic =
    typeof state !== "undefined" &&
    (state.mode === "word" ||
      (state.mode === "coach" && typeof state.coachTarget === "string" && state.coachTarget.length > 1));

  /**
   * @param {LandmarkList | null | undefined} pose
   * @returns {void}
   */
  const drawPoseKeypoints = (pose) => {
    if (!pose || !pose.length) return;
    const pairs = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
    for (const pass of [{ color: palette.halo, width: 5 }, { color: palette.guide, width: 2 }]) {
      for (const [a, b] of pairs) drawLine(pose[a], pose[b], pass.color, pass.width);
    }
    for (const pass of [{ color: palette.halo, grow: 2 }, { color: palette.guide, grow: 0 }]) {
      [0, 11, 12, 13, 14, 15, 16].forEach((idx) => drawDot(pose[idx], pass.color, (idx === 0 ? 3 : 4) + pass.grow));
    }
  };

  /**
   * @param {LandmarkList | null | undefined} face
   * @returns {void}
   */
  const drawFaceKeypoints = (face) => {
    if (!face || !face.length) return;
    // A few points are enough to show face direction and framing.
    const idxs = [1, 10, 152, 33, 263, 13, 14, 61, 291].filter((i) => i < face.length);
    idxs.forEach((idx) => drawDot(face[idx], palette.halo, 4.5));
    idxs.forEach((idx) => drawDot(face[idx], palette.guide, 2.5));
  };

  if (shouldDrawHolistic) {
    drawPoseKeypoints(result.poseLandmarks);
    drawFaceKeypoints(result.faceLandmarks);
  }

  // The else branch tolerates a flat list (the older Holistic API shape). A
  // type guard cannot classify an array by one element, so this is a cast.
  const rh = /** @type {LandmarkList | null} */ (
    Array.isArray(result.rightHandLandmarks) && Array.isArray(result.rightHandLandmarks[0])
      ? result.rightHandLandmarks[0]
      : result.rightHandLandmarks
  );
  const lh = /** @type {LandmarkList | null} */ (
    Array.isArray(result.leftHandLandmarks) && Array.isArray(result.leftHandLandmarks[0])
      ? result.leftHandLandmarks[0]
      : result.leftHandLandmarks
  );

  // One colour for both hands: colour alone would not reach everyone.
  drawHands([rh, lh]);

  ctx.restore();
}

/**
 * @param {HTMLVideoElement | null | undefined} videoEl
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @returns {VideoCoverRect} The full box until the video reports its size,
 *   instead of dividing by zero.
 */
function _getVideoCoverRect(videoEl, boxWidth, boxHeight) {
  const videoWidth = videoEl?.videoWidth || 0;
  const videoHeight = videoEl?.videoHeight || 0;
  if (!videoWidth || !videoHeight || !boxWidth || !boxHeight) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }

  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  return {
    x: (boxWidth - renderedWidth) / 2,
    y: (boxHeight - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight,
  };
}
