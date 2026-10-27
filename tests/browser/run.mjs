// Run the browser checks in a headless Chrome against a local copy of asl-web.
//
//   node tests/browser/run.mjs [--offline] [--lang tr|en] [--only name[,name]] [--list]
//
// Exit codes follow the project's contract:
//   0  every check that ran passed
//   1  a check failed
//   2  the checks could not run: a usage error, or no Chrome to run them in
//
// A missing Chrome is never a pass. The run starts its own server and its own
// Chrome on ports the OS picks, and stops both on every way out: success,
// failure, an exception, and Ctrl+C.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { CHECKS } from "./checks.mjs";
import { Browser, launchChrome, withTimeout } from "./cdp.mjs";
import { startServer } from "./serve.mjs";

const USAGE = `usage: node tests/browser/run.mjs [--offline] [--lang tr|en] [--only name[,name]] [--list]

  --offline   skip the checks that load MediaPipe, ONNX Runtime or kjua from
              their CDNs (the camera, the demo read by the real letter model,
              and the QR code drawn by kjua);
              every other check runs offline
  --lang      the browser language every page opens with: tr (the default)
              or en; a check that needs a language of its own still sets it
  --only      run only the named checks (repeatable or comma-separated)
  --list      print the checks and exit

Chrome is found through the CHROME environment variable, then the standard
install locations.`;

const DEFAULT_TIMEOUT_MS = 30_000;

/** The browser languages a page opens with under each --lang value. */
const RUN_LANGUAGES = { tr: ["tr-TR", "tr"], en: ["en-US", "en"] };

/** @returns {{ offline: boolean, lang: "tr" | "en", only: string[] | null, list: boolean } | string} */
function parseArgs(argv) {
  /** @type {{ offline: boolean, lang: "tr" | "en", only: string[] | null, list: boolean }} */
  const options = { offline: false, lang: "tr", only: null, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--offline") options.offline = true;
    else if (arg === "--lang" || arg.startsWith("--lang=")) {
      const value = arg === "--lang" ? argv[++i] : arg.slice("--lang=".length);
      if (value !== "tr" && value !== "en") return "--lang needs tr or en";
      options.lang = value;
    }
    else if (arg === "--list") options.list = true;
    else if (arg === "--help" || arg === "-h") return "help";
    else if (arg === "--only" || arg.startsWith("--only=")) {
      const value = arg === "--only" ? argv[++i] : arg.slice("--only=".length);
      if (!value) return "--only needs a check name";
      options.only = [...(options.only || []), ...value.split(",").filter(Boolean)];
    } else return `unknown argument: ${arg}`;
  }
  return options;
}

/** Locate a Chrome or Chromium binary, or return null. */
function findChrome() {
  const fromEnv = process.env.CHROME;
  if (fromEnv) return { path: existsSync(fromEnv) ? fromEnv : null, fromEnv };

  const candidates = [];
  if (process.platform === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Chromium.app/Contents/MacOS/Chromium",
      "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ];
    for (const base of ["/Applications", join(process.env.HOME || "", "Applications")]) {
      for (const app of apps) candidates.push(join(base, app));
    }
  } else if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else {
    const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
      for (const name of names) candidates.push(join(dir, name));
    }
  }
  return { path: candidates.find((candidate) => existsSync(candidate)) || null, fromEnv: null };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === "help") {
    console.log(USAGE);
    return 0;
  }
  if (typeof options === "string") {
    console.error(`${options}\n\n${USAGE}`);
    return 2;
  }
  if (options.list) {
    for (const check of CHECKS) console.log(`${check.name.padEnd(18)} ${check.network ? "[CDN] " : ""}${check.summary}`);
    return 0;
  }

  const known = new Set(CHECKS.map((check) => check.name));
  const unknown = (options.only || []).filter((name) => !known.has(name));
  if (unknown.length) {
    console.error(`unknown check: ${unknown.join(", ")}; --list shows them`);
    return 2;
  }
  const selected = CHECKS.filter((check) => !options.only || options.only.includes(check.name));

  const chrome = findChrome();
  if (!chrome.path) {
    const where = chrome.fromEnv ? `CHROME=${chrome.fromEnv} does not exist` : "set CHROME to a Chrome or Chromium binary";
    console.error(`Chrome not found: ${where}. The browser checks did not run.`);
    return 2;
  }

  const started = Date.now();
  let server = null;
  let browserProcess = null;
  let browser = null;

  // Stopping is idempotent and runs on every way out of the process.
  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      await browser?.close();
      await browserProcess?.close();
      await server?.close();
    })();
    return stopping;
  };
  const onSignal = (signal, code) => {
    console.error(`\n${signal}: stopping Chrome and the server`);
    stop().finally(() => process.exit(code));
  };
  process.once("SIGINT", () => onSignal("SIGINT", 130));
  process.once("SIGTERM", () => onSignal("SIGTERM", 143));
  process.once("SIGHUP", () => onSignal("SIGHUP", 129));
  // Last resort if the process leaves without passing through stop().
  process.once("exit", () => browserProcess?.killNow());

  try {
    server = await startServer();
    try {
      browserProcess = await launchChrome({
        executable: chrome.path,
        // Every page also sets its languages (cdp.mjs); the flag makes the
        // browser itself Turkish too, so nothing falls back to the host's.
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--lang=tr-TR"],
      });
    } catch (error) {
      console.error(`Chrome at ${chrome.path} could not start: ${error.message}`);
      return 2;
    }
    browser = await Browser.connect(browserProcess.wsUrl);
    console.log(`Serving asl-web at ${server.origin}; Chrome ${chrome.path}; pages in ${options.lang}`);

    let failed = 0;
    let passed = 0;
    let skipped = 0;
    for (const check of selected) {
      if (check.network && options.offline) {
        skipped += 1;
        console.log(`SKIP  ${check.name}  (--offline: it loads a runtime from its CDN)`);
        continue;
      }
      const pages = [];
      const ctx = {
        origin: server.origin,
        offline: options.offline,
        lang: options.lang,
        newPage: async (pageOptions) => {
          const page = await browser.newPage({ origin: server.origin, languages: RUN_LANGUAGES[options.lang], ...pageOptions });
          pages.push(page);
          return page;
        },
      };
      const checkStarted = Date.now();
      let problems;
      try {
        const timeoutMs = check.timeoutMs || DEFAULT_TIMEOUT_MS;
        problems = await withTimeout(check.run(ctx), timeoutMs, `the ${check.name} check did not finish`);
      } catch (error) {
        problems = [`the check could not complete: ${error.message}`];
      } finally {
        await Promise.all(pages.map((page) => page.close()));
      }
      const elapsed = `${Date.now() - checkStarted} ms`;
      if (problems.length === 0) {
        passed += 1;
        console.log(`PASS  ${check.name}  (${elapsed})`);
      } else {
        failed += 1;
        console.log(`FAIL  ${check.name}  (${elapsed})`);
        for (const problem of problems) console.log(`      - ${problem}`);
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${passed} passed, ${failed} failed, ${skipped} skipped in ${seconds} s`);
    return failed ? 1 : 0;
  } finally {
    await stop();
  }
}

process.exitCode = await main();
