# ASL Assistant Web Application

`asl-web/` is the primary product and the deployment root. It is a static
HTML/CSS/JavaScript application with no build step and no backend dependency.
Camera landmarks and ONNX inference are processed in the browser.

## Run locally

```bash
cd asl-web
python3 -m http.server 8080
```

Open <http://localhost:8080>. Do not use `file://`, because models and JSON are
loaded with `fetch`. Camera access requires `localhost` or HTTPS. From the
repository root, `node tests/browser/serve.mjs 8080` serves the folder the way
the host does, with the response headers from `_headers` (the Content
Security Policy included).

No model downloads when the page opens. Each one loads the first time it is
needed: starting the camera loads the models the current mode runs, and a
word test under **Kamerasız dene** loads the word model. The message line on
the stage reports the download and then which models are ready.

Use **Kamerasız dene** (`#test`) before camera testing. The bundled word
fixture should predict `give` at approximately `0.0760` confidence. It proves
that the word ONNX, temperature, mask, labels, and browser inference path
agree; it is not an official evaluation result.

## Modes

The interface is in Turkish. The three camera modes are the tabs of the top
bar; the other screens are in its "Diğer" menu on a phone and are links in
the bar on a laptop.

| Screen (route) | Behaviour |
|---|---|
| Harf (`#letter`) | Continuous 24-class static-letter inference; the user adds each letter to the transcript |
| Koç (`#coach`) | Target-based letter or word practice with local progress |
| Kelime, deneysel (`#word`) | Recorded 45-frame isolated-sign inference with top-3 review; a result is added only when the user accepts it |
| Kamerasız dene (`#test`) | Camera-free inference from versioned JSON fixtures (Model Test) |
| Telefonda aç (`#qr`) | QR code and deep links to the hosted letter, word or test view |
| Nasıl çalışır (`#project`) | Concise implementation and limitation summary |

Letter mode is the primary experience and opens for an empty or unknown hash.
Leaving the camera screens for `#test`, `#qr` or `#project` stops the camera.
When the camera cannot open (permission refused, no camera, camera busy, an
insecure page) the stage says why, with a retry and the steps for the
visitor's browser.

The layout follows the device: a phone held upright puts the stage over the
transcript and the actions; sideways, the stage fills the height and the
rest stands in a column beside it; a laptop adds a side column of supporting
cards, and its result plate moves to the other bottom corner when a hand
stays under it. The theme follows the system until the visitor picks one.

## Runtime dependencies

The page loads these external browser assets:

- ONNX Runtime Web 1.22.0;
- MediaPipe Tasks Vision 0.10.18 and its hosted task files;
- `kjua` 0.9.0 for QR generation.

The app has no application API. External access is nevertheless required on
first load while these runtime assets remain CDN-hosted.

## Script order

The project currently uses classic scripts and shared browser globals. Their
order is a runtime contract:

```text
js/core/theme-boot.js
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

Do not reorder them or convert only part of the application to modules.
`js/README.md` explains the rules behind this order and where a new module
belongs.

## Configuration

Runtime settings live in `js/core/config.js` under `CONFIG`. Important defaults:

| Setting | Value | Meaning |
|---|---:|---|
| `UNKNOWN_THRESHOLD` | 0.45 | Below this, letter output is treated as uncertain |
| `CONFIDENT_THRESHOLD` | 0.65 | Confident letter display |
| `LETTER_THRESHOLD` | 0.60 | Explicit letter acceptance threshold |
| `WORD_UNKNOWN_THRESHOLD` | 0.15 | Low-confidence word warning; equal to the accept threshold |
| `WORD_CONFIDENT_THRESHOLD` | 0.20 | Stronger word display |
| `WORD_ACCEPT_THRESHOLD` | 0.15 | Manual word acceptance threshold |
| `SMOOTHER_WINDOW` | 5 | Letter temporal label window |
| `WORD_FRAME_COUNT` | 45 | Word recording length |
| `WORD_FIRST_FRAME_TIMEOUT_MS` | 6000 | A recording with no usable frame this long ends |
| `WORD_NO_HAND_TIMEOUT_MS` | 4000 | A recording whose usable frames stop this long ends |
| `WORD_MAX_RECORDING_MS` | 15000 | A recording still not full after this long ends |
| `COACH_HOLD_MS` | 1000 | How long a coach target letter must be held to count |
| `COACH_HOLD_CONFIDENCE` | 0.65 | Smoothed confidence that counts as holding; equal to the confident threshold |
| `COACH_HOLD_GRACE_MS` | 240 | Longest dip that only pauses a hold |
| `COACH_RELEASE_MS` | 400 | Another letter this long before the same target counts again |
| `COACH_MISS_MS` | 1500 | Another letter this long before the coach names it |
| `COACH_ADVANCE_MS` | 2500 | Wait after a success before the next target |
| `COACH_SESSION_SIZE` | 10 | Targets in one practice session or quiz |
| `TOP_K` | 3 | Number of alternatives shown |
| `SELFIE_HANDEDNESS_SWAP` | `false` | Camera-specific handedness correction |

Threshold and handedness changes affect live behavior and require a real-camera
test. Exact feature and model contracts are documented separately.

## Model Test fixture format

Every uploaded fixture uses `schema_version: "asl-sample-v1"` and one task.

Letter fixture:

```json
{
  "schema_version": "asl-sample-v1",
  "task": "letter",
  "features": [0.0],
  "expected_label": "A"
}
```

`features` must contain exactly 93 numbers.

Word fixture:

```json
{
  "schema_version": "asl-sample-v1",
  "task": "word",
  "features": [0.0],
  "mask": [true],
  "expected_label": "bird"
}
```

The real word arrays contain `45 × 168 = 7560` numbers and 45 booleans. Raw
Kaggle parquet files are not accepted by the browser; export them through the
Python evaluation script first.

## Keyboard shortcuts

In letter mode:

| Key | Action | Same as |
|---|---|---|
| `Space` | Add the current letter, when it is confident enough | **Ekle** |
| `Enter` | Add a space | **Boşluk** |
| `Backspace` | Delete the last character | **Sil** |

`Ctrl+D` toggles the debug panel in every mode, and `Escape` closes the phone
menu. There are deliberately no single-letter shortcuts: one that clears the
text or leaves the screen, with no way to turn it off, fails WCAG 2.1.4. A key
pressed while a button, a link or a form field has focus goes to that control,
and any key with `Ctrl`, `Cmd` or `Alt` is left to the browser. Clearing the
transcript (**Temizle**) can be undone from its toast (**Geri al**).

## Deployment

The live site is deployed by dragging this repository's `asl-web/` folder into
the Netlify deploy page; there is no build command. The upload takes the folder
as it is on disk, so run `make deploy-check` from the repository root first: it
fails on anything in here the site does not ship, such as the local
`data/model-test-samples/local/` fixtures, a `.DS_Store` or a `.env`. The other
checks to run before and after the upload are in
[Getting started](../docs/getting-started.md#static-deployment).

Response headers come from `_headers` in this folder, which Netlify applies on
every deploy method. The root `netlify.toml` is not part of a drag-and-drop
upload; it only selects this folder for a Git-linked or CLI deploy. Another
static host can serve the folder unchanged, but only a host that reads
`_headers` will send those headers.

The configured public demo is:

```text
https://asl-assistant.netlify.app/
```

Useful deep links are `#letter`, `#word`, and `#test`.

## Validation

From the repository root:

```bash
# Run from any configured Python environment.
make health          # lint, format, JS syntax and node tests, validation, Python tests
make check           # health plus the JSDoc type check (needs `npm ci` once)
make browser-check   # headless Chrome: cascade, layout, camera stop (OFFLINE=1 skips the CDN)
make web
```

`make browser-check` runs the checks in `tests/browser/` against this folder
as it is: computed style and layout boxes in a real Chrome with a fake camera,
including the phone, landscape and laptop geometry. It needs a Chrome and is
not part of `make health`; see `tests/browser/README.md`.

After automated checks, manually verify model readiness, camera-free
inference, camera start/stop, letter acceptance, word recording/retry, Model
Test, and QR deep links, on a real phone as well as a laptop.

## Known limitations

- J and Z are not supported; the web app contains no trained J/Z model.
- There is no trained no-sign class.
- Word mode recognizes one isolated sign from a fixed 50-word vocabulary; it
  is not continuous translation.
- Live word output is sensitive to framing, timing, lighting, and landmark
  quality.
- The old ZipMap letter export is not browser-compatible; only the active
  no-ZipMap tensor-probability artifact should be deployed.
- CDN availability remains a first-load and offline-use risk.

## Directory map

```text
asl-web/
├── index.html
├── _headers               response headers for the Netlify deploy
├── css/
│   ├── style.css          layer order, then the pre-redesign rules (legacy layer)
│   ├── tokens.css         colours, type, space, radius, motion: the only raw values
│   ├── base.css           fonts, document defaults, focus ring
│   ├── components.css     buttons, mode switch, stage, caption plate, panels
│   └── layout.css         shell and workspace for phone, landscape and laptop
├── js/
│   ├── core/              theme-boot.js (theme before first paint), config.js,
│   │                      runtime.js (state, element registry), app.js (start-up, routes, camera)
│   ├── media/             camera.js (MediaPipe tasks), overlay.js (landmark drawing)
│   ├── ml/                landmarks, features, gating, letter and word models, live inference
│   ├── services/          benchmark.js
│   └── ui/                prediction.js, plate-side.js, toast.js, transcript.js,
│                          word-flow.js, coach.js, reference.js, qr.js, model-test.js
├── types/                 browser-globals.d.ts: the CDN globals, for the type check
├── models/
│   ├── letter_model.onnx.gz   what the browser downloads
│   ├── letter_model.onnx      same model uncompressed: fallback and validation
│   └── word_model.onnx
├── data/                  labels, calibration, teaching data, fixtures
├── favicon.ico
└── assets/
    ├── fonts/             Atkinson Hyperlegible Next and Mono (OFL), subset
    ├── icons/             apple-touch-icon.png
    ├── social-preview.png link preview image (og:image)
    └── signs/             letter and word reference images
```

The QR view is generated at runtime from `CONFIG.DEMO_PUBLIC_URL`; it does not
use a committed QR image. Locally exported `assets/qr-*.svg` and
`assets/qr-*.png` snapshots are ignored because they become stale when the
public URL changes.

See [Models and data](../docs/models-and-data.md) and
[Architecture](../docs/architecture.md) before changing the
ML path.
