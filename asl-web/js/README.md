# Browser JavaScript Modules

The web application uses classic scripts and shared browser globals. It does
not use a bundler or ES-module graph, so the order in `asl-web/index.html` is a
runtime contract.

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

The rules behind that order:

- `core/config.js` comes before anything that reads `CONFIG` or the label lists.
- `core/runtime.js` creates the shared `state`, the `els` DOM registry, the
  overlay canvas context, and the word recording buffers exactly once.
- Feature and model modules load before `ml/live-inference.js` uses them.
- UI modules are defined before `core/app.js` binds events to them.
- `core/app.js` is last and is the only script that calls `init()`.

No module other than `core/app.js` does asynchronous work, binds events, or
loads a model while it is being loaded. Startup side effects belong in the
bootstrap flow.

`tests/project/test_web_ui_contracts.py` enforces this order, and
`tests/web/module-contracts.test.js` loads the scripts the same way the browser
does, so a duplicated global or a file that index.html forgets is caught
automatically.

## Module map

| Module | Responsibility |
|---|---|
| `core/config.js` | Runtime configuration, letter/word label lists, difficulty sets, reference assets |
| `core/runtime.js` | Shared mutable state, DOM registry, canvas context, word recording buffers |
| `core/app.js` | Bootstrap, event wiring, hash routing, camera start/stop, render loop, debug API |
| `media/camera.js` | MediaPipe task lifecycle, GPU/CPU fallback, frame detection loop |
| `media/overlay.js` | Landmark drawing on the camera canvas |
| `ml/landmarks.js` | MediaPipe output to the fixed 321D holistic frame and shoulder normalization |
| `ml/features.js` | Letter 93D and word 168D feature construction |
| `ml/live-inference.js` | Live letter/word inference and word recording finalization |
| `ml/letter-model.js` | Letter ONNX loading, probability parsing, and backward fallback |
| `ml/word-model.js` | Word ONNX loading, mask handling, calibration, softmax, and top-3 output |
| `ml/gating.js` | Letter smoothing and difficulty/confusion feedback data |
| `services/benchmark.js` | Bounded client-side latency measurements |
| `ui/prediction.js` | Prediction, top-3, status message, feedback, word result guide |
| `ui/transcript.js` | Transcript editing, persistence, clipboard, speech output |
| `ui/word-flow.js` | Word countdown, recording progress, quality readout, action buttons |
| `ui/coach.js` | Learning coach targets, flows, scoring, word guidance panel |
| `ui/reference.js` | Reference images, video links, lightbox |
| `ui/qr.js` | Demo deep-link URL and QR rendering |
| `ui/model-test.js` | Offline fixture loading, validation, and model runs |

## Data flow

```text
camera (getUserMedia)      core/app.js    toggleCamera / stopCamera
  -> media/camera.js       MediaPipe hand + pose + face -> latestMediaPipeResult
  -> media/overlay.js      draw landmarks on the canvas
  -> ml/live-inference.js  realInference() reads the latest frame
  -> ml/landmarks.js       321D frame + shoulder normalization
  -> ml/features.js        93D letter features / 168D word features
  -> ml/letter-model.js    ONNX letter prediction
     ml/word-model.js      ONNX word prediction over 45 frames + mask
  -> ui/prediction.js      prediction, top-3, message
     ui/word-flow.js       recording state and controls
     ui/coach.js           target scoring
```

`core/app.js` drives the render loop, which calls `realInference()`;
`media/camera.js` drives the detection loop, which calls `drawOverlay()`.

## Where new code goes

- A new user-facing screen or flow: a new file under `ui/`.
- A new model or feature transform: `ml/`.
- A new shared constant: `core/config.js`.
- New shared mutable state: `core/runtime.js`, and nowhere else.
- A new event binding: `bindEvents()` in `core/app.js`, so every listener stays
  visible from one place.

Add the file to `index.html` in the position its dependencies require, and
update the expected order in `tests/project/test_web_ui_contracts.py`.

## Type contracts

The modules carry JSDoc types. They are documentation that a checker can verify,
not a build step: the browser loads these `.js` files unchanged.

Each type is defined once, in the file where its meaning is fixed, and
referenced from everywhere else. The classic-script global scope makes those
definitions visible project-wide, so a second copy would be a second source of
truth rather than a convenience.

| Type group | Owner |
|---|---|
| `RuntimeConfig`, `ThresholdSet`, reference assets | `core/config.js` |
| State unions, `AppState`, `PredictionResult`, `WordResultAssessment` | `core/runtime.js` |
| `Frame321D` | `ml/landmarks.js` |
| `Hand63`, `LetterFeatures93`, `WordFeatures168`, letter motion and smoothing | `ml/features.js` |
| `BenchmarkStage`, `BenchmarkSummary` | `services/benchmark.js` |
| `ConfusionPairRaw`, `ConfusionPair`, `PerWordStat`, `WordDifficulty` | `ml/gating.js` |
| `WordFeatures45x168`, `WordMask45`, `WordMaskDtype` | `ml/word-model.js` |
| `OnnxSessionLike`, `OnnxTensorLike`, `ProbabilityVector` | `ml/letter-model.js` |
| MediaPipe landmark and task shapes | `media/camera.js` |
| Recording diagnostics, `DominantSide` | `ml/live-inference.js` |
| `ConfidenceLevel`, `FeedbackKind` | `ui/prediction.js` |
| Fixture and manifest shapes | `ui/model-test.js` |

Three rules keep the annotations honest:

- **JSDoc cannot express a typed-array length.** `LetterFeatures93` says 93 in
  prose; the real check stays in `predictLetter()`, `predictWord()`, and the
  fixture validator, and `tests/web/features.test.js` covers the shapes.
- **Unvalidated input is `unknown` until it is checked.** Fixture JSON, fetched
  data, and ONNX outputs all pass through a guard such as `isRecord()` before
  their fields are read. A cast is never a substitute for that check.
- **Nullable stays nullable.** MediaPipe tasks, the camera stream, the latest
  frame, and a model result can all be null, and the types say so. The DOM
  registry is the exception: `requireElement()` proves presence at startup, so
  the rest of the app can dereference those fields freely.

Where a runtime check cannot be expressed as a narrowing -- inspecting one
element to classify an array, or a membership test on a string union -- the
narrowing is stated in place, next to the check that guarantees it.

Run `make js-typecheck` to verify the contracts. It needs `npm ci` once; nothing
else in this repository does.

## Model contracts

The final word inference path makes dominant-hand selection across the complete
recording, not independently per frame. The input mask uses `true` for a real
frame and `false` for padding; the exported ONNX graph performs its own internal
attention-mask inversion.

The letter path supports 24 static classes. J and Z are not implemented, and
no J/Z model is loaded by these modules.

## Comment conventions

Source comments are written in concise English so the implementation is
readable to a broader GitHub audience. User-facing interface text remains in
Turkish. Comments should explain a model contract, browser constraint, fallback,
or non-obvious design decision; they should not preserve temporary phase names,
personal workflow notes, or a line-by-line translation of the code.

## Change safety

Before changing feature order, normalization, mask semantics, label handling,
script order, or recording resets, read:

- [Architecture](../../docs/architecture.md)
- [Models and data](../../docs/models-and-data.md)

Run `make health` from the repository root, then perform the real-browser
camera checklist in the architecture guide. Automated checks cannot validate
camera permissions, handedness metadata, or device-specific MediaPipe behavior.
