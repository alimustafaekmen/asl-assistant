// Where a visitor starts the camera-free demo, and where Model Test went.
//
// Model Test reads fixture files and shows model output: a developer tool a
// visitor does not understand (owner decision 2026-10-18). A visitor without
// a camera is offered the demo instead, on the letter stage, in the camera
// problem (an in-app browser that blocks the camera) and on the project page;
// each plays it on the letter screen. Model Test keeps its route and is
// linked once, for developers, from the project page.
//
// The faults these kill: a start button that still opens Model Test, one that
// starts the demo on the screen it sits on instead of the letter screen, a
// visitor control left pointing at Model Test, a project page that lost its
// developer link, and a keyboard press that leaves focus on a hidden button.
// The network, the clock and ONNX Runtime are the boundaries faked
// (helpers/demo-app.mjs); everything else is the booted app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonResponse } from "./helpers/fake-ort.mjs";
import { demoApp, flush } from "./helpers/demo-app.mjs";

/** The visible start of the demo inside `scope`, a selector. */
function demoStart(demo, scope) {
  const button = demo.app.evaluate(`document.querySelector(${JSON.stringify(`${scope} [data-trigger="demo"]`)})`);
  assert.ok(button, `${scope} offers the camera-free demo`);
  return button;
}

test("the letter stage's way to watch the example starts the demo there", async () => {
  const demo = await demoApp();
  demo.click(demoStart(demo, "#cameraIntro"));
  await flush(30);
  await demo.play(600);

  assert.equal(demo.app.evaluate("state.mode"), "letter");
  assert.equal(demo.byId("demoPanel").hidden, false, "the demo shows on the stage");
  assert.equal(demo.publishedLetter(), "F", "and plays its first letter");
  assert.equal(demo.plate(), "F", "which the plate reads");
  assert.equal(demo.location.hash, "#letter", "without leaving the screen");
});

test("the project page's way to watch the example plays it on the letter screen", async () => {
  const demo = await demoApp({ hash: "#project" });
  demo.click(demoStart(demo, "#projectScreen"));
  await flush(30);
  await demo.play(600);

  assert.equal(demo.app.evaluate("state.mode"), "letter", "the demo opens the letter screen");
  assert.equal(demo.location.hash, "#letter", "and the address says so");
  assert.equal(demo.byId("projectScreen").hidden, true, "the project page gives way");
  assert.equal(demo.publishedLetter(), "F");
  assert.equal(demo.plate(), "F");
});

test("the camera problem's way on plays the example, from the coach screen too", async () => {
  const demo = await demoApp({ hash: "#coach" });
  demo.app.evaluate(`showCameraProblem("denied")`);
  const without = demo.byId("cameraNoCamera");
  assert.equal(without.dataset.trigger, "demo", "the problem's second action is the demo");
  demo.click(without);
  await flush(30);
  await demo.play(600);

  assert.equal(demo.app.evaluate("state.mode"), "letter");
  assert.equal(demo.byId("cameraProblem").hidden, true, "the problem is over");
  assert.equal(demo.publishedLetter(), "F");
  assert.equal(demo.camera.requests, 0, "no camera is asked for");
});

test("no visitor control leads to Model Test; one link on the project page does, and it opens it", async () => {
  const demo = await demoApp({ hash: "#project" });
  const ways = Array.from(
    demo.app.evaluate(
      `document.querySelectorAll('[data-mode="test"], [data-go-mode="test"], [data-qr-target="test"], a[href="#test"]')`,
    ),
  );
  assert.equal(ways.length, 1, "exactly one way into Model Test is in the page");
  const [link] = ways;
  assert.equal(link.tagName, "A", "a link, which a developer can also copy or open in a tab");
  assert.equal(demo.app.evaluate("els.projectScreen").contains(link), true, "on the project page");
  assert.match(link.textContent, /Model Test/, "naming the tool it opens");

  // The browser follows the link: the hash changes and hashchange fires.
  assert.equal(link.dispatchEvent({ type: "click", detail: 1, target: link }), true, "the page lets the link be followed");
  demo.location.hash = link.getAttribute("href");
  demo.app.windowHandler("hashchange")({ type: "hashchange" });
  assert.equal(demo.app.evaluate("state.mode"), "test");
  assert.equal(demo.byId("modelTestScreen").hidden, false, "Model Test opens");
});

test("#test in the address still opens Model Test", async () => {
  const demo = await demoApp({ hash: "#test" });
  assert.equal(demo.app.evaluate("state.mode"), "test");
  assert.equal(demo.byId("modelTestScreen").hidden, false);
  assert.equal(demo.demoRequests.length, 0, "and starts no demo");
});

test("a keyboard start whose recording cannot be loaded gives focus back to the stage's start", async () => {
  const demo = await demoApp({ respond: () => jsonResponse({}, 404) });
  const start = demoStart(demo, "#cameraIntro");
  const panel = demo.byId("demoPanel");
  const focused = [];
  for (const element of [start, panel]) element.focus = () => focused.push(element);

  start.dispatchEvent({ type: "click", detail: 0, target: start });
  assert.equal(focused.at(-1), panel, "focus goes to the demo while it loads");
  await flush(30);

  assert.equal(panel.hidden, true, "precondition: the load failed");
  assert.equal(focused.at(-1), start, "then back to a start that is shown again");
});
