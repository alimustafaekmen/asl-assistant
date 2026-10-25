# asl-features

The Python definition of how MediaPipe landmarks become model input: the
square-units step for a non-square frame, hand normalisation, the 93 letter
features and the 45 × 168 word features. Training, data preparation, the
desktop app and the tests import it. The web app does not: `asl-web/js/ml/features.js`
does the same work in JavaScript, and parity checks compare the two.

```text
src/asl_features/
├── config.py      MediaPipe hand settings, landmark count, the 24 letters, augmentation defaults
├── landmarks.py   to_square_units, normalize_landmarks
├── letter.py      extract_features: the 93-D letter vector
└── word.py        normalize_shoulders, build_compact_features: the training notebook's word features
```

```python
from asl_features.landmarks import normalize_landmarks, to_square_units
from asl_features.letter import extract_features
from asl_features.word import build_compact_features, normalize_shoulders
```

For a letter: `to_square_units(landmarks, width, height)` multiplies x and z by
width over height; `normalize_landmarks` moves the wrist to the origin and
divides by the wrist to middle-knuckle distance (63 values); `extract_features`
returns the 93-value vector. For a word: `normalize_shoulders` per 321-value
frame, then `build_compact_features` for the `(T, 168)` sequence.

`make setup` installs the package in editable mode. The feature order is part
of the model, so a change to `landmarks.py` or `letter.py` goes together with
`features.js`. `word.py` is the notebook's own code, and
`tests/asl_features/unit/test_word.py` fails if it drifts: change the notebook
and retrain first.
