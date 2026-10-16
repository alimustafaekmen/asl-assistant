// Copying the link on the "open on your phone" screen.
//
// "Bağlantı kopyalandı" is a promise that pasting will work. Copying can fail
// (a denied permission, an insecure page, a browser without the clipboard API)
// and the screen used to say it had worked anyway, whatever the browser
// answered. The clipboard, the legacy copy command and the text selection are
// browser APIs and are the boundaries faked here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_URL, announced, clipboard, qrApp, status } from "./helpers/qr-app.mjs";

test("a copied link is reported as copied, on screen and to a screen reader", async () => {
  const written = [];
  const { app } = qrApp({ navigator: clipboard(async (text) => void written.push(text)) });

  await app.get("copyQrDemoUrl")();

  assert.deepEqual(written, [LETTER_URL]);
  assert.equal(status(app), "Bağlantı kopyalandı.");
  assert.equal(announced(app), "Bağlantı kopyalandı.");
});

test("a link that could not be copied is not reported as copied", async () => {
  const { app } = qrApp({
    navigator: clipboard(async () => Promise.reject(new Error("denied"))),
    execCommand: () => false,
  });

  await app.get("copyQrDemoUrl")();

  assert.match(status(app), /^Kopyalanamadı\./);
  assert.doesNotMatch(status(app), /kopyalandı/);
  assert.match(announced(app), /^Kopyalanamadı\./);
});

test("without a clipboard API the legacy copy command is used, and its answer is believed", async () => {
  const worked = qrApp({ execCommand: () => true });
  await worked.app.get("copyQrDemoUrl")();
  assert.equal(status(worked.app), "Bağlantı kopyalandı.");

  const refused = qrApp({ execCommand: () => false });
  await refused.app.get("copyQrDemoUrl")();
  assert.match(status(refused.app), /^Kopyalanamadı\./);
});

test("a copy command that throws is a failed copy", async () => {
  const { app } = qrApp({
    execCommand: () => {
      throw new Error("not allowed");
    },
  });

  await app.get("copyQrDemoUrl")();

  assert.match(status(app), /^Kopyalanamadı\./);
});

test("when copying fails the link is selected so it can be copied by hand", async () => {
  const selected = [];
  const { app } = qrApp({ execCommand: () => false });
  app.evaluate("document").createRange = () => ({
    selectNodeContents: (node) => selected.push(node),
  });
  app.evaluate("window").getSelection = () => ({ removeAllRanges() {}, addRange() {} });

  await app.get("copyQrDemoUrl")();

  assert.equal(selected.length, 1);
  assert.equal(selected[0], app.evaluate("els.qrDemoUrl"));
});

test("a failed copy then a good one leaves the good message", async () => {
  let allowed = false;
  const { app } = qrApp({
    navigator: clipboard(async () => (allowed ? undefined : Promise.reject(new Error("denied")))),
    execCommand: () => false,
  });

  await app.get("copyQrDemoUrl")();
  allowed = true;
  await app.get("copyQrDemoUrl")();

  assert.equal(status(app), "Bağlantı kopyalandı.");
});
