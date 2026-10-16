// The reference viewer: a native modal dialog over the sign images.
//
// showModal() is what gives the page behind it an inert state and keeps Tab
// inside, so the tests check that the app asks for it, hands focus back to
// whatever opened the viewer, steps through the cards and pages, and loads no
// sign image before the viewer is opened. The browser's own dialog methods and
// the camera are the only things faked: the dialog is a stub that records its
// calls, because the harness has no layout and no top layer.

import assert from "node:assert/strict";
import { test } from "node:test";

import { wordModeApp } from "./helpers/word-recording.mjs";

/** The app in word mode, with word_reference.json loaded and a recording dialog. */
async function viewerApp() {
  const { app } = wordModeApp({ winner: "water" });
  await app.get("loadWordReference")();
  app.evaluate(`
    globalThis.__calls = [];
    const dialog = document.getElementById("lightbox");
    dialog.showModal = () => { __calls.push("showModal"); dialog.setAttribute("open", ""); };
    dialog.close = () => { __calls.push("close"); dialog.removeAttribute("open"); };
    for (const id of ["lightboxClose", "referenceOpen", "referenceImage"]) {
      const el = document.getElementById(id);
      el.focus = () => __calls.push("focus:" + id);
    }
    bindReferenceLightbox();
  `);
  return app;
}

// Through JSON, because an array made inside the app's context is not an
// array of this one.
const calls = (app) => JSON.parse(app.evaluate("JSON.stringify(__calls)"));
const title = (app) => app.evaluate('document.getElementById("lightboxTitle").textContent');
const dialog = (app) => app.evaluate('document.getElementById("lightbox")');
const click = (app, id) => app.evaluate(`document.getElementById("${id}")`).dispatchEvent({ type: "click", detail: 1 });

test("opening the viewer asks for a modal dialog and focuses Kapat", async () => {
  const app = await viewerApp();
  const opener = app.evaluate('document.getElementById("referenceOpen")');

  app.get("openReferenceViewer")({ kind: "card", label: "water", opener });

  assert.deepEqual(calls(app), ["showModal", "focus:lightboxClose"]);
  assert.equal(title(app), "water");
  assert.equal(app.evaluate('document.getElementById("lightboxCardImage").src'), "./assets/signs/word-50-5.png");
});

test("closing returns focus to the button that opened the viewer, not to the image", async () => {
  const app = await viewerApp();
  const opener = app.evaluate('document.getElementById("referenceOpen")');
  app.get("openReferenceViewer")({ kind: "card", label: "water", opener });

  dialog(app).dispatchEvent({ type: "cancel", preventDefault() {} });

  assert.deepEqual(calls(app).slice(2), ["close", "focus:referenceOpen"]);
  assert.ok(!calls(app).includes("focus:referenceImage"));
});

test("a click on the backdrop closes the viewer and a click inside does not", async () => {
  const app = await viewerApp();
  const opener = app.evaluate('document.getElementById("referenceOpen")');
  app.get("openReferenceViewer")({ kind: "card", label: "water", opener });

  const inner = app.evaluate('document.getElementById("lightboxBody")');
  dialog(app).dispatchEvent({ type: "click", target: inner });
  assert.ok(!calls(app).includes("close"), "a click on the content must not close the viewer");

  dialog(app).dispatchEvent({ type: "click" });
  assert.ok(calls(app).includes("close"));
});

test("next on the last word wraps to the first, and previous goes back", async () => {
  const app = await viewerApp();
  app.get("openReferenceViewer")({ kind: "card", label: "yes", opener: null });
  assert.equal(title(app), "yes");

  click(app, "lightboxNext");
  assert.equal(title(app), "all");

  click(app, "lightboxPrev");
  assert.equal(title(app), "yes");
});

test("the whole page of a card shows the page that holds it, and the card comes back", async () => {
  const app = await viewerApp();
  app.get("openReferenceViewer")({ kind: "card", label: "water", opener: null });

  click(app, "lightboxMode");
  assert.equal(app.evaluate('document.getElementById("lightboxImage").src'), "./assets/signs/word-50-5.png");
  assert.equal(app.evaluate('document.getElementById("lightboxCard").hidden'), true);
  assert.equal(title(app), "Kelime sayfası 5 / 5");
  assert.equal(app.evaluate('document.getElementById("lightboxMode").textContent'), "Yalnızca kart");

  click(app, "lightboxMode");
  assert.equal(app.evaluate('document.getElementById("lightboxCard").hidden'), false);
  assert.equal(title(app), "water");
  assert.equal(app.evaluate('document.getElementById("lightboxMode").textContent'), "Sayfanın tamamı");
});

test("page view steps through the five pages and wraps", async () => {
  const app = await viewerApp();
  app.get("openReferenceViewer")({ kind: "page", index: 4, opener: null });
  assert.equal(title(app), "Kelime sayfası 5 / 5");

  click(app, "lightboxNext");
  assert.equal(title(app), "Kelime sayfası 1 / 5");
  assert.equal(app.evaluate('document.getElementById("lightboxImage").src'), "./assets/signs/word-50-1.png");
});

test("zoom moves in steps from fit to 200 % and stops at both ends", async () => {
  const app = await viewerApp();
  app.get("openReferenceViewer")({ kind: "page", index: 0, opener: null });
  const readout = () => app.evaluate('document.getElementById("lightboxZoom").textContent');

  assert.equal(readout(), "Sığdır");
  const seen = [];
  for (let i = 0; i < 7; i++) {
    click(app, "lightboxZoomIn");
    seen.push(readout());
  }
  assert.deepEqual(seen, ["%50", "%75", "%100", "%150", "%200", "%200", "%200"]);
  assert.equal(app.evaluate('document.getElementById("lightboxZoomIn").disabled'), true);

  for (let i = 0; i < 6; i++) click(app, "lightboxZoomOut");
  assert.equal(readout(), "Sığdır");
  assert.equal(app.evaluate('document.getElementById("lightboxZoomOut").disabled'), true);
});

test("the viewer cannot be opened while a recording is running", async () => {
  const app = await viewerApp();
  for (const wordState of ["COUNTDOWN", "RECORDING", "PROCESSING"]) {
    app.evaluate(`state.wordState = "${wordState}";`);
    app.get("openReferenceViewer")({ kind: "card", label: "water", opener: null });
    assert.deepEqual(calls(app), [], `${wordState}: the viewer must stay closed`);
  }
});

test("no sign image is requested before the viewer or the reference is opened", async () => {
  const app = await viewerApp();
  // The panel is collapsed and nothing has been recognised.
  app.get("updateReferenceForMode")();

  // The harness does not reflect the src attribute, so a missing src reads
  // as undefined here and as an empty string in a browser.
  assert.ok(!app.evaluate('document.getElementById("lightboxImage").src'));
  assert.ok(!app.evaluate('document.getElementById("lightboxCardImage").src'));
  assert.ok(!app.evaluate("els.referenceImage.src"), "the word reference image waits for the panel to open");
});
