// The "open on your phone" screen without its QR library.
//
// kjua comes from a CDN, and it can be blocked, offline or throw. A
// placeholder picture and a line saying the library failed would leave the
// visitor without the one thing the screen is for. The link is the fallback:
// it must be shown, readable and copyable. kjua is the boundary faked here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LETTER_URL, clipboard, qrApp, status } from "./helpers/qr-app.mjs";

test("when the QR library did not load, the screen shows the link in its place", () => {
  const { app } = qrApp({ kjua: false });

  app.get("renderQrDemo")();

  assert.match(app.evaluate("els.qrCanvas.textContent"), /QR kodu çizilemedi/);
  assert.ok(app.evaluate("els.qrCanvas.textContent").includes(LETTER_URL), "the link itself must be in the place of the code");
  assert.match(status(app), /^QR kodu çizilemedi; bağlantıyı kopyalayıp telefonunuza gönderebilirsiniz\./);
  assert.ok(app.evaluate('els.qrCanvas.getAttribute("aria-label")').endsWith(LETTER_URL));
});

test("when the library throws, the screen falls back the same way", () => {
  const { app } = qrApp({ kjua: false });
  app.evaluate("window").kjua = () => {
    throw new Error("text too long");
  };

  assert.doesNotThrow(() => app.get("renderQrDemo")());
  assert.match(app.evaluate("els.qrCanvas.textContent"), /QR kodu çizilemedi/);
});

test("copying still works when the QR library did not load", async () => {
  const written = [];
  const { app } = qrApp({ kjua: false, navigator: clipboard(async (text) => void written.push(text)) });
  app.get("renderQrDemo")();

  await app.get("copyQrDemoUrl")();

  assert.deepEqual(written, [LETTER_URL]);
  assert.equal(status(app), "Bağlantı kopyalandı.");
});

test("a library that loads again after a failure is used again", () => {
  const { app } = qrApp({ kjua: false });
  app.get("renderQrDemo")();
  const drawn = [];
  app.evaluate("window").kjua = (options) => (drawn.push(options), app.makeTarget({}));

  app.get("renderQrDemo")();

  assert.equal(drawn.length, 1);
  assert.doesNotMatch(app.evaluate("els.qrCanvas.textContent"), /QR kodu çizilemedi/);
});
