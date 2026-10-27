// The QR code the "open on your phone" screen draws.
//
// A code a phone cannot read sends the visitor away with nothing. Scanners
// need a quiet zone of four modules around the code and enough contrast, and a
// code drawn in the dark theme's colours or in a theme tint can fail both. The
// code is drawn by kjua from a CDN, which is the boundary faked here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_URL, qrApp } from "./helpers/qr-app.mjs";

test("the code is drawn for the link, with the four-module quiet zone scanners need", () => {
  const { app, drawn } = qrApp();

  app.get("renderQrDemo")();

  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].text, LETTER_URL);
  assert.ok(drawn[0].quiet >= 4, `quiet zone ${drawn[0].quiet} modules; ISO/IEC 18004 asks for 4`);
});

test("choosing another target redraws the code for that target", () => {
  const { app, drawn } = qrApp();

  app.get("setQrTarget")("word");
  app.get("setQrTarget")("letter");

  assert.deepEqual(drawn.map((options) => options.text), [
    "https://asl-assistant.pages.dev/#word",
    "https://asl-assistant.pages.dev/#letter",
  ]);
  assert.equal(app.evaluate("els.qrDemoUrl.textContent"), "https://asl-assistant.pages.dev/#letter");
});

test("the code stays dark on white in the dark theme", () => {
  const { app, drawn } = qrApp();
  app.evaluate('els.appShell.dataset.theme = "dark"; document.body.dataset.theme = "dark";');

  app.get("renderQrDemo")();

  assert.equal(drawn[0].fill, "#17181b");
  assert.equal(drawn[0].back, "#ffffff");
});

test("the colours come from the page's unthemed QR tokens, not from the theme's", () => {
  // The theme tokens are dark in dark mode; the QR tokens are not.
  const { app, drawn } = qrApp({
    style: {
      "--qr-ink": "#101112",
      "--qr-back": "#fefefe",
      "--color-text": "#f4f4f5",
      "--color-surface": "#17181b",
    },
  });
  app.evaluate('els.appShell.dataset.theme = "dark";');

  app.get("renderQrDemo")();

  assert.equal(drawn[0].fill, "#101112");
  assert.equal(drawn[0].back, "#fefefe");
});

test("the code's label carries the link, so it can be read without seeing the code", () => {
  const { app } = qrApp();

  app.get("setQrTarget")("word");

  assert.match(app.evaluate('els.qrCanvas.getAttribute("aria-label")'), /https:\/\/asl-assistant\.pages\.dev\/#word$/);
});
