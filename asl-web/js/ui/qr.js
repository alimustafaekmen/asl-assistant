// QR demo screen: deep-link URL construction and QR rendering.
//
// The QR code opens the live app in a target mode through the hash route, so
// the URL must be absolute. The code is drawn by kjua, a CDN script loaded by
// index.html; without it the screen still works through the copyable link.

/**
 * Resolve the base URL a scanned QR code should open.
 *
 * A page served from localhost or file:// has no shareable origin, so the
 * published demo URL from CONFIG is used instead.
 *
 * @returns {string} Absolute URL ending in a directory.
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
 * Build the deep link for a target mode.
 *
 * @param {string} [target] Anything unrecognised falls back to "letter".
 * @returns {string} Absolute URL with the mode hash.
 */
function buildQrDemoUrl(target = state.qrTarget) {
  const normalizedTarget = ["letter", "word", "test"].includes(target) ? target : "letter";
  return `${getDemoBaseUrl()}#${normalizedTarget}`;
}

/**
 * Select the target of the radio the visitor chose.
 *
 * Bound to change, not click: moving between radios with the arrow keys
 * fires change and, on some browsers, no click.
 *
 * @param {{target: EventTarget | null}} event
 * @returns {void}
 */
function handleQrTargetChange(event) {
  const radio = event.target;
  if (radio instanceof HTMLInputElement && radio.checked) setQrTarget(radio.dataset.qrTarget ?? "");
}

/**
 * Select which mode the QR code opens, and redraw it.
 *
 * @param {string} target Anything unrecognised falls back to "letter".
 * @returns {void}
 */
function setQrTarget(target) {
  // includes() validates the value but cannot narrow its type, hence the cast.
  state.qrTarget = /** @type {QrTarget} */ (
    ["letter", "word", "test"].includes(target) ? target : "letter"
  );
  renderQrDemo();
}

// The code's ink and paper ignore the theme, because a scanner needs dark on
// light. The stylesheet may set them as custom properties; these are the
// fallbacks.
const QR_INK_FALLBACK = "#17181b";
const QR_PAPER_FALLBACK = "#ffffff";

/**
 * Read an unthemed colour of the QR code from the page's custom properties.
 *
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
 * Draw the QR code with kjua.
 *
 * @param {string} url
 * @returns {HTMLElement | null} Null when the library did not load or could
 *   not draw this text.
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

/**
 * Draw the QR code and show its link.
 *
 * When the code cannot be drawn, its place shows the link as text and the
 * status line points to copying it.
 *
 * @returns {void}
 */
function renderQrDemo() {
  const url = buildQrDemoUrl();
  queryElements("[data-qr-target]").forEach((button) => {
    const isTarget = button.dataset.qrTarget === state.qrTarget;
    button.classList.toggle("is-active", isTarget);
    // Checked from state, whatever changed the target last.
    if (button instanceof HTMLInputElement) button.checked = isTarget;
  });
  // Shown only where the browser has a share sheet to open.
  if (els.qrShare) els.qrShare.hidden = !canShareQrDemoUrl();
  if (els.qrDemoUrl) els.qrDemoUrl.textContent = url;
  if (els.qrOpenDemo) els.qrOpenDemo.href = url;

  if (!els.qrCanvas) return;
  // The code is a picture, so where it leads has to be in its label.
  els.qrCanvas.setAttribute("aria-label", `QR kodu: ${url}`);
  els.qrCanvas.innerHTML = "";
  const qrNode = drawQrCode(url);
  if (qrNode) {
    els.qrCanvas.appendChild(qrNode);
    if (els.qrStatus) els.qrStatus.textContent = `QR hazır: ${url}`;
    return;
  }

  const notice = document.createElement("p");
  notice.textContent = "QR kodu çizilemedi.";
  const link = document.createElement("p");
  link.textContent = url;
  els.qrCanvas.appendChild(notice);
  els.qrCanvas.appendChild(link);
  if (els.qrStatus) {
    els.qrStatus.textContent = "QR kodu çizilemedi; bağlantıyı kopyalayıp telefonunuza gönderebilirsiniz.";
  }
}

/**
 * Write the status line under the link, and announce it.
 *
 * @param {string} message
 * @returns {void}
 */
function setQrStatus(message) {
  if (els.qrStatus) els.qrStatus.textContent = message;
  announce(message);
}

/**
 * Copy the demo link, and say whether it worked. When no copy method works,
 * the link is selected so the visitor can copy it by hand.
 *
 * @returns {Promise<void>}
 */
async function copyQrDemoUrl() {
  if (await copyTextToClipboard(buildQrDemoUrl())) {
    setQrStatus("Bağlantı kopyalandı.");
    return;
  }
  setQrStatus("Kopyalanamadı. Bağlantıyı seçip elle kopyalayın.");
  selectQrDemoUrl();
}

/**
 * Copy through the clipboard API, falling back to the legacy copy command.
 *
 * @param {string} text
 * @returns {Promise<boolean>} True only when the browser reports the copy done.
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
 * Select the text in a hidden input and run the legacy copy command.
 *
 * @param {string} text
 * @returns {boolean} The command's own answer; false when it throws.
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
 * Select the link's text, so a visitor whose browser refused to copy can do it.
 *
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
 * @returns {boolean} Whether this browser has the Web Share API; not every
 *   browser does.
 */
function canShareQrDemoUrl() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Hand the link to the system share sheet, or copy it where there is none.
 * Closing the sheet is the visitor's choice, not a failure, so it says nothing.
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
    // The browser reports a closed sheet as a DOMException named AbortError.
    if (isRecord(err) && err.name === "AbortError") return;
    setQrStatus("Paylaşılamadı. Bağlantıyı kopyalayabilirsiniz.");
  }
}
