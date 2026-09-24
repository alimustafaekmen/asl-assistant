# Architecture

ASL Assistant separates the deployable browser application from Python tools,
training records, and the legacy desktop prototype. The browser is the product;
the other layers create, validate, or explain its artifacts.

## System boundary

```text
Development and validation
datasets -> scripts/notebooks -> source artifacts
                  |                    |
                  +---- parity/hash ---+
                                       |
                                       v
Browser runtime
camera -> MediaPipe -> features -> ONNX models -> UI
```

The web path has no Python service, account system, database, or application
API. Camera pixels are processed in the browser and are not sent to an
application server. External libraries and MediaPipe task files are currently
downloaded from CDNs on first load.

## Repository map

```text
asl-web/       deployable browser application and runtime artifacts
asl-ml/        shared Python ML contracts, features, and data helpers
asl-desktop/   legacy CustomTkinter prototype and desktop configuration
data/          local dataset workspace; only its source manifest is published
models/        curated letter and word model artifacts
notebooks/     word-model training records, metrics, and figures
scripts/       data preparation, training, evaluation, and validation tools
tests/         unit, integration, contract, guardrail, and parity checks
docs/          maintained documentation
```

Dependency direction is intentionally one-way:

```text
asl-web/                 -> browser APIs and web assets only
asl-desktop/             -> asl-ml + models/word/desktop-25
scripts/                 -> asl-ml; desktop J/Z tooling -> asl-desktop
tests/                   -> public code and artifact contracts
models/letter/           -> source of deployed letter artifacts
models/word/web-50/      -> source of deployed word model/labels/calibration
notebooks/word_50_results/ -> source of word evaluation and teaching data
```

The deployed web application must not import Python packages, read root data,
or depend on ignored historical experiments. The desktop's 25-word model is a
separate published artifact under `models/word/desktop-25/`; it is unrelated to
the 50-word web pipeline.

Configuration follows ownership instead of living in a root catch-all module:

- `asl_ml.config` owns shared Python landmark, class-domain, and letter
  augmentation contracts;
- `asl_desktop.config` owns desktop paths, camera behavior, thresholds, UI,
  speech, coach, and desktop sequence-model defaults; and
- `asl-web/js/core/config.js` owns browser runtime configuration.

Training and data scripts derive their repository input/output paths locally.
This keeps `asl-ml` free of UI and repository-layout policy and prevents the
browser from depending on Python configuration.

## Browser modules

The application uses classic scripts in a fixed order:

```text
core/config.js
core/runtime.js
ml/landmarks.js
ml/features.js
services/benchmark.js
ml/gating.js
ml/letter-model.js
ml/word-model.js
media/overlay.js
media/camera.js
ml/live-inference.js
ui/prediction.js
ui/transcript.js
ui/word-flow.js
ui/coach.js
ui/reference.js
ui/qr.js
ui/model-test.js
core/app.js
```

| Component | Responsibility |
|---|---|
| `index.html` | Screen structure, controls, accessibility labels, script loading |
| `css/style.css` | Layout, theme, responsive rules, state classes |
| `js/core/config.js` | Runtime configuration, label domains, difficulty sets, reference assets |
| `js/core/runtime.js` | Shared application state, DOM registry, canvas context, recording buffers |
| `js/core/app.js` | Bootstrap, event wiring, hash routing, camera start/stop, render loop, debug API |
| `js/media/camera.js` | MediaPipe task lifecycle and the frame detection loop |
| `js/media/overlay.js` | Landmark drawing on the camera canvas |
| `js/ml/landmarks.js` | MediaPipe output to the fixed 321D word landmark layout |
| `js/ml/features.js` | 93D letter and 168D word feature extraction |
| `js/ml/live-inference.js` | Live letter/word inference and word recording finalization |
| `js/ml/letter-model.js` | Letter ONNX session and prediction parsing |
| `js/ml/word-model.js` | Word ONNX session, mask compatibility, calibration, top-3 |
| `js/ml/gating.js` | Temporal smoothing and difficulty/confusion feedback |
| `js/services/benchmark.js` | Browser latency measurements |
| `js/ui/prediction.js` | Prediction, top-3, status message, feedback, word result guide |
| `js/ui/transcript.js` | Transcript editing, persistence, clipboard, speech output |
| `js/ui/word-flow.js` | Word countdown, recording progress, quality readout, action buttons |
| `js/ui/coach.js` | Coach targets, study flows, scoring, word guidance panel |
| `js/ui/reference.js` | Reference images, video links, lightbox |
| `js/ui/qr.js` | Demo deep-link URL and QR rendering |
| `js/ui/model-test.js` | Offline fixture loading, validation, and model runs |

The files communicate through browser globals. `core/runtime.js` is the single
owner of the shared mutable state every other module reads and writes, and
`core/app.js` is the only script with startup side effects. Reordering them or
converting them to modules is a structural runtime change and requires full
browser tests.

The live path runs through two cooperating loops:

```text
media/camera.js   detection loop  -> latestMediaPipeResult -> media/overlay.js
core/app.js       render loop     -> ml/live-inference.js
                                     -> ml/landmarks.js  321D + normalization
                                     -> ml/features.js   93D letter / 168D word
                                     -> ml/letter-model.js, ml/word-model.js
                                     -> ui/prediction.js, ui/word-flow.js, ui/coach.js
```

`asl-web/js/README.md` documents the load-order rules, the JSDoc type
contracts, and where new modules go.

The browser sources carry JSDoc types that TypeScript can verify in no-emit
mode with `make js-typecheck`. TypeScript is a checker here, not a source
language: there is no build step, no generated output, and the deployed files
are the `.js` sources themselves. The only declaration file,
`asl-web/types/browser-globals.d.ts`, describes globals the app does not own --
the ONNX Runtime surface it uses, the QR generator, and the debug snapshots
attached to `window`. Running or serving the app, and `make health`, need no
package install.

## Startup and camera lifecycle

At startup, `core/app.js` restores local preferences, binds DOM events, loads a
few small runtime JSON files, and applies the URL hash. It loads no model: each
ONNX session and its labels load the first time something needs them, usually
the camera starting in a mode that runs that model. Camera initialization is
deferred until the user requests it.

Starting the camera:

1. requests `getUserMedia` permission;
2. creates the required MediaPipe tasks for the selected mode;
3. starts a single `requestAnimationFrame` loop; and
4. updates UI readiness and visibility feedback.

Stopping the camera releases media tracks, cancels the animation frame, closes
MediaPipe tasks, and resets prediction and recording state. Returning home also
stops the camera to protect privacy and battery life.

## Letter mode

```text
camera frame
  -> MediaPipe Hand Landmarker
  -> select a visible hand; standardize a selected left hand
  -> landmark EMA smoothing
  -> 93D feature vector
  -> LightGBM ONNX probability tensor
  -> label smoothing and confidence gate
  -> live result; explicit transcript acceptance
```

The mode supports 24 static letter classes. J and Z are not implemented, and
the application contains no trained or deployed model for them. If both hands
disappear, landmark and label smoothing reset so an old prediction cannot leak
across the gap.

## Word mode

```text
camera frames
  -> hand + pose + selected face landmarks
  -> shoulder-normalized 321D frames
  -> collect up to 45 valid frames
  -> choose one dominant hand for the complete sequence
  -> 168D compact features per frame
  -> padding mask
  -> SignTransformer ONNX logits
  -> temperature scaling, softmax, top-3
  -> user review and explicit acceptance
```

Recording follows this state machine:

```text
IDLE -> COUNTDOWN -> RECORDING -> PROCESSING -> RESULT
```

Starting, retrying, finishing, changing mode, and stopping the camera reset the
frame buffer, normalized-frame buffer, mask, motion history, and wait-message
state. These resets prevent one recording from contaminating the next.

The logical mask convention is `true` for a real frame and `false` for padding.
The exported ONNX graph performs the attention-mask inversion internally.

## Other product modes

| Mode | Behavior |
|---|---|
| Learning Coach | Shows a target and local progress. Letter scoring occurs only after the explicit check action; word scoring occurs after a completed recording. |
| Model Test | Runs versioned JSON features directly through the browser ONNX sessions without using the camera. |
| QR Demo | Creates deep links for letter, word, and Model Test views. |
| Project | Shows a concise technical summary inside the application. |

Word results are never appended automatically. This is deliberate: live
confidence is often low and visually similar signs can have small top-1/top-2
margins.

## State and persistence

Runtime state is held in JavaScript memory. Theme, transcript, and learning
progress use browser LocalStorage. There is no server-side session. Local data
must not be described as a cloud profile or formal learning assessment.

## UI contracts

The browser scripts reach the page through two mechanisms and nothing else.
`core/runtime.js` binds elements by ID into the shared registry, and the few
lookups that collect a group of elements resolve a `data-ui` hook through
`queryUi()` / `queryAllUi()`. No script finds an element by a presentation
class, which is what lets the design change without touching behaviour.

That splits renaming into two different jobs:

- **A class** (`camera-column`, `mode-tab`, `word-flow-steps`, and the mode
  visibility classes `mode-only`, `letter-only`, `word-only`, `coach-only`,
  which are CSS and HTML only) is a CSS and HTML change. No JavaScript is
  involved, and the contract tests confirm it.
- **An ID or a `data-ui` hook** is a behaviour contract. It needs the HTML, the
  registry, and the hook catalogue in
  `tests/project/test_web_ui_contracts.py` changed together.

Elements are either required or optional, and the registry says which:
`requireElement()` throws naming the id while the scripts load, so a dropped
element is a startup error rather than a null dereference once its screen
opens; optional ones resolve to null and every reader guards them.

Event bindings run once and guard a second call, since each one adds a listener
rather than replacing one. Render functions rebuild their root from state and
start no listener, timer, fetch or model session.

The UI follows three priorities:

1. letter mode remains the primary experience;
2. word mode communicates uncertainty and requires review; and
3. Model Test results remain separate from official evaluation metrics.

After UI changes, test desktop and mobile widths, keyboard focus, camera
release on home navigation, word retry/reset, fixture inference, and QR links.

## Artifact ownership

```text
models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx
  -> asl-web/models/letter_model.onnx

models/word/web-50/word_model.onnx
  -> asl-web/models/word_model.onnx

models/letter/letter_label_map.json
  -> asl-web/data/letter_labels.json

models/word/web-50/{word_labels,temperature}.json
  -> asl-web/data/{word_labels,temperature}.json

notebooks/word_50_results/{per_word_stats,confusion_pairs,curriculum,test_sample}.json
  -> matching asl-web/data/*.json
```

Deployment copies must not be edited independently. Validation scripts compare
source and deployed hashes and inspect ONNX input/output contracts.

## External dependencies

The page currently loads ONNX Runtime Web 1.22.0, MediaPipe Tasks Vision
0.10.18, MediaPipe task assets, and `kjua` 0.9.0 from external hosts. Browser
WebRTC, LocalStorage, Web Speech, and WebAssembly provide the remaining runtime
capabilities.

Static hosting avoids a server dependency, but CDN availability remains a
first-load and offline risk. Vendoring those dependencies would be a deployment
change requiring size, license, cache, and browser compatibility review.

## Failure modes

| Failure | Effect | Detection or mitigation |
|---|---|---|
| CDN or task asset unavailable | Models or MediaPipe do not initialize | Readiness message and browser network inspection |
| Wrong artifact copy | Shapes, labels, or results drift | Hash and ONNX contract validation |
| Feature-order drift | Plausible but meaningless predictions | Python/JavaScript parity tests |
| Handedness mismatch | Letter behavior changes by hand or camera | Standardization plus real-camera testing |
| Missing face or shoulders | Word capture pauses or degrades | Visibility feedback and quality diagnostics |
| Stale recording state | Motion leaks into the next word | Reset contract at every recording boundary |
| Non-secure phone origin | Camera API is rejected | HTTPS deployment |

## Validation boundary

`make health` checks repository hygiene, runtime assets, provenance, model I/O,
available parity checks, and fast Python tests. It cannot validate lighting,
camera permissions, handedness metadata, device performance, or live signing.
Those require a real browser and camera.

## Related documents

- [Getting started](getting-started.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
