# asl-desktop

<sub>Location: [`asl-assistant`](../README.md) / `asl-desktop`</sub>

<sub>Related: [`docs/getting-started.md`](../docs/getting-started.md) · [`asl-features/`](../asl-features/README.md) · [`models/word/`](../models/word/README.md) · [`tests/`](../tests/README.md)</sub>

The project's first version: a desktop prototype in Python, built with
CustomTkinter, OpenCV and MediaPipe. The browser app in `asl-web/` is the
maintained product; this one is kept working as a reference and for
experiments.

## What it does

- **Translation view:** reads letters from the camera with the 93-feature
  LightGBM model and words with the 25-word BiGRU, and can speak the result
  with offline text-to-speech (`pyttsx3`).
- **Learning coach:** guided practice for letters and the 25 words.
- **Personalization:** few-shot letter templates recorded by the user and matched
  by cosine similarity before the base model runs. They are stored under the
  ignored `models/profiles/` folder and are never committed.

J and Z are not available. They need motion, and no trained J/Z model is
published.

## How it is organised

```text
src/asl_desktop/
├── app/         main window and navigation
├── camera/      camera widget
├── config.py    desktop paths, camera, thresholds, UI and model settings
├── detection/   MediaPipe hand and holistic wrappers
├── models/      letter and sequence classifier wrappers
├── services/    personalization and text-to-speech
├── ui/          translation and coach views
└── utils/       landmark smoothing and motion tracking
```

The app depends on [`asl-features`](../asl-features/README.md) for landmark
normalization (including the correction for the webcam's non-square frame) and
the 93D features. Values shared with training (the 21 landmarks, the 24
letters, augmentation defaults) come from `asl_features.config`. Paths, camera
behaviour, thresholds, colours and the 25-word model settings live in
`asl_desktop.config`; the browser has its own JavaScript configuration. The two
apps do not run identical inference: for letters the web app mirrors a
detected left hand, and the desktop app does not.

The word path is the 25-class BiGRU with attention pooling, fed 30 frames of 321
holistic landmark values, from `models/word/desktop-25/`. It does not load the
web app's 50-word SignTransformer (45 × 168 features). How the two came about
is told in the [project journey](../docs/project-journey.md).

## Install and run

You need Python 3.12, a camera and a desktop session. The simplest route is the
Conda environment, which also installs Node 24 for the repository checks:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make desktop
```

In an existing Conda environment (not `base`) or a Python 3.12 `venv`, run
`make setup` first. It installs the pinned requirements, then `asl-features` and
`asl-desktop` in editable mode, and refuses to run in Conda's base environment.
[Getting started](../docs/getting-started.md) has the direct commands and notes
for each platform.

Things to know:

- The app needs camera permission.
- LightGBM needs an OpenMP runtime on macOS; `environment.yml` includes
  `llvm-openmp`.
- The letter model is a scikit-learn-compatible pickle, so the pinned
  scikit-learn (1.8.0 in `requirements.txt`) has to match the version that wrote
  it. If you replace the model, update and validate both together. The browser's
  ONNX models are not affected.
- The `.pkl` and `.pt` model files are Python pickles and can run code when
  loaded; use only copies you trust.
- Newly trained artifacts and personalization profiles stay local.

## Tests

```bash
python -m pytest tests/asl_desktop/unit
python -m pytest tests/asl_desktop/integration
```

The unit tests are the fast, deterministic ones. The integration tests may need
MediaPipe, the model files, PyTorch and a camera. See
[tests/README.md](../tests/README.md).
