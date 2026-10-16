// Reference gallery: sign images, video links, and the viewer dialog.
//
// Letter mode shows the single alphabet card. Word contexts show the five-page
// split reference, because the combined poster is unreadable at screen size. In
// coach mode the current target decides which of the two is shown. In word mode
// a recognised word shows its own card: the page image cropped to the card's
// rectangle from data/word_reference.json, so no extra image files are needed.
//
// Video links come from the same JSON shape the desktop prototype uses. When
// that file is missing the UI falls back to a generated search URL, so the
// action button always leads somewhere useful.

/**
 * Load the optional reference video links.
 *
 * The file is optional guidance: a missing or unreadable one leaves the
 * generated search fallback in place, so the video action always leads
 * somewhere.
 *
 * @returns {Promise<void>} Resolves whether or not the links were loaded.
 */
async function loadReferenceVideoLinks() {
  try {
    const res = await fetch("./data/asl_video_links.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    referenceVideoLinks = {
      alphabet_video: data.alphabet_video || "",
      words: data.words || {},
    };
    updateReferenceForMode();
  } catch (err) {
    // Missing optional link data is handled by the generated search fallback.
  }
}

/**
 * Load where each word's card sits on the reference pages.
 *
 * The file is optional: without it the word reference shows whole pages, and
 * a recognised word has no card to show.
 *
 * @returns {Promise<void>} Resolves whether or not the file was loaded.
 */
async function loadWordReference() {
  try {
    const res = await fetch("./data/word_reference.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data.words !== "object" || data.words === null) return;
    /** @type {WordCard[]} */
    const cards = [];
    for (const [label, entry] of Object.entries(data.words)) {
      const rect = entry && entry.rect;
      const valid =
        Array.isArray(rect) && rect.length === 4 && rect.every((n) => Number.isFinite(n) && n >= 0);
      if (!valid || !Number.isInteger(entry.page) || entry.page < 1 || entry.page > REFERENCE_ASSETS.wordPages.length) {
        continue;
      }
      cards.push({
        label,
        card: Number(entry.card) || 0,
        page: entry.page,
        rect: [rect[0], rect[1], rect[2], rect[3]],
        title: typeof entry.title === "string" && entry.title ? entry.title : label,
        gloss: typeof entry.gloss_tr === "string" ? entry.gloss_tr : "",
      });
    }
    cards.sort((a, b) => a.card - b.card);
    const size = Array.isArray(data.page_size) && data.page_size.length === 2 ? data.page_size : [1024, 1536];
    wordReference = {
      pageSize: [Number(size[0]) || 1024, Number(size[1]) || 1536],
      // Glosses are shown only after a signer has reviewed them (decision 18).
      glossReviewed: data.gloss_reviewed === true,
      cards,
    };
    updateReferenceForMode();
  } catch (err) {
    // Missing optional card data leaves the page view in place.
  }
}

/**
 * @param {string} label A word label as the model names it.
 * @returns {WordCard | null} Its card, or null when the data is missing or
 *   does not know the word.
 */
function wordCard(label) {
  return wordReference?.cards.find((card) => card.label === label) ?? null;
}

/**
 * @param {WordCard} card
 * @returns {string} The Turkish gloss, empty until a signer has reviewed them.
 */
function wordGloss(card) {
  return wordReference?.glossReviewed && card.gloss ? card.gloss : "";
}

/**
 * @param {WordCard} card
 * @returns {string} The heading for a card: the word, with its gloss when shown.
 */
function wordCardTitle(card) {
  const gloss = wordGloss(card);
  return gloss ? `${card.title} — ${gloss}` : card.title;
}

/**
 * Crop a page image to one card.
 *
 * The frame clips the page image, which the stylesheet scales and offsets
 * from these custom properties; they are set through the CSS object model,
 * which a content security policy allows where an inline style would not be.
 *
 * @param {HTMLElement} frame The clipping box.
 * @param {HTMLImageElement} image The page image inside it.
 * @param {WordCard} card
 * @returns {void}
 */
function showWordCard(frame, image, card) {
  if (!wordReference) return;
  const [x, y, w, h] = card.rect;
  const [pageW, pageH] = wordReference.pageSize;
  frame.style.setProperty("--ref-x", String(x));
  frame.style.setProperty("--ref-y", String(y));
  frame.style.setProperty("--ref-w", String(w));
  frame.style.setProperty("--ref-h", String(h));
  frame.style.setProperty("--ref-aspect", String((w * pageW) / (h * pageH)));
  const gloss = wordGloss(card);
  image.alt = gloss
    ? `${card.title} (${gloss}) işaretinin referans kartı`
    : `${card.title} işaretinin referans kartı`;
  image.src = REFERENCE_ASSETS.wordPages[card.page - 1];
}

/**
 * Which material the reference panel shows now, for the open button.
 *
 * @type {{kind: "letter" | "page" | "card", index: number, label: string}}
 */
let referenceView = { kind: "letter", index: 0, label: "" };

/** The word whose card the panel last opened itself for. */
let referenceCardShown = "";

/** The page image waiting for the panel to open, so a closed panel loads nothing. */
let referencePendingSrc = "";

/**
 * Give the panel image its source once the panel is open.
 *
 * Browsers fetch a hidden image, and a word page is 1.5 MB, so the word
 * reference keeps its source back until somebody can see it.
 *
 * @returns {void}
 */
function applyReferencePendingSrc() {
  if (!referencePendingSrc || els.referenceBody.hidden) return;
  els.referenceImage.src = referencePendingSrc;
  referencePendingSrc = "";
}

/**
 * Point the reference panel at the right material for the current mode.
 *
 * Word contexts get the five-page split reference rather than the combined
 * poster, which is unreadable at screen size. A recognised word shows its own
 * card instead, and opens the panel the first time that word appears. In coach
 * mode the target decides which of the two applies.
 *
 * @returns {void}
 */
function updateReferenceForMode() {
  if (!els.referenceImage) return;
  const mode = state.mode;
  const target = state.coachTarget || "A";
  const wordModeTarget =
    mode === "word" && state.prediction && state.prediction.length > 1
      ? state.prediction
      : "";
  const coachIsWord = mode === "coach" && target.length > 1;
  const isWordRef = mode === "word" || coachIsWord;
  const card = wordModeTarget ? wordCard(wordModeTarget) : null;
  const cardFrame = document.getElementById("referenceCard");
  const cardImage = optionalElement("referenceCardImage", HTMLImageElement);

  if (card && cardFrame && cardImage) {
    showWordCard(cardFrame, cardImage, card);
    cardFrame.hidden = false;
    els.referenceImage.hidden = true;
    referenceView = { kind: "card", index: card.page - 1, label: card.label };
    if (referenceCardShown !== card.label) {
      referenceCardShown = card.label;
      setReferenceOpen(true);
    }
  } else {
    if (cardFrame) cardFrame.hidden = true;
    els.referenceImage.hidden = false;
    referenceCardShown = "";
    const pageIndex = referenceView.kind === "page" ? referenceView.index : 0;
    const refAsset = isWordRef ? REFERENCE_ASSETS.wordPages[pageIndex] : REFERENCE_ASSETS.letter.src;
    if (isWordRef && els.referenceBody.hidden) {
      // Nobody can see the page yet: keep its 1.5 MB from loading until the
      // panel opens.
      referencePendingSrc = refAsset;
      els.referenceImage.removeAttribute("src");
    } else {
      referencePendingSrc = "";
      els.referenceImage.src = refAsset;
    }
    els.referenceImage.alt = isWordRef
      ? `ASL kelime referans sayfası ${pageIndex + 1}`
      : REFERENCE_ASSETS.letter.alt;
    els.referenceImage.loading = "lazy";
    els.referenceImage.decoding = "async";
    referenceView = isWordRef
      ? { kind: "page", index: pageIndex, label: "" }
      : { kind: "letter", index: 0, label: "" };
  }
  renderReferenceThumbnails(isWordRef && !card);

  if (els.referenceKicker) {
    els.referenceKicker.textContent =
      mode === "coach" ? "Koç referansı" : mode === "word" ? "Kelime referansı" : "Harf referansı";
  }
  if (els.referenceTitle) {
    els.referenceTitle.textContent =
      mode === "coach"
        ? (coachIsWord ? `Kelime hedefi: ${target}` : `Harf hedefi: ${target}`)
        : mode === "word"
          ? (card ? wordCardTitle(card) : wordModeTarget ? `Seçili kelime: ${wordModeTarget}` : "50 kelime referans kartı")
          : "ASL harf kartları";
  }
  if (els.referenceNote) {
    els.referenceNote.textContent =
      mode === "word"
        ? "Kelime kartları 5 sayfada. İşareti yaparken yüzünüz, omuzlarınız ve eliniz kadrajda olsun."
        : mode === "coach"
          ? (coachIsWord
              ? "Kelime hedeflerinde önce referans sayfasına bakın, sonra kaydı başlatın."
              : "Hedefi yapamazsanız referans görseline ya da video rehbere bakın.")
          : "Harf karışırsa el şeklinizi referans görseliyle karşılaştırın.";
  }
  if (els.referenceVideoLink) {
    els.referenceVideoLink.href = buildReferenceVideoUrl(
      mode,
      mode === "word" ? wordModeTarget : target,
    );
  }
  syncReferenceOpener();
}

/**
 * Build the page buttons for the split word reference.
 *
 * @param {boolean} isWordRef Whether whole pages are showing; letter mode and a
 *   word's own card hide the strip.
 * @returns {void}
 */
function renderReferenceThumbnails(isWordRef) {
  if (!els.referenceThumbs) return;
  els.referenceThumbs.innerHTML = "";
  els.referenceThumbs.hidden = !isWordRef;
  if (!isWordRef) return;

  REFERENCE_ASSETS.wordPages.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reference-thumb";
    // The thumbs are built here, so they carry their own lookup hook rather
    // than being found again by the class that styles them.
    button.dataset.ui = "reference-thumb";
    button.textContent = `${index + 1}`;
    button.title = `Kelime referans sayfası ${index + 1}`;
    const current = referenceView.kind === "page" ? referenceView.index : 0;
    button.dataset.active = index === current ? "true" : "false";
    button.addEventListener("click", () => {
      els.referenceImage.src = src;
      referencePendingSrc = "";
      referenceView = { kind: "page", index, label: "" };
      els.referenceImage.alt = `ASL kelime referans sayfası ${index + 1}`;
      queryAllUi("reference-thumb", els.referenceThumbs)
        .forEach((thumb) => { thumb.dataset.active = "false"; });
      button.dataset.active = "true";
    });
    els.referenceThumbs.appendChild(button);
  });
}

/**
 * Resolve the video link for a target, falling back to a search URL.
 *
 * @param {string} mode Current app mode.
 * @param {string} target Letter or word; may be empty when nothing is selected.
 * @returns {string} A published link when one exists, otherwise a generated
 *   search URL.
 */
function buildReferenceVideoUrl(mode, target) {
  const isWordTarget = mode === "word" || (mode === "coach" && target && target.length > 1);
  if (isWordTarget && target && referenceVideoLinks.words && referenceVideoLinks.words[target]) {
    return referenceVideoLinks.words[target];
  }
  if (!isWordTarget && referenceVideoLinks.alphabet_video) {
    return referenceVideoLinks.alphabet_video;
  }
  const query = isWordTarget
    ? `ASL ${target || "basic words"} sign tutorial`
    : target && target.length === 1
      ? `ASL letter ${target} hand sign tutorial`
      : "ASL alphabet hand signs tutorial";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/**
 * Open or close the reference body, and keep its button in step.
 *
 * @param {boolean} open
 * @returns {void}
 */
function setReferenceOpen(open) {
  els.referenceBody.hidden = !open;
  els.toggleReference.textContent = open ? "Gizle" : "Göster";
  els.toggleReference.setAttribute("aria-expanded", String(open));
  if (open) applyReferencePendingSrc();
}

/**
 * Show or hide the reference body.
 *
 * @returns {void}
 */
function toggleReference() {
  setReferenceOpen(els.referenceBody.hidden);
}

// ── The viewer ────────────────────────────────────────────────────────────

/**
 * Zoom steps of the viewer, as fractions of the image's natural width. Zero
 * fits the image to the viewer, capped at a width that stays readable.
 */
const VIEWER_ZOOM_LEVELS = [0, 0.5, 0.75, 1, 1.5, 2];

/**
 * What the viewer shows now, and what to focus when it closes.
 *
 * `label` is the word a card or a card's page belongs to; it is empty for the
 * letter chart and for a page opened on its own. `opener` is the control that
 * opened the viewer, because focus goes back to it, not to the image.
 *
 * @type {{open: boolean, kind: "letter" | "page" | "card", index: number, label: string, zoom: number, opener: HTMLElement | null}}
 */
const viewerState = { open: false, kind: "page", index: 0, label: "", zoom: 0, opener: null };

/**
 * @returns {HTMLElement | null}
 */
function viewerDialog() {
  return document.getElementById("lightbox");
}

/**
 * @returns {boolean} True while the viewer is showing. Keys belong to it then.
 */
function referenceViewerOpen() {
  return Boolean(viewerDialog()?.hasAttribute("open"));
}

/**
 * @returns {boolean} True from the countdown to the result: the viewer would
 *   cover the camera while the user is signing.
 */
function referenceViewerBlocked() {
  return (
    state.wordState === "COUNTDOWN" || state.wordState === "RECORDING" || state.wordState === "PROCESSING"
  );
}

/**
 * Keep the open button from offering a viewer that cannot open.
 *
 * @returns {void}
 */
function syncReferenceOpener() {
  const button = optionalElement("referenceOpen", HTMLButtonElement);
  if (button) button.disabled = referenceViewerBlocked();
}

/**
 * Open the viewer on the letter chart, a word page, or one word's card.
 *
 * It asks the browser for a modal dialog, which makes the rest of the page
 * inert and keeps Tab inside. Without card data a card request shows the
 * first page.
 *
 * @param {{kind: "letter" | "page" | "card", index?: number, label?: string, opener?: HTMLElement | null}} request
 * @returns {void}
 */
function openReferenceViewer({ kind, index = 0, label = "", opener = null }) {
  const dialog = /** @type {HTMLDialogElement | null} */ (viewerDialog());
  if (!dialog || referenceViewerBlocked()) return;
  const cards = wordReference ? wordReference.cards : [];
  const cardIndex = kind === "card" ? cards.findIndex((card) => card.label === label) : -1;
  if (kind === "card" && cardIndex >= 0) {
    Object.assign(viewerState, { kind: "card", index: cardIndex, label });
  } else if (kind === "card") {
    Object.assign(viewerState, { kind: "page", index: Math.max(0, index), label: "" });
  } else {
    Object.assign(viewerState, { kind, index, label: "" });
  }
  viewerState.zoom = 0;
  viewerState.opener = opener;
  renderViewer();
  if (!dialog.hasAttribute("open")) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  viewerState.open = true;
  document.getElementById("lightboxClose")?.focus();
}

/**
 * Close the viewer and give focus back to whatever opened it.
 *
 * @returns {void}
 */
function closeReferenceViewer() {
  const dialog = /** @type {HTMLDialogElement | null} */ (viewerDialog());
  if (!dialog) return;
  if (dialog.hasAttribute("open")) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  restoreViewerFocus();
}

/**
 * Focus the control that opened the viewer, once per opening. A control the
 * page has since rebuilt is gone, so the open button stands in for it.
 *
 * @returns {void}
 */
function restoreViewerFocus() {
  if (!viewerState.open) return;
  viewerState.open = false;
  const opener = viewerState.opener;
  viewerState.opener = null;
  const target = opener && opener.isConnected !== false ? opener : document.getElementById("referenceOpen");
  target?.focus?.();
}

/**
 * Draw the viewer for viewerState: the image or the card, its title, and which
 * tools make sense for it. A source is assigned only to the image in use.
 *
 * @returns {void}
 */
function renderViewer() {
  const image = optionalElement("lightboxImage", HTMLImageElement);
  const cardFrame = document.getElementById("lightboxCard");
  const cardImage = optionalElement("lightboxCardImage", HTMLImageElement);
  const heading = document.getElementById("lightboxTitle");
  const modeButton = document.getElementById("lightboxMode");
  const prev = document.getElementById("lightboxPrev");
  const next = document.getElementById("lightboxNext");
  const video = document.getElementById("lightboxVideo");
  if (!image || !cardFrame || !cardImage || !heading) return;

  const { kind, index, label } = viewerState;
  const card = kind === "card" && wordReference ? wordReference.cards[index] : null;
  const pageCount = REFERENCE_ASSETS.wordPages.length;
  // A page opened from a card can lead back to that card.
  const cardOfPage = kind === "page" && label ? wordCard(label) : null;

  cardFrame.hidden = !card;
  image.hidden = Boolean(card);
  let naturalWidth = 1024;
  if (card && wordReference) {
    showWordCard(cardFrame, cardImage, card);
    heading.textContent = wordCardTitle(card);
    heading.lang = "en";
    naturalWidth = card.rect[2] * wordReference.pageSize[0];
  } else if (kind === "page") {
    image.src = REFERENCE_ASSETS.wordPages[index];
    image.alt = `Kelime sayfası ${index + 1} / ${pageCount}`;
    heading.textContent = `Kelime sayfası ${index + 1} / ${pageCount}`;
    heading.lang = "tr";
    naturalWidth = wordReference ? wordReference.pageSize[0] : 1024;
  } else {
    image.src = REFERENCE_ASSETS.letter.src;
    image.alt = REFERENCE_ASSETS.letter.alt;
    heading.textContent = "ASL harf tablosu";
    heading.lang = "tr";
    naturalWidth = image.naturalWidth || 1086;
  }
  document.getElementById("lightboxBody")?.style.setProperty("--viewer-natural", `${Math.round(naturalWidth)}px`);

  if (prev) prev.hidden = kind === "letter";
  if (next) next.hidden = kind === "letter";
  if (modeButton) {
    modeButton.hidden = !(card || cardOfPage);
    modeButton.textContent = card ? "Sayfanın tamamı" : "Yalnızca kart";
  }
  if (video instanceof HTMLAnchorElement) {
    video.hidden = kind === "letter";
    video.href = buildReferenceVideoUrl("word", card ? card.label : label);
  }
  renderViewerZoom();
}

/**
 * Show the zoom level, and stop the buttons at either end of the steps.
 *
 * @returns {void}
 */
function renderViewerZoom() {
  const level = VIEWER_ZOOM_LEVELS[viewerState.zoom];
  const body = document.getElementById("lightboxBody");
  const readout = document.getElementById("lightboxZoom");
  const out = optionalElement("lightboxZoomOut", HTMLButtonElement);
  const zoomIn = optionalElement("lightboxZoomIn", HTMLButtonElement);
  if (body) {
    body.style.setProperty("--viewer-zoom", String(level));
    body.dataset.zoom = level ? "set" : "fit";
  }
  if (readout) {
    const text = level ? `%${Math.round(level * 100)}` : "Sığdır";
    readout.textContent = text;
    // The visible text stays inside the name; tapping it fits the image.
    readout.setAttribute("aria-label", level ? `Yakınlaştırma ${text}, sığdırmak için dokunun` : "Yakınlaştırma sığdırılmış");
  }
  if (out) out.disabled = viewerState.zoom === 0;
  if (zoomIn) zoomIn.disabled = viewerState.zoom === VIEWER_ZOOM_LEVELS.length - 1;
}

/**
 * Move the zoom one step, or to fit.
 *
 * @param {number} step 1 or -1; 0 returns to fit.
 * @returns {void}
 */
function stepViewerZoom(step) {
  const last = VIEWER_ZOOM_LEVELS.length - 1;
  viewerState.zoom = step === 0 ? 0 : Math.max(0, Math.min(last, viewerState.zoom + step));
  renderViewerZoom();
}

/**
 * Show the previous or next word card, or word page; both wrap around.
 *
 * @param {number} direction 1 for next, -1 for previous.
 * @returns {void}
 */
function stepViewer(direction) {
  if (viewerState.kind === "letter") return;
  const count =
    viewerState.kind === "card" && wordReference
      ? wordReference.cards.length
      : REFERENCE_ASSETS.wordPages.length;
  viewerState.index = (viewerState.index + direction + count) % count;
  if (viewerState.kind === "card" && wordReference) viewerState.label = wordReference.cards[viewerState.index].label;
  viewerState.zoom = 0;
  renderViewer();
}

/**
 * Swap between a word's card and the whole page that holds it.
 *
 * @returns {void}
 */
function toggleViewerCard() {
  if (viewerState.kind === "card" && wordReference) {
    const card = wordReference.cards[viewerState.index];
    Object.assign(viewerState, { kind: "page", index: card.page - 1, label: card.label });
  } else if (viewerState.kind === "page" && viewerState.label) {
    const card = wordCard(viewerState.label);
    const cardIndex = card && wordReference ? wordReference.cards.indexOf(card) : -1;
    if (cardIndex < 0) return;
    Object.assign(viewerState, { kind: "card", index: cardIndex });
  } else {
    return;
  }
  viewerState.zoom = 0;
  renderViewer();
}

/**
 * Wire the panel's open controls and the viewer's own.
 *
 * The viewer is a native modal dialog: Escape arrives as its cancel event,
 * which closes through closeReferenceViewer() so focus goes back. A click on
 * the dialog itself, not on its content, is a click on the backdrop. The keys
 * below act only while focus is inside the dialog.
 *
 * @returns {void}
 */
function bindReferenceLightbox() {
  const dialog = viewerDialog();
  if (!dialog) return;

  /** Open on whatever the panel shows, from the control that was used. */
  const openFromPanel = () => {
    openReferenceViewer({
      kind: referenceView.kind,
      index: referenceView.index,
      label: referenceView.label,
      opener: document.getElementById("referenceOpen"),
    });
  };
  document.getElementById("referenceOpen")?.addEventListener("click", openFromPanel);
  // The image and the card are also pointer targets; keyboard users have the button.
  els.referenceImage?.addEventListener("click", openFromPanel);
  document.getElementById("referenceCard")?.addEventListener("click", openFromPanel);

  const on = (/** @type {string} */ id, /** @type {() => void} */ run) =>
    document.getElementById(id)?.addEventListener("click", run);
  on("lightboxClose", closeReferenceViewer);
  on("lightboxPrev", () => stepViewer(-1));
  on("lightboxNext", () => stepViewer(1));
  on("lightboxZoomIn", () => stepViewerZoom(1));
  on("lightboxZoomOut", () => stepViewerZoom(-1));
  on("lightboxZoom", () => stepViewerZoom(0));
  on("lightboxMode", toggleViewerCard);
  // The coach's target tile has its own button for the same view.
  document.getElementById("coachReference")?.addEventListener("click", (event) => {
    openReferenceViewer({
      kind: referenceView.kind,
      index: referenceView.index,
      label: referenceView.label,
      opener: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
    });
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeReferenceViewer();
  });
  // A close the browser made on its own still returns focus.
  dialog.addEventListener("close", restoreViewerFocus);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeReferenceViewer();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") stepViewerZoom(1);
    else if (event.key === "-") stepViewerZoom(-1);
    else if (event.key === "0") stepViewerZoom(0);
    else if (event.key === "ArrowLeft" && viewerState.zoom === 0) stepViewer(-1);
    else if (event.key === "ArrowRight" && viewerState.zoom === 0) stepViewer(1);
    else return;
    event.preventDefault();
  });
}
