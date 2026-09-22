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
  const projectPoint = (pt) => {
    const rawX = videoRect.x + pt.x * videoRect.width;
    const rawY = videoRect.y + pt.y * videoRect.height;
    // Convert original MediaPipe x coordinates to the CSS-mirrored video view.
    return { x: width - rawX, y: rawY };
  };

  const drawDot = (pt, color, radius = 4) => {
    if (!pt) return;
    const { x, y } = projectPoint(pt);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

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

  const drawHand = (hand, color) => {
    if (!hand || !hand.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];
    for (const [a, b] of connections) {
      if (a < hand.length && b < hand.length) drawLine(hand[a], hand[b], color, 2);
    }
    for (const pt of hand) drawDot(pt, color, 3.8);
  };

  // Word contexts require hand, face, and pose cues. Draw only a small set of
  // guidance points to keep the overlay readable and inexpensive.
  const shouldDrawHolistic =
    typeof state !== "undefined" &&
    (state.mode === "word" ||
      (state.mode === "coach" && typeof state.coachTarget === "string" && state.coachTarget.length > 1));

  const drawPoseKeypoints = (pose) => {
    if (!pose || !pose.length) return;
    const color = "rgba(200, 154, 62, 0.95)";
    // MediaPipe pose indices: shoulders 11/12, elbows 13/14, wrists 15/16, nose 0.
    const pairs = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
    for (const [a, b] of pairs) drawLine(pose[a], pose[b], color, 2.5);
    [0, 11, 12, 13, 14, 15, 16].forEach((idx) => drawDot(pose[idx], color, idx === 0 ? 3.5 : 5));
  };

  const drawFaceKeypoints = (face) => {
    if (!face || !face.length) return;
    const color = "rgba(81, 127, 141, 0.9)";
    // Avoid the full 468-point mesh; these points are sufficient to communicate
    // face direction and framing.
    const idxs = [1, 10, 152, 33, 263, 13, 14, 61, 291].filter((i) => i < face.length);
    idxs.forEach((idx) => drawDot(face[idx], color, 3));
  };

  if (shouldDrawHolistic) {
    drawPoseKeypoints(result.poseLandmarks);
    drawFaceKeypoints(result.faceLandmarks);
  }

  const rh = Array.isArray(result.rightHandLandmarks) && Array.isArray(result.rightHandLandmarks[0])
    ? result.rightHandLandmarks[0]
    : result.rightHandLandmarks;
  const lh = Array.isArray(result.leftHandLandmarks) && Array.isArray(result.leftHandLandmarks[0])
    ? result.leftHandLandmarks[0]
    : result.leftHandLandmarks;

  drawHand(rh, "rgba(99, 179, 237, 0.92)");
  drawHand(lh, "rgba(31, 185, 129, 0.92)");

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
