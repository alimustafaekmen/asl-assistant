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

/**
 * Draw the QR code and show its link.
 *
 * When the QR library failed to load, the canvas shows a readable message and
 * the copyable link below it keeps the screen usable.
 *
 * @returns {void}
 */
function renderQrDemo() {
  const url = buildQrDemoUrl();
  queryElements("[data-qr-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.qrTarget === state.qrTarget);
  });
  if (els.qrDemoUrl) els.qrDemoUrl.textContent = url;
  if (els.qrOpenDemo) els.qrOpenDemo.href = url;

  if (!els.qrCanvas) return;
  els.qrCanvas.innerHTML = "";
  if (window.kjua && typeof window.kjua === "function") {
    const qrNode = window.kjua({
      render: "canvas",
      crisp: true,
      minVersion: 1,
      ecLevel: "H",
      size: 420,
      ratio: undefined,
      fill: "#102033",
      back: "#ffffff",
      text: url,
      rounded: 0,
      quiet: 2,
    });
    els.qrCanvas.appendChild(qrNode);
    if (els.qrStatus) els.qrStatus.textContent = `QR hazır: ${url}`;
    return;
  }

  {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 420;
    els.qrCanvas.appendChild(canvas);
    const ctx2d = canvas.getContext("2d");
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = "#102033";
    ctx2d.font = "700 22px sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.fillText("QR yüklenemedi", canvas.width / 2, canvas.height / 2 - 12);
    ctx2d.font = "500 15px sans-serif";
    ctx2d.fillText("Aşağıdaki linki açın", canvas.width / 2, canvas.height / 2 + 20);
    if (els.qrStatus) els.qrStatus.textContent = "QR kütüphanesi yüklenemedi; bağlantı metni yedek olarak kullanılabilir.";
    return;
  }
}

/**
 * Copy the demo link, falling back to a hidden input where the clipboard API
 * is unavailable or blocked.
 *
 * @returns {Promise<void>}
 */
async function copyQrDemoUrl() {
  const url = buildQrDemoUrl();
  try {
    await navigator.clipboard.writeText(url);
    if (els.qrStatus) els.qrStatus.textContent = "Demo linki panoya kopyalandı.";
  } catch (err) {
    const input = document.createElement("input");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    if (els.qrStatus) els.qrStatus.textContent = "Demo linki panoya kopyalandı.";
  }
}
