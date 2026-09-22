// Hash routing contract.
//
// QR deep links and the browser back button both go through modeFromHash, so
// unknown input must resolve to the letter workspace instead of a blank screen.

const test = require("node:test");
const assert = require("node:assert/strict");

let modeFromHash;
test.before(async () => {
  const { loadWebApp } = await import("./helpers/web-app-context.mjs");
  modeFromHash = loadWebApp().get("modeFromHash");
});

test("every published mode is reachable from its hash", () => {
  for (const mode of ["letter", "coach", "word", "project", "test", "qr"]) {
    assert.equal(modeFromHash(`#${mode}`), mode);
  }
});

test("the leading hash and letter case are optional", () => {
  assert.equal(modeFromHash("word"), "word");
  assert.equal(modeFromHash("#WORD"), "word");
  assert.equal(modeFromHash("#Qr"), "qr");
  assert.equal(modeFromHash("#word  "), "word");
});

test("unknown or empty input falls back to letter mode", () => {
  for (const hash of ["", "#", "#bogus", "#word-extra", null, undefined, 0]) {
    assert.equal(modeFromHash(hash), "letter");
  }
});
