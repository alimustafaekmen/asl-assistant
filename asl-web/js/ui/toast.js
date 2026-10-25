// The toast is not a live region: a region that appears together with its
// text is announced unreliably, so announce() writes to one that is always there.

/**
 * @typedef {{label: UiText, run: () => void}} ToastAction
 * @typedef {{action?: ToastAction, durationMs?: number, returnFocus?: HTMLElement | null, onEnd?: () => void}} ToastOptions
 *   returnFocus: the toast disappears after its action, so focus needs a place.
 *   onEnd runs once when the toast hides or is replaced.
 */

let _toastTimer = 0;

/** @type {(() => void) | null} */
let _toastOnEnd = null;

/**
 * Kept as given so a language switch can write them again.
 *
 * @type {{message: UiText, label: UiText | null} | null}
 */
let _toastShown = null;

/**
 * @returns {void}
 */
function endToast() {
  const onEnd = _toastOnEnd;
  _toastOnEnd = null;
  onEnd?.();
}

/**
 * @param {UiText} message
 * @param {ToastOptions} [options]
 * @returns {void}
 */
function showToast(message, options = {}) {
  announce(uiText(message));
  if (!els.toast || !els.toastText || !els.toastAction) return;
  clearTimeout(_toastTimer);
  endToast();
  _toastOnEnd = options.onEnd ?? null;
  const { action } = options;
  _toastShown = { message, label: action ? action.label : null };
  els.toastText.textContent = uiText(message);
  els.toastAction.hidden = !action;
  els.toastAction.onclick = null;
  if (action) els.toastAction.textContent = uiText(action.label);
  els.toast.hidden = false;
  const durationMs = options.durationMs ?? (action ? 6000 : 3000);
  const startTimer = () => {
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, durationMs);
  };
  // WCAG 2.2.1: no timeout while the toast is hovered or its action focused.
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
  _toastShown = null;
  endToast();
}

/**
 * Rewrites the shown toast in the new language without announcing it again.
 *
 * @returns {void}
 */
function renderToastLanguage() {
  if (!_toastShown || !els.toast || els.toast.hidden || !els.toastText || !els.toastAction) return;
  els.toastText.textContent = uiText(_toastShown.message);
  if (_toastShown.label !== null) els.toastAction.textContent = uiText(_toastShown.label);
}

/**
 * @param {string} message
 * @returns {void}
 */
function announce(message) {
  if (!els.announcer) return;
  // A live region only speaks on a change, so a repeated message toggles a
  // trailing no-break space.
  const same = els.announcer.textContent.trim() === message;
  els.announcer.textContent = same && !els.announcer.textContent.endsWith("\u00a0") ? `${message}\u00a0` : message;
}
