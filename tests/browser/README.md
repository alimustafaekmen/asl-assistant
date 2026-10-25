# Browser checks

<sub>Location: [`asl-assistant`](../../README.md) / [`tests`](../README.md) / `browser`</sub>

<sub>Related: [`asl-web/`](../../asl-web/README.md) · [`docs/getting-started.md`](../../docs/getting-started.md)</sub>

Some facts about the web app only a real browser can decide: which CSS rule
wins, whether an element is rendered, whether a page scrolls sideways, whether
a camera track is still live after a stop. The Node suite in `tests/web` has a
stub DOM with no cascade, no layout and no media, so these facts are checked
here, in headless Chrome, against the files in `asl-web/` as they are.

Every check reads computed style, layout boxes, the CSSOM or media state. None
reads source text, so moving a rule from one stylesheet to another, or renaming
a class in the markup and the CSS together, changes nothing here.

## Running

```bash
make browser-check                         # every check
make browser-check OFFLINE=1               # skip the checks that need the CDNs
make browser-check UI_LANG=en              # every page as an English browser's

node tests/browser/run.mjs                 # the same, without make
node tests/browser/run.mjs --offline
node tests/browser/run.mjs --lang en
node tests/browser/run.mjs --only boot,hidden
node tests/browser/run.mjs --list
```

It needs Node 22 or later (the DevTools connection uses the WebSocket built
into Node) and a Chrome or Chromium. Chrome is found through the `CHROME`
environment variable, then the standard install locations on macOS, Linux and
Windows. Nothing is installed: there is no npm dependency.

| Exit code | Meaning |
|---|---|
| `0` | every check that ran passed |
| `1` | a check failed; each failure is listed under its name |
| `2` | the checks could not run: a usage error, or no Chrome was found |

A missing Chrome is never reported as a pass.

An offline run takes under half a minute. The `camera` and `demo-model`
checks add the CDN download, and Chrome's first start on a new profile can
add a few seconds.

## How it runs

- `serve.mjs` serves `asl-web/` from `node:http` on a port the OS picks, with
  the response headers from `asl-web/_headers`, the file Netlify applies on
  every deploy. The page therefore runs under the site's Content Security
  Policy, Report-Only included. The runner has its own server because Python's
  `http.server` reset about one page load in four under the burst of script
  requests the app makes. `node tests/browser/serve.mjs [port]` serves the
  folder the same way for a manual look.
- Chrome runs headless with a temporary profile, a DevTools port the OS picks,
  and a fake camera (`--use-fake-device-for-media-stream`). Your own browser,
  profile and cache are never touched. Chrome and the server are stopped on
  every way out: success, failure, an exception, and Ctrl+C. Chrome gets no
  pipe back to the runner, so a helper process that outlives it cannot hold the
  run open. Branded Google Chrome on macOS starts such a helper, the system's
  Google updater, about 20 s after launch; Chromium and Chrome for Testing,
  chosen through `CHROME`, ship without it.
- Each page gets a fresh browser context, so no check sees storage, cache or
  permissions an earlier one left behind. Pages emulate a light colour scheme
  and no motion preference unless a check says otherwise, so the host's own
  dark mode cannot change a result. They are a Turkish browser's too
  (`navigator.languages` and `Accept-Language`), so the page opens in Turkish
  whatever the host's language; `--lang en` opens every page as an English
  browser's, and a check can set `languages` or a `savedLanguage` itself.
- Every check except `camera` and `demo-model` refuses requests to other
  origins, so the app's CDN scripts (ONNX Runtime, kjua) are blocked and never
  downloaded. Those two let MediaPipe and ONNX Runtime load from their CDNs,
  as a visitor's browser does; `--offline` skips them and says so. The `demo`
  check therefore plays the recording without a letter model: the hand is
  drawn, nothing is read.
- Every wait polls a condition against a deadline and names what it waited for
  when the deadline passes. There are no fixed sleeps.
- Each page waits until `init()` has applied the route and the start-up
  fetches have settled, and fails on an uncaught error. A page that did not
  boot fails the check that opened it instead of being read half-built.

## The checks

Each check was shown to fail on deliberate faults planted in a scratch copy of
`asl-web/`, and to pass on the real tree.

| Check | Asserts |
|---|---|
| `boot` | every route (`#letter` … `#qr`) boots with no uncaught error, no failed script, stylesheet, font or image, and no CSP violation; a planted inline script is reported, so the policy is in force |
| `hidden` | every `[hidden]` element is unrendered, the toast at load included; setting `hidden` on any rendered element hides it; both hold with the `legacy` layer removed through the CSSOM |
| `layer-order` | the first stylesheet opens with a `CSSLayerStatementRule` listing `legacy, tokens, base, components, layout, screens, utilities`; every rule of every sheet is in a declared layer (an unlayered rule outranks them all) |
| `style-link` | `css/style.css` is linked once, loaded, enabled and first |
| `mode-only` | in letter, word and coach mode every control tagged for another mode has `display: none`, every control tagged for the mode is left to its component, and each mode's own actions are rendered |
| `reduced-motion` | with `prefers-reduced-motion: reduce` nothing transitions or animates, with and without the `legacy` layer; without the preference something does, so the check is not vacuous |
| `dark-theme` | the theme toggle changes `--color-page`; the body background becomes that colour and the page canvas follows |
| `qr-colours` | the QR ink and paper resolve to near-black on white, in the light and the dark theme |
| `no-hscroll` | no route, camera mode or information screen scrolls sideways at 320×640, 360×780, 390×844, 844×390 and 1366×768 |
| `landscape` | at 844×390, 740×360, 667×375, 568×320 and 932×430, in letter, word and coach mode, at rest, live and with a refused camera: the stage starts at the top left and fills the height; the mode switch, the "Diğer" (More) menu, the result, the transcript and the actions sit beside it, none on it; nothing overlaps or is cut off; every action is at least 44 px high; no sideways scroll |
| `stage-fit` | at 320×568, 360×640, 375×667, 360×780, 375×812, 390×844, 768×1024, 1366×768 and 1440×900, in letter, word and coach mode, at rest and with a refused camera: the chip, the first-visit content or the camera problem, and the message line under them each lie whole inside the stage, and none overlaps another |
| `strip-tail` | at 844×390, 390×844 and 1366×768, a 39-letter transcript rendered by the app keeps the caret after its newest letter inside the strip; a two-letter one does too, and the long one really overflows |
| `feedback-kinds` | the stage feedback bar, filled through the app's `showFeedback()`, renders every kind; `low` and `good` each look different from a kind no CSS names, and from each other |
| `confidence-levels` | the word result guide, rendered by the app's own assessment of a weak, a close and a clear result, takes the levels `low`, `maybe` and `good`, and each looks different from the others and from no level |
| `model-test-labels` | on `#test`, at laptop and phone width, the ranked results drawn by the panel's own renderer show the longest word labels whole, not cut off, and letters as a control |
| `guided-actions` | on `#test` the short copy and both quick-test buttons are rendered, the long brief is not, and the advanced section starts closed with the model choice inside it; on `#coach` the reference panel sits above the coach card; on `#word` the demo card starts closed |
| `demo` | at 390×844, 320×568, 844×390 and 1366×768 (light and dark), the stage's "Örneği izleyin" plays the real `data/demo-letters.json`: the hand is drawn on the overlay (read from its pixels), at least a quarter of the stage high, and where the stage has room clear of the demo's card and the plate; the instruction is rendered inside the stage; nothing scrolls sideways; the stop clears the overlay and hides itself |
| `demo-model` | the real letter model, through ONNX Runtime from the CDN, reads the recorded hand: the plate shows F, L and Y in turn, a real Space key press adds each, the transcript reads `FLY`, and the end offers the camera; no CSP violation |
| `language-first-paint` | an English browser's page, with the CDN request held unanswered so the parser stops at the first CDN script and `init()` never runs: `<html lang>` is `en`, and the header shows no Turkish text or spoken name (so the page is translated before the CDN scripts) |
| `language-hidden-until-translated` | `js/i18n/info.js` is held unanswered so the parser stops at it with the Turkish body above it: for an English browser the body is not rendered, nothing contentful is painted and no Turkish text shows; 3 s in, the body shows anyway (the fail-safe for a translation that never comes); once the file is answered no Turkish is left. A Turkish browser's page under the same hold is rendered and painted |
| `language-switch` | on a laptop the switch is rendered in the header; a click turns the page to English without a reload, retitles it, names the switch "Türkçeye geç", saves the choice, gives up focus, and a reload keeps English; on a phone the switch shows only in the open "Diğer" menu and switches back |
| `language-every-screen` | an English browser and a Turkish one each open every route at laptop width, the letter and word reference panel and its viewer, the letter demo while it plays and after its stop, and the phone menu; in English nothing rendered (text, spoken names, tooltips, the document title) reads as Turkish, and in Turkish nothing rendered equals an English interface string that is not also Turkish (key caps such as "Space" are left out), the title is the route's Turkish name, and a few authored labels ("Kısayollar", "Gizle", "Büyüt", "Örneği izleyin") read as written. Everything is checked as rendered, so a state reached only with a live camera stays with the node tests |
| `camera` | the model each mode runs (letter, then word) loads through the real ONNX Runtime and its WASM files from the CDN, as `window.aslDebug.models` reports it, so a wrong `wasmPaths` or a 404 on the `.wasm` fails; the stage close button is rendered only while the camera is live, has a label and a 24 px target; after a stop no track handed out by `getUserMedia` is live; no CSP violation while MediaPipe and ONNX Runtime load |

`hidden` and `reduced-motion` run a second time with the `legacy` layer (the
older stylesheet in `css/style.css`) deleted through the CSSOM. That layer
carries its own `!important` copy of both rules, and an `!important`
declaration in an earlier layer wins, so it would mask a missing `base.css`
rule. The second pass shows that `base.css` holds both rules on its own.

`feedback-kinds` asserts nothing about the `confusion` and `hard` kinds: they
have no stage style of their own and render like a kind no CSS names.

## Why it is not in `make health`

`make health` must run in a fresh clone with the Python environment alone, and
fast enough to run after every edit. These checks need Chrome, and the `camera`
and `demo-model` checks need the network, so they are a separate gate: run
them before a deploy and after any change to `index.html` or the CSS.
`tests/scripts/test_make_targets.py` checks that `make browser-check` runs this
runner and fails with it, and that `make health` never starts a browser.

## Adding a check

- Assert what a visitor's browser shows: computed style, layout boxes, the
  CSSOM, media state. Never match source text.
- Drive the page through the app's own functions or real input events; mock
  only at the boundaries the page already has (the camera, the network).
- Open pages through `openApp()`, so the check also asserts that the app
  booted.
- Make it non-vacuous: if the assertion could hold on an empty page, add a
  control that shows the thing being checked exists.
- Plant the fault the check is meant to catch, and see the check fail on it
  before you add it.
