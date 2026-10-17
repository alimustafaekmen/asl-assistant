// A word reaches the transcript only when the user accepts it, and one accept
// appends it once.
//
// The recording runs through the app's own flow with fake runtimes; see
// helpers/word-recording.mjs. The command the accept button runs is called
// directly, because this app is not booted and its buttons are not bound, and
// the clock is moved past the 250 ms double-click debounce so that a second
// press is a real second press.

import assert from "node:assert/strict";
import { test } from "node:test";

import { recordWord, wordModeApp } from "./helpers/word-recording.mjs";

/** Press the accept button, a second after anything before it. */
function pressAccept(app) {
  app.evaluate("__clock += 1000;");
  app.get("appendWordResultToTranscript")();
}

const acceptDisabled = (app) => app.evaluate("els.appendWordResult.disabled");
const transcript = (app) => app.evaluate("state.transcript");

test("an accepted word is appended once, however often accept is pressed", async () => {
  const { app } = wordModeApp({ winner: "book" });
  await recordWord(app);
  assert.equal(app.evaluate("state.wordState"), "RESULT");
  assert.equal(acceptDisabled(app), false, "a confident result can be accepted");

  pressAccept(app);
  assert.equal(transcript(app), "book ");
  assert.equal(acceptDisabled(app), true, "an accepted result cannot be accepted again");

  pressAccept(app);
  assert.equal(transcript(app), "book ", "a second accept must not append the word again");
});

test("a new recording can be accepted after the previous one was", async () => {
  const { app } = wordModeApp({ winner: "book" });
  await recordWord(app);
  pressAccept(app);

  await recordWord(app);
  assert.equal(app.evaluate("state.wordState"), "RESULT");
  assert.equal(acceptDisabled(app), false, "a new result is a new consent");

  pressAccept(app);
  assert.equal(transcript(app), "book book ");
});

test("a finished recording appends nothing until the user accepts it", async () => {
  const { app } = wordModeApp({ winner: "book" });
  await recordWord(app);

  // The result is confident and acceptable, which is exactly when an
  // automatic append would be tempting.
  assert.equal(app.evaluate("state.wordState"), "RESULT");
  assert.equal(app.evaluate("state.prediction"), "book");
  assert.equal(acceptDisabled(app), false);
  assert.equal(transcript(app), "", "a word result must wait for the user's accept");

  pressAccept(app);
  assert.equal(transcript(app), "book ");
});
