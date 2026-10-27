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

The scripts are plain `<script>` tags that share browser globals, so they must
load in the order `index.html` lists them. [The module notes](js/README.md)
list that order and describe each module.

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

Changing a threshold or the handedness setting changes live behaviour, so try
it with a real camera.

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
The [scripts notes](../scripts/README.md#fixtures-and-demo-poses) explain why
the only published word fixture is synthetic and how to make real ones.

## Deployment

This folder is the whole site; [hosting a copy](../docs/getting-started.md#hosting-a-copy)
describes the checks before an upload.

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
