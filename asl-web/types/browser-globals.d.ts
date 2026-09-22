// Ambient declarations for the browser globals the app does not own.
//
// This file is not application code. The browser never loads it, it emits no
// JavaScript, and it is not a deploy artifact; only editors and `tsc --noEmit`
// read it. It exists because these globals arrive from a CDN script tag or are
// attached to `window` at runtime, so JSDoc in the sources cannot describe them.
//
// Only the surface the app actually uses is declared. The upstream packages
// ship far larger type trees, and copying them here would turn a CDN version
// bump into a source change.

/** ONNX Runtime Web, loaded from a CDN script tag in index.html. */
declare namespace ort {
  const env: {
    wasm: {
      /** Where the runtime resolves its worker and WASM assets from. */
      wasmPaths: string;
    };
  };

  class Tensor {
    constructor(type: string, data: unknown, dims: number[]);
    /** Element type follows the tensor's ONNX dtype; int64 arrives as bigint. */
    readonly data: ArrayLike<number | bigint>;
  }

  const InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<OnnxSessionLike>;
  };
}

/** One QR code rendered by the kjua CDN script. */
interface KjuaOptions {
  render: string;
  text: string;
  size: number;
  fill: string;
  back: string;
  ecLevel: string;
  crisp: boolean;
  minVersion: number;
  rounded: number;
  quiet: number;
  ratio?: number;
}

interface Window {
  /** QR generator from the kjua CDN script; absent when that script failed. */
  kjua?: (options: KjuaOptions) => HTMLElement;

  /**
   * Console diagnostics API, published by core/app.js.
   *
   * Declared loosely on purpose: it is a read-only console surface whose
   * getters reach across every module, and pinning its shape here would
   * duplicate what those modules already describe.
   */
  aslDebug?: Record<string, unknown>;

  /** Read-only pipeline snapshots, published by ml/live-inference.js. */
  _lastLetterDebug?: unknown;
  _lastRawLetterPrediction?: {label: string; confidence: number; source: string};
  _lastSmoothedLetterPrediction?: {label: string; confidence: number};
  _lastWordCurrentFrame?: WordCurrentFrameDebug;
  _lastWordDebug?: WordDebugSnapshot;
}
