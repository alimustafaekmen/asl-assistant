// Each word target in the coach carries the difficulty published for it in
// data/per_word_stats.json, the file the word screen's side cards read.
//
// The fault this kills is a coach tag that disagrees with that file: a word
// the evaluation calls hard offered as easy, or the other way round.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coachApp, flush, memoryStorage } from "./helpers/coach-app.mjs";
import { WEB_DIR } from "./helpers/web-app-context.mjs";

const STATS = JSON.parse(readFileSync(join(WEB_DIR, "data", "per_word_stats.json"), "utf8"));
const SHOWN = { easy: "easy", medium: "medium", hard: "tricky" };

test("every coach word target is tagged with its published difficulty", async () => {
  const coach = await coachApp({ hash: "#coach", storage: memoryStorage({ "asl-lang": "en" }) });
  await flush();
  coach.click(coach.el("coachWordsOnly"));

  const options = [...coach.el("coachTarget").children[0].children];
  const tagged = Object.fromEntries(options.map((option) => [option.value, /\((.+)\)$/.exec(option.textContent)[1]]));
  const published = Object.fromEntries(Object.entries(STATS).map(([word, stats]) => [word, SHOWN[stats.difficulty]]));

  assert.deepEqual(tagged, published);
});
