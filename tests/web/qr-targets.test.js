// Choosing which screen the QR code opens.
//
// The targets are a group of radios: choosing one fires a change event, and a
// keyboard moves between them with the arrow keys, which fires change and not
// a click on every browser. The screen also redraws from state when it is
// opened again, so the radios must show what the state says.
//
// These tests hand the change handler radios built like the markup's,
// <input type="radio"> elements carrying data-qr-target, so each case sets the
// checked state it needs; qr-screen.test.js drives the page's own radios.
// Nothing else of the app is replaced.

import assert from "node:assert/strict";
import { test } from "node:test";

import { qrApp } from "./helpers/qr-app.mjs";

/** A radio of the group, as the browser would hand it to a change listener. */
function radio(app, target, checked) {
  const element = app.evaluate('document.createElement("input")');
  element.type = "radio";
  element.dataset.qrTarget = target;
  element.checked = checked;
  return element;
}

test("choosing a radio opens that target in the code and the link", () => {
  const { app, drawn } = qrApp();

  app.get("handleQrTargetChange")({ target: radio(app, "word", true) });

  assert.equal(app.evaluate("state.qrTarget"), "word");
  assert.equal(drawn.at(-1).text, "https://asl-assistant.pages.dev/#word");
  assert.equal(app.evaluate("els.qrDemoUrl.textContent"), "https://asl-assistant.pages.dev/#word");
});

test("a change event from a radio that is not checked changes nothing", () => {
  const { app, drawn } = qrApp();

  app.get("handleQrTargetChange")({ target: radio(app, "test", false) });

  assert.equal(app.evaluate("state.qrTarget"), "letter");
  assert.equal(drawn.length, 0);
});

test("a radio whose target is unknown falls back to the letter screen", () => {
  const { app } = qrApp();
  app.get("setQrTarget")("word");

  app.get("handleQrTargetChange")({ target: radio(app, "coach", true) });

  assert.equal(app.evaluate("state.qrTarget"), "letter");
});

test("drawing the screen checks the radio of the target in state and no other", () => {
  const { app } = qrApp();
  const radios = ["letter", "word", "test"].map((target) => radio(app, target, false));
  for (const element of radios) app.evaluate("document.body").appendChild(element);

  app.get("setQrTarget")("test");

  assert.deepEqual(radios.map((element) => element.checked), [false, false, true]);
  app.get("setQrTarget")("word");
  assert.deepEqual(radios.map((element) => element.checked), [false, true, false]);
});
