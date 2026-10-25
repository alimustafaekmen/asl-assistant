// The link to the project's source code.
//
// Every screen offers it in the page footer, and the project page names it
// in its own closing line. It opens the repository in a new tab without
// handing the page to it, and its name, read by a screen reader too, is in
// the page's language and says that it opens a new tab.
//
// The browser's languages are the boundary faked here; the markup and the
// string tables are the app's own.

import assert from "node:assert/strict";
import { test } from "node:test";

import { turkishLeft } from "./helpers/turkish-left.mjs";
import { loadWebApp } from "./helpers/web-app-context.mjs";

const REPOSITORY = "https://github.com/alimustafaekmen/asl-assistant";
const quietConsole = { ...console, log() {}, warn() {}, info() {} };

async function page(languages) {
  const app = loadWebApp({ boot: true, languages, globals: { console: quietConsole } });
  await app.ready;
  return app;
}

/** The links to the repository: the footer's and the project page's. */
function repositoryLinks(app) {
  const links = Array.from(app.evaluate(`document.querySelectorAll('a[href="${REPOSITORY}"]')`));
  const projectScreen = app.evaluate('document.getElementById("projectScreen")');
  const main = app.evaluate('document.getElementById("main")');
  return {
    all: links,
    site: links.filter((link) => !main.contains(link)),
    project: links.filter((link) => projectScreen.contains(link)),
  };
}

const name = (link) => link.textContent.replace(/\s+/g, " ").trim();

/** Both links, failing when either is missing. */
function bothLinks(app) {
  const { all } = repositoryLinks(app);
  assert.equal(all.length, 2, "the footer's link and the project page's");
  return all;
}

test("the footer and the project page link to the repository in a new tab, without a referrer", async () => {
  const app = await page(["tr-TR", "tr"]);
  const { all, site, project } = repositoryLinks(app);

  assert.equal(site.length, 1, "one link outside the screens, so every screen has it");
  assert.equal(project.length, 1, "the project page's closing line has it too");
  for (const link of all) {
    assert.equal(link.getAttribute("target"), "_blank");
    assert.ok(link.getAttribute("rel").split(/\s+/).includes("noreferrer"));
  }
});

test("the link's name follows the page's language and says it opens a new tab", async () => {
  const app = await page(["tr-TR", "tr"]);
  for (const link of bothLinks(app)) {
    assert.match(name(link), /GitHub/);
    assert.ok(name(link).includes(app.get("t")("info.newTab").trim()), "the name says it opens a new tab");
  }

  app.get("setLanguage")("en");
  for (const link of bothLinks(app)) {
    assert.match(name(link), /GitHub/);
    assert.ok(name(link).includes(app.get("t")("info.newTab").trim()), "the name says it opens a new tab");
    assert.deepEqual(turkishLeft(link, { includeHidden: true }), []);
  }
});

test("an English reader gets the link in English from the first paint", async () => {
  const app = await page(["en-US", "en"]);
  for (const link of bothLinks(app)) {
    assert.ok(name(link).includes(app.get("t")("info.newTab").trim()), "the name says it opens a new tab");
    assert.deepEqual(turkishLeft(link, { includeHidden: true }), []);
  }
});
