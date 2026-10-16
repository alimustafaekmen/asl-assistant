// QR demo screen: deep-link URL construction and QR rendering.
//
// The QR code opens the live app directly in a target mode through the hash
// route, so the URL must be absolute. A page served from localhost or file://
// has no shareable origin, so the published demo URL from CONFIG is used
// instead.
//
// Rendering uses the kjua library loaded by index.html. When that CDN script is
// unavailable the canvas falls back to a readable message, and the copyable
// link below it keeps the screen usable.

/**
 * Resolve the base URL a scanned QR code should open.
 *
 * A page served from localhost or file:// has no shareable origin, so the
 * published demo URL is used instead of a link that only works on this machine.
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
 * Open the target of the radio the visitor chose.
 *
 * Bound to the radios' change event, not to a click: moving between radios
 * with the arrow keys fires change and, on some browsers, no click.
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
  // The membership test is the validation; Array.includes cannot narrow a
  // string to the union, so the result is stated here.
  state.qrTarget = /** @type {QrTarget} */ (
    ["letter", "word", "test"].includes(target) ? target : "letter"
  );
  renderQrDemo();
}

// The code's ink and paper do not follow the theme: a scanner needs dark on
// light whatever the page looks like, so the dark theme must not tint them.
// The page may define them as custom properties; these are used where it does
// not.
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
    console.warn("QR kodu çizilemedi:", err);
    return null;
  }
}

/**
 * Draw the QR code and show its link.
 *
 * When the QR library failed to load, or could not draw, the code's place says
 * so in text and shows the link itself, and the status line points to copying:
 * the link below it keeps the screen usable.
 *
 * @returns {void}
 */
function renderQrDemo() {
  const url = buildQrDemoUrl();
  queryElements("[data-qr-target]").forEach((button) => {
    const isTarget = button.dataset.qrTarget === state.qrTarget;
    button.classList.toggle("is-active", isTarget);
    // A radio shows the state it is drawn from, whatever last changed it.
    if (button instanceof HTMLInputElement) button.checked = isTarget;
  });
  // The share sheet is a browser feature: the button is only there where it
  // opens something.
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
 * Say something about the link under it, and to a screen reader.
 *
 * @param {string} message
 * @returns {void}
 */
function setQrStatus(message) {
  if (els.qrStatus) els.qrStatus.textContent = message;
  announce(message);
}

/**
 * Copy the demo link, and say whether it worked.
 *
 * The clipboard API is tried first, then the legacy copy command. When neither
 * copies, the link is selected so the visitor can copy it by hand.
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
 * The legacy path: select the text in a hidden input and run the copy command.
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
 * Whether this browser can open a system share sheet. The share sheet is a
 * browser API that not every browser has, so it is asked for rather than
 * assumed.
 *
 * @returns {boolean}
 */
function canShareQrDemoUrl() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Hand the link to the system share sheet, or copy it where there is none.
 *
 * Closing the sheet is the visitor's choice, not a failure, and says nothing.
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
