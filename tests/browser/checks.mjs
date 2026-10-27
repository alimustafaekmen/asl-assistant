// The browser checks: facts only a real browser can decide.
//
// The node suite in tests/web stubs the DOM; it has no cascade, no layout and
// no media. Everything here is decided by CSS or by the browser itself: which
// rule wins, whether an element is rendered, whether the page scrolls
// sideways, whether a camera track is still live. Each check reads computed
// style, layout boxes or the CSSOM, never the source text, so a harmless move
// of a rule from one file to another changes nothing here.
//
// Each check's summary names what it guards; `run.mjs --list` prints them all.

import { turkishLeft } from "../web/helpers/turkish-left.mjs";

/** The camera modes; each has its own controls, tagged `<mode>-only`. */
export const CAMERA_MODES = ["letter", "word", "coach"];

/** Every route the app has; an unknown hash falls back to letter. */
export const ROUTES = [...CAMERA_MODES, "test", "project", "qr"];

/**
 * The cascade layers, lowest first. The first declaration of the order wins,
 * so it must come from the first stylesheet; a layer named anywhere else
 * that is not in this list lands above all of them.
 */
export const LAYER_ORDER = ["tokens", "base", "components", "layout", "screens", "utilities"];

// A host in dark mode would otherwise turn every fresh page dark, because the
// app follows the system preference when nothing is stored.
const DEFAULT_MEDIA = [
  { name: "prefers-color-scheme", value: "light" },
  { name: "prefers-reduced-motion", value: "no-preference" },
];

const LAPTOP = { width: 1366, height: 768, mobile: false };
const PHONE = { width: 390, height: 844, mobile: true };
const ENGLISH = ["en-US", "en"];

// Shared in-page helpers, prefixed to the expressions that need them.
const IN_PAGE = String.raw`
  const describe = (el) => {
    if (!el || !el.tagName) return String(el);
    if (el.id) return "#" + el.id;
    const classes = [...el.classList].slice(0, 3).map((c) => "." + c).join("");
    return el.tagName.toLowerCase() + classes;
  };
  // checkVisibility() also sees what layout boxes do not: the content of a
  // closed <details> keeps its boxes but is skipped through content-visibility.
  const rendered = (el) => {
    if (!el || !el.checkVisibility({ visibilityProperty: true })) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  // Layout boxes. Half a pixel of slack absorbs subpixel rounding.
  const all = (selector) => [...document.querySelectorAll(selector)].filter(rendered);
  const box = (el) => el.getBoundingClientRect();
  const meets = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5
    && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
`;

/** An expression that is true once init() has applied `route`. */
function bootedExpression(route) {
  const screen = { test: "modelTestScreen", project: "projectScreen", qr: "qrScreen" }[route];
  // setMode writes the shell's mode and, for a camera mode, the cards'
  // data-hidden; for an information screen it unhides that screen. Neither is
  // in the authored markup, so seeing it means init() got that far.
  const applied = screen
    ? `document.getElementById(${JSON.stringify(screen)})?.hidden === false`
    : `document.getElementById("coachStudy")?.dataset.hidden !== undefined`;
  return `(() => {
    if (document.readyState !== "complete") return false;
    const shell = document.querySelector('[data-ui="app-shell"]');
    return Boolean(shell && shell.dataset.mode === ${JSON.stringify(route)} && ${applied});
  })()`;
}

/**
 * Wait until the app has booted into `route` and its start-up fetches settled.
 *
 * Every check goes through this, so each one also asserts that the app booted:
 * a page that threw while loading fails the check that opened it, instead of
 * letting the check read a half-built page and pass or fail for the wrong
 * reason.
 */
async function waitForBoot(page, route) {
  await page.waitFor(bootedExpression(route), { what: `the app to boot into #${route}` });
  await page.waitForNetworkIdle();
  if (page.exceptions.length) {
    throw new Error(`uncaught error while booting #${route}: ${page.exceptions.join(" | ")}`);
  }
}

/** Open the app at `route` in a fresh page and wait for it to boot. */
async function openApp(ctx, { route = "letter", viewport = LAPTOP, media = DEFAULT_MEDIA, ...options } = {}) {
  const page = await ctx.newPage({ ...viewport, media, ...options });
  await page.goto(`${ctx.origin}/#${route}`);
  await waitForBoot(page, route);
  return page;
}

/** Switch mode the way a visitor's link does, through the hash. */
async function switchMode(page, mode) {
  await page.eval(`location.hash = ${JSON.stringify(`#${mode}`)}`);
  await waitForBoot(page, mode);
}

/** The static resources whose failure leaves a broken page. */
const STATIC_TYPES = new Set(["Document", "Script", "Stylesheet", "Font", "Image"]);

/** @typedef {{ origin: string, offline: boolean, lang: "tr" | "en", newPage: (options: object) => Promise<any> }} CheckContext */

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {string} summary What it asserts, in one line.
 * @property {boolean} [network] Loads MediaPipe, ORT or kjua from their CDNs
 *   (the camera, the demo's real model, the QR code); skipped with --offline.
 * @property {number} [timeoutMs]
 * @property {(ctx: CheckContext) => Promise<string[]>} run Returns the problems found.
 */

/** @type {Check[]} */
export const CHECKS = [
  {
    name: "boot",
    summary: "every route boots with no uncaught error, no failed file and no CSP violation",
    async run(ctx) {
      const problems = [];
      for (const route of ROUTES) {
        const page = await openApp(ctx, { route });
        const csp = await page.eval("window.__browserCheck.csp");
        for (const violation of csp) {
          problems.push(`#${route}: CSP ${violation.disposition} violation of ${violation.directive} by ${violation.blocked || "inline code"} ${violation.source}`.trim());
        }
        for (const failure of page.failedResources) {
          if (STATIC_TYPES.has(failure.type)) problems.push(`#${route}: ${failure.type} ${failure.url} failed (${failure.reason})`);
        }
        await page.close();
      }

      // A check that cannot see a violation passes for the wrong reason: if
      // the policy header went missing, the list above would be empty too.
      // An inline script is one thing the policy refuses, so planting one
      // must produce exactly one report.
      const page = await openApp(ctx, { route: "letter" });
      await page.eval(`(() => {
        const script = document.createElement("script");
        script.textContent = "window.__plantedInlineScript = true;";
        document.head.append(script);
      })()`);
      try {
        await page.waitFor("window.__browserCheck.csp.some((v) => v.directive === 'script-src-elem')", {
          what: "a CSP report for a planted inline script",
          timeoutMs: 3_000,
        });
      } catch {
        problems.push("a planted inline script was not reported: the page is not served under the site's Content Security Policy");
      }
      await page.close();
      return problems;
    },
  },

  {
    name: "hidden",
    summary: "an element with [hidden] is never rendered, the toast included",
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, { route: "letter" });
      const inspect = (label) => `(() => {
        ${IN_PAGE}
        const problems = [];
        const toast = document.getElementById("toast");
        if (!toast) problems.push("${label}: there is no #toast");
        else if (!toast.hidden) problems.push("${label}: #toast is not hidden at load");
        for (const el of document.querySelectorAll("body [hidden]")) {
          if (el.getClientRects().length > 0 || getComputedStyle(el).display !== "none") {
            problems.push("${label}: " + describe(el) + " has [hidden] but is rendered (display " + getComputedStyle(el).display + ")");
          }
        }
        // hidden must beat a component's own display, so try it on every
        // element that is rendered now and restore it at once.
        let probed = 0;
        for (const el of document.querySelectorAll("body *")) {
          if (!(el instanceof HTMLElement) || el.hidden || el.getClientRects().length === 0) continue;
          probed += 1;
          el.hidden = true;
          const display = getComputedStyle(el).display;
          el.hidden = false;
          if (display !== "none") problems.push("${label}: setting hidden on " + describe(el) + " leaves display " + display);
        }
        if (probed < 20) problems.push("${label}: only " + probed + " rendered elements to probe; the page did not render");
        return problems;
      })()`;
      problems.push(...(await page.eval(inspect("as shipped"))));
      return dedupe(problems);
    },
  },

  {
    name: "layer-order",
    summary: "the first stylesheet declares the layer order, and every rule of every sheet sits in a declared layer",
    async run(ctx) {
      const page = await openApp(ctx, { route: "letter" });
      const report = await page.eval(`(() => {
        const expected = ${JSON.stringify(LAYER_ORDER)};
        const problems = [];
        const sheets = [...document.styleSheets];
        const name = (sheet) => sheet.href ? new URL(sheet.href).pathname : "an inline <style>";
        const first = sheets[0];
        const statement = first && first.cssRules[0];
        if (!(statement instanceof CSSLayerStatementRule)) {
          problems.push("the first stylesheet (" + (first ? name(first) : "none") + ") does not open with an @layer statement, so the order falls to link order");
        } else if (statement.nameList.join(",") !== expected.join(",")) {
          problems.push("the layer order is " + statement.nameList.join(", ") + "; expected " + expected.join(", "));
        }
        for (const sheet of sheets) {
          let layered = 0;
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSLayerStatementRule) {
              for (const layer of rule.nameList) {
                if (!expected.includes(layer)) problems.push(name(sheet) + " declares the layer " + layer + ", which is not in the order");
              }
            } else if (rule instanceof CSSLayerBlockRule) {
              layered += 1;
              if (!expected.includes(rule.name)) {
                problems.push(name(sheet) + " puts rules in the layer " + (rule.name || "(anonymous)") + ", which is not in the order, so they land above every declared layer");
              }
            } else if (!(rule instanceof CSSFontFaceRule)) {
              const what = rule.selectorText || rule.conditionText || rule.cssText.slice(0, 60);
              problems.push(name(sheet) + " has an unlayered rule (" + what + "), which outranks every layer");
            }
          }
          if (layered === 0) problems.push(name(sheet) + " has no layered rules");
        }
        return { problems, sheets: sheets.map(name) };
      })()`);
      if (report.sheets.length < 2) report.problems.push(`only ${report.sheets.length} stylesheet(s) loaded: ${report.sheets.join(", ")}`);
      return report.problems;
    },
  },

  {
    name: "tokens-link",
    summary: "css/tokens.css, which declares the layer order, is linked, loaded, enabled and first in the cascade",
    async run(ctx) {
      const page = await openApp(ctx, { route: "letter" });
      const problems = await page.eval(`(() => {
        // The path, not the whole URL: a cache tag such as ?v=11 still links the same file.
        const target = new URL("css/tokens.css", document.baseURI).pathname;
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(
          (link) => new URL(link.href).pathname === target,
        );
        if (links.length !== 1) return ["css/tokens.css is linked " + links.length + " times; expected once"];
        const [link] = links;
        const problems = [];
        if (!link.sheet) problems.push("css/tokens.css did not load");
        else {
          if (link.sheet.disabled) problems.push("css/tokens.css is disabled");
          if (link.sheet.cssRules.length < 2) problems.push("css/tokens.css loaded with " + link.sheet.cssRules.length + " rules");
          if (document.styleSheets[0] !== link.sheet) problems.push("css/tokens.css is not the first stylesheet, so it cannot set the layer order");
          if (!matchMedia(link.media || "all").matches) problems.push("css/tokens.css has a media query that does not match: " + link.media);
        }
        return problems;
      })()`);
      for (const failure of page.failedResources) {
        if (failure.type === "Stylesheet") problems.push(`${failure.url} failed (${failure.reason})`);
      }
      return problems;
    },
  },

  {
    name: "mode-only",
    summary: "each camera mode renders its own controls and none of the other modes'",
    async run(ctx) {
      // The controls each mode must offer. The generic rule below only sees
      // the tags; these catch a control tagged for the wrong mode.
      const mustRender = {
        letter: ["#removeLastChar", "#insertSpace", "#manualAddLetter"],
        word: ["#recordWord", "#retryWord", "#appendWordResult"],
        coach: ["#coachTargetTile", "#coachHintButton", "#coachNextTarget"],
      };
      const problems = [];
      const page = await openApp(ctx, { route: "letter" });
      for (const mode of CAMERA_MODES) {
        await switchMode(page, mode);
        const others = Object.entries(mustRender).filter(([other]) => other !== mode).flatMap(([, ids]) => ids);
        problems.push(
          ...(await page.eval(`(() => {
            ${IN_PAGE}
            const mode = ${JSON.stringify(mode)};
            const problems = [];
            const tagged = [...document.querySelectorAll(".mode-only")];
            if (tagged.length < 10) problems.push(mode + ": only " + tagged.length + " .mode-only elements");
            for (const el of tagged) {
              const display = getComputedStyle(el).display;
              if (!el.classList.contains(mode + "-only")) {
                if (display !== "none") problems.push(mode + ": " + describe(el) + " belongs to another mode but has display " + display);
                continue;
              }
              // Its own mode leaves the element to its component: dropping the
              // mode hook must not change how it is displayed.
              el.classList.remove("mode-only");
              const untagged = getComputedStyle(el).display;
              el.classList.add("mode-only");
              if (display !== untagged) problems.push(mode + ": " + describe(el) + " is " + display + " in its own mode but " + untagged + " untagged");
            }
            for (const selector of ${JSON.stringify(mustRender[mode])}) {
              if (!rendered(document.querySelector(selector))) problems.push(mode + ": " + selector + " is not rendered");
            }
            for (const selector of ${JSON.stringify(others)}) {
              if (rendered(document.querySelector(selector))) problems.push(mode + ": " + selector + " belongs to another mode but is rendered");
            }
            return problems;
          })()`)),
        );
      }
      return problems;
    },
  },

  {
    name: "reduced-motion",
    summary: "with prefers-reduced-motion: reduce no element animates or transitions",
    async run(ctx) {
      const longest = `(() => {
        ${IN_PAGE}
        const seconds = (list) => Math.max(0, ...list.split(",").map((part) => {
          const value = parseFloat(part);
          return part.trim().endsWith("ms") ? value / 1000 : value;
        }));
        let worst = { seconds: 0, what: "" };
        for (const el of document.querySelectorAll("*")) {
          const style = getComputedStyle(el);
          for (const [property, list] of [["transition", style.transitionDuration], ["animation", style.animationDuration]]) {
            const value = seconds(list);
            if (value > worst.seconds) worst = { seconds: value, what: property + " on " + describe(el) };
          }
        }
        return worst;
      })()`;
      const problems = [];
      // Without the preference something must move, or the check below could
      // not tell an honoured preference from a page with no motion at all.
      const control = await openApp(ctx, { route: "letter" });
      const moving = await control.eval(longest);
      if (moving.seconds <= 0.001) problems.push("with no preference nothing transitions, so this check proves nothing");
      await control.close();

      const reduced = [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ];
      const page = await openApp(ctx, { route: "letter", media: reduced });
      const shipped = await page.eval(longest);
      if (shipped.seconds > 0.001) problems.push(`as shipped: a ${shipped.seconds}s ${shipped.what} under reduced motion`);
      return problems;
    },
  },

  {
    name: "dark-theme",
    summary: "the theme toggle switches the tokens, and the page background follows them",
    async run(ctx) {
      const page = await openApp(ctx, { route: "letter" });
      const read = `(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-page)";
        document.body.append(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          theme: document.body.dataset.theme,
          token: getComputedStyle(document.body).getPropertyValue("--color-page").trim(),
          resolved,
          body: getComputedStyle(document.body).backgroundColor,
          html: getComputedStyle(document.documentElement).backgroundColor,
        };
      })()`;
      const light = await page.eval(read);
      const problems = [];
      if (light.theme !== "light") problems.push(`a light-preference visitor starts in ${light.theme}`);
      await page.eval(`document.getElementById("themeToggle").click()`);
      await page.waitFor(`document.body.dataset.theme === "dark"`, { what: "the toggle to set the dark theme" });
      const dark = await page.eval(read);
      if (!light.token || !dark.token) problems.push("--color-page is not defined on the body");
      if (dark.token === light.token) problems.push(`--color-page stays ${dark.token} under data-theme dark`);
      if (dark.body === light.body) problems.push(`the body background stays ${dark.body} under data-theme dark`);
      if (dark.body !== dark.resolved) problems.push(`the dark body background ${dark.body} is not the dark --color-page ${dark.resolved}`);
      if (dark.html !== dark.body) problems.push(`the dark page canvas ${dark.html} does not match the body ${dark.body}`);
      return problems;
    },
  },

  {
    name: "qr-colours",
    summary: "the QR code stays black on white in both themes, so a scanner always sees dark on light",
    async run(ctx) {
      const page = await openApp(ctx, { route: "qr" });
      const read = `(() => {
        const style = getComputedStyle(document.documentElement);
        const probe = document.createElement("div");
        document.body.append(probe);
        const resolve = (name) => {
          probe.style.color = "var(" + name + ", transparent)";
          return getComputedStyle(probe).color;
        };
        const colours = { ink: resolve("--qr-ink"), back: resolve("--qr-back"), declared: style.getPropertyValue("--qr-ink").trim() };
        probe.remove();
        return colours;
      })()`;
      const problems = [];
      const light = await page.eval(read);
      if (!light.declared) problems.push("--qr-ink is not defined, so the drawing falls back to a colour of its own");
      await page.eval(`document.getElementById("themeToggle").click()`);
      await page.waitFor(`document.body.dataset.theme === "dark"`, { what: "the toggle to set the dark theme" });
      const dark = await page.eval(read);
      for (const [label, colours] of [["light", light], ["dark", dark]]) {
        if (colours.ink !== "rgb(23, 24, 27)") problems.push(`${label} theme: the QR ink is ${colours.ink}, not the near-black ink`);
        if (colours.back !== "rgb(255, 255, 255)") problems.push(`${label} theme: the QR paper is ${colours.back}, not white`);
      }
      return problems;
    },
  },

  {
    name: "qr-library",
    summary: "no screen but #qr asks for the QR library; #qr asks for it once and, when the CDN is unreachable, shows the link in the code's place",
    async run(ctx) {
      const problems = [];
      const asksForKjua = (page) => page.blockedRequests.filter((url) => url.includes("/kjua@"));
      for (const route of ["letter", "word", "coach", "project", "test"]) {
        const page = await openApp(ctx, { route });
        if (asksForKjua(page).length) problems.push(`#${route} asks for the QR library: ${asksForKjua(page).join(", ")}`);
        await page.close();
      }
      const page = await openApp(ctx, { route: "qr" });
      try {
        await page.waitFor(`document.getElementById("qrCanvas").textContent.includes(document.getElementById("qrDemoUrl").textContent.trim())`, {
          what: "the link in the code's place once the library is refused",
        });
      } catch (error) {
        problems.push(error.message);
      }
      if (asksForKjua(page).length !== 1) problems.push(`#qr asked for the QR library ${asksForKjua(page).length} times, not once`);
      await page.close();
      return problems;
    },
  },

  {
    name: "qr-library-cdn",
    summary: "#qr fetches the QR library from the CDN once, with its integrity hash, and draws the code; no CSP violation",
    network: true,
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, { route: "qr", allowExternal: true });
      try {
        await page.waitFor(`Boolean(document.querySelector("#qrCanvas canvas"))`, { what: "the QR code to be drawn", timeoutMs: 15_000 });
      } catch (error) {
        problems.push(error.message);
      }
      const facts = await page.eval(`(() => {
        const scripts = [...document.querySelectorAll("script")].filter((script) => script.src.includes("/kjua@"));
        const fetched = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/kjua@"));
        return { scripts: scripts.map((s) => ({ integrity: s.integrity, crossOrigin: s.crossOrigin })), fetched: fetched.length };
      })()`);
      if (facts.fetched !== 1) problems.push(`the QR library was fetched ${facts.fetched} times, not once`);
      if (facts.scripts.length !== 1) problems.push(`the page holds ${facts.scripts.length} QR library scripts, not one`);
      for (const script of facts.scripts) {
        if (!/^sha384-/.test(script.integrity)) problems.push("the QR library's script has no integrity hash");
        if (script.crossOrigin !== "anonymous") problems.push(`the QR library's script is crossorigin=${script.crossOrigin}`);
      }
      for (const violation of await page.eval("window.__browserCheck.csp")) {
        problems.push(`CSP ${violation.disposition} violation of ${violation.directive} by ${violation.blocked || "inline code"}`);
      }
      await page.close();
      return problems;
    },
  },

  {
    name: "qr-code",
    summary: "the QR screen draws its code with the library it loads from the CDN",
    network: true,
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, { route: "qr", allowExternal: true });
      try {
        await page.waitFor(`(() => {
          const code = document.querySelector("#qrCanvas canvas");
          return Boolean(code && code.width > 0 && code.height > 0);
        })()`, { what: "the QR code to be drawn", timeoutMs: 20_000 });
      } catch (error) {
        problems.push(error.message);
      }
      if (page.exceptions.length) problems.push(`uncaught error: ${page.exceptions.join(" | ")}`);
      await page.close();
      return problems;
    },
  },

  {
    name: "cdn-integrity",
    summary: "a CDN script whose bytes changed does not run",
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, {
        route: "qr",
        substituteExternal: "globalThis.__substitutedScripts = (globalThis.__substitutedScripts || 0) + 1;",
      });
      const scripts = page.substitutedRequests.filter((url) => url.endsWith(".js"));
      if (scripts.length === 0) problems.push("the QR screen requested no CDN script, so nothing was checked");
      const ran = await page.eval("globalThis.__substitutedScripts || 0");
      if (ran) problems.push(`${ran} altered CDN script(s) ran: ${scripts.join(", ")}`);
      await page.close();
      return problems;
    },
  },

  {
    name: "no-hscroll",
    summary: "no route, camera or information screen, scrolls sideways at 320, 360, 390, 844x390 or 1366x768",
    async run(ctx) {
      const viewports = [
        { width: 320, height: 640, mobile: true },
        { width: 360, height: 780, mobile: true },
        { width: 390, height: 844, mobile: true },
        { width: 844, height: 390, mobile: true },
        { width: 1366, height: 768, mobile: false },
      ];
      const problems = [];
      for (const viewport of viewports) {
        const page = await openApp(ctx, { route: "letter", viewport });
        for (const mode of ROUTES) {
          await switchMode(page, mode);
          const result = await page.eval(`(() => {
            ${IN_PAGE}
            const root = document.documentElement;
            const width = root.clientWidth;
            const overflow = Math.max(root.scrollWidth, document.body.scrollWidth) - width;
            if (overflow <= 0) return null;
            const wide = [...document.querySelectorAll("body *")]
              .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > width + 0.5)
              .map((el) => describe(el) + " to " + Math.round(el.getBoundingClientRect().right))
              .slice(0, 3);
            return { overflow, wide };
          })()`);
          if (result) {
            problems.push(`${viewport.width}x${viewport.height} ${mode}: scrolls ${result.overflow}px sideways; widest: ${result.wide.join(", ")}`);
          }
        }
        await page.close();
      }
      return problems;
    },
  },

  {
    name: "landscape",
    summary: "phone landscape: the stage fills the height at the left, the result sits beside it, and nothing overlaps or is cut off",
    async run(ctx) {
      const viewports = [
        { width: 844, height: 390, mobile: true },
        { width: 740, height: 360, mobile: true },
        { width: 667, height: 375, mobile: true },
        { width: 568, height: 320, mobile: true },
        { width: 932, height: 430, mobile: true },
      ];
      // Each state through the app's own functions: the first visit, a live
      // result (the camera itself is the boundary, so its effect on the stage
      // is what stands in for it), and a refused camera.
      const states = {
        idle: `stopCamera()`,
        live: `(() => {
          stopCamera();
          els.cameraEmpty.hidden = true;
          state.transcript = "HELLO WOR";
          renderTranscript();
          updatePrediction({ label: "L", confidence: 0.93, alternatives: [{ label: "L", confidence: 0.93 }, { label: "D", confidence: 0.03 }] });
        })()`,
        denied: `(() => { stopCamera(); showCameraProblem(cameraProblemKind({ name: "NotAllowedError", message: "" })); })()`,
      };
      const measure = (label) => `(() => {
        ${IN_PAGE}
        const label = ${JSON.stringify(label)};
        const problems = [];
        const near = (a, b) => Math.abs(a - b) <= 0.5;
        const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

        const stage = document.getElementById("cameraStage");
        const s = box(stage);
        if (!near(s.top, 0) || !near(s.left, 0) || !near(s.bottom, innerHeight)) {
          problems.push(label + ": the stage is at [" + [s.left, s.top, s.width, s.height].map(Math.round) + "], not the full height at the left edge");
        }

        // The side column: what sits beside the stage, never on it.
        const column = [
          ...all(".topbar__modes"), ...all(".topbar__more"), ...all(".camera-column > .plate"),
          ...all(".compose > .strip"), ...all(".dock > *"),
        ];
        // What the stage shows: each of these must be readable whole.
        const onStage = [
          ...all("#latencyBadge"), ...all("#cameraToggle"), ...all(".stage__headline"), ...all(".stage__lead"),
          ...all(".stage__cta > *"), ...all(".stage__facts"), ...all(".stage__problem-text"), ...all(".stage__help > summary"),
        ];
        if (!all(".dock > *").length) problems.push(label + ": no action is rendered");
        for (const el of column) {
          if (meets(box(el), s)) problems.push(label + ": " + describe(el) + " lies on the stage");
          if (!inside(box(el), view)) problems.push(label + ": " + describe(el) + " is cut off by the window");
        }
        for (const el of onStage) {
          if (!inside(box(el), s)) problems.push(label + ": " + describe(el) + " is cut off by the stage");
        }
        const parts = [...column, ...onStage];
        for (let i = 0; i < parts.length; i += 1) {
          for (let j = i + 1; j < parts.length; j += 1) {
            if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
            if (meets(box(parts[i]), box(parts[j]))) problems.push(label + ": " + describe(parts[i]) + " overlaps " + describe(parts[j]));
          }
        }
        for (const el of all(".dock > *")) {
          if (box(el).height < 44 - 0.5) problems.push(label + ": " + describe(el) + " is " + Math.round(box(el).height) + " px high, below 44");
        }
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        if (overflow > 0) problems.push(label + ": the page scrolls " + overflow + " px sideways");
        return problems;
      })()`;
      const problems = [];
      for (const viewport of viewports) {
        const page = await openApp(ctx, { route: "letter", viewport });
        await page.eval("document.fonts.ready.then(() => true)");
        for (const mode of CAMERA_MODES) {
          await switchMode(page, mode);
          for (const [name, setup] of Object.entries(states)) {
            await page.eval(setup);
            problems.push(...(await page.eval(measure(`${viewport.width}x${viewport.height} ${mode} ${name}`))));
          }
        }
        await page.close();
      }
      return problems;
    },
  },

  {
    name: "stage-fit",
    summary: "portrait, tablet and laptop: the first visit and the camera problem fit the stage whole, clear of the chip and the message line",
    async run(ctx) {
      const viewports = [
        { width: 320, height: 568, mobile: true },
        { width: 360, height: 640, mobile: true },
        { width: 375, height: 667, mobile: true },
        { width: 360, height: 780, mobile: true },
        { width: 375, height: 812, mobile: true },
        { width: 390, height: 844, mobile: true },
        { width: 768, height: 1024, mobile: true },
        { width: 1366, height: 768, mobile: false },
        { width: 1440, height: 900, mobile: false },
      ];
      // At rest and with a refused camera, through the app's own functions.
      const states = {
        idle: `stopCamera()`,
        denied: `(() => { stopCamera(); showCameraProblem(cameraProblemKind({ name: "NotAllowedError", message: "" })); })()`,
      };
      const measure = (label) => `(() => {
        ${IN_PAGE}
        const label = ${JSON.stringify(label)};
        const problems = [];
        const stage = box(document.getElementById("cameraStage"));
        // What the stage shows before the camera runs. Each is read whole:
        // a part that runs past the stage or into a scrolled-away area, or
        // that lies on another part, is a part the visitor cannot read.
        const parts = [
          ...all("#latencyBadge"), ...all(".stage__illustration"), ...all(".stage__headline"), ...all(".stage__lead"),
          ...all(".stage__cta > *"), ...all(".stage__facts > li"), ...all(".stage__problem-icon"),
          ...all(".stage__problem-text"), ...all(".stage__help > summary"),
          // The message line under the first visit, when it shows.
          ...all(".camera-column > .plate"),
        ];
        if (parts.length < 4) problems.push(label + ": only " + parts.length + " parts rendered on the stage");
        for (const el of parts) {
          if (!inside(box(el), stage)) problems.push(label + ": " + describe(el) + " is cut off by the stage");
        }
        for (let i = 0; i < parts.length; i += 1) {
          for (let j = i + 1; j < parts.length; j += 1) {
            if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
            if (meets(box(parts[i]), box(parts[j]))) problems.push(label + ": " + describe(parts[i]) + " overlaps " + describe(parts[j]));
          }
        }
        return problems;
      })()`;
      const problems = [];
      for (const viewport of viewports) {
        const page = await openApp(ctx, { route: "letter", viewport });
        await page.eval("document.fonts.ready.then(() => true)");
        for (const mode of CAMERA_MODES) {
          await switchMode(page, mode);
          for (const [name, setup] of Object.entries(states)) {
            await page.eval(setup);
            problems.push(...(await page.eval(measure(`${viewport.width}x${viewport.height} ${mode} ${name}`))));
          }
        }
        await page.close();
      }
      return problems;
    },
  },

  {
    name: "strip-tail",
    summary: "a transcript longer than the strip shows its newest letters and the caret",
    async run(ctx) {
      const viewports = [
        { width: 844, height: 390, mobile: true },
        { width: 390, height: 844, mobile: true },
        { width: 1366, height: 768, mobile: false },
      ];
      const problems = [];
      for (const viewport of viewports) {
        const page = await openApp(ctx, { route: "letter", viewport });
        await page.eval("document.fonts.ready.then(() => true)");
        for (const text of ["AB", "THE QUICK BROWN FOX JUMPS OVER THE LAZY"]) {
          // Typed through the app's own render, then one frame for layout.
          await page.eval(`(() => { state.transcript = ${JSON.stringify(text)}; renderTranscript(); })()`);
          await page.eval("new Promise((resolve) => requestAnimationFrame(() => resolve(true)))");
          const seen = await page.eval(`(() => {
            ${IN_PAGE}
            const strip = document.getElementById("transcriptText");
            const caret = strip.querySelector(".cursor");
            return { inside: Boolean(caret) && inside(box(caret), box(strip)), clipped: strip.scrollWidth > strip.clientWidth };
          })()`);
          if (!seen.inside) problems.push(`${viewport.width}x${viewport.height} "${text}": the caret after the newest letter is outside the strip`);
          if (text.length > 30 && !seen.clipped) problems.push(`${viewport.width}x${viewport.height}: a ${text.length}-letter text fits the strip, so this proves nothing`);
        }
        await page.close();
      }
      return problems;
    },
  },

  {
    name: "feedback-kinds",
    summary: "the stage feedback bar renders every kind, and marks low and good apart from a neutral warning",
    async run(ctx) {
      const page = await openApp(ctx, { route: "letter" });
      // Sent through the app's own showFeedback(), so a renamed modifier class
      // fails here as it would on screen. "unstyled" is a kind no CSS names.
      const looks = await page.eval(`(() => {
        ${IN_PAGE}
        const bar = document.getElementById("feedbackBar");
        const out = {};
        for (const kind of ["confusion", "hard", "low", "good", "unstyled"]) {
          showFeedback("Deneme", kind);
          const style = getComputedStyle(bar);
          const marker = getComputedStyle(bar, "::before");
          out[kind] = {
            rendered: rendered(bar),
            look: [style.backgroundColor, style.borderTopColor, style.borderLeftColor, style.color, marker.backgroundColor].join(" "),
          };
        }
        clearFeedback();
        return out;
      })()`);
      const problems = [];
      for (const [kind, { rendered }] of Object.entries(looks)) {
        if (!rendered) problems.push(`the ${kind} feedback bar is not rendered`);
      }
      // A judgement must not read as a plain warning, nor as the other one.
      for (const kind of ["low", "good"]) {
        if (looks[kind].look === looks.unstyled.look) problems.push(`the ${kind} feedback looks the same as a kind no CSS styles`);
      }
      if (looks.low.look === looks.good.look) problems.push("low and good feedback look the same");
      return problems;
    },
  },

  {
    name: "confidence-levels",
    summary: "the word result guide renders low, maybe and good differently from each other and from no level",
    async run(ctx) {
      const page = await openApp(ctx, { route: "word" });
      // Driven through the app's own assessment and renderer: a finished
      // recording with a weak, a close and a clear top result.
      const looks = await page.eval(`(() => {
        ${IN_PAGE}
        const guide = document.getElementById("wordResultGuide");
        const read = () => {
          const style = getComputedStyle(guide);
          return [style.backgroundColor, style.borderTopColor, style.borderLeftColor].join(" ");
        };
        const results = {
          low: { prediction: "book", confidence: 0.05, top3: [{ label: "book", confidence: 0.05 }, { label: "eat", confidence: 0.04 }] },
          maybe: { prediction: "book", confidence: 0.5, top3: [{ label: "book", confidence: 0.5 }, { label: "eat", confidence: 0.46 }] },
          good: { prediction: "book", confidence: 0.9, top3: [{ label: "book", confidence: 0.9 }, { label: "eat", confidence: 0.05 }] },
        };
        const out = {};
        state.wordState = "RESULT";
        state.wordQualityWarnings = [];
        for (const [level, result] of Object.entries(results)) {
          Object.assign(state, result);
          renderWordResultGuide();
          out[level] = { level: guide.dataset.level, rendered: rendered(guide), look: read() };
        }
        guide.removeAttribute("data-level");
        out.none = { level: undefined, rendered: rendered(guide), look: read() };
        state.wordState = "IDLE";
        renderWordResultGuide();
        return out;
      })()`);
      const problems = [];
      for (const level of ["low", "maybe", "good"]) {
        const look = looks[level];
        if (look.level !== level) problems.push(`a ${level} result rendered the guide at level ${look.level}`);
        if (!look.rendered) problems.push(`the guide is not rendered for a ${level} result`);
        if (look.look === looks.none.look) problems.push(`the ${level} guide looks the same as a guide with no level`);
      }
      for (const [a, b] of [["low", "maybe"], ["low", "good"], ["maybe", "good"]]) {
        if (looks[a].look === looks[b].look) problems.push(`the ${a} and ${b} guides look the same`);
      }
      return problems;
    },
  },

  {
    name: "model-test-labels",
    summary: "Model Test's ranked results show whole word labels, not cut-off ones, on a laptop and a phone",
    async run(ctx) {
      const problems = [];
      for (const [device, viewport] of [["laptop", LAPTOP], ["phone", { width: 390, height: 844, mobile: true }]]) {
        const page = await openApp(ctx, { route: "test", viewport });
        // Drawn by the panel's own renderer, so no model has to run: the
        // longest word labels the word model has, then letters as a control.
        const cut = await page.eval(`(() => {
          ${IN_PAGE}
          const draw = (task, labels) => {
            setModelTestTask(task);
            renderModelTestTop3(labels.map((label, i) => ({ label, confidence: 0.5 - i * 0.1 })));
            return [...document.querySelectorAll("#modelTestTop3List .top3-row b")]
              .filter((b) => !rendered(b) || b.scrollWidth > b.clientWidth + 1)
              .map((b) => task + ": " + b.textContent + (rendered(b) ? " is cut off" : " is not rendered"));
          };
          return [...draw("word", ["toothbrush", "thankyou", "brother"]), ...draw("letter", ["A", "B", "C"])];
        })()`);
        problems.push(...cut.map((line) => `${device}: ${line}`));
      }
      return problems;
    },
  },

  {
    name: "guided-actions",
    summary: "primary Model Test and reference actions are visible; advanced controls start collapsed",
    async run(ctx) {
      const problems = [];
      const test = await openApp(ctx, { route: "test" });
      problems.push(
        ...(await test.eval(`(() => {
          ${IN_PAGE}
          const problems = [];
          for (const selector of [".model-test-simple-copy", "#loadDemoLetter", "#loadDemoWord"]) {
            if (!rendered(document.querySelector(selector))) problems.push("#test: " + selector + " is not rendered");
          }
          const brief = document.querySelector(".model-test-brief");
          if (brief && rendered(brief)) problems.push("#test: the long .model-test-brief is rendered; the simple copy replaces it");
          const advanced = document.querySelector("details.model-test-advanced");
          if (!advanced) problems.push("#test: there is no collapsible advanced section");
          else {
            if (advanced.open) problems.push("#test: the advanced section starts open");
            const choice = advanced.querySelector(".model-test-task-switch");
            if (!choice) problems.push("#test: the model choice is not inside the advanced section");
            else if (!advanced.open && rendered(choice)) problems.push("#test: the model choice is rendered while the advanced section is closed");
          }
          return problems;
        })()`)),
      );
      await test.close();

      const coach = await openApp(ctx, { route: "coach" });
      problems.push(
        ...(await coach.eval(`(() => {
          ${IN_PAGE}
          const problems = [];
          const reference = document.querySelector(".app-reference");
          const study = document.getElementById("coachStudy");
          if (!rendered(reference)) problems.push("#coach: the reference panel is not rendered");
          if (!rendered(study)) problems.push("#coach: the study cards are not rendered");
          if (rendered(reference) && rendered(study) && study.getBoundingClientRect().top >= reference.getBoundingClientRect().top) {
            problems.push("#coach: the study cards are not above the reference panel");
          }
          return problems;
        })()`)),
      );
      await coach.close();

      const word = await openApp(ctx, { route: "word" });
      const demo = await word.eval(`(() => {
        ${IN_PAGE}
        const demo = document.querySelector("details.word-demo-card");
        return demo ? { rendered: rendered(demo), open: demo.open } : null;
      })()`);
      if (!demo) problems.push("#word: there is no collapsible word demo card");
      else {
        if (!demo.rendered) problems.push("#word: the word demo card is not rendered");
        if (demo.open) problems.push("#word: the word demo card starts open");
      }
      return problems;
    },
  },

  {
    name: "demo",
    summary: "the camera-free demo plays the real recording: the hand is drawn clear of its card and the plate, the instruction shows, nothing scrolls sideways, and stop clears the stage",
    timeoutMs: 60_000,
    async run(ctx) {
      const viewports = [
        { width: 390, height: 844, mobile: true, room: true },
        { width: 320, height: 568, mobile: true, room: false },
        { width: 844, height: 390, mobile: true, room: true },
        { width: 1366, height: 768, mobile: false, room: true },
      ];
      // The overlay's drawn pixels, as a box in page pixels, and what lies
      // over the stage. The hand is read from the canvas itself, so a demo
      // that publishes nothing, or draws off the stage, shows here.
      const look = `(() => {
        ${IN_PAGE}
        const canvas = document.getElementById("overlayCanvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
            count += 1;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
        const c = box(canvas);
        const scale = c.width / canvas.width;
        const hand = count
          ? { left: c.left + left * scale, top: c.top + top * scale, right: c.left + (right + 1) * scale, bottom: c.top + (bottom + 1) * scale }
          : null;
        const panel = document.getElementById("demoPanel");
        const text = document.getElementById("demoText");
        const plate = document.querySelector(".camera-column > .plate");
        const stage = box(document.getElementById("cameraStage"));
        return {
          count,
          hand,
          stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom, height: stage.height },
          panel: rendered(panel) ? box(panel).toJSON() : null,
          plate: rendered(plate) ? box(plate).toJSON() : null,
          text: rendered(text) ? text.textContent.trim() : "",
          textInside: rendered(text) && inside(box(text), stage),
          stop: rendered(document.getElementById("demoStop")),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`;
      const meetsBox = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const problems = [];
      for (const viewport of viewports) {
        for (const scheme of viewport.mobile ? ["light"] : ["light", "dark"]) {
          const label = `${viewport.width}x${viewport.height} ${scheme}`;
          const page = await openApp(ctx, {
            route: "letter",
            viewport,
            media: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }],
          });
          await page.eval("document.fonts.ready.then(() => true)");
          const before = await page.eval(look);
          if (before.count !== 0) problems.push(`${label}: the overlay draws before the demo starts`);

          await page.click('#cameraIntro [data-trigger="demo"]');
          try {
            await page.waitFor(`(() => {
              const c = document.getElementById("overlayCanvas");
              const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
              for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
              return false;
            })()`, { what: `${label}: the demo's hand on the stage`, timeoutMs: 5_000 });
          } catch (error) {
            problems.push(error.message);
            await page.close();
            continue;
          }
          const playing = await page.eval(look);
          if (!playing.panel) problems.push(`${label}: the demo's card is not rendered`);
          if (!playing.text) problems.push(`${label}: the instruction is not rendered`);
          else if (!playing.textInside) problems.push(`${label}: the instruction is cut off by the stage`);
          if (!playing.stop) problems.push(`${label}: the demo's stop is not rendered`);
          if (playing.overflow > 0) problems.push(`${label}: the page scrolls ${playing.overflow}px sideways`);
          const hand = playing.hand;
          const h = hand ? hand.bottom - hand.top : 0;
          if (hand && h < 0.25 * playing.stage.height) {
            problems.push(`${label}: the hand is ${Math.round(h)}px high, under a quarter of the stage`);
          }
          // Where the stage has the room, nothing lies over the hand.
          if (hand && viewport.room) {
            if (playing.panel && meetsBox(hand, playing.panel)) problems.push(`${label}: the hand is drawn under the demo's card`);
            if (playing.plate && meetsBox(hand, playing.plate)) problems.push(`${label}: the hand is drawn under the plate`);
          }

          await page.click("#demoStop");
          await page.waitFor(`document.getElementById("demoPanel").hidden`, { what: `${label}: the demo to stop` });
          // The render loop clears the overlay on its next frame.
          await page.eval("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
          const stopped = await page.eval(look);
          if (stopped.count !== 0) problems.push(`${label}: the hand is still drawn after stop`);
          if (stopped.stop) problems.push(`${label}: the demo's stop is still rendered after stop`);
          if (page.exceptions.length) problems.push(`${label}: uncaught error: ${page.exceptions.join(" | ")}`);
          await page.close();
        }
      }
      return problems;
    },
  },

  {
    name: "demo-model",
    summary: "the real letter model reads the demo's recorded hand: Space for each letter writes F, L and Y, and the end offers the camera",
    network: true,
    timeoutMs: 90_000,
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, { route: "letter", allowExternal: true });
      await page.click('#cameraIntro [data-trigger="demo"]');
      const press = async () => {
        for (const type of ["keyDown", "keyUp"]) {
          await page.send("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32, text: type === "keyDown" ? " " : undefined });
        }
      };
      for (const letter of ["F", "L", "Y"]) {
        try {
          await page.waitFor(`document.getElementById("primaryPrediction").textContent.trim() === ${JSON.stringify(letter)}`, {
            what: `the plate to read ${letter} from the recorded hand`,
            timeoutMs: 45_000,
          });
        } catch (error) {
          problems.push(error.message);
          break;
        }
        await press();
      }
      try {
        await page.waitFor(`(() => {
          const camera = document.getElementById("demoCamera");
          return !camera.hidden && camera.getBoundingClientRect().height > 0;
        })()`, { what: "the end of the demo to offer the camera", timeoutMs: 10_000 });
      } catch (error) {
        problems.push(error.message);
      }
      const written = await page.eval(`document.getElementById("transcriptText").textContent.replace("|", "").trim()`);
      if (written !== "FLY") problems.push(`the transcript reads "${written}", not "FLY"`);
      if (page.exceptions.length) problems.push(`uncaught error: ${page.exceptions.join(" | ")}`);
      for (const violation of await page.eval("window.__browserCheck.csp")) {
        problems.push(`CSP ${violation.disposition} violation of ${violation.directive} by ${violation.blocked || "inline code"}`);
      }
      await page.close();
      return problems;
    },
  },

  {
    name: "camera",
    summary: "each camera mode loads its model through ONNX Runtime, the stage close button shows only while the camera is live, and stopping leaves no live track",
    network: true,
    timeoutMs: 120_000,
    async run(ctx) {
      const problems = [];
      const page = await openApp(ctx, { route: "letter", grantCamera: true, allowExternal: true });
      const look = `(() => {
        ${IN_PAGE}
        const close = document.getElementById("cameraToggle");
        const streams = window.__browserCheck.streams;
        return {
          closeRendered: rendered(close),
          closeLabel: (close?.textContent || "").trim(),
          closeBox: close ? Math.round(Math.min(close.getBoundingClientRect().width, close.getBoundingClientRect().height)) : 0,
          emptyRendered: rendered(document.getElementById("cameraEmpty")),
          liveTracks: streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length,
          streams: streams.length,
        };
      })()`;
      for (const mode of ["letter", "word"]) {
        await switchMode(page, mode);
        const before = await page.eval(look);
        if (before.closeRendered) problems.push(`${mode}: the close button is rendered before the camera starts`);
        if (!before.emptyRendered) problems.push(`${mode}: the camera call to action is not rendered before the start`);

        await page.click('[data-trigger="camera"]');
        await page.waitFor(`window.__browserCheck.streams.some((s) => s.getTracks().some((t) => t.readyState === "live")) && document.getElementById("cameraEmpty").hidden`, {
          what: `the ${mode} camera to go live`,
          timeoutMs: 20_000,
        });
        // The start goes on to load MediaPipe from its CDN; stop only once it
        // has settled, so the stop meets the fully started state.
        await page.waitFor(`typeof _cameraStartAttempt !== "undefined" && _cameraStartAttempt === null`, {
          what: `the ${mode} camera start to finish loading hand tracking`,
          timeoutMs: 90_000,
        });
        // The model this mode runs loads beside the camera start, through
        // the real ONNX Runtime build and its WASM files on the CDN. A failed
        // load is only logged, so a wrong wasmPaths or a 404 on the .wasm
        // would pass every other assertion here. Loaded is read from the
        // app's debug API; a load promise forgotten without a session means
        // the load failed (or never started), which ends the wait early.
        const [session, labels, load, classes] = {
          letter: ["letterSession", "letterLabels", "_letterModelLoad", 24],
          word: ["wordSession", "wordLabels", "_wordModelLoad", 50],
        }[mode];
        try {
          const outcome = await page.waitFor(`(() => {
            const models = window.aslDebug.models;
            if (models.${session} === true && models.${labels} === ${classes}) return "loaded";
            return ${load} === null && !models.${session} ? "failed" : false;
          })()`, { what: `the ${mode} model to load through ONNX Runtime`, timeoutMs: 60_000 });
          if (outcome !== "loaded") problems.push(`${mode}: the ${mode} model did not load through ONNX Runtime`);
        } catch (error) {
          problems.push(`${mode}: ${error.message}`);
        }

        const live = await page.eval(look);
        if (!live.closeRendered) problems.push(`${mode}: the close button is not rendered while the camera is live`);
        if (!live.closeLabel) problems.push(`${mode}: the close button has no label`);
        if (live.closeRendered && live.closeBox < 24) problems.push(`${mode}: the close button is ${live.closeBox}px, below a 24px target`);
        if (live.emptyRendered) problems.push(`${mode}: the call to action is still rendered while the camera is live`);

        if (live.closeRendered) await page.click("#cameraToggle");
        else await page.eval(`document.getElementById("cameraToggle").click()`);
        await page.waitFor(`!document.getElementById("cameraEmpty").hidden`, { what: `the ${mode} camera to stop` });
        const after = await page.eval(look);
        if (after.liveTracks !== 0) problems.push(`${mode}: ${after.liveTracks} camera track(s) still live after stop`);
        if (after.closeRendered) problems.push(`${mode}: the close button is still rendered after stop`);
      }
      if (page.exceptions.length) problems.push(`uncaught error: ${page.exceptions.join(" | ")}`);
      for (const violation of await page.eval("window.__browserCheck.csp")) {
        problems.push(`CSP ${violation.disposition} violation of ${violation.directive} by ${violation.blocked || "inline code"}`);
      }
      return problems;
    },
  },

  {
    name: "language-first-paint",
    summary: "an English reader sees the shell in English while the page still waits for a CDN that never answers",
    async run(ctx) {
      // The CDN request is held, not refused: the parser stops at the first
      // CDN script and init() never runs, as on a connection that stalls.
      // Whatever is English by then was translated before the CDN scripts.
      const problems = [];
      const page = await ctx.newPage({ ...LAPTOP, media: DEFAULT_MEDIA, languages: ENGLISH, holdExternal: true });
      await page.navigate(`${ctx.origin}/#letter`);
      await page.waitFor("typeof I18N_STRINGS !== 'undefined'", { what: "the strings to load" });
      await page.waitFor(`document.documentElement.lang === "en" && document.getElementById("skipLink").textContent === I18N_STRINGS.en["shell.skipLink"]`, {
        what: "the English shell before the CDN scripts",
        timeoutMs: 5_000,
      }).catch((error) => problems.push(error.message));
      if (!page.heldRequests.some((url) => url.includes("cdn.jsdelivr.net"))) {
        problems.push(`the page asked no CDN for a script, so nothing was held: ${page.heldRequests.join(", ") || "no request"}`);
      }
      const state = await page.eval(`(() => {
        const left = (${turkishLeft})(document.querySelector(".topbar"), { rendered: true });
        return {
          readyState: document.readyState,
          booted: document.getElementById("coachStudy").dataset.hidden !== undefined,
          left: left.map((finding) => finding.element + " " + finding.where + ": " + finding.text),
        };
      })()`);
      if (state.readyState !== "loading" || state.booted) {
        problems.push(`the page got past the held CDN script (readyState ${state.readyState}), so this proves nothing`);
      }
      for (const finding of state.left) problems.push(`Turkish in the header before the CDN answered: ${finding}`);
      await page.close();
      return problems;
    },
  },

  {
    name: "language-hidden-until-translated",
    summary: "an English reader sees no Turkish while a strings file is still downloading, the page shows itself after 3 s if the translation never comes, and a Turkish reader's page is never held back",
    async run(ctx) {
      // One strings file is held, so the parser stops at it with the Turkish
      // body parsed above it, as on a slow connection. Chrome paints what is
      // parsed while it waits, unless the page keeps it hidden.
      const problems = [];
      const HELD = "js/i18n/info.js";
      // Turkish is looked for twice: in what the page shows (innerText leaves
      // out text under visibility: hidden, which checkVisibility() does not),
      // and, once translated, in every rendered text and spoken name.
      const look = `(() => {
        ${IN_PAGE}
        const shownText = document.createElement("p");
        shownText.textContent = document.body.innerText;
        const shown = (${turkishLeft})(shownText);
        const left = (${turkishLeft})(document.body, { rendered: true });
        return {
          readyState: document.readyState,
          lang: document.documentElement.lang,
          bodyRendered: rendered(document.body),
          contentfulPaint: performance.getEntriesByType("paint").some((entry) => entry.name === "first-contentful-paint"),
          shown: shown.slice(0, 3).map((finding) => finding.text),
          left: left.slice(0, 3).map((finding) => finding.element + " " + finding.where + ": " + finding.text),
          leftCount: left.length,
          sinceStart: performance.now(),
        };
      })()`;
      const held = async (page) => {
        await page.waitFor("document.readyState === 'loading' && document.getElementById('skipLink') !== null", {
          what: "the body to be parsed up to the held strings file",
        });
        if (!page.heldRequests.some((url) => url.includes(HELD))) {
          throw new Error(`the page never asked for ${HELD}, so nothing was held`);
        }
        // Long enough for Chrome to paint what it has parsed.
        await page.eval("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200))))");
      };

      const english = await ctx.newPage({ ...LAPTOP, media: DEFAULT_MEDIA, languages: ENGLISH, holdPaths: [HELD] });
      await english.navigate(`${ctx.origin}/#letter`);
      await held(english);
      let seen = await english.eval(look);
      if (seen.readyState !== "loading") problems.push(`english: the page got past the held file (readyState ${seen.readyState}), so this proves nothing`);
      if (seen.sinceStart >= 3000) problems.push(`english: the first look came ${Math.round(seen.sinceStart)} ms in, after the fail-safe; this proves nothing`);
      if (seen.lang !== "en") problems.push(`english: <html lang> is ${seen.lang}`);
      if (seen.bodyRendered) problems.push("english: the body is rendered before the page is translated");
      if (seen.contentfulPaint) problems.push("english: content was painted before the page was translated");
      for (const text of seen.shown) problems.push(`english: Turkish shown before the translation: ${text}`);

      // The fail-safe: a translation that never comes must not leave a blank page.
      await english.waitFor("performance.now() > 3300", { what: "the fail-safe's 3 s", timeoutMs: 6_000 });
      await english.eval("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
      seen = await english.eval(look);
      if (!seen.bodyRendered) problems.push("english: the body is still hidden 3 s in while the translation waits");

      await english.release();
      await english.waitFor(`document.readyState !== "loading" && !document.documentElement.hasAttribute("data-i18n-pending")`, {
        what: "the translation to run once the held file arrives",
      }).catch((error) => problems.push(`english: ${error.message}`));
      seen = await english.eval(look);
      if (seen.leftCount) problems.push(`english: ${seen.leftCount} Turkish text(s) left after the translation, first: ${seen.left[0]}`);
      await english.close();

      const turkish = await ctx.newPage({ ...LAPTOP, media: DEFAULT_MEDIA, languages: ["tr-TR", "tr"], holdPaths: [HELD] });
      await turkish.navigate(`${ctx.origin}/#letter`);
      await held(turkish);
      seen = await turkish.eval(look);
      if (seen.lang !== "tr") problems.push(`turkish: <html lang> is ${seen.lang}`);
      if (!seen.bodyRendered) problems.push("turkish: the body is hidden while a strings file downloads, though a Turkish page needs no translation");
      if (!seen.contentfulPaint) problems.push("turkish: nothing was painted while a strings file downloads");
      await turkish.close();
      return problems;
    },
  },

  {
    name: "language-switch",
    summary: "the language switch shows TR and EN side by side, the language shown standing out, in the laptop header and the phone menu; it switches without a reload, keeps the choice and gives up focus after a click",
    async run(ctx) {
      const problems = [];
      const read = `(() => {
        ${IN_PAGE}
        const group = document.getElementById("languageSwitch");
        const [tr, en] = ["tr", "en"].map((language) => group.querySelector('[data-language="' + language + '"]'));
        const rect = (el) => el.getBoundingClientRect();
        return {
          lang: document.documentElement.lang,
          title: document.title,
          rendered: rendered(tr) && rendered(en),
          // Side by side: on one line, TR first, apart.
          sideBySide: Math.abs((rect(tr).top + rect(tr).bottom) / 2 - (rect(en).top + rect(en).bottom) / 2) < 2 && rect(tr).right <= rect(en).left,
          labels: [tr.textContent.trim(), en.textContent.trim()].join(" "),
          pressed: [tr, en].filter((option) => option.getAttribute("aria-pressed") === "true").map((option) => option.dataset.language).join(","),
          // The language shown stands out: its text is further from the
          // page behind it than the other's, in either theme.
          standsOut: (() => {
            const luminance = (colour) => {
              const [r, g, b] = colour.match(/[\\d.]+/g).map(Number);
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const page = luminance(getComputedStyle(document.body).backgroundColor);
            const distance = (el) => Math.abs(luminance(getComputedStyle(el).color) - page);
            const shown = document.documentElement.lang === "en" ? en : tr;
            const other = shown === en ? tr : en;
            return distance(shown) > distance(other) + 20;
          })(),
          focused: [tr, en].includes(document.activeElement),
          saved: localStorage.getItem("asl-lang"),
          marker: window.__sameDocument === true,
        };
      })()`;

      const laptop = await openApp(ctx, { route: "letter", viewport: LAPTOP, languages: ["tr-TR", "tr"] });
      await laptop.eval("window.__sameDocument = true");
      let seen = await laptop.eval(read);
      if (!seen.rendered) problems.push("laptop: the switch is not rendered in the header");
      if (seen.lang !== "tr") problems.push(`laptop: a Turkish browser opened the page in ${seen.lang}`);
      const looks = (where, s) => {
        if (s.labels !== "TR EN") problems.push(`${where}: the switch reads "${s.labels}"`);
        if (!s.sideBySide) problems.push(`${where}: TR and EN are not side by side`);
        if (s.pressed !== s.lang) problems.push(`${where}: the page is in ${s.lang} but "${s.pressed}" is pressed`);
        if (!s.standsOut) problems.push(`${where}: the language shown does not stand out from the other`);
      };
      looks("laptop", seen);
      await laptop.click('#languageSwitch [data-language="en"]');
      seen = await laptop.eval(read);
      if (seen.lang !== "en") problems.push(`laptop: after a click the page is in ${seen.lang}, not en`);
      if (!seen.marker) problems.push("laptop: the switch reloaded the page");
      if (seen.title !== "Letter recognition · ASL Assistant") problems.push(`laptop: the title is "${seen.title}"`);
      looks("laptop, in English", seen);
      if (seen.focused) problems.push("laptop: the switch kept focus after a mouse click");
      if (seen.saved !== "en") problems.push(`laptop: the choice was saved as ${seen.saved}`);
      const left = await laptop.eval(`(${turkishLeft})(document.querySelector(".topbar"), { rendered: true })`);
      for (const finding of left) problems.push(`laptop: Turkish left in the header: ${finding.element} ${finding.where}: ${finding.text}`);
      // A new address, so the browser loads the page again instead of only
      // moving to a fragment of the same document.
      await laptop.goto(`${ctx.origin}/?again#letter`);
      await waitForBoot(laptop, "letter");
      seen = await laptop.eval(read);
      if (seen.lang !== "en") problems.push(`laptop: after a reload the page is in ${seen.lang}; the choice was not kept`);
      await laptop.close();

      const phone = await openApp(ctx, { route: "letter", viewport: PHONE, languages: ENGLISH });
      seen = await phone.eval(read);
      if (seen.lang !== "en") problems.push(`phone: an English browser opened the page in ${seen.lang}`);
      if (seen.rendered) problems.push("phone: the switch shows outside the menu");
      await phone.click(".topbar__more");
      await phone.waitFor(`document.getElementById("moreMenu").matches(":popover-open")`, { what: "the phone menu to open" });
      seen = await phone.eval(read);
      if (!seen.rendered) problems.push("phone: the switch is not rendered in the open menu");
      looks("phone", seen);
      await phone.click('#languageSwitch [data-language="tr"]');
      seen = await phone.eval(read);
      if (seen.lang !== "tr") problems.push(`phone: after a click the page is in ${seen.lang}, not tr`);
      looks("phone, in Turkish", seen);
      if (phone.exceptions.length) problems.push(`uncaught error: ${phone.exceptions.join(" | ")}`);
      await phone.close();
      return problems;
    },
  },

  {
    name: "language-every-screen",
    summary: "an English browser meets no Turkish on any route, in the phone menu, the demo or the reference viewer, and a Turkish browser meets no English interface string there",
    timeoutMs: 120_000,
    async run(ctx) {
      const problems = [];
      // What a reader of `lang` meets that belongs to the other language, as
      // "where: text" lines. Turkish is found as the node suite finds it.
      // English is any rendered text or spoken name equal to an English
      // interface string that is not also Turkish (ASL glosses, "ASL
      // Assistant" and the switch's own "English" are both), so a key left
      // out of a redraw, or a script that writes English, shows by its text.
      const scan = (lang) => `(() => {
        const lines = [];
        const titleHolder = document.createElement("p");
        titleHolder.textContent = document.title;
        if (${JSON.stringify(lang)} === "en") {
          for (const root of [document.body, titleHolder]) {
            // The font licence's name, SIL, reads as the Turkish verb "sil".
            for (const f of (${turkishLeft})(root, { rendered: root === document.body, allow: ["· SIL OFL 1.1"] })) {
              lines.push((root === titleHolder ? "document.title" : f.element + " " + f.where) + ": " + f.text);
            }
          }
          return lines;
        }
        const plain = (value) => String(value).replace(/<[^>]*>/g, "").replace(/\\s+/g, " ").trim();
        const texts = (table) => Object.values(table).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value))).map(plain);
        const turkish = new Set(texts(I18N_STRINGS.tr));
        const english = new Set(texts(I18N_STRINGS.en).filter((text) => text.length > 1 && !text.includes("{") && !turkish.has(text)));
        const collapse = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
        const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "aria-description", "aria-valuetext"];
        if (english.has(collapse(document.title))) lines.push("document.title: " + document.title);
        const walk = (el) => {
          if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(el.tagName) || el.hasAttribute("hidden")) return;
          // A key cap names the key as printed on the keyboard ("Space") in
          // either language, so it is left out of the text compared.
          if (!el.checkVisibility() || el.classList.contains("kbd")) return;
          let own = el.textContent;
          if (el.querySelector(".kbd")) {
            const copy = el.cloneNode(true);
            for (const cap of copy.querySelectorAll(".kbd")) cap.remove();
            own = copy.textContent;
          }
          own = collapse(own);
          if (english.has(own)) {
            lines.push((el.id ? "#" + el.id : el.tagName.toLowerCase()) + " text: " + own);
            return;
          }
          for (const attribute of ATTRIBUTES) {
            const value = collapse(el.getAttribute(attribute));
            if (english.has(value)) lines.push((el.id ? "#" + el.id : el.tagName.toLowerCase()) + " " + attribute + ": " + value);
          }
          for (const child of el.children) walk(child);
        };
        walk(document.body);
        return lines;
      })()`;

      // Labels a Turkish reader must see as authored, read in each state so
      // a page that shows nothing at all cannot pass the scan above.
      const expectTurkish = async (page, label, pairs) => {
        const seen = await page.eval(`(() => {
          const out = {};
          for (const [selector, key] of ${JSON.stringify(pairs)}) {
            const el = document.querySelector(selector);
            out[selector] = { text: el ? el.textContent.replace(/\\s+/g, " ").trim() : null, want: I18N_STRINGS.tr[key] };
          }
          return out;
        })()`);
        for (const [selector, { text, want }] of Object.entries(seen)) {
          if (text !== want) problems.push(`tr ${label}: ${selector} reads "${text}", not "${want}"`);
        }
      };

      const languages = { en: ENGLISH, tr: ["tr-TR", "tr"] };
      for (const lang of /** @type {const} */ (["en", "tr"])) {
        const record = async (page, label) => {
          for (const line of await page.eval(scan(lang))) problems.push(`${lang} ${label}: ${line}`);
          if (page.exceptions.length) problems.push(`${lang} ${label}: uncaught error: ${page.exceptions.join(" | ")}`);
        };

        for (const route of ROUTES) {
          const page = await openApp(ctx, { route, viewport: LAPTOP, languages: languages[lang] });
          const htmlLang = await page.eval("document.documentElement.lang");
          if (htmlLang !== lang) problems.push(`${lang} #${route}: <html lang> is ${htmlLang}`);
          await record(page, `#${route}`);
          if (lang === "tr") {
            const title = await page.eval("document.title");
            const want = await page.eval(`I18N_STRINGS.tr["shell.route.${route}"] + " · ASL Assistant"`);
            if (title !== want) problems.push(`tr #${route}: the title is "${title}", not "${want}"`);
          }

          if (route === "letter" || route === "word") {
            // The reference panel opened, then its viewer as a modal dialog.
            await page.click("#toggleReference");
            await page.waitFor(`!document.getElementById("referenceBody").hidden`, { what: `#${route}: the reference panel to open` });
            await record(page, `#${route} reference shown`);
            if (lang === "tr") await expectTurkish(page, `#${route} reference`, [["#toggleReference", "word.reference.hide"], ["#referenceOpen", "word.reference.enlarge"]]);
            await page.click("#referenceOpen");
            await page.waitFor(`document.getElementById("lightbox").open`, { what: `#${route}: the reference viewer to open` });
            await record(page, `#${route} reference viewer`);
            await page.click("#lightboxClose");
            await page.waitFor(`!document.getElementById("lightbox").open`, { what: `#${route}: the reference viewer to close` });
          }

          if (route === "letter") {
            if (lang === "tr") await expectTurkish(page, "#letter", [["#shortcutsTitle", "letter.shortcuts.title"], ['#cameraIntro [data-trigger="demo"]', "letter.stage.watchDemo"]]);
            await page.click('#cameraIntro [data-trigger="demo"]');
            await page.waitFor(`(() => { const t = document.getElementById("demoText"); return !document.getElementById("demoPanel").hidden && t.textContent.trim() !== ""; })()`, {
              what: `${lang}: the demo's instruction`,
              timeoutMs: 10_000,
            }).catch((error) => problems.push(error.message));
            await record(page, "#letter demo");
            await page.click("#demoStop");
            await page.waitFor(`document.getElementById("demoPanel").hidden`, { what: `${lang}: the demo to stop` });
            await record(page, "#letter after the demo");
          }
          await page.close();
        }

        const phone = await openApp(ctx, { route: "letter", viewport: PHONE, languages: languages[lang] });
        await phone.click(".topbar__more");
        await phone.waitFor(`document.getElementById("moreMenu").matches(":popover-open")`, { what: `${lang}: the phone menu to open` });
        await record(phone, "phone menu");
        await phone.close();
      }
      return dedupe(problems);
    },
  },

  {
    name: "webgl-context-loss",
    summary: "hand tracking comes back, with one detection loop, after the browser drops every WebGL context MediaPipe uses",
    network: true,
    timeoutMs: 150_000,
    async run(ctx) {
      const problems = [];
      const page = await ctx.newPage({ ...PHONE, media: DEFAULT_MEDIA, grantCamera: true, allowExternal: true });
      // Every WebGL context the page creates, and every animation frame it
      // asks for, recorded before any page script runs.
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          const probe = { contexts: [], requests: 0, nativeFrame: window.requestAnimationFrame.bind(window) };
          Object.defineProperty(window, "__glProbe", { value: probe });
          for (const Canvas of [window.HTMLCanvasElement, window.OffscreenCanvas]) {
            if (!Canvas) continue;
            const getContext = Canvas.prototype.getContext;
            Canvas.prototype.getContext = function (type, ...rest) {
              const context = getContext.call(this, type, ...rest);
              if (context && /webgl/.test(type) && !probe.contexts.includes(context)) probe.contexts.push(context);
              return context;
            };
          }
          window.requestAnimationFrame = (callback) => {
            probe.requests += 1;
            return probe.nativeFrame(callback);
          };
        })()`,
      });
      await page.goto(`${ctx.origin}/#letter`);
      await waitForBoot(page, "letter");

      const tracking = `aslDebug.mediapipe.handLandmarker === true && aslDebug.mediapipe.mpRunning === true`;
      // Frames the page asks for per painted frame: the render loop plus one
      // detection loop. A second detection loop raises it by one.
      const requestsPerFrame = `(async () => {
        const probe = window.__glProbe;
        const before = probe.requests;
        let frames = 0;
        await new Promise((resolve) => {
          const started = performance.now();
          const tick = (now) => {
            frames += 1;
            if (now - started < 1500) probe.nativeFrame(tick);
            else resolve();
          };
          probe.nativeFrame(tick);
        });
        return (probe.requests - before) / frames;
      })()`;

      await page.click('[data-trigger="camera"]');
      await page.waitFor(tracking, { what: "hand tracking to start", timeoutMs: 90_000 });
      const loopsBefore = await page.eval(requestsPerFrame);

      const lost = await page.eval(`(() => {
        const probe = window.__glProbe;
        const live = probe.contexts.filter((gl) => !gl.isContextLost());
        const losers = live.map((gl) => gl.getExtension("WEBGL_lose_context")).filter(Boolean);
        probe.lostAt = probe.contexts.length;
        losers.forEach((extension) => extension.loseContext());
        return losers.length;
      })()`);
      if (lost === 0) {
        problems.push("MediaPipe opened no WebGL context to lose");
        return problems;
      }
      const lostTime = Date.now();
      try {
        await page.waitFor(`(() => {
          const probe = window.__glProbe;
          const fresh = probe.contexts.slice(probe.lostAt).some((gl) => !gl.isContextLost());
          return fresh && ${tracking};
        })()`, { what: "a new WebGL context and running hand tracking after the loss", timeoutMs: 15_000 });
      } catch (error) {
        problems.push(error.message);
        return problems;
      }
      const recoveredMs = Date.now() - lostTime;
      if (recoveredMs > 3_000) problems.push(`hand tracking took ${recoveredMs} ms to come back after the loss`);

      const published = await page.eval(`aslDebug.latestResult?.timestamp ?? 0`);
      await page.waitFor(`(aslDebug.latestResult?.timestamp ?? 0) > ${published}`, { what: "frames to be detected again after the loss" })
        .catch((error) => problems.push(error.message));
      const loopsAfter = await page.eval(requestsPerFrame);
      if (Math.abs(loopsAfter - loopsBefore) > 0.5) {
        problems.push(`${loopsBefore.toFixed(2)} animation frame requests per frame before the loss, ${loopsAfter.toFixed(2)} after it`);
      }

      await page.click("#cameraToggle");
      await page.waitFor(`!document.getElementById("cameraEmpty").hidden && aslDebug.mediapipe.mpRunning === false`, { what: "the camera to stop" });
      if (page.exceptions.length) problems.push(`uncaught error: ${page.exceptions.join(" | ")}`);
      return problems;
    },
  },

  {
    name: "route-scroll",
    summary: "a phone visitor who changes screen from a scrolled page lands at the top, with the letter stage in view",
    async run(ctx) {
      const problems = [];
      for (const viewport of [PHONE, { width: 360, height: 640, mobile: true }]) {
        const size = `${viewport.width}x${viewport.height}`;
        const page = await openApp(ctx, { route: "project", viewport });
        // Scrolled to the end directly: a synthetic touch fling keeps running
        // after the tap and would scroll the next screen, which a real tap stops.
        await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
        await page.waitFor("scrollY > 0 && Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)) < 2", {
          what: `${size}: #project to scroll to its end`,
        });
        await touchTapSelector(page, '.topbar [data-ui="mode-tab"][data-mode="letter"]');
        await waitForBoot(page, "letter");
        const after = await page.eval(`(() => ({
          scrollY: Math.round(scrollY),
          stageTop: Math.round(document.getElementById("cameraStage").getBoundingClientRect().top),
          topbarBottom: Math.round(document.querySelector(".topbar").getBoundingClientRect().bottom),
        }))()`);
        if (after.scrollY !== 0) problems.push(`${size}: #letter opens at scrollY ${after.scrollY}, not at the top`);
        if (after.stageTop < after.topbarBottom) {
          problems.push(`${size}: the stage starts at ${after.stageTop}px, under the top bar ending at ${after.topbarBottom}px`);
        }
        await page.close();
      }
      return problems;
    },
  },

  {
    name: "coach-sheet-tap",
    summary: "a tap beside the open coach sheet only closes it, and a laptop-wide window left with the sheet open still takes clicks",
    async run(ctx) {
      const problems = [];
      const wordTab = '.topbar [data-ui="mode-tab"][data-mode="word"]';
      const modeOf = (page) => page.eval(`document.querySelector('[data-ui="app-shell"]').dataset.mode`);
      const sheetOpen = (page) => page.eval(`document.getElementById("coachStudy").dataset.open === "true"`);
      // A fresh #coach page with the sheet open, as a visitor opens it.
      const withSheet = async () => {
        const page = await openApp(ctx, { route: "coach", viewport: PHONE });
        await touchTapSelector(page, "#coachSessionButton");
        await page.waitFor(`document.getElementById("coachStudy").dataset.open === "true"`, { what: "the coach sheet to open" });
        return page;
      };
      // Whether a tap at the element's centre lands on it: true for a target in
      // the dimmed band above the sheet, where a visitor taps to close it.
      const reachable = (page, selector) => page.eval(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.checkVisibility());
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })()`);

      let page = await withSheet();
      if (!(await reachable(page, wordTab))) throw new Error("precondition: the word tab is not in the dimmed band");
      await touchTapSelector(page, wordTab);
      if (await sheetOpen(page)) problems.push("a tap on the dimmed word tab left the sheet open");
      const mode = await modeOf(page);
      if (mode !== "coach") problems.push(`a tap meant to close the sheet switched to #${mode}`);
      await page.close();

      page = await withSheet();
      if (!(await reachable(page, "#coachReference"))) throw new Error("precondition: the target tile is not in the dimmed band");
      await touchTapSelector(page, "#coachReference");
      if (await sheetOpen(page)) problems.push("a tap on the dimmed target tile left the sheet open");
      if (await page.eval(`document.querySelector("dialog[open]") !== null`)) {
        problems.push("a tap meant to close the sheet opened the reference viewer");
      }
      await page.close();

      // A window widened past the sheet layout while the sheet was open.
      page = await withSheet();
      await page.setViewport(LAPTOP);
      await page.click(wordTab);
      await page.waitFor(`document.querySelector('[data-ui="app-shell"]').dataset.mode === "word"`, {
        what: "a laptop click on the word tab to switch mode",
        timeoutMs: 2000,
      }).catch(() => problems.push("at laptop width the first click after the sheet was left open was swallowed"));
      await page.close();
      return problems;
    },
  },

  {
    name: "menu-fallback-dismiss",
    summary: "without the Popover API (Safari before 17) the phone menu closes on a tap outside it and on a screen change",
    async run(ctx) {
      const problems = [];
      const menuShown = (page) => page.eval(`document.getElementById("moreMenu").checkVisibility()`);
      // A menu the last step failed to close is left as it is.
      const openMenu = async (page) => {
        if (!(await menuShown(page))) await touchTapSelector(page, ".topbar__more");
        await page.waitFor(`document.getElementById("moreMenu").checkVisibility()`, { what: "the fallback menu to open" });
      };
      const page = await ctx.newPage({ ...PHONE, media: DEFAULT_MEDIA });
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: "for (const name of ['showPopover', 'hidePopover', 'togglePopover']) delete HTMLElement.prototype[name];",
      });
      await page.goto(`${ctx.origin}/#letter`);
      await waitForBoot(page, "letter");
      if (await page.eval(`typeof HTMLElement.prototype.showPopover === "function"`)) {
        throw new Error("precondition: the Popover API is still there");
      }

      await openMenu(page);
      await touchTapPoint(page, PHONE.width / 2, 500);
      if (await menuShown(page)) problems.push("a tap on the stage left the menu open");

      await openMenu(page);
      await touchTapSelector(page, '.topbar [data-ui="mode-tab"][data-mode="coach"]');
      await waitForBoot(page, "coach");
      if (await menuShown(page)) problems.push("the menu stayed open over #coach after a tab change");

      await openMenu(page);
      await page.eval(`location.hash = "#word"`);
      await waitForBoot(page, "word");
      if (await menuShown(page)) problems.push("the menu stayed open over #word after a hash change");
      await page.close();
      return problems;
    },
  },

  {
    name: "model-test-row-labels",
    summary: "on a phone, the labels in front of a Model Test row's expected and predicted values are in the page's language, after a switch too",
    async run(ctx) {
      const problems = [];
      const labels = `(() => {
        const row = document.querySelector("#modelTestRows tr");
        if (!row) return null;
        const before = (index) => getComputedStyle(row.children[index], "::before").content;
        return { expected: before(1), prediction: before(2) };
      })()`;
      const want = (lang) => `({ expected: JSON.stringify(I18N_STRINGS.${lang}["info.test.result.expected"] + " "), prediction: JSON.stringify(I18N_STRINGS.${lang}["info.test.result.prediction"] + " ") })`;
      const compare = async (page, lang, when) => {
        const [shown, expected] = [await page.eval(labels), await page.eval(want(lang))];
        if (!shown) return problems.push(`${when}: no result row was drawn`);
        for (const key of ["expected", "prediction"]) {
          if (shown[key] !== expected[key]) problems.push(`${when}: the ${key} label reads ${shown[key]}, not ${expected[key]}`);
        }
      };
      for (const [lang, languages, other] of [["en", ENGLISH, "tr"], ["tr", ["tr-TR", "tr"], "en"]]) {
        const page = await openApp(ctx, { route: "test", viewport: PHONE, languages });
        await page.eval(`(() => {
          state.modelTestBatch = { task: "letter", rows: [{ title: "A", expected: "A", predicted: "B", confidence: 0.4, ms: 12, verdict: "wrong" }] };
          renderModelTestBatch();
        })()`);
        await compare(page, lang, `${lang} phone`);
        await page.eval(`setLanguage(${JSON.stringify(other)})`);
        await compare(page, other, `${lang} phone switched to ${other}`);
        await page.close();
      }
      return problems;
    },
  },
];

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * One finger tap at a point, as a phone sends it, so the browser's own hit
 * test decides what is pressed. Resolves once the tap's click has been
 * dispatched, even if a listener stops it.
 */
async function touchTapPoint(page, x, y) {
  const before = await page.eval(`(() => {
    if (!window.__touchClicks) {
      window.__touchClicks = { count: 0 };
      window.addEventListener("click", () => { window.__touchClicks.count += 1; }, true);
    }
    return window.__touchClicks.count;
  })()`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitFor(`window.__touchClicks.count > ${before}`, { what: `the tap at ${Math.round(x)},${Math.round(y)} to click` });
}

/** Tap the centre of the first rendered element matching `selector`, where it is now. */
async function touchTapSelector(page, selector) {
  const point = await page.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.checkVisibility());
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error(`tap: nothing rendered matches ${selector}`);
  await touchTapPoint(page, point.x, point.y);
}
