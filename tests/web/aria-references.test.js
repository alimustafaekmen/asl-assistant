// Labels and descriptions point at elements that exist.
//
// A screen reader builds a region's or a control's name from the ids in
// aria-labelledby, its description from aria-describedby, and a field's label
// from <label for>. A reference to a missing id is dropped without a sound, so
// moving or renaming an element leaves the control nameless while every screen
// still looks right. Each route is opened through the real app, so markup the
// scripts add counts too.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const ROUTES = ["letter", "coach", "word", "test", "project", "qr"];
const REFERENCES = ["aria-labelledby", "aria-describedby", "aria-controls"];

/** Every reference on the page that names no element, as "attribute -> id". */
function danglingReferences(app) {
  const dangling = [];
  for (const attribute of REFERENCES) {
    for (const element of app.evaluate(`document.querySelectorAll("[${attribute}]")`)) {
      for (const id of element.getAttribute(attribute).split(/\s+/).filter(Boolean)) {
        if (!app.evaluate(`document.getElementById(${JSON.stringify(id)})`)) dangling.push(`${attribute} -> ${id}`);
      }
    }
  }
  for (const label of app.evaluate(`document.querySelectorAll("label[for]")`)) {
    const id = label.getAttribute("for");
    if (!app.evaluate(`document.getElementById(${JSON.stringify(id)})`)) dangling.push(`label for -> ${id}`);
  }
  return dangling;
}

test("the page labels some regions and fields by reference", async () => {
  // Guards the loop below, which would pass with nothing to check.
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  assert.ok(app.evaluate(`document.querySelectorAll("[aria-labelledby]")`).length > 0);
  assert.ok(app.evaluate(`document.querySelectorAll("label[for]")`).length > 0);
});

test("every label and description names an element that exists, on every screen", async () => {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;

  const dangling = [];
  for (const route of ROUTES) {
    app.get("setMode")(route);
    dangling.push(...danglingReferences(app).map((reference) => `#${route}: ${reference}`));
  }
  assert.deepEqual(dangling, []);
});
