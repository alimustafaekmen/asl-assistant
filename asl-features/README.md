# asl-features

<sub>Location: [`asl-assistant`](../README.md) / `asl-features`</sub>

<sub>Related: [`docs/models-and-data.md`](../docs/models-and-data.md) · [`asl-web/js/`](../asl-web/js/README.md) · [`tests/`](../tests/README.md)</sub>

The Python source of truth for how MediaPipe landmarks become the two models'
input. `asl-features` holds the landmark step (normalization, and the correction for
a non-square camera frame), the 93-value letter feature vector, the 45 × 168
word sequence features, and the few constants that training and Python
inference must agree on.

The web app does not use this package. `asl-web/js/ml/features.js` implements
the same feature code in JavaScript, and parity checks compare the two (see
below). The feature order is part of the model: a vector with the right shape
but the wrong order would run and predict nonsense. This package defines that
order.

## Contents

```text
src/asl_features/
├── config.py       MediaPipe hand settings, landmark count, the letters, augmentation defaults
├── landmarks.py    square units for a camera frame; wrist-origin, hand-size normalization
├── letter.py       93-D letter feature extraction
└── word.py         45 × 168 word features, as the training notebook computes them
```

The folder uses Python's standard `src` layout: `asl-features/` is the project
(its `pyproject.toml` and this README) and `src/asl_features/` is the package
you import, with an underscore because a Python name cannot contain a hyphen.
An editable install also writes `src/asl_features.egg-info/`, which Git
ignores.

The letter data-preparation and training scripts under `scripts/`, the Python
tests, the golden-fixture exporter, the parity checks and the desktop prototype
all import it. Anything about the UI, the camera, desktop model paths or web
thresholds belongs elsewhere.

## Use

```python
from asl_features.config import NUM_LANDMARKS, STATIC_LETTERS
from asl_features.letter import extract_features
from asl_features.word import build_compact_features, normalize_shoulders
from asl_features.landmarks import normalize_landmarks, to_square_units
```

For a letter:

1. `to_square_units(landmarks, width, height)` multiplies x and z by the frame's
   width over its height. MediaPipe gives x as a fraction of the width and y of
   the height, and the letter model was trained on square photographs, so a
   hand from a 640 × 480 or 1280 × 720 camera is squeezed until this is applied.
   A square frame is left alone.
2. `normalize_landmarks` takes the flat 63 values of one hand, moves the wrist
   to the origin and divides by the wrist to middle-finger-base distance. It
   returns zeros if that distance is degenerate.
3. `extract_features` takes those 63 normalized values and returns the 93-value
   vector. Its layout is in
   [Models and data](../docs/models-and-data.md#letter-feature-engineering).

For a word, `normalize_shoulders` normalizes each 321-value holistic frame, and
`build_compact_features` turns the sequence into the `(T, 168)` input the word
model was trained on.

## Install and test

From the repository root, in a Python 3.12 environment you created for this
project:

```bash
python -m pip install -e ./asl-features
python -m pytest tests/asl_features
```

`make setup` installs this package and `asl-desktop` together with the pinned
requirements ([Getting started](../docs/getting-started.md)).

## Keeping Python and JavaScript in step

- **Letters.** Changing the normalization, the square-units step or the feature
  order means changing `landmarks.py`, `letter.py` and
  `asl-web/js/ml/features.js` together.
- **Words.** `word.py` is the trained notebook's feature code.
  `tests/asl_features/unit/test_word.py` runs the notebook's own functions
  and fails if this module returns anything different, so do not edit it to
  chase a difference with the browser: change the notebook and retrain first.

`make parity` runs `tests/validation/check_letter_feature_parity.py` and
`check_word_feature_parity.py`, which feed the same input to both
implementations and fail if any value differs by `1e-4` or more. They need
Node. The browser unit tests hold the same Python outputs as golden values in
`tests/web/fixtures/feature-golden.json`, regenerated with
`scripts/evaluation/export_feature_goldens.py`.
