# tests

Project Python tests, organized by package being tested.

```text
tests/
├── asl_ml/
│   └── unit/                # asl-ml package tests (FE + utils)
│       ├── test_letter_features.py    # 93D extract_features regression
│       └── test_utils.py              # normalize_landmarks + label I/O
├── asl_desktop/
│   ├── unit/                # asl-desktop package tests (light)
│   │   ├── test_landmark_smoother.py
│   │   └── test_smoother.py
│   └── integration/         # require MediaPipe + camera + ONNX
│       ├── test_holistic_output.py
│       ├── test_letter_classifier.py
│       └── test_word_mode_no_hands.py
├── project/                 # repo guardrails + web data/model contracts
│   ├── test_repo_guardrails.py
│   └── test_web_contracts.py
├── validation/              # (placeholder for future smoke tests against scripts/validation/)
├── smoke/                   # (placeholder for asl-web parity tests, future)
├── conftest.py              # adds project root to sys.path
└── README.md                # this file
```

## What is tested

| Test directory | Covers | MediaPipe required? | Camera required? |
|---|---|---|---|
| `tests/asl_ml/unit/` | `asl_ml.utils` + `asl_ml.features.letter_features` | ❌ | ❌ |
| `tests/asl_desktop/unit/` | smoothers (pure logic) | ❌ | ❌ |
| `tests/project/` | repo guardrails, Git hygiene, web runtime contracts | ❌ | ❌ |
| `tests/asl_desktop/integration/` | MediaPipe pipeline + LightGBM/ONNX | ✅ | ✅ (some) |
| `tests/validation/` | (placeholder) | — | — |
| `tests/smoke/` | (placeholder — future asl-web JS↔Python parity) | — | — |

> The browser runtime (`asl-web/`) currently has **no automated test
> coverage**; manual browser testing is documented in `asl-web/README.md`
> and `docs/current/runtime-pipeline.md`. The numerical Python↔JS feature
> parity is verified ad-hoc by Node scripts (see commit history).

## Running

```bash
# Editable install for asl-ml + asl-desktop
pip install -r requirements-dev.txt
pip install -e asl-ml
pip install -e asl-desktop

# Hızlı: unit + proje guardrail testleri (kamera/model bağımsız)
pytest tests/asl_ml/ tests/asl_desktop/unit/ tests/project/

# Tam: unit + integration (MediaPipe + ONNX gerekir)
pytest tests/

# Kapsamlı (coverage)
pytest --cov=asl_ml --cov=asl_desktop tests/
```

If PyTorch / MediaPipe / OpenCV missing, integration tests `skip`
(import error gracefully handled by `conftest.py`); unit tests still run.

## Imports

Tests follow the new package layout:

```python
# asl-ml package
from asl_ml.utils import normalize_landmarks, load_label_map
from asl_ml.features.letter_features import extract_features

# asl-desktop package
from asl_desktop.utils.smoother import PredictionSmoother
from asl_desktop.utils.landmark_smoother import LandmarkSmoother
from asl_desktop.models.letter_classifier import LetterClassifier
from asl_desktop.models.sequence_classifier import SequenceClassifier
from asl_desktop.detection.holistic_detector import HolisticDetector

# Shared root config (NOT moved into either package)
from config.settings import LETTER_MODEL_PATH, SEQUENCE_LENGTH, CONFIDENCE_THRESHOLD
```
