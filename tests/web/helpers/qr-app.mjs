// The "open on your phone" screen with its browser APIs under the test's hand.
//
// The code is drawn by kjua, loaded from a CDN; the clipboard, the share sheet,
// the page's computed style and the selection are browser APIs. Those are the
// boundaries and are faked here. The screen, its URLs and its status line are
// the app's own.

import { loadWebApp } from "./web-app-context.mjs";

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/** The link the screen shows by default, on the published site. */
export const LETTER_URL = "https://asl-assistant.netlify.app/#letter";

/**
 * @param {{
 *   kjua?: boolean,
 *   navigator?: object,
 *   execCommand?: () => boolean,
 *   style?: Record<string, string>,
 * }} [options] `kjua: false` is a CDN script that never loaded. `execCommand`
 *   is the legacy copy command. `style` maps a custom property to the value
 *   the page computes for it.
 */
export function qrApp({ kjua = true, navigator = {}, execCommand, style } = {}) {
  const drawn = [];
  const holder = {};
  const globals = {
    console: quietConsole,
    navigator,
    ...(kjua ? { kjua: (options) => (drawn.push(options), holder.app.makeTarget({})) } : {}),
    ...(style ? { getComputedStyle: () => ({ getPropertyValue: (name) => style[name] ?? "" }) } : {}),
  };
  const app = loadWebApp({ globals });
  holder.app = app;
  if (execCommand) app.evaluate("document").execCommand = execCommand;
  return { app, drawn };
}

/** The status line under the link. */
export const status = (app) => app.evaluate("els.qrStatus.textContent");

/** What was last said to a screen reader. */
export const announced = (app) => app.evaluate("els.announcer.textContent").trim();

/** A navigator whose clipboard writes through `writeText`. */
export const clipboard = (writeText) => ({ clipboard: { writeText } });
