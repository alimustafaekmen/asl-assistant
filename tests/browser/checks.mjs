// The browser checks: facts only a real browser can decide.
//
// The node suite in tests/web stubs the DOM; it has no cascade, no layout and
// no media. Everything here is decided by CSS or by the browser itself: which
// rule wins, whether an element is rendered, whether the page scrolls
// sideways, whether a camera track is still live. Each check reads computed
// style, layout boxes or the CSSOM, never the source text, so a harmless move
// of a rule from one file to another changes nothing here.
//
// Each check's summary names what it guards; tests/browser/README.md describes
// every check.

/** The camera modes; each has its own controls, tagged `<mode>-only`. */
export const CAMERA_MODES = ["letter", "word", "coach"];

/** Every route the app has; an unknown hash falls back to letter. */
export const ROUTES = [...CAMERA_MODES, "test", "project", "qr"];

/**
 * The cascade layers, lowest first. The first declaration of the order wins,
 * so it must come from the first stylesheet; a layer named anywhere else
 * that is not in this list lands above all of them.
 */
export const LAYER_ORDER = ["legacy", "tokens", "base", "components", "layout", "screens", "utilities"];

// A host in dark mode would otherwise turn every fresh page dark, because the
// app follows the system preference when nothing is stored.
const DEFAULT_MEDIA = [
  { name: "prefers-color-scheme", value: "light" },
  { name: "prefers-reduced-motion", value: "no-preference" },
];

const LAPTOP = { width: 1366, height: 768, mobile: false };

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
  const removeLegacyLayer = () => {
    const sheet = document.styleSheets[0];
    const rules = sheet ? [...sheet.cssRules] : [];
    const index = rules.findIndex((rule) => rule instanceof CSSLayerBlockRule && rule.name === "legacy");
    if (index < 0) throw new Error("the first stylesheet has no legacy layer block to remove");
    sheet.deleteRule(index);
  };
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

/** @typedef {{ origin: string, offline: boolean, newPage: (options: object) => Promise<any> }} CheckContext */

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {string} summary What it asserts, in one line.
 * @property {boolean} [network] Starts the camera and loads MediaPipe and ORT
 *   from their CDNs; skipped with --offline.
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
    summary: "an element with [hidden] is never rendered, the toast included, and the new layers keep that on their own",
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
      // base.css keeps its own [hidden] rule so it survives the legacy
      // layer's removal; while that layer exists, it hides the fault.
      await page.eval(`(() => { ${IN_PAGE} removeLegacyLayer(); })()`);
      problems.push(...(await page.eval(inspect("without the legacy layer"))));
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
    name: "style-link",
    summary: "css/style.css is linked, loaded, enabled and first in the cascade",
    async run(ctx) {
      const page = await openApp(ctx, { route: "letter" });
      const problems = await page.eval(`(() => {
        // The path, not the whole URL: a cache tag such as ?v=11 still links the same file.
        const target = new URL("css/style.css", document.baseURI).pathname;
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(
          (link) => new URL(link.href).pathname === target,
        );
        if (links.length !== 1) return ["css/style.css is linked " + links.length + " times; expected once"];
        const [link] = links;
        const problems = [];
        if (!link.sheet) problems.push("css/style.css did not load");
        else {
          if (link.sheet.disabled) problems.push("css/style.css is disabled");
          if (link.sheet.cssRules.length < 2) problems.push("css/style.css loaded with " + link.sheet.cssRules.length + " rules");
          if (document.styleSheets[0] !== link.sheet) problems.push("css/style.css is not the first stylesheet, so it cannot set the layer order");
          if (!matchMedia(link.media || "all").matches) problems.push("css/style.css has a media query that does not match: " + link.media);
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
    summary: "with prefers-reduced-motion: reduce no element animates or transitions, with or without the legacy layer",
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
      await page.eval(`(() => { ${IN_PAGE} removeLegacyLayer(); })()`);
      const alone = await page.eval(longest);
      if (alone.seconds > 0.001) problems.push(`without the legacy layer: a ${alone.seconds}s ${alone.what} under reduced motion`);
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
];

function dedupe(list) {
  return [...new Set(list)];
}
