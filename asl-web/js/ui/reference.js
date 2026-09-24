// Reference gallery: sign images, video links, and the fullscreen lightbox.
//
// Letter mode shows the single alphabet card. Word contexts show the five-page
// split reference, because the combined poster is unreadable at screen size. In
// coach mode the current target decides which of the two is shown.
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
 * Point the reference panel at the right material for the current mode.
 *
 * Word contexts get the five-page split reference rather than the combined
 * poster, which is unreadable at screen size. In coach mode the target decides
 * which of the two applies.
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

  const refAsset = isWordRef ? REFERENCE_ASSETS.wordPages[0] : REFERENCE_ASSETS.letter.src;
  els.referenceImage.src = refAsset;
  els.referenceImage.alt = isWordRef
    ? "ASL kelime referans sayfası 1"
    : REFERENCE_ASSETS.letter.alt;
  els.referenceImage.loading = "lazy";
  els.referenceImage.decoding = "async";
  renderReferenceThumbnails(isWordRef);

  if (els.referenceKicker) {
    els.referenceKicker.textContent =
      mode === "coach" ? "Koç referansı" : mode === "word" ? "Kelime referansı" : "Harf referansı";
  }
  if (els.referenceTitle) {
    els.referenceTitle.textContent =
      mode === "coach"
        ? (coachIsWord ? `Kelime hedefi: ${target}` : `Harf hedefi: ${target}`)
        : mode === "word"
          ? (wordModeTarget ? `Seçili kelime: ${wordModeTarget}` : "50 kelime referans kartı")
          : "ASL harf kartları";
  }
  if (els.referenceNote) {
    els.referenceNote.textContent =
      mode === "word"
        ? "Kelime referansı 5 sayfaya bölünmüştür. Sayfa seçip işareti incelerken yüz, omuz ve el aynı anda kamerada kalmalı."
        : mode === "coach"
          ? (coachIsWord
              ? "Kelime hedefleri için referans sayfasını aç, sonra 45 frame kayıtla sonucu kontrol et."
              : "Hedefi yapamazsan görsel referansı aç veya video rehberden destek al.")
          : "Harf karışırsa referans görseli açıp el şeklini karşılaştır.";
  }
  if (els.referenceVideoLink) {
    els.referenceVideoLink.href = buildReferenceVideoUrl(
      mode,
      mode === "word" ? wordModeTarget : target,
    );
  }
}

/**
 * Build the page buttons for the split word reference.
 *
 * @param {boolean} isWordRef Whether a word reference is showing; letter mode
 *   hides the strip entirely.
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
    button.dataset.active = index === 0 ? "true" : "false";
    button.addEventListener("click", () => {
      els.referenceImage.src = src;
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
 * Show or hide the reference body.
 *
 * @returns {void}
 */
function toggleReference() {
  const isHidden = els.referenceBody.hidden;
  els.referenceBody.hidden = !isHidden;
  els.toggleReference.textContent = isHidden ? "Gizle" : "Göster";
}

/**
 * Open the fullscreen view of the active reference image.
 *
 * Focus moves to the close control so the dialog is usable from the keyboard.
 *
 * @returns {void}
 */
function _openReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  const img = optionalElement("lightboxImage", HTMLImageElement);
  const title = document.getElementById("lightboxTitle");
  if (!lb || !img || !els.referenceImage) return;
  const src = els.referenceImage.currentSrc || els.referenceImage.src;
  const alt = els.referenceImage.alt || "ASL referans görseli";
  img.src = src;
  img.alt = alt;
  if (title) title.textContent = alt;
  lb.hidden = false;
  // Prevent the page behind the modal from scrolling.
  document.body.dataset.lightboxOpen = "true";
  // Move focus to the close control for keyboard users.
  document.getElementById("lightboxClose")?.focus();
}

/**
 * Close the fullscreen view and return focus to the reference image.
 *
 * @returns {void}
 */
function _closeReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  delete document.body.dataset.lightboxOpen;
  // Restore focus to the element that opens the lightbox.
  els.referenceImage?.focus?.();
}

/**
 * Make the reference image open fullscreen, and wire the ways out.
 *
 * The image is given a button role and keyboard handling because it is
 * interactive. The dialog closes on the close button, a backdrop click, and
 * Escape; a click inside the dialog does not close it.
 *
 * @returns {void}
 */
function bindReferenceLightbox() {
  const lb = document.getElementById("lightbox");
  const closeBtn = document.getElementById("lightboxClose");
  if (!lb) return;

  // Make the reference image usable with pointer and keyboard input.
  if (els.referenceImage) {
    els.referenceImage.style.cursor = "zoom-in";
    els.referenceImage.setAttribute("role", "button");
    els.referenceImage.setAttribute("tabindex", "0");
    els.referenceImage.setAttribute("title", "Tam ekranda görüntüle");
    els.referenceImage.addEventListener("click", _openReferenceLightbox);
    els.referenceImage.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        _openReferenceLightbox();
      }
    });
  }

  // Close button.
  closeBtn?.addEventListener("click", _closeReferenceLightbox);

  // Backdrop click; clicks inside the dialog must not close it.
  lb.addEventListener("click", (event) => {
    if (event.target === lb) _closeReferenceLightbox();
  });

  // Escape key while the dialog is open.
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lb.hidden) {
      event.preventDefault();
      _closeReferenceLightbox();
    }
  });
}
