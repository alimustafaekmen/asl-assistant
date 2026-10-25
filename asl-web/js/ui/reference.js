// A word card is its page image cropped to the rectangle in
// data/word_reference.json, so no extra image files are needed.

// Both data files are optional but a failed read is logged, so a broken deploy
// leaves a trace. Only the fetch and parse are guarded, so a rendering bug is
// not mistaken for a missing file.

/**
 * @param {string} path
 * @param {string} fallback What the visitor gets instead.
 * @param {unknown} reason
 * @returns {void}
 */
function warnReferenceData(path, fallback, reason) {
  console.warn(`${path} could not be read; ${fallback}:`, reason);
}

/**
 * Without the file the video button falls back to a search URL.
 *
 * @returns {Promise<void>}
 */
async function loadReferenceVideoLinks() {
  const path = "./data/asl_video_links.json";
  const fallback = "the video button searches instead";
  let data;
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    warnReferenceData(path, fallback, err);
    return;
  }
  if (!data || typeof data !== "object") {
    warnReferenceData(path, fallback, "not a JSON object");
    return;
  }
  referenceVideoLinks = {
    alphabet_video: data.alphabet_video || "",
    words: data.words || {},
  };
  updateReferenceForMode();
}

/**
 * @returns {Promise<void>}
 */
async function loadWordReference() {
  const path = "./data/word_reference.json";
  const fallback = "the word reference shows whole pages only";
  let data;
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    warnReferenceData(path, fallback, err);
    return;
  }
  if (!data || typeof data.words !== "object" || data.words === null) {
    warnReferenceData(path, fallback, "no words object");
    return;
  }
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
    // Glosses are shown only after a signer has reviewed them.
    glossReviewed: data.gloss_reviewed === true,
    cards,
  };
  updateReferenceForMode();
}

/**
 * @param {string} label As the model names it.
 * @returns {WordCard | null}
 */
function wordCard(label) {
  return wordReference?.cards.find((card) => card.label === label) ?? null;
}

/**
 * An English page shows no gloss: the word itself is already English.
 *
 * @param {WordCard} card
 * @returns {string}
 */
function wordGloss(card) {
  if (currentLanguage() !== "tr") return "";
  return wordReference?.glossReviewed && card.gloss ? card.gloss : "";
}

/**
 * For text that is not one of our strings, so a language switch leaves it alone.
 *
 * @param {Element} element
 * @param {string} text
 * @returns {void}
 */
function setPlainText(element, text) {
  element.removeAttribute("data-i18n");
  element.removeAttribute("data-i18n-params");
  element.textContent = text;
}

/**
 * @param {WordCard} card
 * @returns {string}
 */
function wordCardTitle(card) {
  const gloss = wordGloss(card);
  return gloss ? `${card.title} (${gloss})` : card.title;
}

/**
 * Custom properties go through the CSS object model, which the CSP allows
 * where an inline style attribute is not.
 *
 * @param {HTMLElement} frame
 * @param {HTMLImageElement} image
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
  image.alt = t(gloss ? "word.reference.cardAltGloss" : "word.reference.cardAlt", { title: card.title, gloss });
  image.src = REFERENCE_ASSETS.wordPages[card.page - 1];
}

/**
 * @type {{kind: "letter" | "page" | "card", index: number, label: string}}
 */
let referenceView = { kind: "letter", index: 0, label: "" };

let referenceCardShown = "";

// Browsers fetch even a hidden image, so a word page waits for the panel to open.
let referencePendingSrc = "";

/**
 * @returns {void}
 */
function applyReferencePendingSrc() {
  if (!referencePendingSrc || els.referenceBody.hidden) return;
  els.referenceImage.src = referencePendingSrc;
  referencePendingSrc = "";
}

/**
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
      referencePendingSrc = refAsset;
      els.referenceImage.removeAttribute("src");
    } else {
      referencePendingSrc = "";
      els.referenceImage.src = refAsset;
    }
    if (isWordRef) setAttrText(els.referenceImage, "alt", "word.reference.pageAlt", { n: pageIndex + 1 });
    else setAttrText(els.referenceImage, "alt", "word.reference.letterAlt");
    els.referenceImage.loading = "lazy";
    els.referenceImage.decoding = "async";
    referenceView = isWordRef
      ? { kind: "page", index: pageIndex, label: "" }
      : { kind: "letter", index: 0, label: "" };
  }
  renderReferenceThumbnails(isWordRef && !card);

  setText(
    els.referenceKicker,
    mode === "coach" ? "word.reference.kicker.coach" : mode === "word" ? "word.reference.kicker.word" : "word.reference.kicker.letter",
  );
  if (els.referenceTitle) {
    if (mode === "coach") {
      setText(els.referenceTitle, coachIsWord ? "word.reference.title.coachWord" : "word.reference.title.coachLetter", { target });
    } else if (mode === "word" && card) {
      setPlainText(els.referenceTitle, wordCardTitle(card));
    } else if (mode === "word") {
      if (wordModeTarget) setText(els.referenceTitle, "word.reference.title.selected", { word: wordModeTarget });
      else setText(els.referenceTitle, "word.reference.title.wordCards");
    } else {
      setText(els.referenceTitle, "word.reference.title.letterCards");
    }
  }
  setText(
    els.referenceNote,
    mode === "word"
      ? "word.reference.note.word"
      : mode === "coach"
        ? (coachIsWord ? "word.reference.note.coachWord" : "word.reference.note.coachLetter")
        : "word.reference.note.letter",
  );
  if (els.referenceVideoLink) {
    els.referenceVideoLink.href = buildReferenceVideoUrl(
      mode,
      mode === "word" ? wordModeTarget : target,
    );
  }
  syncReferenceOpener();
}

/**
 * @param {boolean} isWordRef
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
    button.dataset.ui = "reference-thumb";
    button.textContent = `${index + 1}`;
    setAttrText(button, "title", "word.reference.pageTitle", { n: index + 1 });
    const current = referenceView.kind === "page" ? referenceView.index : 0;
    button.dataset.active = index === current ? "true" : "false";
    button.addEventListener("click", () => {
      els.referenceImage.src = src;
      referencePendingSrc = "";
      referenceView = { kind: "page", index, label: "" };
      setAttrText(els.referenceImage, "alt", "word.reference.pageAlt", { n: index + 1 });
      queryAllUi("reference-thumb", els.referenceThumbs)
        .forEach((thumb) => { thumb.dataset.active = "false"; });
      button.dataset.active = "true";
    });
    els.referenceThumbs.appendChild(button);
  });
}

/**
 * @param {string} mode
 * @param {string} target May be empty.
 * @returns {string}
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
 * @param {boolean} open
 * @returns {void}
 */
function setReferenceOpen(open) {
  els.referenceBody.hidden = !open;
  setText(els.toggleReference, open ? "word.reference.hide" : "word.reference.show");
  els.toggleReference.setAttribute("aria-expanded", String(open));
  if (open) applyReferencePendingSrc();
}

/** @returns {void} */
function toggleReference() {
  setReferenceOpen(els.referenceBody.hidden);
}

// Fractions of the image's natural width; zero fits it to the viewer.
const VIEWER_ZOOM_LEVELS = [0, 0.5, 0.75, 1, 1.5, 2];

/**
 * Focus returns to `opener` on close, not to the image.
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
 * @returns {boolean}
 */
function referenceViewerOpen() {
  return Boolean(viewerDialog()?.hasAttribute("open"));
}

/**
 * The viewer would cover the camera while the user is signing.
 *
 * @returns {boolean}
 */
function referenceViewerBlocked() {
  return (
    state.wordState === "COUNTDOWN" || state.wordState === "RECORDING" || state.wordState === "PROCESSING"
  );
}

/**
 * @returns {void}
 */
function syncReferenceOpener() {
  const button = optionalElement("referenceOpen", HTMLButtonElement);
  if (button) button.disabled = referenceViewerBlocked();
}

/**
 * A card the data does not know falls back to a page.
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
 * If the page has rebuilt the opener since, the open button stands in for it.
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
    setPlainText(heading, wordCardTitle(card));
    heading.setAttribute("lang", "en");
    naturalWidth = card.rect[2] * wordReference.pageSize[0];
  } else if (kind === "page") {
    image.src = REFERENCE_ASSETS.wordPages[index];
    const page = { n: index + 1, count: pageCount };
    setAttrText(image, "alt", "word.viewer.page", page);
    setText(heading, "word.viewer.page", page);
    heading.setAttribute("lang", currentLanguage());
    naturalWidth = wordReference ? wordReference.pageSize[0] : 1024;
  } else {
    image.src = REFERENCE_ASSETS.letter.src;
    setAttrText(image, "alt", "word.reference.letterAlt");
    setText(heading, "word.viewer.letterChart");
    heading.setAttribute("lang", currentLanguage());
    naturalWidth = image.naturalWidth || 1086;
  }
  document.getElementById("lightboxBody")?.style.setProperty("--viewer-natural", `${Math.round(naturalWidth)}px`);

  if (prev) prev.hidden = kind === "letter";
  if (next) next.hidden = kind === "letter";
  if (modeButton) {
    modeButton.hidden = !(card || cardOfPage);
    setText(modeButton, card ? "word.viewer.wholePage" : "word.viewer.cardOnly");
  }
  if (video instanceof HTMLAnchorElement) {
    video.hidden = kind === "letter";
    video.href = buildReferenceVideoUrl("word", card ? card.label : label);
  }
  renderViewerZoom();
}

/**
 * @returns {void}
 */
function renderOpenViewer() {
  if (viewerState.open) renderViewer();
}

/**
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
    // The visible text stays inside the accessible name.
    if (level) {
      const percent = { n: Math.round(level * 100) };
      setText(readout, "word.percent", percent);
      setAttrText(readout, "aria-label", "word.viewer.zoomName", percent);
    } else {
      setText(readout, "word.viewer.fit");
      setAttrText(readout, "aria-label", "word.viewer.fitName");
    }
  }
  if (out) out.disabled = viewerState.zoom === 0;
  if (zoomIn) zoomIn.disabled = viewerState.zoom === VIEWER_ZOOM_LEVELS.length - 1;
}

/**
 * @param {number} step 1 or -1; 0 returns to fit.
 * @returns {void}
 */
function stepViewerZoom(step) {
  const last = VIEWER_ZOOM_LEVELS.length - 1;
  viewerState.zoom = step === 0 ? 0 : Math.max(0, Math.min(last, viewerState.zoom + step));
  renderViewerZoom();
}

/**
 * @param {number} direction
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
 * Escape arrives as the dialog's cancel event and is routed through
 * closeReferenceViewer() so focus goes back.
 *
 * @returns {void}
 */
function bindReferenceLightbox() {
  const dialog = viewerDialog();
  if (!dialog) return;

  const openFromPanel = () => {
    openReferenceViewer({
      kind: referenceView.kind,
      index: referenceView.index,
      label: referenceView.label,
      opener: document.getElementById("referenceOpen"),
    });
  };
  document.getElementById("referenceOpen")?.addEventListener("click", openFromPanel);
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
  dialog.addEventListener("close", restoreViewerFocus);
  // A click on the dialog itself, not its content, is on the backdrop.
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
