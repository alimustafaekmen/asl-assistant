// Hold detection: a letter counts when it is held steadily for a while. The
// smoothed confidence already carries stability; this adds the time. The time
// is passed in, never read from a clock, so the detector behaves the same at
// any frame rate and a test can drive it with plain numbers.

/**
 * "done" is reported once per hold. "blocked": a hold completed and the pose
 * is still there, so nothing counts again until it is released.
 *
 * @typedef {"idle" | "holding" | "done" | "blocked"} HoldPhase
 */

/**
 * @typedef {Object} HoldObservation
 * @property {string} label The smoothed label.
 * @property {number} confidence The smoothed confidence, in [0, 1].
 * @property {boolean} handPresent False on a frame with no hand.
 */

/**
 * @typedef {Object} HoldStatus
 * @property {HoldPhase} phase
 * @property {number} progress In [0, 1]: 0 when idle, 1 when done or blocked.
 * @property {string | null} heldLabel The target while it is held, done or
 *   blocked; null when idle.
 */

/**
 * @typedef {Object} HoldTimings
 * @property {number} holdMs How long the target must be held to succeed.
 * @property {number} minConfidence The confidence the target must reach to count as held.
 * @property {number} graceMs The longest dip below that confidence that pauses
 *   the hold instead of starting it over.
 * @property {number} releaseMs How long another letter must show before a
 *   completed hold may count again.
 */

/**
 * @typedef {Object} HoldTracker
 * @property {(observation: HoldObservation, target: string, now: number) => HoldStatus} update
 *   Feed one observation; `now` is in milliseconds on any forward-only clock.
 * @property {() => void} reset Forget the hold in progress and any completed one.
 */

/**
 * A dip pauses the hold when the two sightings around it are at most graceMs
 * apart; otherwise the hold starts over. A different label or a lost hand is
 * never a dip: the smoother has already decided the hand shows something else.
 *
 * @param {HoldTimings} timings
 * @returns {HoldTracker}
 */
function createHoldTracker({ holdMs, minConfidence, graceMs, releaseMs }) {
  let holding = false;
  let heldMs = 0;
  let lastHeldAt = 0;
  let lastWasHeld = false;
  /** @type {string | null} */
  let heldTarget = null;
  // After a success: blocked until another label has been seen this long.
  let blocked = false;
  /** @type {number | null} */
  let awaySince = null;

  /** @returns {void} */
  const dropHold = () => {
    holding = false;
    heldMs = 0;
    lastWasHeld = false;
    heldTarget = null;
  };

  /** @returns {HoldStatus} */
  const idle = () => ({ phase: "idle", progress: 0, heldLabel: null });

  /**
   * @param {string} target
   * @returns {HoldStatus}
   */
  const stillBlocked = (target) => ({ phase: "blocked", progress: 1, heldLabel: target });

  /**
   * @param {string} target
   * @param {number} now
   * @returns {void}
   */
  const startHold = (target, now) => {
    holding = true;
    heldMs = 0;
    lastHeldAt = now;
    lastWasHeld = true;
    heldTarget = target;
  };

  return {
    update({ label, confidence, handPresent }, target, now) {
      if (!handPresent) {
        dropHold();
        blocked = false;
        awaySince = null;
        return idle();
      }

      if (blocked) {
        if (label === target) {
          awaySince = null;
          return stillBlocked(target);
        }
        if (awaySince === null) awaySince = now;
        if (now - awaySince < releaseMs) return stillBlocked(target);
        blocked = false;
        awaySince = null;
        return idle();
      }

      if (label !== target || (heldTarget !== null && heldTarget !== target)) {
        dropHold();
        return idle();
      }

      const held = confidence >= minConfidence;
      if (!holding) {
        if (!held) return idle();
        startHold(target, now);
      } else if (now - lastHeldAt > graceMs) {
        // The dip outlasted the grace: start over, from now if this frame holds.
        if (!held) {
          dropHold();
          return idle();
        }
        startHold(target, now);
      } else if (held) {
        // Time inside a dip is not held time: only consecutive sightings add.
        if (lastWasHeld) heldMs += now - lastHeldAt;
        lastHeldAt = now;
        lastWasHeld = true;
      } else {
        lastWasHeld = false;
      }

      if (heldMs >= holdMs) {
        dropHold();
        blocked = true;
        awaySince = null;
        return { phase: "done", progress: 1, heldLabel: target };
      }
      return { phase: "holding", progress: heldMs / holdMs, heldLabel: target };
    },

    reset() {
      dropHold();
      blocked = false;
      awaySince = null;
    },
  };
}
