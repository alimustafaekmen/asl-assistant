// Landmark overlay drawing for the camera canvas.
//
// The <video> element is mirrored by CSS only, and it is rendered with
// `object-fit: cover`. MediaPipe reports normalized coordinates against the
// original, uncropped frame, so every point is first mapped through the cover
// rectangle and then flipped horizontally. Skipping either step misplaces the
// whole overlay.
//
// Drawing is intentionally sparse: full hands, plus a small set of pose and
// face guidance points in word contexts, where framing matters.
//
// Every stroke and dot is drawn twice, a dark halo under a light core, so the
// skeleton reads on light skin, a white wall or a plant as well as on a dark
// room; a single-colour stroke fell under 3:1 on most of those. The colours
// are the design tokens, read once: the stage is dark in both themes.

/**
 * Where the video actually sits inside its box under `object-fit: cover`.
 *
 * With cover, one axis fills the box and the other overflows, so x or y is
 * negative and width or height exceeds the box.
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
 * The overlay colours, from the CSS custom properties in tokens.css, so the
 * canvas and the stylesheet cannot drift apart. The defaults apply only if a
 * token is missing.
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

/** Hand bones as landmark index pairs. */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

/**
 * Draw the latest landmarks over the camera canvas.
 *
 * Points arrive normalized against the original frame, so each one is mapped
 * through the cover rectangle and then flipped horizontally to match the
 * CSS-mirrored video. Pose and face guidance points are drawn only in word
 * contexts, where framing is what the user needs to fix.
 *
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {MediaPipeFrameResult | null} result Latest frame, or null to draw nothing.
 * @param {number} width Canvas width in CSS pixels.
 * @param {number} height Canvas height in CSS pixels.
 * @param {HTMLVideoElement | null} [videoEl] Source video, for the cover crop.
 * @returns {void}
 */
function drawLandmarks(ctx, result, width, height, videoEl = null) {
  if (!result) return;
  ctx.save();

  const videoRect = _getVideoCoverRect(videoEl, width, height);
  /**
   * @param {NormalizedLandmark} pt Normalized against the original frame.
   * @returns {{x: number, y: number}} Canvas coordinates, already mirrored.
   */
  const projectPoint = (pt) => {
    const rawX = videoRect.x + pt.x * videoRect.width;
    const rawY = videoRect.y + pt.y * videoRect.height;
    // Convert original MediaPipe x coordinates to the CSS-mirrored video view.
    return { x: width - rawX, y: rawY };
  };

  /**
   * @param {NormalizedLandmark | null | undefined} pt Skipped when absent; an
   *   index into a shorter list than expected yields undefined.
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
  // The frame and the skeleton lock together: the stage's state is what the
  // prediction code wrote, so both always agree.
  const core = els.cameraStage?.dataset.state === "good" ? palette.lock : palette.core;

  /**
   * Draw hands in layers: every halo first, then every core, so where two
   * hands overlap no halo covers a core.
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

  // Word contexts require hand, face, and pose cues. Draw only a small set of
  // guidance points to keep the overlay readable and inexpensive.
  const shouldDrawHolistic =
    typeof state !== "undefined" &&
    (state.mode === "word" ||
      (state.mode === "coach" && typeof state.coachTarget === "string" && state.coachTarget.length > 1));

  /**
   * @param {LandmarkList | null | undefined} pose Full pose list; only the
   *   shoulder, elbow, wrist and nose indices are read.
   * @returns {void}
   */
  const drawPoseKeypoints = (pose) => {
    if (!pose || !pose.length) return;
    // MediaPipe pose indices: shoulders 11/12, elbows 13/14, wrists 15/16, nose 0.
    const pairs = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
    for (const pass of [{ color: palette.halo, width: 5 }, { color: palette.guide, width: 2 }]) {
      for (const [a, b] of pairs) drawLine(pose[a], pose[b], pass.color, pass.width);
    }
    for (const pass of [{ color: palette.halo, grow: 2 }, { color: palette.guide, grow: 0 }]) {
      [0, 11, 12, 13, 14, 15, 16].forEach((idx) => drawDot(pose[idx], pass.color, (idx === 0 ? 3 : 4) + pass.grow));
    }
  };

  /**
   * @param {LandmarkList | null | undefined} face Full face mesh; only a few
   *   framing points are read.
   * @returns {void}
   */
  const drawFaceKeypoints = (face) => {
    if (!face || !face.length) return;
    // Avoid the full 468-point mesh; these points are sufficient to communicate
    // face direction and framing.
    const idxs = [1, 10, 152, 33, 263, 13, 14, 61, 291].filter((i) => i < face.length);
    idxs.forEach((idx) => drawDot(face[idx], palette.halo, 4.5));
    idxs.forEach((idx) => drawDot(face[idx], palette.guide, 2.5));
  };

  if (shouldDrawHolistic) {
    drawPoseKeypoints(result.poseLandmarks);
    drawFaceKeypoints(result.faceLandmarks);
  }

  // Hands arrive nested by detected person and the first one is drawn. The
  // else branch is reached only for an already-flat list or a nullish value,
  // which camera.js no longer produces; it is kept as tolerance for the older
  // Holistic shape. Inspecting one element to classify the array is not
  // something a type guard can express, so the narrowing is stated here.
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

  // One colour for both hands: position tells them apart, and colour alone
  // would not reach everyone.
  drawHands([rh, lh]);

  ctx.restore();
}

/**
 * Compute the cover rectangle for a video inside a box.
 *
 * @param {HTMLVideoElement | null | undefined} videoEl
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @returns {VideoCoverRect} The full box when the video has not reported its
 *   dimensions yet, so the overlay degrades instead of dividing by zero.
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
