// Shared runtime: the DOM registry guard and the initial application state.
//
// The registry is resolved once, at load, and the rest of the app dereferences
// it freely. These tests cover what that guarantee rests on.

const test = require("node:test");
const assert = require("node:assert/strict");

let app;
test.beforeEach(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  app = loadWebApp();
});

test("requireElement returns the element it found", () => {
  const element = app.get("requireElement")("cameraVideo");

  assert.ok(element);
  assert.equal(typeof element.addEventListener, "function");
});

test("requireElement names the missing id", () => {
  app.evaluate('document.getElementById = () => null;');

  assert.throws(
    () => app.get("requireElement")("cameraVideo"),
    /#cameraVideo/,
    "the error must say which element is missing",
  );
});

test("requireElement rejects an element of the wrong type", () => {
  app.evaluate('class Unrelated {}; globalThis.Unrelated = Unrelated;');

  // Checking the constructor, rather than asserting it, is what lets a field
  // carry its real element type.
  assert.throws(
    () => app.get("requireElement")("cameraVideo", app.get("Unrelated")),
    /beklenen turde degil/,
  );
});

test("optionalElement reports a missing or mistyped element as absent", () => {
  const optionalElement = app.get("optionalElement");
  const HTMLButtonElement = app.get("HTMLButtonElement");

  assert.ok(optionalElement("recordWord", HTMLButtonElement));

  app.evaluate('class Unrelated {}; globalThis.Unrelated = Unrelated;');
  assert.equal(optionalElement("recordWord", app.get("Unrelated")), null);

  app.evaluate('document.getElementById = () => null;');
  assert.equal(optionalElement("recordWord", HTMLButtonElement), null);
});

test("every element the app cannot run without is resolved at load", () => {
  const els = app.get("els");

  // These are dereferenced without a guard, so a missing one would fail later
  // instead of at startup.
  for (const key of [
    "video", "canvas", "cameraStage", "cameraStatus", "controlBar",
    "primaryPrediction", "confidenceRing", "confidenceMessage", "top3List",
    "transcriptText", "modeBadge", "latencyBadge", "wordStateLabel",
    "frameProgress", "coachTarget", "coachProgress", "referenceImage",
    "countdown", "debugPanel", "debugLatency",
  ]) {
    assert.ok(els[key], `required element missing from the registry: ${key}`);
  }
});

test("the overlay canvas context is resolved once at load", () => {
  assert.ok(app.get("ctx"), "drawOverlay dereferences this on every frame");
});

test("the initial state matches the declared contract", () => {
  const state = app.get("state");

  assert.equal(state.mode, "letter");
  assert.equal(state.wordState, "IDLE");
  assert.equal(state.cameraOn, false);
  assert.equal(state.stream, null);
  assert.equal(state.transcript, "");
  assert.equal(state.prediction, "?");
  assert.deepEqual([...state.top3], []);
  assert.deepEqual([...state.wordQualityWarnings], []);
  assert.equal(state.wordResultAssessment, null);
  assert.equal(state.modelTestSample, null);
  assert.equal(state.modelTestManifest, null);
  assert.equal(state.coachTargetType, "letter");
  assert.equal(state.coachFlow, "learn");
  assert.equal(state.modelTestTask, "letter");
  assert.equal(state.qrTarget, "letter");
});

test("the word recording buffers start empty", () => {
  assert.equal(app.get("previousFrame"), null);
  assert.deepEqual([...app.get("frameBuffer")], []);
  assert.deepEqual([...app.get("normalizedFrameBuffer")], []);
});

test("reference links start empty so the search fallback applies", () => {
  const links = app.get("referenceVideoLinks");

  assert.equal(links.alphabet_video, "");
  assert.deepEqual({ ...links.words }, {});
});
