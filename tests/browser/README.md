# Browser checks

Facts about the web app that only a real browser can decide: which CSS rule
wins, whether an element is rendered, whether a page scrolls sideways, whether
a camera track is still live after a stop. The node suite in `tests/web` stubs
the DOM and has no cascade, no layout and no media, so these facts are checked
here, in headless Chrome, against the files in `asl-web/` as they are.

Every check reads computed style, layout boxes or the CSSOM. None reads the
source text, so moving a rule from one stylesheet to another, or renaming a
class in the markup and the CSS together, changes nothing here.

## Running

```bash
node tests/browser/run.mjs                 # every check
node tests/browser/run.mjs --offline       # skip the camera check (no CDN)
node tests/browser/run.mjs --only boot,hidden
node tests/browser/run.mjs --list
```

It needs Node 22 or later and a Chrome or Chromium. Chrome is found through the
`CHROME` environment variable, then the standard install locations on macOS,
Linux and Windows. Nothing is installed: there is no npm dependency.

| Exit code | Meaning |
|---|---|
| `0` | every check that ran passed |
| `1` | a check failed; each failure is listed under its name |
| `2` | the checks could not run: a usage error, or no Chrome (`Chrome bulunamadı / Chrome not found`) |

A missing Chrome is never reported as a pass.

## How it runs

- **Its own server.** `serve.mjs` serves `asl-web/` from `node:http` on a port
  the OS picks, with the response headers from `asl-web/_headers`, the file
  Netlify applies on every deploy. The page therefore runs under the site's
  Content Security Policy, Report-Only included. Python's `http.server` was
  not used: it reset about one page load in four under the burst of script
  requests the app makes. `node tests/browser/serve.mjs [port]` serves the
  folder the same way for a manual look.
- **Its own Chrome.** A headless Chrome with a temporary profile and a
  DevTools port the OS picks, and a fake camera
  (`--use-fake-device-for-media-stream`). The owner's own browser, profile and
  cache are never touched. Chrome and the server are stopped on every way
  out: success, failure, an exception, and Ctrl+C. Chrome gets no pipe back to
  the runner, so a helper that outlives it cannot hold the run open: branded
  Google Chrome on macOS wakes the system's Google updater about 20 s after
  it starts, a launchd service that exits by itself. Chromium and Chrome for
  Testing, chosen through `CHROME`, ship without that updater.
- **A fresh context per page.** No check sees storage, cache or permissions
  an earlier one left behind. Pages emulate a light colour scheme and no
  motion preference unless a check says otherwise, so the host's own dark
  mode cannot change a result.
- **Offline by default.** Every check except `camera` refuses requests to
  other origins; the app's CDN scripts (ONNX Runtime, kjua) are blocked and
  never downloaded. The `camera` check lets MediaPipe and ONNX Runtime load
  from their CDNs, as a visitor's browser does; `--offline` skips it and says
  so.
- **Condition waits, no sleeps.** Every wait polls a condition against a
  deadline and names what it waited for when the deadline passes.
- **A boot assertion in every check.** Each page waits until `init()` has
  applied the route and the start-up fetches have settled, and fails on an
  uncaught error. A page that did not boot fails the check that opened it
  instead of being read half-built.

## The checks

Each check was shown to fail on the faults in its last column, planted in a
scratch copy of `asl-web/`, and to pass on the real tree.

| Check | Asserts | Fails on |
|---|---|---|
| `boot` | every route (`#letter` … `#qr`) boots with no uncaught error, no failed script, stylesheet, font or image, and no CSP violation; a planted inline script is reported, so the policy is really in force | an inline `<script>` in `index.html`; the CSP header renamed in `_headers`; a broken script link; `init()` throwing |
| `hidden` | every `[hidden]` element is unrendered (the toast at load included); setting `hidden` on any rendered element hides it; both still hold with the legacy layer removed through the CSSOM | `[hidden]` rule deleted from `base.css` |
| `layer-order` | the first stylesheet opens with a `CSSLayerStatementRule` listing `legacy, tokens, base, components, layout, screens, utilities`; every rule of every sheet is in a declared layer (an unlayered rule outranks them all) | legacy last; order reversed; statement deleted; `tokens` renamed `tokenz`; an unlayered rule appended |
| `style-link` | `css/style.css` is linked once, loaded, enabled and first | link removed; statement deleted |
| `mode-only` | in letter, word and coach mode every control tagged for another mode has `display: none`, every control tagged for the mode is left to its component, and each mode's own actions are rendered | mode rule deleted; its letter line deleted; `#insertSpace` tagged word-only |
| `reduced-motion` | with `prefers-reduced-motion: reduce` nothing transitions or animates, with and without the legacy layer; without the preference something does, so the check is not vacuous | the `base.css` reduced-motion query disabled |
| `dark-theme` | the theme toggle changes `--color-page`; the body background becomes that colour and the page canvas follows | dark-token selector broken; legacy last |
| `no-hscroll` | no camera mode scrolls sideways at 320×640, 360×780, 390×844, 844×390 and 1366×768 | a planted 400 px `min-width` on the action bar; the mode rule deleted |
| `landscape` | at 844×390, 740×360, 667×375, 568×320 and 932×430, in letter, word and coach mode, at rest, live and with a refused camera: the stage starts at the top left and fills the height; the mode switch, "Diğer", the result, the transcript and the actions sit beside it, none on it; no part on the stage or beside it overlaps another or is cut off; every action is at least 44 px high; no sideways scroll | the layout before the landscape rework (a 49 px top bar above the stage, the result on the stage, the result over the call to action and the chip over the headline at 568×320); the top bar put back in the flow; the result placed back on the stage |
| `stage-fit` | at 320×568, 360×640, 375×667, 360×780, 375×812, 390×844, 768×1024, 1366×768 and 1440×900, in letter, word and coach mode, at rest and with a refused camera: the chip, the first-visit content or the camera problem, and the message line under them each lie whole inside the stage and none lies on another | the first-visit fact list under the message line at 390×844, 375×812, 360×780 and 375×667; the problem's help link past the stage at 375×667 and 320×568 in word mode; the first visit no longer ending above the message line; the illustration not shrinking on mid-height phones |
| `strip-tail` | at 844×390, 390×844 and 1366×768, a 39-letter transcript rendered by the app keeps the caret after its newest letter inside the strip; a two-letter one does too, and the long one really overflows | the strip cut at its end with an ellipsis, which hid the letter just added |
| `feedback-kinds` | the stage feedback bar, filled through the app's `showFeedback()`, renders every kind; `low` and `good` each look different from a kind no CSS names, and from each other | the stage `low` or `good` marker deleted; `showFeedback()` writing a misspelt modifier class |
| `confidence-levels` | the word result guide, rendered by the app's own assessment of a weak, a close and a clear result, takes the levels `low`, `maybe` and `good`, and each looks different from the others and from no level | the `maybe` rule deleted; the renderer writing the level to another attribute |
| `guided-actions` | on `#test` the short copy and both quick-test buttons are rendered, the long brief is not, and the advanced section starts closed with the model choice inside it; on `#coach` the reference panel sits above the coach card; on `#word` the demo card starts closed | the desktop rule hiding the brief deleted; the advanced section authored open; the reference panel moved below the coach card; the short copy hidden |
| `camera` | the stage close button is rendered only while the camera is live, has a label and a 24 px target; after a stop no track handed out by `getUserMedia` is live; no CSP violation while MediaPipe and ONNX Runtime load | the `:has()` rule that shows the button deleted; `stopCamera` not stopping tracks; the call to action left visible after start |

`hidden` and `reduced-motion` also run with the legacy layer deleted through
the CSSOM. The legacy stylesheet still carries its own copy of both rules, and
an `!important` declaration in an earlier layer wins, so today that copy masks
a deleted `base.css` rule. `base.css` keeps them so they survive the legacy
layer's removal; the second pass is what shows that they would.

`feedback-kinds` asserts nothing about `confusion` and `hard`: on the stage
they render exactly like a kind no CSS names. The legacy `.feedback-bar--*`
rules for them are overridden by the stage bar in the components layer, so
they paint nothing today. Whether those two kinds should look different is a
design decision, not something this check can settle.

The last three checks are the computed-style replacements for the
`tests/project` tests that read `css/style.css` for selector text. Those fail
when a rule moves to another stylesheet or a class is renamed in markup and
CSS together, which the redesign does on purpose; these do not. Two facts
those tests also check are not browser facts: a `showFeedback()` or
`setMessage()` call with a value outside its JSDoc union is caught by
`make js-typecheck`, and a kind added to the union with no CSS of its own is
caught by neither (it renders as the neutral bar, like `confusion` and
`hard`).

A run takes about 9 s with `--offline` and about 16 s with the camera check,
most of which is the CDN download; Chrome's first start on a new profile can
add a few seconds.

## Why it is not in `make health`

`make health` must run in a fresh clone with the Python environment alone, and
fast enough to run after every edit. These checks need a Chrome, and the
camera check needs the network. They are a separate gate, run before a deploy
and after any change to `index.html` or the CSS.

## Adding a check

- Assert what a visitor's browser shows: computed style, layout boxes, the
  CSSOM, media state. Never match source text.
- Drive the page through the app's own functions or real input events; mock
  only at the boundaries the page already has (the camera, the network).
- Open pages through `openApp()`, so the check also asserts that the app
  booted.
- Make it non-vacuous: if the assertion could hold on an empty page, add a
  control that shows the thing being checked exists.
- Name the fault it kills, and show it failing on that fault before it lands.
