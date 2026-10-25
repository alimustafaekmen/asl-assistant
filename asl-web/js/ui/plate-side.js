// On a laptop the result plate covers the stage's bottom-left, where a signing
// hand often is, so it moves to the bottom-right while the hand covers it.
// The holds are in milliseconds, not frames, so the refresh rate does not
// change them. CSS does the moving (data-plate-side on the stage).

// The holds keep a hand at the plate's edge from making it jump every frame.
const PLATE_SIDE_MOVE_MS = 500;
const PLATE_SIDE_RETURN_MS = 1000;
const PLATE_SIDE_SPACING_MS = 2000;
// Phones are left alone: there the plate does not overlap the stage.
const PLATE_SIDE_LAPTOP_QUERY = "(min-width: 64rem)";

/**
 * Stage pixels, mirrored as the visitor sees the stage.
 *
 * @typedef {Object} StageBox
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {"start" | "end"} PlateSide
 */

/**
 * @typedef {Object} PlateSideState
 * @property {PlateSide} side
 * @property {number | null} since When the condition for the next move began.
 * @property {number} lastMove
 */

/**
 * @returns {PlateSideState}
 */
function initialPlateSide() {
  return { side: "start", since: null, lastMove: -Infinity };
}

/**
 * @param {StageBox} a
 * @param {StageBox} b
 * @returns {boolean}
 */
function stageBoxesMeet(a, b) {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/**
 * The plate leaves home only when the hand covers the home corner and not the
 * other one, so it never moves under the hand.
 *
 * @param {PlateSideState} current
 * @param {{hand: StageBox | null, start: StageBox, end: StageBox, now: number, frozen?: boolean}} frame
 * @returns {PlateSideState}
 */
function plateSideFor(current, { hand, start, end, now, frozen = false }) {
  if (frozen) return { ...current, since: null };
  /** @param {StageBox} corner */
  const covered = (corner) => hand !== null && stageBoxesMeet(hand, corner);
  const wantsMove = current.side === "start" ? covered(start) && !covered(end) : !covered(start);
  if (!wantsMove) return { ...current, since: null };

  const since = current.since ?? now;
  const hold = current.side === "start" ? PLATE_SIDE_MOVE_MS : PLATE_SIDE_RETURN_MS;
  if (now - since >= hold && now - current.lastMove >= PLATE_SIDE_SPACING_MS) {
    return { side: current.side === "start" ? "end" : "start", since: null, lastMove: now };
  }
  return { ...current, since };
}

/**
 * Points are normalised to the unmirrored frame, so each goes through the
 * video's cover crop and is then flipped, as overlay.js draws them.
 *
 * @param {MediaPipeFrameResult | null} result
 * @param {number} width
 * @param {number} height
 * @param {HTMLVideoElement | {videoWidth: number, videoHeight: number} | null} videoEl
 * @returns {StageBox | null}
 */
function handBoxOnStage(result, width, height, videoEl) {
  if (!result) return null;
  const crop = _getVideoCoverRect(/** @type {HTMLVideoElement | null} */ (videoEl), width, height);
  /** @type {NormalizedLandmark[]} */
  const points = [];
  for (const hands of [result.rightHandLandmarks, result.leftHandLandmarks]) {
    if (!Array.isArray(hands)) continue;
    // Nested per hand from camera.js; the overlay also accepts a flat list.
    const lists = Array.isArray(hands[0]) ? hands : [hands];
    for (const list of lists) {
      if (Array.isArray(list)) points.push(.../** @type {NormalizedLandmark[]} */ (list));
    }
  }
  if (!points.length) return null;
  const xs = points.map((pt) => width - (crop.x + pt.x * crop.width));
  const ys = points.map((pt) => crop.y + pt.y * crop.height);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** @type {PlateSideState} */
let _plateSide = initialPlateSide();
/** @type {MediaQueryList | null} */
let _plateSideLaptop = null;

/**
 * @param {PlateSide} side
 * @returns {void}
 */
function showPlateSide(side) {
  if (els.cameraStage.dataset.plateSide !== side) els.cameraStage.dataset.plateSide = side;
}

/**
 * @param {number} now
 * @returns {void}
 */
function updatePlateSide(now) {
  const plate = els.resultPlate;
  if (!plate) return;
  if (!_plateSideLaptop && typeof matchMedia === "function") _plateSideLaptop = matchMedia(PLATE_SIDE_LAPTOP_QUERY);
  if (!state.cameraOn || !_plateSideLaptop?.matches) {
    _plateSide = initialPlateSide();
    showPlateSide("start");
    return;
  }

  const stage = els.cameraStage.getBoundingClientRect();
  const box = plate.getBoundingClientRect();
  if (!stage.width || !box.width) return;
  // Mid-slide the gap reads larger, which is harmless: moves are seconds apart.
  const gap = Math.max(0, Math.min(box.left - stage.left, stage.right - box.right));
  const top = box.top - stage.top;
  const bottom = box.bottom - stage.top;
  const start = { left: gap, top, right: gap + box.width, bottom };
  const end = { left: stage.width - gap - box.width, top, right: stage.width - gap, bottom };
  const hand = handBoxOnStage(latestMediaPipeResult, stage.width, stage.height, els.video);
  // Held still while a word records, so it does not slide across the hands.
  const frozen = state.wordState === "COUNTDOWN" || state.wordState === "RECORDING" || state.wordState === "PROCESSING";

  _plateSide = plateSideFor(_plateSide, { hand, start, end, now, frozen });
  showPlateSide(_plateSide.side);
}
