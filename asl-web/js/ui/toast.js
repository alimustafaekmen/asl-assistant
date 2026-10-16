// Confirmations: a short toast on the camera stage, with at most one action,
// and a polite live region that tells a screen reader the same thing.
//
// One toast at a time; a new one replaces the last. The toast itself is not a
// live region, because a region that appears with its text is announced
// unreliably; announce() writes to a region that is always present.

/**
 * @typedef {{label: string, run: () => void}} ToastAction
 * @typedef {{action?: ToastAction, durationMs?: number, returnFocus?: HTMLElement | null}} ToastOptions
 *   returnFocus is where focus goes after the action: the toast disappears,
 *   so a keyboard user would otherwise be left on the page.
 */

/** Pending auto-hide, so a newer toast is not hidden by an older timer. */
let _toastTimer = 0;

/**
 * Show a confirmation, and announce it.
 *
 * @param {string} message
 * @param {ToastOptions} [options] An action keeps the toast up longer, so there
 *   is time to reach it.
 * @returns {void}
 */
function showToast(message, options = {}) {
  announce(message);
  if (!els.toast || !els.toastText || !els.toastAction) return;
  clearTimeout(_toastTimer);
  els.toastText.textContent = message;
  const { action } = options;
  els.toastAction.hidden = !action;
  els.toastAction.onclick = null;
  if (action) els.toastAction.textContent = action.label;
  els.toast.hidden = false;
  const durationMs = options.durationMs ?? (action ? 6000 : 3000);
  const startTimer = () => {
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, durationMs);
  };
  // No timeout while the toast is being read or reached (WCAG 2.2.1): the
  // timer stops on hover and focus and starts again when they leave.
  // The action is the toast's only focusable part, so its focus stands for the
  // toast's.
  const pause = () => clearTimeout(_toastTimer);
  els.toast.onmouseenter = pause;
  els.toast.onmouseleave = startTimer;
  els.toastAction.onfocus = pause;
  els.toastAction.onblur = startTimer;
  if (action) {
    els.toastAction.onclick = () => {
      hideToast();
      action.run();
      options.returnFocus?.focus();
    };
  }
  startTimer();
}

/**
 * @returns {void}
 */
function hideToast() {
  clearTimeout(_toastTimer);
  if (els.toast) els.toast.hidden = true;
}

/**
 * Tell a screen reader something without showing it.
 *
 * @param {string} message
 * @returns {void}
 */
function announce(message) {
  if (!els.announcer) return;
  // A live region speaks when its text changes, so the same message twice in a
  // row (a second "A eklendi") alternates a trailing no-break space.
  const same = els.announcer.textContent.trim() === message;
  els.announcer.textContent = same && !els.announcer.textContent.endsWith("\u00a0") ? `${message}\u00a0` : message;
}
