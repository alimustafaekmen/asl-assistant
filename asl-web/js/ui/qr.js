// kjua is fetched the first time the screen draws; without it the screen still
// works through the copyable link.

/**
 * A local page has no shareable origin, so it links to the published site.
 *
 * @returns {string}
 */
function getDemoBaseUrl() {
  const host = window.location.hostname;
  const isLocal =
    window.location.protocol === "file:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "";
  if (isLocal) return CONFIG.DEMO_PUBLIC_URL;

  const pathname = window.location.pathname || "/";
  const directory = pathname.endsWith("/") ? pathname : pathname.replace(/[^/]*$/, "");
  return new URL(directory || "/", window.location.origin).href;
}

/**
 * @param {string} [target]
 * @returns {string}
 */
function buildQrDemoUrl(target = state.qrTarget) {
  const normalizedTarget = ["letter", "word", "test"].includes(target) ? target : "letter";
  return `${getDemoBaseUrl()}#${normalizedTarget}`;
}

/**
 * Bound to change, not click: arrow keys between radios fire no click on some
 * browsers.
 *
 * @param {{target: EventTarget | null}} event
 * @returns {void}
 */
function handleQrTargetChange(event) {
  const radio = event.target;
  if (radio instanceof HTMLInputElement && radio.checked) setQrTarget(radio.dataset.qrTarget ?? "");
}

/**
 * @param {string} target
 * @returns {void}
 */
function setQrTarget(target) {
  // includes() validates the value but cannot narrow its type, hence the cast.
  state.qrTarget = /** @type {QrTarget} */ (
    ["letter", "word", "test"].includes(target) ? target : "letter"
  );
  renderQrDemo();
}

// Not themed: a scanner needs dark on light.
const QR_INK_FALLBACK = "#17181b";
const QR_PAPER_FALLBACK = "#ffffff";

/**
 * @param {string} property
 * @param {string} fallback
 * @returns {string}
 */
function readQrColour(property, fallback) {
  if (typeof getComputedStyle !== "function") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return value || fallback;
}

/**
 * @param {string} url
 * @returns {HTMLElement | null}
 */
function drawQrCode(url) {
  if (typeof window.kjua !== "function") return null;
  try {
    return window.kjua({
      render: "canvas",
      crisp: true,
      minVersion: 1,
      ecLevel: "H",
      size: 420,
      ratio: undefined,
      fill: readQrColour("--qr-ink", QR_INK_FALLBACK),
      back: readQrColour("--qr-back", QR_PAPER_FALLBACK),
      text: url,
      rounded: 0,
      // Scanners need four modules of empty margin (ISO/IEC 18004).
      quiet: 4,
    });
  } catch (err) {
    console.warn("Could not draw the QR code:", err);
    return null;
  }
}

/** @type {Promise<void> | null} */
let _qrLibraryLoad = null;

/**
 * @returns {void}
 */
function loadQrLibrary() {
  _qrLibraryLoad ??= loadCdnScript(QR_LIBRARY_SCRIPT)
    .catch((err) => console.warn("Could not load the QR library:", err))
    .then(() => {
      _qrLibraryLoad = null;
      if (typeof window.kjua === "function") renderQrDemo();
      else showQrFallback(buildQrDemoUrl());
    });
}

/**
 * @returns {void}
 */
function renderQrDemo() {
  const url = buildQrDemoUrl();
  queryElements("[data-qr-target]").forEach((button) => {
    const isTarget = button.dataset.qrTarget === state.qrTarget;
    button.classList.toggle("is-active", isTarget);
    if (button instanceof HTMLInputElement) button.checked = isTarget;
  });
  if (els.qrShare) els.qrShare.hidden = !canShareQrDemoUrl();
  if (els.qrDemoUrl) els.qrDemoUrl.textContent = url;
  if (els.qrOpenDemo) els.qrOpenDemo.href = url;

  if (!els.qrCanvas) return;
  // The code is a picture, so where it leads has to be in its label.
  setAttrText(els.qrCanvas, "aria-label", "info.qr.codeFor", { url });
  els.qrCanvas.innerHTML = "";
  if (typeof window.kjua !== "function") {
    setText(els.qrStatus, "info.qr.preparing");
    loadQrLibrary();
    return;
  }
  const qrNode = drawQrCode(url);
  if (qrNode) {
    els.qrCanvas.appendChild(qrNode);
    setText(els.qrStatus, "info.qr.ready", { url });
    return;
  }
  showQrFallback(url);
}

/**
 * @param {string} url
 * @returns {void}
 */
function showQrFallback(url) {
  if (!els.qrCanvas) return;
  els.qrCanvas.innerHTML = "";
  const notice = document.createElement("p");
  setText(notice, "info.qr.drawFailed");
  const link = document.createElement("p");
  link.textContent = url;
  els.qrCanvas.appendChild(notice);
  els.qrCanvas.appendChild(link);
  setText(els.qrStatus, "info.qr.drawFailedStatus");
}

/**
 * @param {string} key
 * @returns {void}
 */
function setQrStatus(key) {
  setText(els.qrStatus, key);
  announce(t(key));
}

/**
 * When no copy method works, the link is selected for copying by hand.
 *
 * @returns {Promise<void>}
 */
async function copyQrDemoUrl() {
  if (await copyTextToClipboard(buildQrDemoUrl())) {
    setQrStatus("info.qr.copied");
    return;
  }
  setQrStatus("info.qr.copyFailed");
  selectQrDemoUrl();
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Denied or insecure page: the legacy command below may still work.
    }
  }
  return copyTextWithCommand(text);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function copyTextWithCommand(text) {
  const input = document.createElement("input");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  try {
    input.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

/**
 * @returns {void}
 */
function selectQrDemoUrl() {
  if (!els.qrDemoUrl || typeof window.getSelection !== "function" || typeof document.createRange !== "function") return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(els.qrDemoUrl);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * @returns {boolean}
 */
function canShareQrDemoUrl() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Closing the share sheet is the visitor's choice, not a failure.
 *
 * @returns {Promise<void>}
 */
async function shareQrDemoUrl() {
  if (!canShareQrDemoUrl()) {
    await copyQrDemoUrl();
    return;
  }
  try {
    await navigator.share({ title: "ASL Assistant", url: buildQrDemoUrl() });
  } catch (err) {
    if (isRecord(err) && err.name === "AbortError") return;
    setQrStatus("info.qr.shareFailed");
  }
}
