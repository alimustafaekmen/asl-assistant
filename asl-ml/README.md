# asl-ml

The Python source of truth for how a MediaPipe hand becomes the model's input.
`asl-ml` holds hand-landmark normalization, the 93-value letter feature
vector, label-map reading and writing, and the few constants that training and
Python inference must agree on.

The web app does not use this package. `asl-web/js/ml/features.js` implements the
same feature code in JavaScript, and parity checks compare the two (see below).
Because the feature order is part of the model, a vector with the right shape but
the wrong order would run and predict nonsense; this package is where that order
is defined.

## Contents

```text
src/asl_ml/
├── config.py                   landmark count, the 24 letters, augmentation defaults
├── features/letter_features.py 93D letter feature extraction
└── utils/
    ├── landmarks.py            wrist-origin and hand-size normalization
    ├── labels.py               load, save and invert label maps
    └── io.py                   ensure_dir
```

The letter data-preparation and training scripts under `scripts/`, the Python
tests and the desktop prototype all import it. Anything about the UI, the camera,
desktop model paths or web thresholds belongs elsewhere. Word feature extraction
is not here yet; it can move in once it can be tested against both the training
notebook and the browser.

## Use

```python
from asl_ml.config import NUM_LANDMARKS, STATIC_LETTERS
from asl_ml.features.letter_features import extract_features
from asl_ml.utils import ensure_dir, load_label_map, normalize_landmarks
```

`normalize_landmarks` takes the flat 63 values of one hand, moves the wrist to
the origin and divides by the wrist to middle-finger-base distance. It returns
zeros if that distance is degenerate. `extract_features` takes those 63
normalized values and returns the 93-value vector. Its layout is in
[Models and data](../docs/models-and-data.md#letter-feature-engineering).

## Install and test

From the repository root, in a Python 3.12 environment you created for this
project:

```bash
python -m pip install -e ./asl-ml
python -m pytest tests/asl_ml
```

`make setup` installs this package and `asl-desktop` together with the pinned
requirements ([Getting started](../docs/getting-started.md)).

## Keeping Python and JavaScript in step

Changing the normalization or the feature order means changing
`letter_features.py`, `landmarks.py` and `asl-web/js/ml/features.js` together.
`make parity` runs `tests/validation/check_letter_feature_parity.py` (and the word
equivalent), which feeds the same hands to both implementations and fails if any
value differs by `1e-4` or more. It needs Node. The browser unit tests hold the
same Python outputs as golden values in `tests/web/fixtures/feature-golden.json`,
regenerated with `scripts/evaluation/export_feature_goldens.py`.
