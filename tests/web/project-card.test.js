// The figures on the "Nasıl çalışır" page come from data/model-card.json.
//
// A figure typed into the markup goes stale the day a model is retrained, and
// nothing would say so. The page therefore fills its numbers from the file when
// it is opened, and these tests serve the page a card of their own so that a
// hand-typed figure cannot pass for the file's.
//
// The faults they kill:
// - a figure written into the markup instead of read from the card;
// - the card fetched at start-up, so every visit to the letter screen pays
//   for a page it never opens;
// - a sentence left half filled ("%NaN doğru", or a blank) when the card is
//   missing or lacks a figure: the block must stay hidden instead.
//
// fetch is the browser boundary and is replaced for the card only.

import assert from "node:assert/strict";
import { test } from "node:test";

import { appWithFakeOrt, jsonResponse, routeFetch } from "./helpers/fake-ort.mjs";
import { readJson } from "./helpers/model-test-panel.mjs";

const CARD_PATH = "data/model-card.json";

/** A card whose every figure differs from the shipped one. */
const MADE_UP = {
  schema_version: "model-card-v1",
  letter: { classes: 21, accuracy_held_out: 0.8123, size_bytes_gzip: 3 * 1048576 },
  word: { classes: 47, accuracy: 0.5555, size_bytes: 1.5 * 1048576, test_signers: 7 },
};

/**
 * The app booted on the letter screen, with the card answered by `answer`
 * (null leaves the file on disk).
 *
 * @param {(() => unknown) | null} answer
 */
async function appServing(answer) {
  const app = await appWithFakeOrt({ boot: true });
  const asked = [];
  routeFetch(app, (path) => {
    if (!path.includes("model-card.json")) return undefined;
    asked.push(path);
    return answer ? answer() : undefined;
  });
  return { app, asked };
}

/** Let the pending fetches and renders run; bounded so a dead page fails. */
async function untilCardAsked(asked) {
  for (let turn = 0; turn < 200 && asked.length === 0; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** The text of every element the page marks as a figure of the card. */
const figures = (app) =>
  Object.fromEntries(
    Array.from(
      app.evaluate('document.querySelectorAll("[data-card]")'),
      (element) => [element.getAttribute("data-card"), element.textContent],
    ),
  );

const numbersHidden = (app) => app.evaluate('document.getElementById("projectNumbers").hidden');

test("the page shows the card's figures, not figures of its own", async () => {
  const { app, asked } = await appServing(() => jsonResponse(MADE_UP));

  app.get("setMode")("project");
  await untilCardAsked(asked);

  const shown = figures(app);
  assert.equal(shown["letter.accuracy_held_out"], "%81");
  assert.equal(shown["word.accuracy"], "%56");
  assert.equal(shown["letter.classes"], "21");
  assert.equal(shown["word.classes"], "47");
  assert.equal(shown["letter.size_bytes_gzip"], "3 MB");
  assert.equal(shown["word.size_bytes"], "1,5 MB");
  assert.equal(numbersHidden(app), false);
});

test("served from disk, the page shows the figures of the shipped file", async () => {
  const { app, asked } = await appServing(null);
  const card = readJson(CARD_PATH);
  const percent = app.get("formatPercent");

  app.get("setMode")("project");
  await untilCardAsked(asked);

  const shown = figures(app);
  assert.equal(shown["letter.accuracy_held_out"], percent(card.letter.accuracy_held_out));
  assert.equal(shown["word.accuracy"], percent(card.word.accuracy));
  assert.equal(shown["letter.classes"], String(card.letter.classes));
  assert.equal(shown["word.classes"], String(card.word.classes));
});

test("the card is fetched when the page is opened, not at start-up", async () => {
  const { app, asked } = await appServing(null);
  assert.deepEqual(asked, [], "a visit to the letter screen asked for the card");

  app.get("setMode")("project");
  await untilCardAsked(asked);

  assert.equal(asked.length, 1);
});

test("a card that cannot be fetched leaves the numbers hidden", async () => {
  const { app, asked } = await appServing(() => jsonResponse({}, 404));

  app.get("setMode")("project");
  await untilCardAsked(asked);

  assert.equal(numbersHidden(app), true);
});

test("a card that lacks a figure leaves the numbers hidden rather than half filled", async () => {
  const incomplete = structuredClone(MADE_UP);
  delete incomplete.word.accuracy;
  const { app, asked } = await appServing(() => jsonResponse(incomplete));

  app.get("setMode")("project");
  await untilCardAsked(asked);

  assert.equal(numbersHidden(app), true);
});
