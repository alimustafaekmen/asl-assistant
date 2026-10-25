// The "open on your phone" screen in English, and the switch while it is open.
//
// The faults these tests kill:
// - a part of the screen left in Turkish for an English reader: its copy,
//   its buttons, the code's spoken name, or a status line in any state
//   (ready, not drawn, copied, not copied, not shared);
// - a status said to a screen reader in Turkish on an English page;
// - a switch that leaves the status line or the code's name in the old
//   language, and a switch back that does not give the same Turkish.
//
// kjua, the clipboard, the share sheet and the browser's languages are faked
// at their boundaries; the screen is the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_URL, announced, clipboard, qrApp, status } from "./helpers/qr-app.mjs";
import { turkishLeft } from "./helpers/turkish-left.mjs";

const ENGLISH = { languages: ["en-US", "en"], language: "en-US" };

/** The screen in an English browser, with `navigator` extending its languages. */
function englishQr(options = {}) {
  return qrApp({ ...options, navigator: { ...ENGLISH, ...options.navigator } });
}

const screen = (app) => app.evaluate('document.getElementById("qrScreen")');
const turkishOn = (app) => turkishLeft(screen(app), { includeHidden: true });
const codeName = (app) => app.evaluate('els.qrCanvas.getAttribute("aria-label")');
const missing = (app) => [...app.get("I18N_PROBLEMS").missing];

test("an English reader gets the screen in English before and after the code is drawn", () => {
  const { app } = englishQr();
  assert.deepEqual(turkishOn(app), [], "before the code is drawn");
  assert.equal(status(app), "Preparing the QR code…");

  app.get("renderQrDemo")();

  assert.deepEqual(turkishOn(app), []);
  assert.equal(status(app), `QR code ready: ${LETTER_URL}`);
  assert.equal(codeName(app), `QR code: ${LETTER_URL}`);
  assert.deepEqual(missing(app), []);
});

test("an English reader gets the fallback in English when the code cannot be drawn", async () => {
  const { app } = englishQr({ kjua: false });

  app.get("renderQrDemo")();
  // The page asks for the library; the refusal arrives after the call.
  await flush();

  assert.deepEqual(turkishOn(app), []);
  assert.match(app.evaluate("els.qrCanvas.textContent"), /The QR code could not be drawn\./);
  assert.ok(app.evaluate("els.qrCanvas.textContent").includes(LETTER_URL));
  assert.match(status(app), /^The QR code could not be drawn; you can copy the link/);
});

test("copying and sharing report in English, on screen and to a screen reader", async () => {
  const copied = englishQr({ navigator: clipboard(async () => {}) });
  await copied.app.get("copyQrDemoUrl")();
  assert.equal(status(copied.app), "Link copied.");
  assert.equal(announced(copied.app), "Link copied.");

  const refused = englishQr({ execCommand: () => false });
  await refused.app.get("copyQrDemoUrl")();
  assert.match(status(refused.app), /^Couldn't copy\./);
  assert.match(announced(refused.app), /^Couldn't copy\./);
  assert.deepEqual(turkishOn(refused.app), []);

  const unshared = englishQr({ navigator: { share: async () => Promise.reject(new Error("no target")) } });
  await unshared.app.get("shareQrDemoUrl")();
  assert.match(status(unshared.app), /^Couldn't share\./);
  assert.deepEqual(turkishOn(unshared.app), []);
  assert.deepEqual(missing(unshared.app), []);
});

test("a switch while a status is shown rewrites it and the code's name, both ways", async () => {
  const { app } = qrApp({ navigator: clipboard(async () => {}) });
  app.get("renderQrDemo")();
  await app.get("copyQrDemoUrl")();
  assert.equal(status(app), "Bağlantı kopyalandı.");
  const turkishName = codeName(app);

  app.get("setLanguage")("en");
  assert.equal(status(app), "Link copied.");
  assert.equal(codeName(app), `QR code: ${LETTER_URL}`);
  assert.deepEqual(turkishOn(app), []);

  app.get("setLanguage")("tr");
  assert.equal(status(app), "Bağlantı kopyalandı.");
  assert.equal(codeName(app), turkishName);
});
