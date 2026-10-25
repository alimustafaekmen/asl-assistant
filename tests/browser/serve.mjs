// A static file server for asl-web/ that behaves like the host it deploys to.
//
// Python's http.server resets about one page load in four under the burst of
// classic-script requests the app makes, which makes a booted page look
// broken. node:http serves them concurrently and keeps the checks
// deterministic.
//
// The response headers come from asl-web/_headers, the same file Cloudflare
// Pages reads on every deploy, so the page runs under the site's real Content
// Security Policy, Report-Only included, and a violation shows up in the checks
// before it shows up on the live site. The file is published nowhere: the host
// does not serve it, and neither does this server.
//
//   node tests/browser/serve.mjs [port]     serve until interrupted

import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../asl-web");

// Content types for the extensions the app ships. A `.gz` file is served as
// application/gzip with no Content-Encoding, as Cloudflare Pages serves it: the
// app checks the magic bytes and decompresses the letter model itself.
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".gz": "application/gzip",
};

/**
 * Parse a `_headers` file into path rules.
 *
 * The format is a path line followed by indented `Name: value` lines; `#`
 * starts a comment. A path may end in `*`, which matches any rest.
 *
 * @param {string} text
 * @returns {Array<{ pattern: string, headers: Array<[string, string]> }>}
 */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = raw.indexOf(":");
    if (!current || colon < 0) throw new Error(`_headers: cannot read the line ${JSON.stringify(raw)}`);
    current.headers.push([raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Whether a `_headers` path pattern applies to a request path. */
function patternMatches(pattern, path) {
  if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

/**
 * Map a URL path to a file under the root, or null when it escapes the root.
 *
 * @param {string} root
 * @param {string} urlPath
 */
function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidate = normalize(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/**
 * Start the server on 127.0.0.1 and a port the OS picks.
 *
 * @param {{ root?: string, port?: number }} [options]
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startServer({ root: rootOption = WEB_ROOT, port = 0 } = {}) {
  const root = resolve(rootOption);
  const rules = parseHeadersFile(readFileSync(join(root, "_headers"), "utf8"));

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    let file = resolveFile(root, url.pathname);
    let stats = null;
    if (file) {
      try {
        stats = statSync(file);
        if (stats.isDirectory()) {
          file = join(file, "index.html");
          stats = statSync(file);
        }
      } catch {
        stats = null;
      }
    }

    for (const rule of rules) {
      if (patternMatches(rule.pattern, url.pathname)) {
        for (const [name, value] of rule.headers) response.setHeader(name, value);
      }
    }
    // Every reload must see the files as they are on disk now: a check run
    // after a file changed must not be answered from Chrome's cache.
    response.setHeader("Cache-Control", "no-store");

    const published = file && stats && stats.isFile() && !file.endsWith(`${sep}_headers`);
    if (!published) {
      response.statusCode = 404;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Not found\n");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end();
      return;
    }
    response.setHeader("Content-Type", MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream");
    response.setHeader("Content-Length", stats.size);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the server has no TCP address");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise) => {
        server.closeAllConnections();
        server.close(() => resolvePromise());
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 0);
  const { origin, close } = await startServer({ port });
  console.log(`Serving asl-web at ${origin}/ (Ctrl+C to stop)`);
  const stop = () => close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
