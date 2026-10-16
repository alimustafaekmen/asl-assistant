// The phone's "Diğer" menu in a browser without the Popover API.
//
// The menu is a popover opened by popovertarget. Safari before 17 and other
// older browsers have neither: the button does nothing, and the menu code
// threw, because such a browser rejects ":popover-open" as a selector. The
// fault these tests kill is a phone menu that cannot be opened, or a menu
// choice that throws instead of opening its screen. The browser is faked at
// its API: the popover methods are absent and the selector is refused, as
// such a browser does; everything else is the real page.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {} };

/** The page booted in a browser that has no Popover API. */
async function pageWithoutPopovers() {
  const app = loadWebApp({ globals: { console: quietConsole, kjua: () => ({}) } });
  app.evaluate(`
    delete Element.prototype.showPopover;
    delete Element.prototype.hidePopover;
    delete Element.prototype.togglePopover;
    const realMatches = Element.prototype.matches;
    Element.prototype.matches = function (selector) {
      if (String(selector).includes(":popover-open")) {
        throw new SyntaxError("'" + selector + "' is not a valid selector");
      }
      return realMatches.call(this, selector);
    };
  `);
  await app.get("init")();
  const button = app.evaluate('document.querySelector("[popovertarget]")');
  const menu = app.evaluate('document.getElementById("moreMenu")');
  return {
    app,
    button,
    menu,
    open: () => button.getAttribute("aria-expanded"),
    shown: () => menu.dataset.open,
    pressMore: () => button.dispatchEvent({ type: "click", detail: 0, target: button }),
  };
}

test("the More button opens and closes the menu, and says which", async () => {
  const page = await pageWithoutPopovers();
  assert.equal(page.open(), "false", "the button says the menu is closed");
  assert.equal(page.shown(), "false");
  assert.equal(page.button.getAttribute("aria-controls"), "moreMenu");

  page.pressMore();
  assert.equal(page.open(), "true");
  assert.equal(page.shown(), "true");

  page.pressMore();
  assert.equal(page.open(), "false");
  assert.equal(page.shown(), "false");
});

test("choosing a screen from the menu opens it and closes the menu", async () => {
  const page = await pageWithoutPopovers();
  page.pressMore();

  const item = page.menu.querySelector('[data-mode="project"]');
  assert.doesNotThrow(() => item.dispatchEvent({ type: "click", detail: 0, target: item }));

  assert.equal(page.app.evaluate("state.mode"), "project");
  assert.equal(page.open(), "false");
  assert.equal(page.shown(), "false");
});

test("Escape closes the open menu and gives focus back to its button", async () => {
  const page = await pageWithoutPopovers();
  let focused = 0;
  page.button.focus = () => {
    focused += 1;
  };
  page.pressMore();

  let prevented = false;
  page.app.windowHandler("keydown")({
    key: "Escape",
    code: "Escape",
    target: page.app.makeTarget({ tagName: "DIV" }),
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(page.shown(), "false");
  assert.equal(page.open(), "false");
  assert.equal(focused, 1);
  assert.equal(prevented, true);
});

test("a browser with the Popover API keeps the native menu", async () => {
  // The control: nothing faked, so the page leaves the menu to the browser.
  const app = loadWebApp({ boot: true, globals: { console: quietConsole } });
  await app.ready;
  const menu = app.evaluate('document.getElementById("moreMenu")');
  assert.equal(menu.dataset.open, undefined);
  assert.equal(app.evaluate('document.querySelector("[popovertarget]").getAttribute("aria-expanded")'), null);
});
