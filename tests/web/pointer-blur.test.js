// Which clicks give up focus.
//
// After a mouse click a button keeps focus, so the next Space would press it
// again (another space after Boşluk) instead of adding the current letter;
// the page therefore blurs a clicked button. A touch, and the click an
// assistive technology makes, must keep focus: iOS VoiceOver's double tap is
// a touch, and dropping its focus to the page sends VoiceOver back to the top
// of the page after every "Ekle". The fault these tests kill is a blur on
// such a click. The kind of press is the boundary fact: the pointerType of
// the pointerdown before the click, as the browser reports it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWebApp } from "./helpers/web-app-context.mjs";

/** The page's window handlers and one button whose blur() is counted. */
function pageWithButton() {
  const app = loadWebApp();
  app.get("bindEvents")();
  const onClick = app.windowHandler("click");
  const onPointerDown = app.windowHandler("pointerdown");
  /** A button, and an icon inside it that a press lands on. */
  const makeButton = () => {
    let blurred = 0;
    const button = app.makeTarget({ tagName: "BUTTON" });
    button.blur = () => {
      blurred += 1;
    };
    const icon = app.makeTarget({ tagName: "SPAN" });
    icon.closest = (selector) => (selector === "button" ? button : null);
    return { button, icon, blurred: () => blurred };
  };
  const first = makeButton();
  const pointerDown = (pointerType, target) => onPointerDown?.({ type: "pointerdown", pointerType, target });
  return {
    ...first,
    makeButton,
    pointerDown,
    /** A press of `pointerType` on the first button's icon, then its click. */
    press(pointerType, { detail = 1 } = {}) {
      pointerDown(pointerType, first.icon);
      onClick({ type: "click", detail, target: first.icon });
    },
  };
}

test("a touch on a button keeps its focus", () => {
  const page = pageWithButton();
  page.press("touch");
  assert.equal(page.blurred(), 0);
});

test("a mouse or pen click releases the button", () => {
  for (const pointerType of ["mouse", "pen"]) {
    const page = pageWithButton();
    page.press(pointerType);
    assert.equal(page.blurred(), 1, pointerType);
  }
});

test("a keyboard activation keeps focus, whatever was pressed before", () => {
  const page = pageWithButton();
  page.press("mouse", { detail: 0 });
  assert.equal(page.blurred(), 0);
});

test("a touch is remembered for its own click only", () => {
  const page = pageWithButton();
  page.press("touch");
  // The next click on the same button comes with a mouse press.
  page.press("mouse");
  assert.equal(page.blurred(), 1);
});

test("a touch held over from another button does not decide this click", () => {
  // A touch press on a second button that never became a click, then a
  // mouse press and click on the first one.
  const page = pageWithButton();
  const elsewhere = page.makeButton();
  page.pointerDown("touch", elsewhere.icon);
  page.press("mouse");
  assert.equal(page.blurred(), 1);
  assert.equal(elsewhere.blurred(), 0);
});
