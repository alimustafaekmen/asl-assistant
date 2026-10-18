// The harness document is index.html, so markup drift reaches the node tests.
//
// A harness that returned a blank element for any id would let a renamed id or
// a dropped data-ui hook pass every node test, so this one parses the real
// document. These tests pin that seam: what the scripts find is what the
// markup holds, the parser reads the HTML constructs the page uses, and the
// selector engine either matches as a browser does or refuses loudly.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createDomClasses, parseHtml } from "./helpers/static-dom.mjs";
import { loadWebApp, parsedIndexHtml } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };
const ROUTES = ["letter", "coach", "word", "test", "project", "qr"];
// Model Test is a developer tool (owner decision 2026-10-18): it has no tab,
// and the project page links to it; routes.test.js follows that link.
const TABBED_ROUTES = ROUTES.filter((route) => route !== "test");

/** Build loose markup into live stub nodes, outside any app. */
function fragment(html) {
  const dom = createDomClasses({ listenerLog: [] });
  const root = dom.createElement("div");
  for (const node of parseHtml(html).children) root.appendChild(dom.build(node));
  return { root, dom };
}

test("an id the markup lacks is not found, and one it has is always the same element", () => {
  const app = loadWebApp();

  assert.equal(app.evaluate('document.getElementById("noSuchElementAnywhere")'), null);
  const toast = app.evaluate('document.getElementById("toast")');
  assert.ok(toast, "the markup has #toast");
  assert.equal(app.evaluate('document.getElementById("toast")'), toast);
  assert.equal(app.evaluate("els.toast"), toast, "the registry holds the markup's element");
});

test("index.html parses without a tag the parser had to repair", () => {
  assert.deepEqual(parsedIndexHtml().diagnostics, []);
});

test("every mode tab in the markup opens its mode when clicked, and only it is current", async () => {
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  // Found by what they are, buttons that name a mode, not by the hook the app
  // binds to, so a tab that lost its hook is still clicked here.
  const tabs = Array.from(app.evaluate('document.querySelectorAll("button[data-mode]")'));
  assert.deepEqual(tabs.map((tab) => tab.dataset.mode).sort(), [...TABBED_ROUTES].sort(), "one tab per route but Model Test");

  for (const tab of tabs) {
    tab.dispatchEvent({ type: "click", detail: 1 });
    const mode = tab.dataset.mode;
    assert.equal(app.evaluate("state.mode"), mode, `the ${mode} tab opens ${mode}`);
    const current = tabs.filter((other) => other.getAttribute("aria-current") === "page");
    assert.deepEqual(current, [tab], `only the ${mode} tab is marked current`);
  }
});

test("each element has the constructor its tag gives it", () => {
  const app = loadWebApp();

  assert.equal(app.evaluate("els.video instanceof HTMLVideoElement"), true);
  assert.equal(app.evaluate("els.canvas instanceof HTMLCanvasElement"), true);
  assert.equal(app.evaluate("els.toast instanceof HTMLVideoElement"), false);
  // SVG is not HTML: the scripts' element queries drop it, as in the browser.
  assert.ok(app.evaluate('document.querySelectorAll("svg").length') > 0);
  assert.equal(app.evaluate('document.querySelector("svg") instanceof HTMLElement'), false);
  assert.deepEqual([...app.evaluate('queryElements("svg")')], []);
});

test("the parser reads attributes in every form the HTML syntax allows", () => {
  const { root } = fragment(
    `<button id=go class="a  b" data-go-mode='word' disabled title="x &amp; y &#233; &#x41;">Go</button>`,
  );
  const button = root.firstChild;

  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.id, "go");
  assert.deepEqual([...button.classList], ["a", "b"]);
  assert.equal(button.dataset.goMode, "word");
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("disabled"), "");
  assert.equal(button.getAttribute("title"), "x & y é A");
  assert.equal(button.textContent, "Go");
});

test("void elements, comments, raw text and templates do not swallow or leak content", () => {
  const { root } = fragment(
    [
      `<p>one<br>two<img src="a.png" alt="">three</p>`,
      `<!-- <div id="commented"></div> -->`,
      // Lowercasing "İ" lengthens the string, so a parser that lowercased the
      // document to find "</script>" would misplace where the raw text ends.
      `<h2>İŞARET İÇİN İPUCU</h2>`,
      `<script>if (a < b && c > d) document.write("<div id='scripted'></div>");</script>`,
      `<template><span id="templated">x</span></template>`,
      `<svg viewBox="0 0 2 2"><rect width="1"/><circle r="1"></circle></svg><span id="after">ok</span>`,
    ].join(""),
  );

  const p = root.querySelector("p");
  assert.equal(p.textContent, "onetwothree");
  assert.equal(p.children.length, 2, "br and img hold no children of their own");
  assert.equal(root.querySelector("#commented"), null);
  assert.equal(root.querySelector("#scripted"), null);
  assert.match(root.querySelector("script").textContent, /a < b && c > d/);
  assert.equal(root.querySelector("#templated"), null, "template content is not in the tree");
  assert.ok(root.querySelector("template").content.querySelector("#templated"));
  // In SVG, "/>" closes the element, so the circle is the rect's sibling.
  const svg = root.querySelector("svg");
  assert.deepEqual(svg.children.map((node) => node.localName), ["rect", "circle"]);
  assert.equal(svg.getAttribute("viewBox"), "0 0 2 2", "SVG keeps the attribute's case");
  assert.equal(root.querySelector("#after").parentElement, root);
});

test("implied end tags close where the HTML parser closes them", () => {
  const { root } = fragment(`<ul><li>a<li>b</ul><p>one<div>block</div><select><option>x<option>y</select>`);

  assert.equal(root.querySelectorAll("li").length, 2);
  assert.equal(root.querySelector("ul").children.length, 2);
  assert.equal(root.querySelector("div").parentElement, root, "a block closes an open <p>");
  assert.deepEqual(
    root.querySelector("select").options.map((option) => option.textContent),
    ["x", "y"],
  );
  assert.deepEqual(parseHtml(`<div><span></div></span>`).diagnostics, ["end tag </span> closes nothing"]);
});

test("the selector engine matches what the scripts ask for", () => {
  const { root } = fragment(
    `<nav id="n" popover><button class="tab on" data-ui="mode-tab" data-mode="qr"><i>x</i></button></nav>` +
      `<section><button data-trigger="camera"></button></section>`,
  );
  const tab = root.querySelector('[data-ui="mode-tab"]');
  const icon = tab.querySelector("i");

  assert.equal(root.querySelector("button.tab.on[data-mode=qr]"), tab);
  assert.equal(root.querySelector('[data-mode="letter"]'), null, "the attribute value must match");
  assert.equal(root.querySelector(".tab.off"), null, "every class must match");
  assert.equal(root.querySelector("#n > button"), tab);
  assert.equal(root.querySelector("nav i"), icon);
  assert.equal(root.querySelector("#n > i"), null, "> takes a child, not a grandchild");
  assert.equal(root.querySelectorAll("[data-trigger], [data-ui]").length, 2);
  assert.deepEqual(root.querySelectorAll("button:not(.tab)"), [root.querySelector("[data-trigger]")]);
  assert.equal(icon.closest("button"), tab);
  assert.equal(icon.closest("[popover]"), root.querySelector("nav"));
  const menu = root.querySelector("nav");
  assert.equal(menu.matches(":popover-open"), false);
  menu.showPopover();
  assert.equal(menu.matches(":popover-open"), true);
});

test("a selector the engine does not implement throws instead of matching wrongly", () => {
  const { root } = fragment(`<ul><li>a</li><li>b</li></ul>`);

  for (const selector of ["li + li", "li ~ li", "li:nth-child(2)", '[data-a^="x"]', "li:first-child", "ul >"]) {
    assert.throws(() => root.querySelectorAll(selector), /does not support the selector/, selector);
  }
});

test("innerHTML and textContent rebuild children as the browser does", () => {
  const { root } = fragment(`<p id="t">old<b>bold</b></p>`);
  const p = root.querySelector("#t");

  p.innerHTML = `a &amp; b<span class="cursor" aria-hidden="true">|</span>`;
  assert.equal(p.children.length, 1);
  assert.equal(p.textContent, "a & b|");
  assert.equal(p.innerHTML, `a &amp; b<span class="cursor" aria-hidden="true">|</span>`);

  p.textContent = "<b>plain</b>";
  assert.equal(p.children.length, 0, "text is never parsed as markup");
  assert.equal(p.innerHTML, "&lt;b&gt;plain&lt;/b&gt;");
});

test("the document runs its own listeners and reports whether the page is hidden", () => {
  const app = loadWebApp();
  app.evaluate(`
    globalThis.__seen = [];
    globalThis.__listener = () => __seen.push(document.visibilityState + ":" + document.hidden);
    document.addEventListener("visibilitychange", __listener);
    document.addEventListener("visibilitychange", __listener);
  `);
  assert.equal(app.evaluate("document.visibilityState"), "visible", "a page starts visible");

  app.evaluate('document.visibilityState = "hidden"; document.dispatchEvent({ type: "visibilitychange" });');
  assert.deepEqual([...app.evaluate("__seen")], ["hidden:true"], "a listener added twice runs once");

  app.evaluate(`
    document.removeEventListener("visibilitychange", __listener);
    document.visibilityState = "visible";
    document.dispatchEvent({ type: "visibilitychange" });
  `);
  assert.deepEqual([...app.evaluate("__seen")], ["hidden:true"], "a removed listener does not run");
});
