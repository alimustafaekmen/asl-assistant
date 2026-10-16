// What a recognised word shows beside the camera: its own card, and a toast
// that can take an accepted word back out of the transcript.
//
// A card is the page image cropped to the word's rectangle from
// word_reference.json, so the checks read the image source, the crop's custom
// properties and the alt text the app writes. Only the ONNX runtime, the
// clock and the MediaPipe results are fake.

import assert from "node:assert/strict";
import { test } from "node:test";

import { recordWord, wordModeApp } from "./helpers/word-recording.mjs";

async function waterApp(options = {}) {
  const ctx = wordModeApp({ winner: "water", ...options });
  await ctx.app.get("loadWordReference")();
  // The harness keeps no style properties, so the card frame records them.
  ctx.app.evaluate(`
    globalThis.__props = {};
    for (const id of ["referenceCard"]) {
      document.getElementById(id).style = { setProperty(name, value) { __props[name] = value; } };
    }
  `);
  return ctx;
}

const read = (app, expression) => app.evaluate(expression);
const props = (app) => JSON.parse(app.evaluate("JSON.stringify(__props)"));

test("a recognised word shows its card: the right page, cropped to its rectangle", async () => {
  const { app } = await waterApp();
  await recordWord(app);
  assert.equal(read(app, "state.prediction"), "water");

  assert.equal(read(app, 'document.getElementById("referenceCardImage").src'), "./assets/signs/word-50-5.webp");
  assert.equal(read(app, 'document.getElementById("referenceCard").hidden'), false);
  assert.equal(read(app, "els.referenceImage.hidden"), true, "the whole page gives way to the card");

  // water is card 48, at [0.5049, 0.5833, 0.4795, 0.1882] of its page.
  const crop = props(app);
  assert.equal(crop["--ref-x"], "0.5049");
  assert.equal(crop["--ref-y"], "0.5833");
  assert.equal(crop["--ref-w"], "0.4795");
  assert.equal(crop["--ref-h"], "0.1882");
  // 0.4795 * 1024 by 0.1882 * 1536: a card is about 1.7 times as wide as high.
  assert.ok(Math.abs(Number(crop["--ref-aspect"]) - 1.6985) < 0.01, `aspect ${crop["--ref-aspect"]}`);

  assert.equal(read(app, 'document.getElementById("referenceCardImage").alt'), "water işaretinin referans kartı");
  assert.equal(read(app, "els.referenceTitle.textContent"), "water");
});

test("the card opens the reference panel, and the panel is not reopened by a later redraw", async () => {
  const { app } = await waterApp();
  assert.equal(read(app, "els.referenceBody.hidden"), true);

  await recordWord(app);
  assert.equal(read(app, "els.referenceBody.hidden"), false, "a result brings the card into view");
  assert.equal(read(app, 'els.toggleReference.getAttribute("aria-expanded")'), "true");

  // The user puts the panel away; redrawing for the same word leaves it alone.
  app.get("toggleReference")();
  assert.equal(read(app, "els.referenceBody.hidden"), true);
  app.get("updateReferenceForMode")();
  assert.equal(read(app, "els.referenceBody.hidden"), true);
});

test("a new recording takes the previous word's card off the screen", async () => {
  const { app } = await waterApp();
  await recordWord(app);
  assert.equal(read(app, 'document.getElementById("referenceCard").hidden'), false);

  app.get("retryWordRecording")();
  assert.equal(read(app, "state.prediction"), "?");
  assert.equal(read(app, 'document.getElementById("referenceCard").hidden'), true);
  assert.equal(read(app, "els.referenceImage.hidden"), false);
});

test("without card data the reference stays a page and a result does not break it", async () => {
  const ctx = wordModeApp({ winner: "water" });
  // The data file is never loaded.
  await recordWord(ctx.app);
  assert.equal(read(ctx.app, "state.wordState"), "RESULT");
  assert.equal(read(ctx.app, 'document.getElementById("referenceCard").hidden'), true);
  assert.equal(read(ctx.app, "els.referenceImage.hidden"), false);
});

test("accepting a word shows a toast whose undo removes exactly that word", async () => {
  const { app } = await waterApp();
  app.evaluate('state.transcript = "HELLO ";');
  await recordWord(app);

  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(read(app, "state.transcript"), "HELLO water ");
  assert.equal(read(app, "els.toast.hidden"), false);
  assert.match(read(app, "els.toastText.textContent"), /water.*metne eklendi/);
  assert.equal(read(app, "els.toastAction.hidden"), false);

  app.evaluate("els.toastAction.onclick()");
  assert.equal(read(app, "state.transcript"), "HELLO ");
  assert.equal(read(app, "els.announcer.textContent").trim(), "water metinden çıkarıldı");
  assert.equal(read(app, "els.appendWordResult.disabled"), true, "one result is one consent: undo does not offer it again");

  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(read(app, "state.transcript"), "HELLO ", "the undone result is not appended a second time");
});

test("undo does nothing once the transcript has moved on", async () => {
  const { app } = await waterApp();
  await recordWord(app);
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
  assert.equal(read(app, "state.transcript"), "water ");

  app.evaluate('state.transcript += "A";');
  app.evaluate("els.toastAction.onclick()");
  assert.equal(read(app, "state.transcript"), "water A", "the word is no longer last, so nothing is taken out");
});
