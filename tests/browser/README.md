# Browser checks

Some facts only a real browser can decide: which CSS rule wins, whether an
element is rendered, whether a page scrolls sideways, whether a camera track is
still live after a stop. These checks open `asl-web/` in headless Chrome and
read computed style, layout boxes, the CSSOM and media state, never source text.

```bash
make browser-check              # every check
make browser-check OFFLINE=1    # skip the checks that load the CDNs
make browser-check UI_LANG=en   # every page as an English browser's
node tests/browser/run.mjs --only boot,hidden    # a few checks
node tests/browser/run.mjs --list
```

They need Node 22 or later and Chrome or Chromium, found through the `CHROME`
environment variable or the standard install locations. Nothing is installed.
The runner exits 0 when every check passed, 1 when one failed and 2 when it
could not run, for example without Chrome.

## How it runs

- `serve.mjs` serves `asl-web/` with the headers from `asl-web/_headers`, so the
  page runs under the site's Content Security Policy.
- Chrome runs headless with a temporary profile and a fake camera. Each page
  gets a fresh browser context, a light colour scheme and a Turkish browser's
  languages unless a check asks otherwise.
- Every check except `camera`, `demo-model`, `qr-library-cdn` and `qr-code`
  blocks other origins (`cdn-integrity` answers them with altered bytes), so
  the CDN libraries never load. Those four load
  MediaPipe, ONNX Runtime and kjua from the CDNs, as a visitor's browser does;
  `--offline` skips them.
- Waits poll a condition against a deadline; there are no fixed sleeps.

## The checks

| Check | Asserts |
|---|---|
| `boot` | Every route loads with no uncaught error, no failed file and no CSP violation |
| `hidden`, `mode-only` | `[hidden]` elements and controls for another mode are not rendered |
| `layer-order`, `tokens-link` | The cascade layers are declared in order and every rule sits in one |
| `reduced-motion`, `dark-theme`, `qr-colours` | Reduced motion stops animation; the theme switch and the QR colours work in both themes |
| `qr-library`, `qr-library-cdn`, `qr-code` | Only `#qr` asks for the QR library, once and with its integrity hash; it draws the code, or shows the link when the CDN is unreachable |
| `cdn-integrity` | A CDN script whose bytes were altered does not run |
| `no-hscroll`, `landscape`, `stage-fit`, `strip-tail` | No sideways scroll from 320 px up; the stage, actions and text fit at phone, landscape and laptop sizes |
| `feedback-kinds`, `confidence-levels`, `model-test-labels`, `guided-actions` | Each feedback kind and confidence level looks different; Model Test labels show whole; the guided actions render |
| `demo` | The demo draws the recorded hand where it can be seen, at phone and laptop sizes |
| `demo-model` | The real letter model reads the recorded hand, and Space adds F, L and Y |
| `language-first-paint`, `language-hidden-until-translated`, `language-switch`, `language-every-screen` | An English page is translated before the CDN scripts and never shows Turkish; the switch works without a reload; every screen reads in one language |
| `camera` | Each mode's model loads through the real ONNX Runtime; after a stop no camera track is live |

Each check was shown to fail on a fault planted in a copy of `asl-web/`. A new
check should assert what a visitor's browser shows, open pages through
`openApp()`, and fail on the fault it is meant to catch before it is added.
