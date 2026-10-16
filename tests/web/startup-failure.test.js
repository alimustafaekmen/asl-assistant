// A page that cannot start says so.
//
// The page is static markup until init() has bound it, so when start-up
// fails the buttons look ready and do nothing. The fault these tests kill is
// that silence: a script the page could not fetch, or an error thrown while
// starting, must leave a visible message and an announcement, in Turkish,
// rather than a page that ignores every press.
//
// The two failures are made at boundaries: the network (a script never
// loaded, as after a 404) and a host API that throws (matchMedia, the first
// one init() calls). Everything else is the real app.

import assert from "node:assert/strict";
import { test } from "node:test";

import { flush } from "./helpers/fake-camera.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** Boot, and wait for init() to finish or fail. */
async function boot(options) {
  const app = loadWebApp({ boot: true, ...options, globals: { console: quietConsole, ...options.globals } });
  await app.ready.catch(() => {});
  await flush();
  return app;
}

/** What the user is shown and told about start-up. */
function startupNotice(app) {
  return app.evaluate(`(() => {
    const notice = document.getElementById("startupError");
    return {
      exists: notice !== null,
      hidden: notice ? notice.hidden : true,
      text: notice ? notice.textContent.trim() : "",
      announced: document.getElementById("announcer").textContent.trim(),
    };
  })()`);
}

const FAILURES = {
  "a script the page could not fetch": { unloadedScripts: ["js/ui/word-flow.js"] },
  "an error thrown while starting": {
    globals: {
      matchMedia() {
        throw new Error("matchMedia is unavailable");
      },
    },
  },
};

for (const [name, failure] of Object.entries(FAILURES)) {
  test(`${name} leaves a visible, announced message`, async () => {
    const app = await boot(failure);
    const notice = startupNotice(app);

    assert.equal(notice.exists, true, "the page has a place to say it could not start");
    assert.equal(notice.hidden, false, "the message is shown");
    assert.notEqual(notice.text, "", "and says something");
    assert.equal(notice.announced, notice.text, "the same message is announced");
  });
}

test("a page that starts shows no start-up message", async () => {
  const app = await boot({});
  const notice = startupNotice(app);

  assert.equal(notice.hidden, true);
  assert.equal(notice.announced, "");
});
