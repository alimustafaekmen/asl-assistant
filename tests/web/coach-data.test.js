// The coach's letter teaching data, read from disk.
//
// letter_curriculum.json and letter_confusion.json are hand-curated, not model
// outputs, so nothing regenerates them and nothing else notices when they drift
// from the 24-letter domain. A letter dropped from the order is a letter the
// coach never teaches; a typo in a group is a cue shown for a letter that does
// not exist. The domain is the app's own LETTERS, evaluated from the scripts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = join(import.meta.dirname, "..", "..", "asl-web", "data");
const readJson = (name) => JSON.parse(readFileSync(join(DATA, name), "utf8"));

let letters;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  // Copied out of the vm realm so deepEqual compares plain values.
  letters = Array.from(loadWebApp().get("LETTERS"));
});

const sorted = (list) => [...list].sort();

test("the curriculum has one record for each of the 24 static letters", () => {
  const curriculum = readJson("letter_curriculum.json");
  const ids = curriculum.letters.map((entry) => entry.letter);

  assert.equal(curriculum.schema_version, "letter-curriculum-v1");
  assert.equal(new Set(ids).size, ids.length, "a letter appears twice");
  assert.deepEqual(sorted(ids), sorted(letters));
});

test("suggested_order is a permutation of the letters", () => {
  const { suggested_order: order } = readJson("letter_curriculum.json");

  assert.equal(order.length, letters.length);
  assert.deepEqual(sorted(order), sorted(letters));
});

test("every curriculum record has a cue, a known difficulty and look-alikes that exist", () => {
  const { letters: records } = readJson("letter_curriculum.json");

  for (const record of records) {
    assert.ok(record.cue_tr && record.cue_en, `${record.letter} has no cue`);
    assert.ok(
      ["easy", "medium", "hard"].includes(record.difficulty),
      `${record.letter}: difficulty ${record.difficulty}`,
    );
    for (const other of record.confusable_with) {
      assert.ok(letters.includes(other), `${record.letter} lists unknown ${other}`);
      assert.notEqual(other, record.letter, `${record.letter} lists itself`);
    }
  }
});

test("every confusion group names real letters and a cue for each member", () => {
  const confusion = readJson("letter_confusion.json");

  assert.equal(confusion.schema_version, "letter-confusion-v1");
  assert.ok(confusion.groups.length > 0);
  for (const group of confusion.groups) {
    assert.ok(group.letters.length >= 2, `group ${group.letters} has fewer than two letters`);
    assert.equal(new Set(group.letters).size, group.letters.length);
    assert.ok(group.reason_tr && group.reason_en, `group ${group.letters} has no reason`);
    for (const letter of group.letters) {
      assert.ok(letters.includes(letter), `group ${group.letters} lists unknown ${letter}`);
      assert.ok(group.cues[letter], `group ${group.letters} has no cue for ${letter}`);
    }
    assert.deepEqual(
      sorted(Object.keys(group.cues)),
      sorted(group.letters),
      `group ${group.letters}: cues and members differ`,
    );
  }
});

test("every confusion group has an English cue for each member, as it has a Turkish one", () => {
  for (const group of readJson("letter_confusion.json").groups) {
    assert.ok(group.cues_en, `group ${group.letters} has no English cues`);
    assert.deepEqual(
      sorted(Object.keys(group.cues_en)),
      sorted(group.letters),
      `group ${group.letters}: English cues and members differ`,
    );
    for (const letter of group.letters) {
      assert.ok(group.cues_en[letter], `group ${group.letters} has no English cue for ${letter}`);
    }
  }
});
