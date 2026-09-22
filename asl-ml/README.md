# asl-ml

`asl-ml` is the reusable Python-side ML contract layer. It keeps landmark
normalization, the 93D static-letter feature implementation, label-map I/O,
and the small set of preprocessing constants that training and Python
inference must share.

The browser application does not import this package. `asl-web/` contains a
separate JavaScript implementation whose outputs are checked against the
Python contract with parity tests.

## Contents

```text
src/asl_ml/
├── config.py                       shared 21-landmark, 24-class, and augmentation defaults
├── features/letter_features.py   93D letter feature extraction
└── utils/
    ├── landmarks.py              wrist-origin/scale normalization
    ├── labels.py                 label-map load/save/invert helpers
    └── io.py                     filesystem helper
```

Consumers include data-preparation and letter-training scripts, Python tests,
and the desktop prototype. UI colors, camera lifecycle policy, desktop model
paths, and web thresholds do not belong here.

This separation gives `asl-ml` one clear role: it is the canonical Python
implementation of model-adjacent preprocessing, not a second application and
not a generic dumping ground for project settings. Future reusable word
feature extraction may be added only after it can be tested against the
notebook and browser contracts.

## Install and test

```bash
# Activate any isolated Python environment first.
python -m pip install -e ./asl-ml
python -m pytest tests/asl_ml
```

Public imports:

```python
from asl_ml.features.letter_features import extract_features
from asl_ml.utils import ensure_dir, load_label_map, normalize_landmarks
from asl_ml.config import NUM_LANDMARKS, STATIC_LETTERS
```

The 93D order and normalization are protected by the
[models and data contract](../docs/models-and-data.md). Update the Python and
JavaScript paths together and run the letter parity checks before changing
them.
