// List renderers rebuild, they do not append.
//
// Every one of these clears its root before rebuilding, so calling it twice
// with the same state must leave the same number of rows. The vm context tracks
// children and honours innerHTML assignment, which is enough to show that
// without a browser.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

/** Render twice and report the child count after each call. */
function renderTwice(app, render, rootExpression) {
  render();
  const first = app.evaluate(`${rootExpression}.children.length`);
  render();
  const second = app.evaluate(`${rootExpression}.children.length`);
  return { first, second };
}

test("the prediction top-3 list rebuilds its rows", () => {
  const app = loadWebApp();
  app.evaluate(`state.top3 = [
    { label: "A", confidence: 0.8 },
    { label: "B", confidence: 0.15 },
    { label: "C", confidence: 0.05 },
  ];`);
  const renderTop3 = app.get("renderTop3");

  const { first, second } = renderTwice(app, renderTop3, "els.top3List");
  assert.equal(first, 3);
  assert.equal(second, first, "a second render must not append a second set");
});

test("the model test top-3 list rebuilds its rows", () => {
  const app = loadWebApp();
  const renderModelTestTop3 = app.get("renderModelTestTop3");
  const items = [
    { label: "water", confidence: 0.7 },
    { label: "sad", confidence: 0.2 },
  ];

  const { first, second } = renderTwice(
    app,
    () => renderModelTestTop3(items),
    "els.modelTestTop3List",
  );
  assert.equal(first, 2);
  assert.equal(second, first);
});

test("the coach target list rebuilds its options", () => {
  const app = loadWebApp();
  app.evaluate('state.coachTargetType = "letter";');
  const buildCoachOptions = app.get("buildCoachOptions");

  const { first, second } = renderTwice(app, buildCoachOptions, "els.coachTarget");
  assert.equal(first, 1, "one optgroup holds every option");
  assert.equal(second, first);
});

test("the coach progress cells match the goal rather than accumulating", () => {
  const app = loadWebApp();
  const buildCoachProgress = app.get("buildCoachProgress");

  app.evaluate("state.coachGoal = 5;");
  const { first, second } = renderTwice(app, buildCoachProgress, "els.coachProgress");
  assert.equal(first, 5);
  assert.equal(second, first);

  // Lowering the goal must remove cells, not leave the longer row in place.
  app.evaluate("state.coachGoal = 2;");
  buildCoachProgress();
  assert.equal(app.evaluate("els.coachProgress.children.length"), 2);
});

test("the reference thumbnails rebuild rather than accumulate", () => {
  const app = loadWebApp();
  const renderReferenceThumbnails = app.get("renderReferenceThumbnails");

  const { first, second } = renderTwice(
    app,
    () => renderReferenceThumbnails(true),
    "els.referenceThumbs",
  );
  assert.ok(first > 0, "a word reference should produce page buttons");
  assert.equal(second, first);

  // Letter mode clears the strip instead of leaving the word pages behind.
  renderReferenceThumbnails(false);
  assert.equal(app.evaluate("els.referenceThumbs.children.length"), 0);
});

test("the word guidance panel keeps its authored fallback without data", () => {
  const app = loadWebApp();
  const renderWordGuidancePanel = app.get("renderWordGuidancePanel");
  // The markup carries a hand-written list for each of the three groups.
  app.evaluate('els.wordDemoList.innerHTML = "authored fallback";');
  app.evaluate("confusionPairs = []; perWordStats = {};");

  renderWordGuidancePanel();

  assert.equal(
    app.evaluate("els.wordDemoList.innerHTML"),
    "authored fallback",
    "an empty evaluation result must not blank the authored list",
  );
});

test("the word guidance panel replaces its chips on a repeat render", () => {
  const app = loadWebApp();
  const renderWordGuidancePanel = app.get("renderWordGuidancePanel");
  app.evaluate(`
    confusionPairs = [{ word_a: "hear", word_b: "listen", count: 3 }];
    perWordStats = { hear: { f1: 0.9 }, listen: { f1: 0.4 } };
  `);

  renderWordGuidancePanel();
  const first = app.evaluate("els.wordConfusionList.innerHTML");
  renderWordGuidancePanel();

  assert.equal(app.evaluate("els.wordConfusionList.innerHTML"), first);
});

test("an empty prediction list shows a hint instead of a placeholder row", () => {
  // The old placeholder was a ranked row "#1 - 0%", which read as a result.
  const app = loadWebApp();
  app.evaluate("state.top3 = [];");
  app.get("renderTop3")();

  assert.equal(app.evaluate("els.top3List.children.length"), 1);
  assert.equal(app.evaluate("els.top3List.children[0].className"), "top3-empty");
  assert.match(app.evaluate("els.top3List.children[0].textContent"), /görünür/);
});

test("the stage says whether its result is a letter or a word", () => {
  // A word drawn at the letter's display size ran far out of the caption
  // plate; the stylesheet sizes the result from this attribute.
  const app = loadWebApp();
  const updatePrediction = app.get("updatePrediction");

  updatePrediction({ label: "toothbrush", confidence: 0.4, alternatives: [] });
  assert.equal(app.evaluate("els.cameraStage.dataset.kind"), "word");

  updatePrediction({ label: "L", confidence: 0.9, alternatives: [] });
  assert.equal(app.evaluate("els.cameraStage.dataset.kind"), "letter");

  updatePrediction({ label: "?", confidence: 0, alternatives: [] });
  assert.equal(app.evaluate("els.cameraStage.dataset.kind"), "letter");
});
