// The Back gesture on a phone closes the coach's study sheet.
//
// The faults these tests kill:
// - Back leaves the open sheet on screen (no close watcher, or one whose close
//   does not close the sheet);
// - a sheet closed by its button or by leaving the coach keeps its watcher, so
//   the next Back is spent on a sheet that is no longer there;
// - a second opening that leaves two watchers.
//
// CloseWatcher is the browser's boundary and is faked; the coach is the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { coachApp } from "./helpers/coach-app.mjs";

/** A CloseWatcher that the test closes as the browser does on Back. */
function fakeCloseWatcher() {
  const watchers = [];
  class CloseWatcher {
    constructor() {
      this.active = true;
      this.onclose = null;
      this.listeners = [];
      watchers.push(this);
    }
    addEventListener(type, listener) {
      if (type === "close") this.listeners.push(listener);
    }
    destroy() {
      this.active = false;
    }
  }
  const back = () => {
    const watcher = watchers.findLast((entry) => entry.active);
    if (!watcher) return false;
    watcher.active = false;
    const event = { type: "close" };
    watcher.onclose?.(event);
    for (const listener of watcher.listeners) listener(event);
    return true;
  };
  return { CloseWatcher, back, active: () => watchers.filter((entry) => entry.active).length };
}

async function coachWithWatcher() {
  const watcher = fakeCloseWatcher();
  const coach = await coachApp({ hash: "#coach", globals: { CloseWatcher: watcher.CloseWatcher } });
  return { coach, watcher, open: () => coach.el("coachStudy").dataset.open };
}

test("Back closes the open study sheet", async () => {
  const { coach, watcher, open } = await coachWithWatcher();
  coach.click(coach.el("coachSessionButton"));
  assert.equal(open(), "true", "precondition: the sheet is open");

  assert.equal(watcher.back(), true, "the open sheet listens for Back");
  assert.equal(open(), "false");
  assert.equal(coach.el("coachSessionButton").getAttribute("aria-expanded"), "false");
});

test("a sheet closed another way leaves no watcher for the next Back", async () => {
  const { coach, watcher, open } = await coachWithWatcher();
  coach.click(coach.el("coachSessionButton"));
  coach.click(coach.el("coachSheetClose"));
  assert.equal(open(), "false", "precondition: the close button closed the sheet");
  assert.equal(watcher.active(), 0, "after the close button");

  coach.click(coach.el("coachSessionButton"));
  coach.app.get("setMode")("letter");
  assert.equal(open(), "false", "precondition: leaving the coach closed the sheet");
  assert.equal(watcher.active(), 0, "after leaving the coach");
});

test("each opening listens for Back once", async () => {
  const { coach, watcher, open } = await coachWithWatcher();
  for (let round = 0; round < 3; round += 1) {
    coach.click(coach.el("coachSessionButton"));
    assert.equal(watcher.active(), 1, `opening ${round + 1}`);
    watcher.back();
    assert.equal(open(), "false", `Back after opening ${round + 1}`);
  }
  assert.equal(watcher.active(), 0);
});
