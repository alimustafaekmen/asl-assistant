# Architecture

ASL Assistant has one product, a static browser application in `asl-web/`. The
rest of the repository produces, validates or documents what that application
loads: Python feature code, training records, validation scripts, and an older
desktop prototype.

## System boundary

```text
Development and validation
datasets -> scripts / notebooks -> source artifacts
                  |                      |
                  +---- parity + hash ---+
                                         |
                                         v
Browser runtime
camera -> MediaPipe -> features -> ONNX models -> UI
```

The web path has no Python service, account system, database or application
API. Camera frames are processed in the browser and never sent to a server of
this project. ONNX Runtime Web, MediaPipe and the QR library are downloaded
from public CDNs when needed, so the first visit needs a network connection.

## Repository map

```text
asl-web/       the browser application and the artifacts it loads
asl-ml/        shared Python feature code and label helpers
asl-desktop/   CustomTkinter prototype (legacy)
models/        curated letter and word model files, the source of the deployed copies
notebooks/     word-model training notebooks and recorded results
scripts/       data preparation, training, evaluation, validation, environment tooling
tests/         Python tests, Node tests for the browser code, headless-Chrome checks
data/          local dataset workspace; only its README is tracked
docs/          this documentation
```

Dependencies point one way:

```text
asl-web/                    browser APIs and its own files only
asl-desktop/                asl-ml, models/word/desktop-25
scripts/                    asl-ml; the J/Z training tool also uses asl-desktop
tests/                      public code and artifact contracts
models/letter/              source of the deployed letter model and labels
models/word/web-50/         source of the deployed word model, labels and calibration
notebooks/word_50_results/  source of the word evaluation and teaching data
```

The web application imports no Python, reads nothing from `data/`, and does
not depend on files that Git ignores. The desktop prototype's 25-word model
(`models/word/desktop-25/`) is a separate artifact from the web application's
50-word model.

Configuration lives with its owner:

- `asl_ml.config`: landmark counts, class domains and letter augmentation
  settings shared by Python code;
- `asl_desktop.config`: desktop paths, camera, thresholds, UI, speech and
  sequence-model defaults;
- `asl-web/js/core/config.js`: browser thresholds, label lists, timing and
  reference assets.

Training and data scripts work out their own input and output paths, so
`asl-ml` carries no UI or repository-layout policy.

## Browser application

### Scripts and styles

The page loads classic scripts, not ES modules, in the order below. The order
is a runtime contract; `asl-web/js/README.md` explains the rules behind it and
`tests/web/module-contracts.test.js` loads the files the way the browser does.

```text
core/theme-boot.js          (in <head>, before the stylesheets)
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
core/app.js                 (last; the only script with startup side effects)
```

| File | Responsibility |
|---|---|
| `index.html` | Every screen, the controls, accessibility labels, script loading |
| `css/style.css` | Declares the cascade layer order and holds the pre-redesign rules in the `legacy` layer, removed screen by screen as each one is rebuilt |
| `css/tokens.css` | Design tokens for both themes; the only file with raw colour and size values |
| `css/base.css` | Self-hosted fonts, document defaults, the focus ring |
| `css/layout.css` | The shell and camera workspace for phone, phone landscape and laptop; which parts show in which mode |
| `css/components.css` | Buttons, mode switch, camera stage, caption plate, transcript strip, panels |
| `css/screens-coach.css` | The coach screen: target tile, plate extras, session row, dock, letter grid and the phone sheet |
| `css/screens-info.css` | The Model Test, QR and project screens and their shared parts (segmented control, notices, result table), in the `screens` layer |
| `css/screens-word.css` | The word screen (recording HUD, result plate, dock states) and the reference viewer, in the `screens` layer |
| `js/core/theme-boot.js` | Resolves the theme before the first paint |
| `js/core/config.js` | Runtime configuration, label lists, difficulty sets, reference assets |
| `js/core/runtime.js` | Shared state, the DOM registry, the canvas context, word recording buffers |
| `js/core/app.js` | Bootstrap, event wiring, hash routing, camera start and stop, render loop, `window.aslDebug` |
| `js/media/camera.js` | MediaPipe task lifecycle (GPU with CPU fallback) and the detection loop |
| `js/media/overlay.js` | Landmark drawing on the camera canvas |
| `js/ml/landmarks.js` | MediaPipe output to the fixed 321D frame, shoulder normalization |
| `js/ml/features.js` | 93D letter features and 168D word features |
| `js/ml/live-inference.js` | Live letter and word inference, finishing a word recording |
| `js/ml/letter-model.js` | Letter ONNX session and probability parsing |
| `js/ml/word-model.js` | Word ONNX session, mask dtype handling, temperature, top-3 |
| `js/ml/gating.js` | Letter label smoothing; word difficulty and confusion feedback |
| `js/ml/hold.js` | Hold detection for the coach: a target held steadily counts once |
| `js/services/benchmark.js` | Latency measurements |
| `js/ui/prediction.js` | Prediction and top-3 display, status messages, the word result decision |
| `js/ui/plate-side.js` | Laptop result plate: moves to the other bottom corner when a hand stays under it (time-based hysteresis) |
| `js/ui/toast.js` | Toasts with one optional action, and the screen-reader live region |
| `js/ui/transcript.js` | Transcript editing, persistence, clipboard, speech output |
| `js/ui/word-flow.js` | Word countdown, recording clock, framing and quality readout, action bar |
| `js/ui/coach.js` | Learning coach targets, study flows, scoring, word guidance panel |
| `js/ui/reference.js` | Reference images, word cards, video links, viewer dialog |
| `js/ui/qr.js` | Deep-link URL and QR code |
| `js/ui/model-test.js` | Fixture loading, validation and model runs for the Model Test screen |

The stylesheets are linked after `theme-boot.js` in this order: `style.css`,
`tokens.css`, `base.css`, `layout.css`, `components.css`, `screens-coach.css`,
`screens-info.css`, `screens-word.css`. The layer order declared in `style.css`
(`legacy, tokens, base, components, layout, screens, utilities`) decides the
cascade, not the link order.

The scripts share browser globals. `core/runtime.js` creates the shared
mutable state once, and `core/app.js` is the only script that does asynchronous
work or binds events while the scripts load. Reordering the files or turning
them into modules is a structural change and needs the full set of checks
below, including `make browser-check`.

### Live path

Two loops cooperate:

```text
media/camera.js   detection loop -> latestMediaPipeResult -> media/overlay.js
core/app.js       render loop    -> ml/live-inference.js
                                    -> ml/landmarks.js        321D + normalization
                                    -> ml/features.js         93D letter / 168D word
                                    -> ml/letter-model.js, ml/word-model.js
                                    -> ui/prediction.js, ui/word-flow.js, ui/coach.js
```

### Type checking

The sources carry JSDoc types that TypeScript checks without emitting anything
(`make js-typecheck`). TypeScript is a checker here, not a source language:
there is no build step and the deployed files are the `.js` sources.
`asl-web/types/browser-globals.d.ts` only describes globals the app does not
own: the part of ONNX Runtime it uses, the QR generator, and the debug
snapshots attached to `window`. Serving the app and running `make health` need
no npm install; the type check needs `npm ci` once.

## Screens and routes

| Hash | Screen (UI label) | Camera |
|---|---|---|
| `#letter` | Letter translation (Harf) | yes |
| `#word` | Word practice (Kelime, marked experimental) | yes |
| `#coach` | Learning coach (Koç) | yes |
| `#test` | Model Test (Kamerasız dene) | no |
| `#project` | Project summary (Nasıl çalışır) | no |
| `#qr` | QR demo (Telefonda aç) | no |

An unknown hash opens letter mode. There is no separate home screen: the brand
link opens the letter screen, whose empty camera stage explains the app.

## Startup and camera lifecycle

At startup `core/app.js` restores the theme and the saved transcript, builds
the coach options, binds events, applies the URL hash, starts the render loop,
and then fetches a few small JSON files (reference video links, the Model Test
manifest, word guidance data). It loads no model. Each ONNX session and its
labels load the first time something needs them: the camera starting in a mode
that runs the model, a word recording, or a Model Test run. A model that fails to load is forgotten, so the next need retries.

Starting the camera:

1. asks for `getUserMedia` permission and waits for the first video frame;
2. starts downloading the models the current mode runs, and in parallel creates
   the MediaPipe hand, pose and face tasks;
3. starts the detection loop, a single `requestAnimationFrame` loop; and
4. reports progress and any problem on the status line.

Stopping the camera stops every media track, cancels the detection loop, closes
the MediaPipe tasks, abandons a recording in progress and resets prediction and
smoothing state. A stop that arrives while a start is still waiting (for the
permission prompt or for MediaPipe) cancels that start. A track that the
browser ends is handled like a stop and tells the user.

The camera also stops when the visitor opens the brand link or one of the
screens that need no camera (`#test`, `#project`, `#qr`). Switching between
letter, word and coach keeps it running and loads whichever model the new mode
needs. Hiding something is never treated as releasing it: a camera that is
still running behind a hidden screen is a bug.

## Letter mode

```text
camera frame
  -> MediaPipe Hand Landmarker
  -> pick a visible hand; mirror a left hand to the right-hand layout
  -> landmark EMA smoothing
  -> 93D feature vector
  -> LightGBM ONNX probability tensor
  -> label smoothing and confidence thresholds
  -> live result; the user adds it to the transcript
```

The model has 24 static letter classes. J and Z need motion and are not
implemented; no model for them is deployed. A frame without a hand resets the
landmark and label smoothing so an earlier sign cannot carry across the gap.

The letter reaches the transcript through the user: Space adds the current
letter if its confidence is at least `LETTER_THRESHOLD`, Enter adds a space,
Backspace removes the last character. These keys act only in letter mode and
never while focus is in a form control; the on-screen buttons call the same
functions.

## Word mode

```text
camera frames
  -> hand + pose + selected face landmarks
  -> shoulder-normalized 321D frames
  -> up to 45 frames that have hand, face and shoulders
  -> one dominant hand chosen for the whole sequence
  -> 168D features per frame
  -> padding mask
  -> SignTransformer ONNX logits
  -> temperature scaling, softmax, top-3
  -> the user reviews the result and accepts it
```

Recording follows a fixed state machine:

```text
IDLE -> COUNTDOWN -> RECORDING -> PROCESSING -> RESULT
```

Starting, retrying, finishing, changing mode and stopping the camera reset the
frame buffers, the mask, the motion history and the framing readout, so one
recording cannot leak into the next. A recording that cannot fill ends by
itself instead of waiting at 0/45: when no usable frame arrives, when usable
frames stop arriving, or when the whole recording runs too long (the limits are
`WORD_FIRST_FRAME_TIMEOUT_MS`, `WORD_NO_HAND_TIMEOUT_MS` and
`WORD_MAX_RECORDING_MS`, listed in the [web README](../asl-web/README.md)). It
is also abandoned when the page is hidden. A result is shown only if no newer
recording has started in the meantime.

The mask is `true` for a real frame and `false` for padding. The exported ONNX
graph inverts it itself, so it must not be inverted before the call.

Word results are never added to the transcript on their own. After a
recording, `assessWordResult()` in `ui/prediction.js` decides what the user is
offered: no word if the model produced nothing; "not sure" below
`WORD_ACCEPT_THRESHOLD`, with accept disabled; "check before adding" when the
top two results are close or the framing was poor; otherwise "usable". Accept
appends the word once, and only for the latest recording. The reason for this
is practical: confidence is often low for a correct word, and similar signs can
be separated by a small margin.

## Other screens

| Screen | Behaviour |
|---|---|
| Learning coach | Shows a target and the progress kept on this device. A letter target is scored by holding it: a steady hold for the hold time counts once, and the same pose counts again only after it is released. A button press never scores a letter. A word target is scored after a completed recording. |
| Model Test | Runs versioned JSON fixtures straight through the browser ONNX sessions, without the camera, one sample or a whole set at a time. Made-up and local samples are kept out of the accuracy summary. |
| QR demo | Builds deep links to the letter, word and Model Test screens, draws the QR code, and offers copy and the system share sheet. A page served from `localhost` uses the published demo URL, since a phone cannot reach `localhost`. |
| Project | A short summary of the models and their limits inside the app. |

Word results are never appended automatically. This is deliberate: live
confidence is often low and visually similar signs can have small top-1/top-2
margins.

## State and persistence

State lives in JavaScript memory. Three things are stored in `localStorage`:
the theme choice (`asl-theme`), the transcript (`asl-web-transcript`) and the
coach progress (`asl-coach-v1`, which the coach can reset). Nothing about a
visitor leaves the browser. Storage that is blocked or unavailable must leave
the app working.

## Markup and script contracts

Scripts reach the page in two ways and no other. `core/runtime.js` binds
elements by id into the shared `els` registry, and the few lookups that
collect a group of elements resolve a `data-ui` hook with `queryUi()` and
`queryAllUi()`. No script finds an element by a presentation class, so the
design can change without touching behaviour.

Renaming therefore comes in two kinds:

- **A class** (`camera-column`, `modes__item`, the mode visibility classes
  `mode-only`, `letter-only`, `word-only`, `coach-only`) is a CSS and HTML
  change only.
- **An id or a `data-ui` hook** is a behaviour contract. It needs the HTML, the
  registry and the hook list in `tests/project/test_web_ui_contracts.py`
  changed together.

The registry separates required from optional elements. `requireElement()`
throws, naming the id, while the scripts load, so a dropped element is a
startup error and not a null dereference once its screen opens. Optional
elements resolve to `null` and every reader guards them.

Event bindings run once and guard a second call, since each one adds a
listener. Render functions rebuild their root from state and start no
listener, timer, fetch or model session.

After a UI change, check desktop and phone widths, keyboard focus, that the
camera is released when you leave a camera screen, word retry and reset,
fixture inference and QR links.

## Artifact ownership

Each deployed model and data file is a byte-for-byte copy of a tracked source:

```text
models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx
  -> asl-web/models/letter_model.onnx
  -> asl-web/models/letter_model.onnx.gz        (gzip of the file above)

models/word/web-50/word_model.onnx
  -> asl-web/models/word_model.onnx

models/letter/letter_label_map.json
  -> asl-web/data/letter_labels.json

models/word/web-50/{word_labels,temperature}.json
  -> asl-web/data/{word_labels,temperature}.json

notebooks/word_50_results/{per_word_stats,confusion_pairs,curriculum,test_sample}.json
  -> asl-web/data/ (same file names)
```

The other files in `asl-web/data/` and `asl-web/assets/` (video links, the
curated letter teaching data, `word_reference.json`, `model-card.json`, the
sign reference images) are curated in place and have no separate source.
`scripts/validation/contracts.py` is the single list of all of them. The
validators compare hashes, check that the gzip copy decompresses to the deployed
model, and inspect the ONNX inputs and outputs; do not edit a deployed copy on
its own.

## External dependencies

The page loads ONNX Runtime Web 1.22.0 and `kjua` 0.9.0 (QR codes) from
jsDelivr with Subresource Integrity hashes. MediaPipe Tasks Vision 0.10.18 is
imported from jsDelivr, and its three landmark models (version `1` of each) come
from Google Cloud Storage. Fonts are self-hosted. The browser provides WebRTC
for the camera, `localStorage`, Web Speech for reading the transcript aloud, and
WebAssembly.

Static hosting needs no server, but the CDNs are a first-load and offline risk.
Bundling these files into `asl-web/` would change the deployment and needs a
review of size, licences, caching and browser support. `asl-web/_headers` sends
the security headers, including a report-only Content Security Policy.

## Failure modes

| Failure | Effect | Detection or mitigation |
|---|---|---|
| CDN or task file unavailable | Models or MediaPipe do not start | Status message; the browser Network panel |
| Wrong artifact copy | Shapes, labels or results drift | Hash and ONNX contract validation |
| Feature-order drift | Plausible but meaningless predictions | Python and JavaScript parity checks |
| Handedness mismatch | Letter behaviour changes with hand or camera | Left-hand mirroring, plus a test on a real camera |
| Missing face or shoulders | Word frames are not accepted | Framing readout, quality diagnostics, recording timeout |
| Stale recording state | Motion leaks into the next word | Reset at every recording boundary |
| Non-secure phone origin | The camera API is refused | HTTPS hosting |

## What the checks cover

| Command | Covers |
|---|---|
| `make health` | Lint, formatting, JavaScript syntax and Node tests, Git hygiene, runtime assets and hashes, ONNX contracts, word and letter feature parity, the fast Python tests. Needs no npm install. |
| `make check` | `make health` plus the JSDoc type check. |
| `make browser-check` | Real-Chrome facts the Node tests cannot see: cascade layers, hidden and mode-only rules, dark theme, horizontal overflow, camera release. Needs Chrome. |
| `make deploy-check` | `make validate` plus a list of every file in `asl-web/`; run before every upload. |

None of them covers lighting, camera permission prompts, handedness metadata,
device speed or live signing. Those need a real browser, a camera and a person
signing; see [Getting started](getting-started.md#static-deployment) for the
manual checklist before an upload.

## Related documents

- [Getting started](getting-started.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web application notes](../asl-web/README.md)
- [Browser module notes](../asl-web/js/README.md)
