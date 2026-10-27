// The letter model downloads gzipped and falls back to the raw file.
//
// The static host serves .onnx uncompressed, so the raw 12.6 MB file is about
// six times the download of its gzipped copy. The loader fetches the .gz, checks it
// really is gzip, decompresses it, and hands ONNX Runtime the bytes. Anything
// that fails on that path must still end in a session, built from the raw file
// that is always deployed beside it. ONNX Runtime is replaced by a recorder:
// which model it was handed is the whole question here. Real decompression runs
// on the host's own DecompressionStream.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { loadWebApp } from "./helpers/web-app-context.mjs";

const MODEL = new TextEncoder().encode("stand-in onnx bytes ".repeat(200));

/**
 * The app with a recording ONNX Runtime and a fetch that serves `gz` for the
 * compressed model, or a 404 when it is null.
 *
 * @param {{gz?: Uint8Array | null, decompression?: boolean, rejectBytes?: boolean}} [options]
 */
function appServing({ gz = gzipSync(MODEL), decompression = true, rejectBytes = false } = {}) {
  const fetched = [];
  const globals = {
    Blob,
    Response,
    fetch: async (url) => {
      fetched.push(String(url));
      if (String(url).includes("letter_labels.json")) return Response.json({ A: 0, B: 1 });
      if (String(url).includes(".onnx.gz")) {
        return gz ? new Response(gz) : new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  };
  if (decompression) globals.DecompressionStream = DecompressionStream;

  const app = loadWebApp({ globals });
  app.evaluate(`
    globalThis.__created = [];
    globalThis.ort = {
      env: { wasm: {} },
      InferenceSession: {
        create: async (model) => {
          __created.push(model);
          if (typeof model !== "string" && ${rejectBytes}) throw new Error("not a model");
          return { inputNames: ["input"], outputNames: ["label", "probabilities"] };
        },
      },
    };
    globalThis.console = { ...console, log() {}, warn() {} };
  `);
  return { app, fetched };
}

/** What ONNX Runtime was handed: the raw URL, or the bytes as a Buffer. */
function created(app) {
  return Array.from(app.evaluate("__created"), (model) =>
    typeof model === "string" ? model : Buffer.from(model),
  );
}

test("the gzipped model is fetched, decompressed, and handed over as bytes", async () => {
  const { app, fetched } = appServing();

  assert.equal(await app.get("loadLetterModel")(), true);

  assert.deepEqual(created(app), [Buffer.from(MODEL)]);
  assert.ok(fetched.some((url) => url.includes("letter_model.onnx.gz")));
});

test("bytes a host has already decoded are used as they are", async () => {
  // A host that sends the file with Content-Encoding: gzip has it decoded by
  // fetch; decompressing those bytes a second time would fail.
  const { app } = appServing({ gz: MODEL });

  assert.equal(await app.get("loadLetterModel")(), true);
  assert.deepEqual(created(app), [Buffer.from(MODEL)]);
});

test("every failure on the compressed path ends in a session from the raw file", async () => {
  const rawUrl = loadWebApp().get("LETTER_MODEL_URL");
  const compressed = gzipSync(MODEL);
  const failures = {
    "no DecompressionStream": { decompression: false },
    "the .gz is missing": { gz: null },
    "the .gz is truncated": { gz: compressed.subarray(0, compressed.length >> 1) },
  };

  for (const [why, options] of Object.entries(failures)) {
    const { app } = appServing(options);
    assert.equal(await app.get("loadLetterModel")(), true, why);
    assert.deepEqual(created(app), [rawUrl], why);
  }

  // Bytes the runtime refuses reach it first, then the raw file does.
  const { app } = appServing({ rejectBytes: true });
  assert.equal(await app.get("loadLetterModel")(), true);
  assert.deepEqual(created(app), [Buffer.from(MODEL), rawUrl]);
});
