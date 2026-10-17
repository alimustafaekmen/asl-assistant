// A minimal Chrome DevTools Protocol client for the browser checks.
//
// It needs nothing but Node: the WebSocket is the one built into Node 22 and
// later, and Chrome is started as a child process with a throwaway profile.
// The checks drive the page only through the protocol, so the app runs exactly
// as a visitor's browser runs it, with real layout, real CSS and real media.
//
// Every wait here is a condition with a deadline. A fixed sleep is either too
// short on a slow machine or wasted time on a fast one, and a wait that runs
// out says what it was waiting for instead of letting the next step fail on a
// half-loaded page.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** Resolve after `ms`; used only between polls of a condition. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Race `promise` against a deadline that rejects with `message`.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} (timed out after ${ms} ms)`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Start a headless Chrome with its own profile on a port the OS picks.
 *
 * The profile is a fresh temporary directory, so the user's own browser, its
 * cookies and its cache are never touched, and two runs never share state.
 * `--remote-debugging-port=0` lets Chrome choose a free port and write it to
 * DevToolsActivePort in the profile, which avoids both a fixed port and the
 * race of probing for one.
 *
 * Chrome gets no pipe back to this process. Its crash handler, and the
 * system updater branded Chrome wakes about 20 s after start, leave Chrome's
 * process group and outlive it; holding an inherited pipe, they would keep the
 * run from exiting for minutes after every check has finished. Chrome's stderr
 * goes to a file in the profile instead, read only when the start fails.
 *
 * @param {{ executable: string, args?: string[], startTimeoutMs?: number }} options
 * @returns {Promise<{ wsUrl: string, close: () => Promise<void>, killNow: () => void }>}
 */
export async function launchChrome({ executable, args = [], startTimeoutMs = 20_000 }) {
  const profileDir = mkdtempSync(join(tmpdir(), "asl-browser-check-"));
  const logPath = join(profileDir, "chrome-stderr.log");
  const logFd = openSync(logPath, "w");
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "--disable-default-apps",
      "--mute-audio",
      // Only one page is open at a time, but a page Chrome treats as a
      // background tab gets throttled timers and no animation frames.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...args,
      "about:blank",
    ],
    {
      // Its own process group, so one signal reaches the renderer and GPU
      // helpers too, not only the browser process.
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", logFd],
      // Chromium's switch for automated runs: among other things the crash
      // handler then exits with the browser instead of lingering.
      env: { ...process.env, CHROME_HEADLESS: "1" },
    },
  );
  closeSync(logFd);

  let exited = false;
  let exitCode = null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code ?? signal;
  });
  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error;
    exited = true;
  });

  const killNow = () => {
    if (!exited && child.pid) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A helper still holds a file in it; the OS temp cleaner takes it later.
    }
  };

  const close = async () => {
    if (!exited && child.pid) {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
      const gone = new Promise((resolve) => child.once("exit", resolve));
      await withTimeout(gone, 3_000, "Chrome did not exit").catch(() => {});
    }
    killNow();
  };

  const portFile = join(profileDir, "DevToolsActivePort");
  const started = Date.now();
  while (!existsSync(portFile)) {
    if (exited || Date.now() - started > startTimeoutMs) {
      const log = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
      const reason = spawnError
        ? spawnError.message
        : exited
          ? `it exited with ${exitCode} before it opened DevTools`
          : `it opened no DevTools port within ${startTimeoutMs} ms`;
      await close();
      throw new Error(`${reason}${log ? `:\n${log}` : ""}`);
    }
    await pause(25);
  }
  // Chrome writes the port line, then the path line; wait for both.
  let lines = readFileSync(portFile, "utf8").split("\n");
  while (!lines[1]) {
    if (Date.now() - started > startTimeoutMs) {
      await close();
      throw new Error("DevToolsActivePort stayed incomplete");
    }
    await pause(25);
    lines = readFileSync(portFile, "utf8").split("\n");
  }
  return { wsUrl: `ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`, close, killNow };
}

/** One WebSocket to the browser; pages are flattened sessions on it. */
export class Browser {
  /**
   * @param {string} wsUrl The browser's webSocketDebuggerUrl.
   * @returns {Promise<Browser>}
   */
  static async connect(wsUrl) {
    const browser = new Browser();
    browser.ws = new WebSocket(wsUrl);
    await withTimeout(
      new Promise((resolve, reject) => {
        browser.ws.onopen = resolve;
        browser.ws.onerror = () => reject(new Error(`cannot open ${wsUrl}`));
      }),
      10_000,
      "the DevTools WebSocket did not open",
    );
    browser.ws.onmessage = (event) => browser._dispatch(JSON.parse(String(event.data)));
    browser.ws.onclose = () => {
      for (const { reject } of browser.pending.values()) reject(new Error("the browser connection closed"));
      browser.pending.clear();
    };
    return browser;
  }

  constructor() {
    this.nextId = 1;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pending = new Map();
    /** @type {Set<(message: any) => void>} */
    this.listeners = new Set();
  }

  _dispatch(message) {
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} ${message.error.data || ""}`.trim()));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  /**
   * Send one protocol command and wait for its reply.
   *
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    const reply = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify(payload));
    return withTimeout(reply, DEFAULT_COMMAND_TIMEOUT_MS, `no reply to ${method}`).finally(() =>
      this.pending.delete(id),
    );
  }

  /** Subscribe to protocol events; returns the unsubscribe function. */
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Open a page in a fresh browser context: its own storage, cache and
   * permissions, so no check sees what an earlier one left behind.
   *
   * @param {PageOptions} options
   * @returns {Promise<Page>}
   */
  async newPage(options) {
    const { browserContextId } = await this.send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, { sessionId, targetId, browserContextId });
    await page._init(options);
    return page;
  }

  /** Ask Chrome to quit, then drop the connection. */
  async close() {
    if (this.ws.readyState === WebSocket.OPEN) {
      await withTimeout(this.send("Browser.close"), 3_000, "Chrome did not acknowledge Browser.close").catch(() => {});
    }
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * @typedef {object} PageOptions
 * @property {string} origin The served app's origin. Required: permissions and
 *   the network policy are scoped to it, and a default port would silently
 *   point at whatever else is listening there.
 * @property {number} [width]
 * @property {number} [height]
 * @property {boolean} [mobile]
 * @property {boolean} [allowExternal] Let the page reach other origins (the
 *   CDNs). Off by default: such requests are refused and recorded.
 * @property {boolean} [grantCamera] Grant the camera permission for the origin.
 * @property {Array<{name: string, value: string}>} [media] Emulated media features.
 */

// Installed before any page script runs. It records what the page itself
// cannot report back once it has gone wrong: every CSP violation, including
// those a Report-Only policy only logs, and every media stream handed out, so
// a check can count live tracks even after the app has dropped its reference.
const PAGE_PROBE = `(() => {
  const probe = { csp: [], streams: [] };
  Object.defineProperty(window, "__browserCheck", { value: probe });
  document.addEventListener("securitypolicyviolation", (event) => {
    probe.csp.push({
      directive: event.effectiveDirective || event.violatedDirective,
      blocked: event.blockedURI,
      disposition: event.disposition,
      source: event.sourceFile ? event.sourceFile + ":" + event.lineNumber : "",
    });
  });
  const media = navigator.mediaDevices;
  if (media && typeof media.getUserMedia === "function") {
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (...args) => {
      const stream = await original(...args);
      probe.streams.push(stream);
      return stream;
    };
  }
})();`;

export class Page {
  constructor(browser, { sessionId, targetId, browserContextId }) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.browserContextId = browserContextId;
    /** Uncaught exceptions and unhandled rejections, as Chrome reports them. */
    this.exceptions = [];
    /** console.error calls, kept for diagnosis. */
    this.consoleErrors = [];
    /** Same-origin subresources that failed or answered with an error status. */
    this.failedResources = [];
    /** Requests to other origins that were refused. */
    this.blockedRequests = [];
    this._loadWaiters = new Set();
    this._requestTypes = new Map();
    this._inflight = new Set();
    this._lastNetworkActivity = Date.now();
    this.off = browser.on((message) => {
      if (message.sessionId === sessionId) this._onEvent(message);
    });
  }

  _onEvent({ method, params }) {
    switch (method) {
      case "Runtime.exceptionThrown": {
        const details = params.exceptionDetails;
        this.exceptions.push(details.exception?.description || details.text);
        break;
      }
      case "Runtime.consoleAPICalled":
        if (params.type === "error") {
          this.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
        }
        break;
      case "Network.requestWillBeSent":
        this._requestTypes.set(params.requestId, { url: params.request.url, type: params.type });
        if (!params.request.url.startsWith("data:")) this._inflight.add(params.requestId);
        this._lastNetworkActivity = Date.now();
        break;
      case "Network.loadingFinished":
        this._inflight.delete(params.requestId);
        this._lastNetworkActivity = Date.now();
        break;
      case "Network.responseReceived": {
        const { url, status } = params.response;
        // An error body the page never reads never finishes loading, so the
        // request is settled once its status is known.
        if (status >= 400) this._inflight.delete(params.requestId);
        if (status >= 400 && this._sameOrigin(url)) {
          this.failedResources.push({ url, type: params.type, reason: `HTTP ${status}` });
        }
        break;
      }
      case "Network.loadingFailed": {
        this._inflight.delete(params.requestId);
        this._lastNetworkActivity = Date.now();
        const request = this._requestTypes.get(params.requestId);
        if (request && this._sameOrigin(request.url) && !params.canceled) {
          this.failedResources.push({ url: request.url, type: params.type, reason: params.errorText });
        }
        break;
      }
      case "Fetch.requestPaused":
        this._onRequestPaused(params);
        break;
      case "Page.loadEventFired":
        for (const resolve of this._loadWaiters) resolve();
        this._loadWaiters.clear();
        break;
      default:
    }
  }

  _sameOrigin(url) {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  _onRequestPaused({ requestId, request }) {
    const url = request.url;
    const local = this._sameOrigin(url) || url.startsWith("data:") || url.startsWith("blob:");
    if (local) {
      this.send("Fetch.continueRequest", { requestId }).catch(() => {});
    } else {
      this.blockedRequests.push(url);
      this.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
  }

  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }

  async _init(options) {
    if (!options || !options.origin) throw new Error("newPage needs the served origin");
    this.origin = new URL(options.origin).origin;
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_PROBE });
    await this.setViewport(options);
    if (options.media) await this.send("Emulation.setEmulatedMedia", { features: options.media });
    if (options.grantCamera) {
      await this.browser.send("Browser.setPermission", {
        permission: { name: "camera" },
        setting: "granted",
        origin: this.origin,
        browserContextId: this.browserContextId,
      });
    }
    if (!options.allowExternal) {
      await this.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    }
  }

  /** @param {{width?: number, height?: number, mobile?: boolean}} viewport */
  async setViewport({ width = 1366, height = 768, mobile = false } = {}) {
    this.viewport = { width, height, mobile };
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  /** @param {Array<{name: string, value: string}>} features */
  async emulateMedia(features) {
    await this.send("Emulation.setEmulatedMedia", { features });
  }

  /**
   * Navigate and wait for the load event.
   *
   * @param {string} url
   * @param {number} [timeoutMs]
   */
  async goto(url, timeoutMs = 15_000) {
    const loaded = new Promise((resolve) => this._loadWaiters.add(resolve));
    const result = await this.send("Page.navigate", { url });
    if (result.errorText) throw new Error(`navigation to ${url} failed: ${result.errorText}`);
    await withTimeout(loaded, timeoutMs, `${url} did not fire its load event`);
  }

  /**
   * Evaluate an expression in the page and return its value.
   *
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async eval(expression) {
    const reply = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (reply.exceptionDetails) {
      const details = reply.exceptionDetails;
      throw new Error(`page evaluation threw: ${details.exception?.description || details.text}`);
    }
    return reply.result.value;
  }

  /**
   * Poll `expression` until it is truthy; throw naming `what` if it never is.
   *
   * @param {string} expression
   * @param {{ what: string, timeoutMs?: number, intervalMs?: number }} options
   * @returns {Promise<any>} The truthy value.
   */
  async waitFor(expression, { what, timeoutMs = 10_000, intervalMs = 25 }) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await this.eval(expression);
        if (value) return value;
        lastError = null;
      } catch (error) {
        lastError = error;
      }
      await pause(intervalMs);
    }
    const reason = lastError ? `; last error: ${lastError.message}` : "";
    throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${reason}`);
  }

  /**
   * Wait until no request has been in flight for `quietMs`.
   *
   * The app keeps fetching after its first render (gating data, the Model
   * Test manifest); a check that reads the page before those settle can miss
   * an error they raise.
   *
   * @param {{ quietMs?: number, timeoutMs?: number }} [options]
   */
  async waitForNetworkIdle({ quietMs = 100, timeoutMs = 10_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this._inflight.size === 0 && Date.now() - this._lastNetworkActivity >= quietMs) return;
      await pause(20);
    }
    const pending = [...this._inflight].map((id) => this._requestTypes.get(id)?.url || id);
    throw new Error(`the network did not settle within ${timeoutMs} ms; still loading: ${pending.join(", ")}`);
  }

  /** Click the centre of the element through real mouse events. */
  async click(selector) {
    const point = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { hidden: true };
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`click: no element matches ${selector}`);
    if (point.hidden) throw new Error(`click: ${selector} is not rendered`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
  }

  async close() {
    this.off();
    try {
      await this.browser.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      // Already closed.
    }
    try {
      await this.browser.send("Target.disposeBrowserContext", { browserContextId: this.browserContextId });
    } catch {
      // Disposed with the target.
    }
  }
}
