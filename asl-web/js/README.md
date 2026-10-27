# Browser modules

The app uses classic scripts that share one global scope, with no bundler and
no ES modules, so they must load in the order `asl-web/index.html` lists them:

```text
core/theme-boot.js
core/lang-boot.js
core/i18n.js
i18n/shell.js
i18n/letter.js
i18n/word.js
i18n/coach.js
i18n/info.js
core/i18n-boot.js
core/config.js
core/runtime.js
ml/landmarks.js
ml/features.js
services/benchmark.js
ml/gating.js
ml/hold.js
ml/letter-model.js
ml/word-model.js
media/overlay.js
media/camera.js
media/demo-source.js
ml/live-inference.js
ui/prediction.js
ui/plate-side.js
ui/toast.js
ui/transcript.js
ui/word-flow.js
ui/coach.js
ui/reference.js
ui/qr.js
ui/model-test.js
core/app.js
```

- `core/theme-boot.js` and `core/lang-boot.js` run in `<head>`, so the first
  paint has the right theme and `<html lang>`.
- The strings and `core/i18n-boot.js` come before the CDN scripts, so the page
  is translated before the browser waits on a CDN. An English page stays hidden
  until then (`data-i18n-pending`, with a 3 s fail-safe in `css/base.css`).
- `core/config.js` and `core/runtime.js` create the settings, the shared
  `state`, the `els` element registry and the word buffers, once.
- `core/app.js` is last and the only script with start-up side effects: it
  calls `init()`. The other files only declare functions and values.

A new file goes into `index.html` where its dependencies require.

## Modules

| Module | Responsibility |
|---|---|
| `core/theme-boot.js` | The theme before the first paint |
| `core/lang-boot.js` | The language before the first paint: saved choice, else the browser's, else English |
| `core/i18n.js` | The strings registry, `t()`, the markup pass and the language switch |
| `core/i18n-boot.js` | Translates the parsed page before the CDN scripts |
| `i18n/shell.js`, `i18n/letter.js`, `i18n/word.js`, `i18n/coach.js`, `i18n/info.js` | The interface strings of each area, Turkish and English side by side |
| `core/config.js` | `CONFIG`, the letter and word lists, reference assets, the ONNX Runtime path |
| `core/runtime.js` | Shared state, element registry, canvas context, word buffers |
| `core/app.js` | Start-up, event binding, routing, camera start and stop, render loop, `window.aslDebug` |
| `media/camera.js` | MediaPipe tasks, GPU/CPU fallback, the detection loop |
| `media/overlay.js` | Landmark drawing |
| `media/demo-source.js` | The camera-free demo: a recorded hand published as live frames |
| `ml/landmarks.js` | The 321-D holistic frame and shoulder normalisation |
| `ml/features.js` | The 93-D letter and 168-D word features, square units included |
| `ml/live-inference.js` | Live letter and word inference, the end of a word recording |
| `ml/letter-model.js` | Letter ONNX loading and probabilities |
| `ml/word-model.js` | Word ONNX loading, the mask, calibration, top 3 |
| `ml/gating.js` | Letter smoothing and word difficulty data |
| `ml/hold.js` | Hold detection for the coach |
| `services/benchmark.js` | Latency measurements for the debug panel |
| `ui/prediction.js` | Result plate, top 3, messages, the word result guide |
| `ui/plate-side.js` | Moves the laptop result plate away from a hand |
| `ui/toast.js` | Toasts and the screen-reader live region |
| `ui/transcript.js` | The text: editing, storage, copy, speech |
| `ui/word-flow.js` | Word countdown, recording progress and buttons |
| `ui/coach.js` | The coach |
| `ui/reference.js` | Reference images, video links, the image viewer |
| `ui/qr.js` | The QR screen |
| `ui/model-test.js` | Model Test: loading, validating and running fixtures |

## How the code is written

- Scripts find elements by `id` or a `data-ui` hook, so a change of styling
  class does not break them. `requireElement()` throws at start-up when a
  required element is missing; `optionalElement()` returns `null`, and the code
  that reads it checks for that.
- `bindEvents()` in `core/app.js` binds every listener once. Render functions
  only rebuild the screen from state; they start no timers, fetches or model
  sessions.
- Plain text is set with `textContent`. Model labels, dataset values and
  fetched JSON are escaped before they go into `innerHTML`.
- A model loads the first time it is needed, through `ensureLetterModel()` or
  `ensureWordModel()`, so a live frame does not start a download. The word
  mask is `true` for a real frame; the ONNX graph inverts it itself.
- TypeScript checks the JSDoc types and emits no files. Fetched JSON and ONNX
  outputs are typed `unknown` until a check such as `isRecord()` has looked at
  them.

## Interface strings

The authored markup is Turkish. An element names its string with
`data-i18n="area.part.name"` (or `data-i18n-html`, `data-i18n-aria-label` and
similar for attributes), and each area's file under `i18n/` registers the
Turkish and English text with `registerStrings()`. Scripts use `t(key)`,
`setText()` or `setAttrText()`; text built from state is redrawn in an
`onLanguageChange()` listener. A key missing in English shows the Turkish
string. Turkish addresses the reader as *siz*; English is plain US English.
ASL letters and word glosses are not translated.
