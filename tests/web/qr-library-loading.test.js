// The QR encoder is fetched when the "open on your phone" screen first needs it.
//
// Most visitors never open that screen, so a page open must not download,
// check and run the library; opening the screen must fetch it once, pinned by
// its integrity hash, and draw the code with it. A library that fails to load
// leaves the link in the code's place, and the next draw tries again.
//
// The script element the page adds is the network boundary: the test reads
// what it asks for and answers it with a load or an error, as the browser
// does. kjua itself is faked when the load succeeds.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { LETTER_URL, status } from "./helpers/qr-app.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const KJUA = "https://cdn.jsdelivr.net/npm/kjua@0.9.0/dist/kjua.min.js";
const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

async function pageAt(hash) {
  const location = new URL(`https://asl-assistant.pages.dev/${hash}`);
  const app = loadWebApp({ boot: true, globals: { console: quietConsole, location } });
  await app.ready;
  return app;
}

/** Script elements in the document that ask for the QR library. */
function qrLibraryScripts(app) {
  return Array.from(app.evaluate('document.querySelectorAll("script")')).filter(
    (script) => (script.getAttribute("src") ?? script.src ?? "") === KJUA,
  );
}

/** The library arrives: kjua is defined and the script reports its load. */
function answerWithLibrary(app, script) {
  const drawn = [];
  app.evaluate("window").kjua = (options) => (drawn.push(options), app.makeTarget({}));
  script.dispatchEvent({ type: "load", target: script });
  return drawn;
}

test("opening a page does not ask for the QR library", async () => {
  for (const hash of ["", "#letter", "#word", "#coach", "#project"]) {
    const app = await pageAt(hash);
    await flush();
    assert.equal(qrLibraryScripts(app).length, 0, `${hash || "a bare URL"} asks for the QR library`);
  }
});

test("opening the QR screen fetches the library once, pinned, and draws the code with it", async () => {
  const app = await pageAt("#qr");
  const [script, ...more] = qrLibraryScripts(app);
  assert.ok(script, "the QR screen asks for the library");
  assert.equal(more.length, 0);
  assert.match(script.integrity ?? "", /^sha384-[A-Za-z0-9+/]+={0,2}$/, "the script is pinned by its hash");
  assert.equal(script.crossOrigin, "anonymous", "an integrity check needs a CORS request");
  assert.equal(status(app), app.get("t")("info.qr.preparing"), "the screen says it is preparing the code");

  // A redraw while the library is on its way waits for the same load.
  app.get("setQrTarget")("word");
  assert.equal(qrLibraryScripts(app).length, 1, "a redraw while loading asks again");

  const drawn = answerWithLibrary(app, script);
  await flush();
  const WORD_URL = "https://asl-assistant.pages.dev/#word";
  assert.deepEqual(drawn.map((options) => options.text), [WORD_URL], "the code is drawn once, for the chosen target");
  assert.equal(status(app), app.get("t")("info.qr.ready", { url: WORD_URL }));

  app.get("setMode")("letter");
  app.get("setMode")("qr");
  await flush();
  assert.equal(qrLibraryScripts(app).length, 1, "the library is fetched only once");
  assert.equal(drawn.length, 2, "a second visit draws with the loaded library");
});

test("a library that fails to load leaves the link, and the next draw tries again", async () => {
  const app = await pageAt("#qr");
  const [first] = qrLibraryScripts(app);
  first.dispatchEvent({ type: "error", target: first });
  await flush();
  assert.match(app.evaluate("els.qrCanvas.textContent"), /QR kodu çizilemedi/);
  assert.ok(app.evaluate("els.qrCanvas.textContent").includes(LETTER_URL), "the link is in the code's place");

  app.get("setMode")("letter");
  app.get("setMode")("qr");
  const retry = qrLibraryScripts(app).find((script) => script !== first);
  assert.ok(retry, "opening the screen again asks for the library again");
  const drawn = answerWithLibrary(app, retry);
  await flush();
  assert.equal(drawn.length, 1, "and draws the code once it arrives");
});
