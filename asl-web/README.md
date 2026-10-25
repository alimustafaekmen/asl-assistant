# Web app

`asl-web/` is the browser app and the folder that is deployed: static HTML,
CSS and JavaScript, with no build step and no backend. `make web` serves it at
<http://localhost:8080>; the camera needs `localhost` or HTTPS. Models download
on first use, and ONNX Runtime Web 1.22.0, MediaPipe Tasks Vision 0.10.18 and
kjua 0.9.0 come from public CDNs.

## Screens

| Route | Screen |
|---|---|
| `#letter` | Live recognition of 24 static letters; the user adds each letter. *Watch the demo* plays a recorded hand spelling FLY through the same pipeline. Opens for an empty or unknown hash. |
| `#word` | Experimental: records one sign and offers the top 3 of 50 words; a word is added only when the user accepts it |
| `#coach` | Practice with a letter or word target; progress stays on the device |
| `#test` | Model Test, for developers: runs the bundled fixtures without a camera |
| `#qr` | A QR code that opens the hosted letter or word screen |
| `#project` | A short page on how the app works and its limits |

Every screen is in English and Turkish; the switch in the top bar changes the
language without a reload. Leaving the camera screens for `#test`, `#qr` or
`#project` stops the camera.

## Script order

The app uses classic scripts that share browser globals, so their order in
`index.html` is a runtime contract. [The module notes](js/README.md) explain it.

```text
js/core/theme-boot.js
js/core/lang-boot.js
js/core/i18n.js
js/i18n/shell.js
js/i18n/letter.js
js/i18n/word.js
js/i18n/coach.js
js/i18n/info.js
js/core/i18n-boot.js
js/core/config.js
js/core/runtime.js
js/ml/landmarks.js
js/ml/features.js
js/services/benchmark.js
js/ml/gating.js
js/ml/hold.js
js/ml/letter-model.js
js/ml/word-model.js
js/media/overlay.js
js/media/camera.js
js/media/demo-source.js
js/ml/live-inference.js
js/ui/prediction.js
js/ui/plate-side.js
js/ui/toast.js
js/ui/transcript.js
js/ui/word-flow.js
js/ui/coach.js
js/ui/reference.js
js/ui/qr.js
js/ui/model-test.js
js/core/app.js
```

## Settings

`CONFIG` in `js/core/config.js` holds the thresholds and timings. The main ones:

| Setting | Value | Meaning |
|---|---:|---|
| `UNKNOWN_THRESHOLD` / `CONFIDENT_THRESHOLD` | 0.45 / 0.65 | A letter below the first is uncertain, from the second confident |
| `LETTER_THRESHOLD` | 0.60 | Minimum confidence to add a letter |
| `WORD_ACCEPT_THRESHOLD` | 0.15 | Minimum confidence to accept a word |
| `SMOOTHER_WINDOW` | 5 | Predictions in the letter smoothing window |
| `WORD_FRAME_COUNT` | 45 | Frames in a word recording |
| `WORD_FIRST_FRAME_TIMEOUT_MS`, `WORD_NO_HAND_TIMEOUT_MS`, `WORD_MAX_RECORDING_MS` | 6000, 4000, 15000 | When a recording that cannot fill ends |
| `COACH_HOLD_MS` | 1000 | How long a coach letter must be held |
| `SELFIE_HANDEDNESS_SWAP` | `false` | Swap left and right for a camera that reports them the other way round |

A change to a threshold or to handedness alters live behaviour and needs a test
with a real camera.

## Keyboard

| Mode | Keys |
|---|---|
| Letter | `Space` adds the letter, `Enter` adds a space, `Backspace` deletes |
| Word | `Enter` starts a recording or records again, `Space` accepts the result, `Escape` cancels |
| Coach | `Space` takes the next step, `Escape` stays on the target |

`Ctrl+D` toggles the debug panel. There are no single-letter shortcuts, and a
key pressed while a control has focus goes to that control.

## Model Test fixtures

A fixture is one JSON file with `schema_version: "asl-sample-v1"`, a `task`
(`letter` or `word`), `features` and `expected_label`. A letter fixture has 93
numbers; a word fixture has `45 × 168 = 7560` numbers and a 45-value `mask`.
The [word fixtures note](data/model-test-samples/words/README.md) explains why
the only published word fixture is synthetic.

## Deployment

This folder is the whole site; any static host can serve it as it is. Before
an upload, `python scripts/validation/check_runtime_assets.py --deploy` fails on
files the site must not ship, such as competition-derived samples or a
`.DS_Store`. `_headers` sets the response headers, including a report-only
Content Security Policy, on hosts that read it (Cloudflare Pages, Netlify), and
`404.html` answers unknown paths.

## Folders

```text
index.html, 404.html, _headers
css/      tokens.css declares the cascade layers; tokens, base, components, layout, screens
js/       core/, i18n/, media/, ml/, services/, ui/ (see js/README.md)
types/    browser-globals.d.ts, the CDN globals for the type check
models/   letter_model.onnx.gz (downloaded), letter_model.onnx (fallback), word_model.onnx
data/     labels, calibration, teaching data, the demo recording, fixtures
assets/   fonts (OFL), icons, the link preview image, sign reference images
```
