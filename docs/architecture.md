# Architecture

<sub>Location: [`asl-assistant`](../README.md) / [`docs`](README.md) / `architecture.md`</sub>

<sub>Related: [`asl-web/js/`](../asl-web/js/README.md) · [`docs/models-and-data.md`](models-and-data.md) · [`TECHNICAL_REPORT.md`](../TECHNICAL_REPORT.md)</sub>

Start with the repository map and what each component depends on, then follow
a camera frame until it becomes a letter or a word on the screen. The
[browser module notes](../asl-web/js/README.md) list every script and the rules
for changing them; the [technical report](../TECHNICAL_REPORT.md) explains why
the system is built this way and what was measured.

## Repository map

```text
asl-web/        the product: a static browser app and every file it loads
asl-features/   Python feature code, the source of truth for both models' input
asl-desktop/    an earlier Python desktop prototype, kept working
models/         curated letter and word model files, the sources of the deployed copies
notebooks/      word-model training notebooks and their exported results
scripts/        data preparation, training, fixture export, validation, environment tools
tests/          Python tests, Node tests for the browser code, headless-Chrome checks
data/           local dataset workspace; only its README is tracked
docs/           these guides
```

At the root, the `Makefile` holds the commands (`make help` lists them),
`requirements.txt` and `environment.yml` set up Python, and `package.json`
installs only TypeScript, for the type check. `netlify.toml` names `asl-web/`
as the folder to publish for a Git-linked or command-line deploy.

## Components and what they depend on

The repository has three components. They share files and tests, not code.

| Component | What it is | Depends on |
|---|---|---|
| `asl-web/` | The live product: HTML, CSS and JavaScript that the browser runs as they are, with no build step and no server code | Browser APIs, its own files, and three libraries from public CDNs: ONNX Runtime Web 1.22.0, MediaPipe Tasks Vision 0.10.18 and `kjua` 0.9.0 (QR codes) |
| `asl-features/` | The Python package `asl_features`, which turns landmarks into model input: hand normalization, the 93-value letter vector and the 45 × 168 word features | NumPy only |
| `asl-desktop/` | The CustomTkinter prototype `asl_desktop`, with its own 25-word model | `asl-features`, `models/letter/letter_model.pkl`, `models/word/desktop-25/`, and OpenCV, MediaPipe, LightGBM and PyTorch among others |

The web app imports no Python and reads nothing from the top-level `data/`
folder. It needs no file that Git ignores: the one ignored folder it reads,
`asl-web/data/model-test-samples/local/`, holds optional Model Test samples
and may be absent.

The other folders produce or check what the components load:

- `scripts/` imports `asl-features`; the J and Z training tool also imports
  `asl-desktop`. Each script works out its own input and output paths, so
  `asl-features` holds no repository layout.
- `notebooks/` trains the word models. Its exported results in
  `notebooks/word_50_results/` and the files in `models/` are the sources of
  the deployed copies.
- `tests/` covers all three components. The parity commands in
  `tests/validation/` run the Python and the JavaScript feature code side by
  side.

### Where Python and the browser meet

The browser never calls Python. Two links keep the sides in step:

```text
datasets -> scripts/, notebooks/ -> models/, notebooks/word_50_results/
                                          |
                                          |  copied byte for byte; make validate checks the hashes
                                          v
camera -> MediaPipe -> asl-web/js/ml/ -> asl-web/models/*.onnx -> screen
                             |
                             |  same output as asl-features; make parity checks it
```

1. **Features.** `ml/landmarks.js` and `ml/features.js` re-implement
   `asl-features` in JavaScript. `make parity` gives both the same landmarks
   and compares the output, and the feature goldens (fixed inputs with their
   expected outputs, in `tests/web/fixtures/feature-golden.json`) are checked
   from both languages. The word features in `asl_features.word` are the
   training notebook's own code, and `tests/asl_features/unit/test_word.py`
   holds the two equal.
2. **Artifacts.** Every deployed model, label map and exported result is a
   copy of a tracked source. `scripts/validation/contracts.py` lists each
   pair; `make validate` compares their SHA-256 hashes, checks that
   `letter_model.onnx.gz` decompresses to the deployed model, and inspects
   the ONNX inputs and outputs. The pairs are listed in
   [Models and data](models-and-data.md#artifact-provenance). Never edit a
   deployed copy on its own.

The other files in `asl-web/data/` and `asl-web/assets/` (video links, letter
teaching data, word reference cards, the model card, the sign images) are
edited in place and have no separate source.

## The browser app

### Classic scripts in a fixed order

`asl-web/index.html` holds every screen and loads 31 plain `<script>` files.
They are classic scripts, not ES modules: they share one global scope, and a
file can use what an earlier file defined. That makes the order a runtime
contract:

- `core/theme-boot.js` and `core/lang-boot.js` run in `<head>`, before the
  stylesheets, so the first paint already has the visitor's theme and
  `<html lang>` names their language.
- `core/i18n.js`, the strings files under `i18n/` and `core/i18n-boot.js`
  open the body's scripts, before the CDN script tags, so the page is in the
  visitor's language before the browser waits on a CDN. Until they have
  run, a page in English is kept hidden (`data-i18n-pending` on `<html>`,
  with a 3 s fail-safe in `css/base.css`), so the Turkish markup is never
  painted.
- `core/config.js` and then `core/runtime.js` come next. `runtime.js` creates
  the shared `state` object, the `els` registry of page elements and the word
  recording buffers, once.
- The `ml/`, `media/`, `services/` and `ui/` files only declare functions and
  values.
- `core/app.js` comes last. It is the only script with startup side effects:
  it calls `init()`. The boot scripts only write onto `<html>` or translate
  the parsed markup, and the strings files only register.

ONNX Runtime Web and `kjua` are script tags placed before the app's own, with
Subresource Integrity hashes (the browser checks the file against a hash
before running it). MediaPipe is not a script tag: `media/camera.js` imports
it the first time the camera starts.

The full list, the reasons for its order and where a new file goes are in the
[browser module notes](../asl-web/js/README.md).
`tests/project/test_web_ui_contracts.py` compares the documented list with
`index.html`, and `tests/web/module-contracts.test.js` loads the scripts the
way the browser does.

### Modules by folder

| Folder | Files | What they do |
|---|---|---|
| `core/` | `theme-boot.js`, `lang-boot.js`, `i18n.js`, `i18n-boot.js`, `config.js`, `runtime.js`, `app.js` | Theme and language before the first paint; the strings registry, translation and the language switch; settings and label lists; shared state and the element registry; startup, routing, camera start and stop, the render loop and the `window.aslDebug` console helper |
| `i18n/` | `shell.js`, `letter.js`, `word.js`, `coach.js`, `info.js` | The interface strings of each area, Turkish and English side by side |
| `media/` | `camera.js`, `demo-source.js`, `overlay.js` | The MediaPipe tasks and the detection loop; the camera-free demo, which plays a recorded hand as a second frame source; the landmarks drawn over the video or the demo's square |
| `ml/` | `landmarks.js`, `features.js`, `gating.js`, `hold.js`, `letter-model.js`, `word-model.js`, `live-inference.js` | The 321-value landmark frame; letter and word features; letter smoothing and word feedback data; hold detection for the coach; the two ONNX sessions; running them on live frames |
| `services/` | `benchmark.js` | Latency measurements shown in the debug panel |
| `ui/` | `prediction.js`, `plate-side.js`, `toast.js`, `transcript.js`, `word-flow.js`, `coach.js`, `reference.js`, `qr.js`, `model-test.js` | The result plate and messages; the transcript; the word recording flow; the coach; reference images; the QR and Model Test screens |

Scripts find page elements only by `id` or by a `data-ui` attribute, never by
a styling class, so the design can change without touching behaviour.
Listeners are bound once, in `bindEvents()` in `core/app.js`, and render
functions only rebuild from state. The rules are in
[DOM contracts](../asl-web/js/README.md#dom-contracts). The code carries JSDoc
types that `make js-typecheck` checks with TypeScript, which emits nothing;
see [type contracts](../asl-web/js/README.md#type-contracts).

State lives in memory. Three things are kept in `localStorage`: the theme
choice (`asl-theme`), the transcript (`asl-web-transcript`) and the coach
progress (`asl-coach-v1`). Every storage call is guarded, so blocked storage
only means nothing is remembered for the next visit.

### Two loops

| Loop | Where | Runs | On each animation frame |
|---|---|---|---|
| Render loop | `renderLoop()` in `core/app.js` | From `init()`, for the whole visit | Draws the overlay, moves the laptop result plate away from a hand, and while the camera is on or the demo plays calls `realInference()` in `ml/live-inference.js` |
| Detection loop | `_processFrame()` in `media/camera.js` | Only while the camera is on, one per camera session | Runs MediaPipe when the camera has presented a new frame (counted with `requestVideoFrameCallback`, or every animation frame where the browser lacks it, and at least every 200 ms), and publishes the result as `latestMediaPipeResult` |

The camera-free demo takes the detection loop's place without the camera:
a timer in `media/demo-source.js` publishes the recorded hand of
`data/demo-letters.json` to `latestMediaPipeResult` about every 50 ms. Its
frames say aspect 1, because the recording holds square photographs, and the
overlay draws that square in the room the demo's card and the plate leave on
the stage.

The loops meet only at `latestMediaPipeResult`. In a letter context the render
loop runs inference at most every 120 ms, so the five-prediction smoothing
window spans about 600 ms of signing; a word recording reads every frame. One
model call runs at a time: a frame that arrives during a call is dropped, not
queued.

## From a camera frame to a letter

Letter mode and a single-letter coach target take this path.

1. **Detect.** The detection loop runs the MediaPipe Hand Landmarker on up to
   two hands. Each hand goes to the right or the left slot by MediaPipe's
   handedness label, and a label scoring below `LETTER_HANDEDNESS_SCORE_MIN`
   (0.5) is dropped. Pose and face are not run for letters.
2. **Skip or wait.** `realInference()` skips a frame with no hand and resets
   both smoothers, so an earlier sign cannot carry across the gap. Until the
   letter model has loaded, frames are dropped.
3. **Lay out.** `landmarksTo321D()` in `ml/landmarks.js` places the result in
   the fixed 321-value frame.
4. **Build features.** `computeLetterFeatures()` in `ml/features.js` makes 93
   values. It corrects x and z for the camera's aspect ratio (the training
   photos were square), takes the hand with more visible landmarks (on a tie,
   the clearly raised one) and mirrors a left hand, smooths the landmarks over frames, normalizes the hand to 63
   values and adds 30 geometry values. Each step is described in
   [Models and data](models-and-data.md#browser-parity-and-export-boundary).
5. **Classify.** `predictLetter()` in `ml/letter-model.js` runs the LightGBM
   model, exported to ONNX, and reads 24 probabilities.
6. **Smooth.** `smoothLetterPrediction()` in `ml/gating.js` keeps the last
   five predictions (`SMOOTHER_WINDOW`). The most frequent label wins, with a
   confidence equal to its share of the window times its mean probability.
7. **Show.** `updatePrediction()` in `ui/prediction.js` shows the letter and
   the top three. The plate says "Emin değil" (not sure) below
   `UNKNOWN_THRESHOLD` (0.45), "Büyük olasılıkla" (probably) below
   `CONFIDENT_THRESHOLD` (0.65), and "Emin" (sure) from there up. In the
   coach, the hold tracker in `ml/hold.js` sees the result first: a target
   letter counts when it is held steadily.
8. **Add.** Nothing is added on its own. Space, or the **Ekle** (add) button,
   calls `appendCurrentLetter()`, which adds the letter only if its smoothed
   confidence is at least `LETTER_THRESHOLD` (0.60).

J and Z need motion and have no model. After the hand leaves, letter mode
keeps the last letter on the plate, so Space can still add it; only the
smoothing resets. The order of the 93 values is in
[Models and data](models-and-data.md#letter-feature-engineering).

## From a recording to a word

Word mode and a coach word target take this path. A word is one isolated
sign, recorded as 45 frames.

1. **Start.** The record button (Enter in word mode) calls
   `startWordRecording()` in `ui/word-flow.js`. It loads the word model if
   needed, and refuses while hand tracking or the pose and face tasks are not
   ready. It clears the frame buffers, gives the recording a new serial number
   and counts down three steps of 720 ms.
2. **Detect.** In a word context the detection loop also runs the Pose and
   Face Landmarkers.
3. **Accept frames.** On each render frame `realInference()` takes each
   MediaPipe result once (a result it has already seen is skipped). It
   accepts the frame only if a hand, the face and the shoulders are all
   present: the 321-value frame has a fixed slot for each, and a missing group
   would reach the model as zeros. The framing readout tells the user what is
   missing.
4. **Normalize.** `normalizeShoulders()` in `ml/landmarks.js` centres the
   frame on the midpoint of the shoulders and divides by the shoulder width.
   Without usable shoulders it falls back to the notebook's min-max scaling.
5. **Build features.** At 45 frames the recording moves to PROCESSING.
   `buildCompactSequenceFeatures()` in `ml/features.js` chooses one dominant
   hand for the whole recording, as training did, and builds 168 values per
   frame: the dominant hand (63), hand-shape geometry (30), hand-to-face
   relations (12) and motion against the previous frame (63). If that step
   throws, the per-frame features collected during the recording are used.
6. **Mask.** A 45-value mask is `true` for each real frame and `false` for
   padding. The exported graph inverts it itself, so the code must not invert
   it first.
7. **Classify.** `predictWord()` in `ml/word-model.js` runs the
   SignTransformer on a `[1, 45, 168]` tensor and the mask (sent as `bool`,
   then `uint8`, then `int64` if the runtime rejects a type). It divides the
   50 outputs by the calibration temperature from `temperature.json`, applies
   softmax and keeps the top three (`TOP_K`).
8. **Check it is current.** The result is shown only if no newer recording
   has started, the state is still PROCESSING, a word context is still open
   and the camera is still on. Otherwise it is discarded.
9. **Offer.** `assessWordResult()` in `ui/prediction.js` decides what the
   user is offered: nothing when there is no word; "Emin olunamadı" (could not
   be sure), with accept disabled, below `WORD_ACCEPT_THRESHOLD` (0.15);
   "Kontrol ederek ekleyin" (check before adding) when the top two are within
   0.08 or the framing was poor; and "Sonuç kullanılabilir" (result usable)
   otherwise.
10. **Accept.** Space, or **Metne ekle** (add to text), calls
    `appendWordResultToTranscript()`, the only path from a word to the
    transcript. It checks the same conditions again and appends the word
    once; a toast offers **Geri al** (undo). In the coach, a word result
    scores the target and is not added to the transcript.

Word results are never added without the user's accept, because a correct
word often has low confidence and similar signs can be close. Models and data
gives the [321-value layout](models-and-data.md#landmark-frame-order) and the
[order of the 168 values](models-and-data.md#compact-feature-order); the web
app notes give the [keys for each mode](../asl-web/README.md#keyboard-shortcuts).

### Recording states

```text
IDLE -> COUNTDOWN -> RECORDING -> PROCESSING -> RESULT
```

| State | What happens | How it ends |
|---|---|---|
| `IDLE` | Nothing is recorded | The record button starts a countdown |
| `COUNTDOWN` | Three steps of 720 ms | `RECORDING`; or back to `IDLE` on cancel (Escape or **Vazgeç**, cancel), a hidden page, a camera stop or a mode change |
| `RECORDING` | Usable frames are collected | `PROCESSING` at 45 frames; or back to `IDLE` for the same reasons, or when the recording cannot fill |
| `PROCESSING` | One model call | `RESULT`, also when the call fails, which then offers no word; a camera stop or a mode change returns to `IDLE` and the result is discarded |
| `RESULT` | The word and its top three are shown | Accept appends once; recording again starts a new countdown; a mode change returns to `IDLE` |

A recording that cannot fill ends by itself instead of waiting at 0/45:
when no usable frame arrives within `WORD_FIRST_FRAME_TIMEOUT_MS` (6,000 ms),
when usable frames stop for `WORD_NO_HAND_TIMEOUT_MS` (4,000 ms), or when it
is still not full after `WORD_MAX_RECORDING_MS` (15,000 ms).
`checkWordRecordingClock()` checks these on every render frame, and the
message line says why the recording ended.

Every way into or out of a recording clears the frame buffers, so one
recording cannot leak into the next. The serial number does the same for
results: a model call that finishes late cannot touch a newer recording, and
only the latest recording's result can be accepted. The full transition
diagram is in the
[technical report](../TECHNICAL_REPORT.md#33-word-recording-state-machine).

## Screens and routes

| Hash | Screen (label in the app) | Camera | Models it runs |
|---|---|---|---|
| `#letter` | Letter translation (Harf) | yes | letter |
| `#word` | Word practice (Kelime, marked experimental) | yes | word |
| `#coach` | Learning coach (Koç) | yes | letter, and word while the coach is on words |
| `#test` | Model Test, for developers, linked from the project page | no | the model of the sample being run |
| `#project` | Project summary (Nasıl çalışır) | no | none |
| `#qr` | QR code (Telefonda aç) | no | none |

`setMode()` in `core/app.js` applies a route. An unknown hash opens letter
mode. There is no separate home screen: the brand link stops the camera and
opens the letter screen, whose empty stage explains the app. The camera-free
demo has no route either: **Örneği izleyin** (watch the example), on the
stage of every camera screen, in the camera problem and on the project page,
opens the letter screen and plays it there.

## Camera lifecycle

### Startup

`init()` restores the theme and the saved transcript, builds the coach
options, binds events, applies the URL hash and starts the render loop. It
then reads a few small JSON files: the reference video links, the word
reference cards, the Model Test manifest and the word difficulty and
confusion data. It loads no model and starts no camera. If `init()` throws, a
banner asks the visitor to reload.

### Models load on first need

`ensureLetterModel()` and `ensureWordModel()` load a model once and give
every caller the same promise. A failed load is forgotten, so the next need
retries. A need is the camera starting, a mode change while the camera is on,
a demo start, a word recording, or a Model Test run; a live frame never
starts a load. A demo start loads the letter model only: it imports no
MediaPipe and asks for no camera.

The letter model downloads as `letter_model.onnx.gz` (2.16 MB) and is
decompressed in the page with `DecompressionStream`; the raw
`letter_model.onnx` (13.2 MB) is the fallback. The word model is 1.85 MB.
Why loading waits is explained in the
[technical report](../TECHNICAL_REPORT.md#35-lazy-loading-and-sizes).

### Starting the camera

`toggleCamera()` in `core/app.js`:

1. checks that the camera API exists; on a page that is neither HTTPS nor
   `localhost`, it says so instead of asking;
2. asks for the camera with `getUserMedia` (the front camera, ideally
   1280 × 720, no audio) and waits for the first video frame;
3. starts loading the models the current mode runs and, at the same time,
   calls `startMediaPipe()` in `media/camera.js`;
4. `startMediaPipe()` imports MediaPipe, creates the Hand Landmarker (on the
   GPU, or on the CPU if that fails) and starts the detection loop. Pose and
   Face load in the background only when a word context needs them, so letter
   mode works on a slow connection.

A start waits several times: for the permission prompt, the first video
frame, the MediaPipe download and each task. A stop can arrive during any of
those waits. Each wait is followed by a check, so the stop cancels the start
and the start closes whatever it had created. A task that finishes loading
after a stop is closed rather than kept.

### Stopping the camera

`stopCamera()` stops every media track and calls `stopMediaPipe()`, which
cancels the detection loop's pending frame and closes the three tasks. It
also abandons a countdown or a recording and clears the smoothers and frame
buffers. The render loop keeps running, but does no inference while the
camera is off.

The camera stops when:

- the visitor presses the camera button again;
- the visitor opens the brand link, `#test`, `#project` or `#qr`;
- the visitor starts the camera-free demo;
- the browser ends a track, for example when the permission is revoked or
  the camera is unplugged. This is handled like a stop, and the stage says
  the camera was lost.

The demo stops, through `stopDemo()`, its one way out, when the visitor
presses its stop, starts the camera, changes mode or route (the brand link
included), or the page is hidden. Each of these ends its frame timer, so a
restart leaves one timer; `tests/web/demo-lifecycle.test.js` holds this.

Switching between letter, word and coach keeps the camera on and loads the
model the new mode needs. Hiding a screen is never the same as releasing the
camera. Reopening the camera leaves exactly one detection loop and one set of
tasks. The `camera-stop`, `camera-lifecycle`, `camera-start-stop`,
`camera-track-ended` and `mediapipe-start-race` tests in `tests/web/` hold
this, and `make browser-check` confirms in real Chrome that no camera track is
still live after a stop.

## Configuration

Each setting lives with the component that uses it.

| Setting | Where it lives |
|---|---|
| Browser thresholds, timing, coach hold times, MediaPipe hand confidences, the handedness swap, the demo URL | `CONFIG` in `asl-web/js/core/config.js` |
| Browser letter and word lists, easy and hard words, word categories, reference images | `LETTERS`, `WORDS`, `EASY_WORDS`, `HARD_WORDS`, `WORD_CATEGORIES` and `REFERENCE_ASSETS` in the same file |
| Pinned runtime versions | ONNX Runtime and `kjua` in `index.html` (ONNX Runtime's WebAssembly path also in both model files); MediaPipe and its three task model URLs in `media/camera.js` |
| Model labels and calibration | `asl-web/data/letter_labels.json`, `word_labels.json` and `temperature.json`, copied from `models/` |
| Response headers and the Content Security Policy | `asl-web/_headers` |
| Colours, type, spacing, radius and motion | `asl-web/css/tokens.css` |
| Values shared by Python training and inference: landmark count, the 24 letters, augmentation | `asl_features.config` |
| Desktop paths, camera, thresholds, UI, speech and sequence-model settings | `asl_desktop.config` |
| Which deployed file comes from which source, and what an upload may contain | `scripts/validation/contracts.py` |

What each browser setting means is in the
[web app notes](../asl-web/README.md#configuration). A change to a threshold
or to handedness alters live behaviour, so it needs a test with a real camera.

## Styling layers

The CSS uses cascade layers (`@layer`): groups of rules whose declared order
decides which rule wins, whatever the selectors' specificity.
`css/style.css` declares the order, lowest first:

```text
legacy, tokens, base, components, layout, screens, utilities
```

| Layer | File | What it holds |
|---|---|---|
| `legacy` | `style.css` | The original stylesheet, in the lowest layer so every newer layer overrides it without specificity fights; a screen's rules here are deleted once that screen has its own |
| `tokens` | `tokens.css` | Design tokens for both themes: the raw colour, type, space, radius and motion values that the other files read by name |
| `base` | `base.css` | Self-hosted fonts, document defaults, the focus ring |
| `components` | `components.css` | Buttons, mode switch, camera stage, caption plate, transcript strip, panels |
| `layout` | `layout.css` | The shell and workspace for phone, phone landscape and laptop |
| `screens` | `screens-coach.css`, `screens-info.css`, `screens-word.css` | The coach; the Model Test, QR and project screens; the word screen and its reference viewer |
| `utilities` | the end of `layout.css` | Mode visibility (`mode-only` with `letter-only`, `word-only`, `coach-only`) and the visually hidden helper |

The declared order decides, not the order of the `<link>` tags: `layout.css`
is linked before `components.css`, yet its rules win, because the layout places
the components. `core/theme-boot.js` sets the theme before the first paint,
and the camera stage is dark in both themes. Why layers were chosen is
explained in the [technical report](../TECHNICAL_REPORT.md#38-styling-system).
`make browser-check` checks the layer order, hidden and mode-only rules, the
dark theme and sideways scrolling in real Chrome.

## Failure modes

What can go wrong while the app runs:

| Failure | What the visitor sees | Handled in |
|---|---|---|
| Camera refused, missing or busy, or the page not on HTTPS | The stage says why, offers a retry where one can help, and lists the steps for the visitor's browser | `toggleCamera()` and `showCameraProblem()` in `core/app.js` |
| The browser ends the camera track | The camera stops and the stage says the connection was lost | `toggleCamera()` |
| MediaPipe cannot be downloaded, or the hand task fails | The camera stays on; the badge says "El izleme yok" (no hand tracking) and the message asks the visitor to check the connection | `toggleCamera()`, `startMediaPipe()` |
| The GPU cannot run a task | Nothing: that task runs on the CPU | `_createWithFallback()` in `media/camera.js` |
| The pose or face task fails | Letters still work; a word recording is refused with a message | `_loadOptionalHolisticLandmarkers()`, `startWordRecording()` |
| A model download fails | The message line says which model is missing; the next need retries | `loadModelsWithStatus()`, `ensureLetterModel()`, `ensureWordModel()` |
| The demo recording cannot be fetched or is malformed | The stage goes back to rest and the message line says the example could not be loaded; the next start fetches it again | `startDemo()`, `loadDemoRecording()` in `media/demo-source.js` |
| The letter model cannot load during the demo | The hand plays on and the message line says letter recognition could not load | `startDemo()` |
| The gzip copy cannot be used | Nothing: the raw letter model loads instead | `loadLetterModel()` |
| The runtime rejects a mask type | Nothing: the next type is tried | `predictWord()` |
| A recording cannot fill | It ends after the timeouts above, with the reason | `checkWordRecordingClock()` |
| The page is hidden during a recording | The recording ends; the camera stays on | `watchPageVisibilityForWordRecording()` |
| A word result arrives after a stop, a mode change or a newer recording | It is discarded | `_finishWordRecordingReal()` |
| `init()` throws | A banner asks the visitor to reload | `reportStartupFailure()` |
| `localStorage` is blocked | The app works; nothing is remembered for the next visit | a `try` around every storage call |
| A CDN is unreachable | No hand tracking or no model, so the first visit needs a network | the status messages above; the browser's Network panel |

What else can go wrong before a deploy, besides the source and parity faults
[above](#where-python-and-the-browser-meet), and what catches it:

| Failure | Effect if shipped | Caught by |
|---|---|---|
| An inverted mask or frames in the wrong order | Wrong words, with no error | `tests/web/word-model-input.test.js` |
| A file the site must not ship is in `asl-web/` | It is published | `make deploy-check` |
| A device reports left and right the other way round | Letter behaviour changes with the hand or the camera | `SELFIE_HANDEDNESS_SWAP`, and a test on a real device |

## Checking a change

What each `make` gate runs is in [Tests](../tests/README.md#what-each-gate-runs).
Run `make health` after most edits and `make check` before a commit. A change
to the script order, the stylesheets or the camera lifecycle also needs
`make browser-check` (Chrome required; see
[browser checks](../tests/browser/README.md)).

No gate covers lighting, the camera permission prompt, handedness on a given
device, device speed or live signing. After a change to the camera or the
model path, check by hand in a real browser, on a phone as well as a laptop:

1. The camera starts, the status line reports the models ready, and the
   camera turns off when you open `#test`, `#project` or `#qr`.
2. Space adds a letter only once the plate is confident.
3. Record a word, retry, and cancel one; the word reaches the text only after
   you accept it.
4. **Örneği izleyin** plays the recorded hand: the plate reads F, L and Y in
   turn, each letter reaches the text only when you add it, and the end
   offers the camera. Starting the camera stops the demo.
5. Model Test (`#test`) runs the bundled samples without a camera.
6. The QR screen's links open the right screens.

The checks before and after an upload are in
[Getting started](getting-started.md#static-deployment).

## Related documents

- [Browser module notes](../asl-web/js/README.md): every script, the DOM and
  type contracts
- [Web application notes](../asl-web/README.md): running locally, settings,
  keyboard shortcuts, deployment
- [Models and data](models-and-data.md): feature order, ONNX inputs and
  outputs, labels, artifact sources
- [Technical report](../TECHNICAL_REPORT.md): design decisions, measurements
  and test evidence
- [Getting started](getting-started.md)
- [Project journey](project-journey.md)
