# Browser checks

Some facts only a real browser can decide: which CSS rule wins, whether an
element is rendered, whether a page scrolls sideways, whether a camera track is
still live after a stop. These checks open `asl-web/` in headless Chrome and
read computed style, layout boxes, the CSSOM and media state.

```bash
make browser-check              # every check
make browser-check OFFLINE=1    # skip the checks that load the CDNs
make browser-check UI_LANG=en   # every page as an English browser's
node tests/browser/run.mjs --only boot,hidden    # a few checks
node tests/browser/run.mjs --list
```

They need Node 22 or later and Chrome or Chromium, found through the `CHROME`
environment variable or the standard install locations. Nothing is installed.

## How it runs

- `serve.mjs` serves `asl-web/` with the headers from `asl-web/_headers`, so the
  page runs under the site's Content Security Policy.
- Chrome runs headless with a temporary profile and a fake camera. Each page
  gets a fresh browser context, a light colour scheme and a Turkish browser's
  languages unless a check asks otherwise.
- Five checks (`camera`, `demo-model`, `qr-library-cdn`, `qr-code` and
  `webgl-context-loss`) load MediaPipe, ONNX Runtime or kjua from the CDNs, as a
  visitor's browser does; `OFFLINE=1` skips them. The others block every other
  origin (`cdn-integrity` answers with altered bytes instead).
- Waits poll a condition against a deadline; there are no fixed sleeps.

## The checks

`node tests/browser/run.mjs --list` prints every check and what it asserts;
`[CDN]` marks the ones that load the CDNs. The checks are in `checks.mjs`, and
each one opens its pages through `openApp()`.
