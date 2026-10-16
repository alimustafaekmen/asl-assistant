// Sharing the link from the "open on your phone" screen.
//
// On a phone the natural way to pass the link on is the system share sheet.
// Whether the browser has one is a property of the browser, so the screen asks
// the browser; whether the visitor finished or cancelled is the sheet's
// answer, and cancelling is not a failure. navigator.share is the boundary.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_URL, announced, clipboard, qrApp, status } from "./helpers/qr-app.mjs";

test("sharing hands the link to the system share sheet", async () => {
  const shared = [];
  const { app } = qrApp({ navigator: { share: async (data) => void shared.push(data) } });
  app.get("setQrTarget")("word");

  await app.get("shareQrDemoUrl")();

  // The app's object has the app realm's prototype, so it is compared as data.
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [
    { title: "ASL Assistant", url: "https://asl-assistant.netlify.app/#word" },
  ]);
});

test("closing the share sheet is not an error", async () => {
  const abort = Object.assign(new Error("closed"), { name: "AbortError" });
  const { app } = qrApp({ navigator: { share: async () => Promise.reject(abort) } });
  app.evaluate('els.qrStatus.textContent = "before"');

  await app.get("shareQrDemoUrl")();

  assert.equal(status(app), "before", "the visitor chose to cancel; nothing is said");
  assert.equal(announced(app), "");
});

test("a share that fails says so and points to copying", async () => {
  const { app } = qrApp({ navigator: { share: async () => Promise.reject(new Error("no target")) } });

  await app.get("shareQrDemoUrl")();

  assert.match(status(app), /^Paylaşılamadı\./);
  assert.match(status(app), /kopyalayabilirsiniz/);
});

test("sharing is only offered where the browser can share", () => {
  assert.equal(qrApp({ navigator: { share: async () => {} } }).app.get("canShareQrDemoUrl")(), true);
  assert.equal(qrApp({ navigator: {} }).app.get("canShareQrDemoUrl")(), false);
});

test("where the browser cannot share, sharing copies the link instead", async () => {
  const written = [];
  const { app } = qrApp({ navigator: clipboard(async (text) => void written.push(text)) });

  await app.get("shareQrDemoUrl")();

  assert.deepEqual(written, [LETTER_URL]);
  assert.equal(status(app), "Bağlantı kopyalandı.");
});
