// ONNX Runtime Web as a boundary fake for the Model Test tests.
//
// ORT is the one thing here that is not the app's: it is fetched from a CDN and
// runs a model the test cannot choose the answer of. The fake hands out
// sessions in the shapes the published graphs have (a probability tensor for
// letters, logits for words), answers the class the test picks, and lets the
// test hold a session's creation back or fail it. It is installed inside the
// app's own realm, so the arrays it returns are the app's own types, as in a
// browser.
//
// Everything the test can steer or read hangs off `__ort`:
//   answer(input, n)  class index for the n-th real run (warm-ups are not counted)
//   letterProbabilities(index)
//                     the letter session's probability output for that class;
//                     by default a tensor whose Float32Array(24) favours it
//   runs              real runs so far
//   created           sessions created so far
//   feeds             every run's feeds, warm-ups included
//   wasmPaths         ort.env.wasm.wasmPaths as each session creation saw it
//   fail              creating a session throws
//   failRun(n)        the n-th real run throws
//   createMs, runMs   how far the fake clock moves per creation and per run
//                     (runMs may be a function of the run's number)
//   hold() / release() hold session creation back until released
//
// A run whose input is all zeros is a warm-up: the app runs one on a fresh
// session, and it is neither counted nor answered with `answer`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WEB_DIR, loadWebApp } from "./web-app-context.mjs";

export const FAKE_ORT_SOURCE = `
  globalThis.__ort = {
    chosen: 0,
    answer: (input, n) => __ort.chosen,
    letterProbabilities: (index) => {
      const probabilities = new Float32Array(24).fill(0.1 / 23);
      probabilities[index] = 0.9;
      return { data: probabilities };
    },
    runs: 0,
    created: 0,
    fail: false,
    failRun: () => false,
    feeds: [],
    wasmPaths: [],
    createMs: 0,
    runMs: 0,
    gate: null,
    release: () => {},
    hold() {
      this.gate = new Promise((resolve) => { this.release = resolve; });
    },
    runGate: null,
    releaseRuns: () => {},
    holdRuns() {
      this.runGate = new Promise((resolve) => { this.releaseRuns = resolve; });
    },
  };
  const __advance = (ms) => { if (ms && typeof globalThis.__advanceClock === "function") globalThis.__advanceClock(ms); };
  const __classAndWarmup = async (feeds) => {
    __ort.feeds.push(feeds);
    const input = feeds.input;
    const warmup = input.data.every((value) => value === 0);
    if (warmup) return { index: __ort.chosen, warmup };
    __ort.runs += 1;
    if (__ort.runGate) await __ort.runGate;
    if (__ort.failRun(__ort.runs)) throw new Error("the model run failed in the test");
    __advance(typeof __ort.runMs === "function" ? __ort.runMs(__ort.runs) : __ort.runMs);
    return { index: __ort.answer(input.data, __ort.runs), warmup };
  };
  globalThis.ort = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
    InferenceSession: {
      create: async (model) => {
        // ORT reads where its WASM files live when it creates a session.
        __ort.wasmPaths.push(globalThis.ort.env.wasm.wasmPaths);
        if (__ort.gate) await __ort.gate;
        if (__ort.fail) throw new Error("no model in the test");
        __ort.created += 1;
        __advance(__ort.createMs);
        return String(model).includes("word") ? __wordSession : __letterSession;
      },
    },
  };
  globalThis.__letterSession = {
    inputNames: ["input"],
    outputNames: ["label", "probabilities"],
    run: async (feeds) => {
      const { index } = await __classAndWarmup(feeds);
      return { label: { data: new BigInt64Array([BigInt(index)]) }, probabilities: __ort.letterProbabilities(index) };
    },
  };
  globalThis.__wordSession = {
    inputNames: ["input", "mask"],
    outputNames: ["logits"],
    run: async (feeds) => {
      const { index } = await __classAndWarmup(feeds);
      const logits = new Float32Array(50);
      logits[index] = 12;
      return { logits: { data: logits } };
    },
  };
`;

const readJson = (path) => JSON.parse(readFileSync(join(WEB_DIR, path), "utf8"));

/** Letter labels in model output order, from the deployed label map. */
export const LETTER_LABELS = Object.entries(readJson("data/letter_labels.json"))
  .sort(([, a], [, b]) => a - b)
  .map(([letter]) => letter);

/** Word label to model output index, from the deployed label map. */
export const WORD_INDEX = readJson("data/word_labels.json");

const quietConsole = { ...console, log() {}, warn() {}, info() {}, error() {} };

/**
 * A clock the test advances by hand. The app reads it as `performance.now()`;
 * the fake ORT moves it by `createMs` and `runMs`.
 */
export function fakeClock() {
  const clock = { now: 0 };
  return {
    clock,
    globals: {
      performance: { now: () => clock.now },
      __advanceClock: (ms) => {
        clock.now += ms;
      },
    },
  };
}

/**
 * The app with the fake ONNX Runtime installed.
 *
 * Not booted unless asked to: a Model Test run must work from the module's own
 * entry points, and an unbooted app makes no requests of its own, so a test
 * sees exactly the ones the run makes.
 *
 * @param {{boot?: boolean, globals?: Record<string, unknown>}} [options]
 */
export async function appWithFakeOrt({ boot = false, globals = {} } = {}) {
  const app = loadWebApp({ boot, globals: { console: quietConsole, ...globals } });
  if (app.ready) await app.ready;
  app.evaluate(FAKE_ORT_SOURCE);
  return app;
}

/**
 * Put a wrapper in front of the app's fetch. `route(path, passthrough)` gets
 * the request path as the app wrote it and the unwrapped fetch; return a
 * Response-like object to answer it, or undefined to let it through.
 *
 * @param {ReturnType<typeof loadWebApp>} app
 * @param {(path: string, passthrough: () => Promise<unknown>) => unknown} route
 */
export function routeFetch(app, route) {
  const disk = app.get("fetch");
  const wrapped = (input, init) => {
    const answer = route(String(input), () => disk(input, init));
    return answer === undefined ? disk(input, init) : Promise.resolve(answer);
  };
  app.get("globalThis").fetch = wrapped;
}

/** A fetch Response for JSON the test made up. */
export const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
