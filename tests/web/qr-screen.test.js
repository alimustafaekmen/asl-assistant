// The "open on your phone" screen as the page wires it.
//
// qr-targets, qr-share and qr-copy cover the screen's functions. These tests
// start the app on the real markup and drive the controls a visitor touches.
//
// The faults they kill:
// - the target choice is bound to a click: moving between radios with the
//   arrow keys fires change and, on some browsers, no click, so the code would
//   keep pointing at the old screen;
// - the share button is shown where the browser has no share sheet (a dead
//   button), or hidden where it has one (the natural way to send the link on
//   a phone);
// - the share button is not connected to the share operation.
//
// kjua, the clipboard and the share sheet are browser boundaries and are faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** The app booted on the real markup, with the browser's `navigator` as given. */
async function bootedApp(navigator = {}) {
  const holder = {};
  const app = loadWebApp({
    boot: true,
    globals: { console: quietConsole, navigator, kjua: () => holder.app.makeTarget({}) },
  });
  holder.app = app;
  await app.ready;
  return app;
}

const select = (app, selector) => {
  const found = app.evaluate(`document.querySelector(${JSON.stringify(selector)})`);
  assert.ok(found, `the page has no ${selector}`);
  return found;
};

test("choosing a target radio, by change alone, opens that target", async () => {
  const app = await bootedApp();
  app.get("setMode")("qr");
  const radio = select(app, 'input[type="radio"][data-qr-target="word"]');

  radio.checked = true;
  radio.dispatchEvent({ type: "change" });

  assert.equal(app.evaluate("state.qrTarget"), "word");
  assert.equal(app.evaluate("els.qrDemoUrl.textContent"), "https://asl-assistant.pages.dev/#word");
});

test("the share button is shown where the browser can share", async () => {
  const app = await bootedApp({ share: async () => {} });

  app.get("setMode")("qr");

  assert.equal(select(app, "#qrShare").hidden, false);
});

test("the share button stays hidden where the browser cannot share", async () => {
  const app = await bootedApp({});

  app.get("setMode")("qr");

  assert.equal(select(app, "#qrShare").hidden, true);
});

test("pressing the share button hands the link of the chosen target to the share sheet", async () => {
  const shared = [];
  const app = await bootedApp({ share: async (data) => void shared.push(JSON.parse(JSON.stringify(data))) });
  app.get("setMode")("qr");
  app.get("setQrTarget")("word");

  select(app, "#qrShare").dispatchEvent({ type: "click", detail: 1 });

  assert.deepEqual(shared, [{ title: "ASL Assistant", url: "https://asl-assistant.pages.dev/#word" }]);
});
