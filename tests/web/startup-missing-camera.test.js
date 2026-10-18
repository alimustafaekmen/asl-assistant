// A page that could not fetch its camera code says so at start-up.
//
// Nothing calls into js/media/camera.js until the camera starts, so a page
// that failed to fetch it (a 404, a deploy that left it out) starts without
// a word: the camera opens, nothing tracks a hand, and the badge waits
// forever. The fault these tests kill is that silence. The start-up notice
// startup-failure.test.js covers for other scripts must appear for this one
// too, while the screens that need no camera keep working.
//
// The failure is made at the network boundary: the script is never loaded.
// Everything else is the booted app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** Boot without camera.js, and wait for init() to finish or fail. */
async function bootWithoutCamera() {
  const app = loadWebApp({
    boot: true,
    unloadedScripts: ["js/media/camera.js"],
    globals: { console: quietConsole },
  });
  await app.ready.catch(() => {});
  await flush();
  return app;
}

/** What the user is shown and told about start-up. */
function startupNotice(app) {
  return app.evaluate(`(() => {
    const notice = document.getElementById("startupError");
    return {
      hidden: notice ? notice.hidden : true,
      text: notice ? notice.textContent.trim() : "",
      announced: document.getElementById("announcer").textContent.trim(),
    };
  })()`);
}

test("a page without its camera code shows and announces the start-up message", async () => {
  const app = await bootWithoutCamera();
  const notice = startupNotice(app);

  assert.equal(notice.hidden, false, "the page started without its camera code and said nothing");
  assert.notEqual(notice.text, "");
  assert.equal(notice.announced, notice.text, "the same message is announced");
});

test("a page without its camera code still opens the screens that need no camera", async () => {
  const app = await bootWithoutCamera();

  const tab = app.evaluate(`document.querySelector('[data-ui="mode-tab"][data-mode="project"]')`);
  tab.dispatchEvent({ type: "click", detail: 1 });
  await flush();

  assert.equal(app.evaluate("state.mode"), "project", "the rest of the page stopped answering");
});
