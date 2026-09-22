# asl-desktop

`asl-desktop` is the legacy CustomTkinter prototype. The active product is the
browser application under `asl-web/`; this package is retained for reference,
experiments, and desktop-specific tests.

## Responsibilities

```text
src/asl_desktop/
├── app/         application controller
├── camera/      camera widget
├── config.py    desktop paths, camera, thresholds, UI, and model defaults
├── detection/   Python MediaPipe wrappers
├── models/      letter and sequence classifier wrappers
├── services/    personalization and text-to-speech
├── ui/          translation and coach views
└── utils/       smoothing and motion helpers
```

It depends on `asl-ml` and the local Python ML/GUI stack. Shared landmark and
class-domain values come from `asl_ml.config`; desktop-only paths, camera
behavior, thresholds, UI values, and the 25-word artifact contract live in
`asl_desktop.config`. The browser keeps an independent JavaScript config.

This removes the former root `config/` package and prevents training tools
from depending on desktop UI settings. Visual similarity between desktop and
web still does not imply inference parity.

The desktop word path is the earlier 25-class BiGRU+Attention implementation:
30 frames of 321D holistic landmarks. It does not load the browser's 50-class,
45 × 168 SignTransformer. See the
[project journey](../docs/project-journey.md) for the verified
transition between these versions.

## Install and run

The recommended public setup creates the isolated Python 3.12 environment and
installs Node 24 for the repository checks:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make desktop
```

For an existing isolated Conda environment or Python 3.12 `venv`, run
`make setup` before `make desktop`. Setup refuses Conda base and installs the
two local packages in editable mode after the pinned requirements. See the
[getting-started guide](../docs/getting-started.md) for direct commands and
platform notes.

The application requires a GUI session and camera permission. On macOS,
LightGBM also requires an OpenMP runtime; `environment.yml` includes
`llvm-openmp`. The 25-word checkpoint is published under
`models/word/desktop-25/`; J/Z remains unavailable because no trained J/Z model
is included. Personalization profiles and newly generated training artifacts
remain local-only.

Python pickle/joblib model files are scikit-learn-version sensitive. The pinned
requirements match the published letter artifact's scikit-learn 1.8.0 runtime.
If the artifact is replaced, update and validate that contract together. This
does not affect the browser's ONNX models.

## Test

```bash
python -m pytest tests/asl_desktop/unit
python -m pytest tests/asl_desktop/integration
```

Integration tests may require MediaPipe, ONNX/PyTorch artifacts, and camera
access. See [tests/README.md](../tests/README.md).
