#!/usr/bin/env python3
"""Export the feature goldens the browser tests compare against.

Builds a small set of deterministic synthetic hands and holistic frames, runs
them through the Python feature code, and writes the inputs together with the
outputs to ``tests/web/fixtures/feature-golden.json``:

* letter: ``normalize_landmarks`` -> ``extract_features`` from ``asl-ml``, the
  source of truth for the 93-D vector;
* word: the notebook port in ``tests/validation/check_word_feature_parity.py``
  (``normalize_shoulders`` -> ``build_compact_features``), which is the only
  Python copy of the 168-D contract, applied to short sequences.

Two tests read the file. ``tests/asl_ml/unit/test_feature_golden.py`` rebuilds
it and fails if the committed copy differs from what the Python code computes
now, so the golden cannot drift from Python. ``tests/web/feature-golden.test.js``
runs ``asl-web/js/ml/features.js`` on the same inputs and expects the same
numbers, so the browser cannot drift either.

The inputs are written out of closed-form geometry, not a random generator, so
a library upgrade cannot change them. Regenerate after an intended change to
the feature contract:

    python scripts/evaluation/export_feature_goldens.py
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_PATH = PROJECT_ROOT / "tests" / "web" / "fixtures" / "feature-golden.json"

for _root in (PROJECT_ROOT / "asl-ml" / "src", PROJECT_ROOT):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

from asl_ml.features.letter_features import extract_features  # noqa: E402
from asl_ml.utils.landmarks import normalize_landmarks  # noqa: E402

from tests.validation.check_word_feature_parity import (  # noqa: E402
    build_compact_features,
    normalize_shoulders,
)

INPUT_DECIMALS = 6
OUTPUT_DECIMALS = 7
TOLERANCE = 1e-5

# Hand shapes in palm units: wrist at the origin, landmark 9 (middle MCP) at
# distance exactly 1, image y growing downward so the fingers point at -y.
# Scaling a template by s therefore puts wrist-to-landmark-9 at s.
OPEN_PALM = [
    (0.0, 0.0, 0.0),
    (-0.5, -0.3, -0.05),
    (-0.8, -0.7, -0.08),
    (-1.0, -1.0, -0.10),
    (-1.15, -1.3, -0.12),
    (-0.35, -0.95, -0.02),
    (-0.4, -1.45, -0.04),
    (-0.42, -1.75, -0.05),
    (-0.43, -2.0, -0.06),
    (0.0, -1.0, 0.0),
    (0.0, -1.55, -0.03),
    (0.0, -1.9, -0.04),
    (0.0, -2.15, -0.05),
    (0.35, -0.95, -0.02),
    (0.4, -1.45, -0.04),
    (0.42, -1.75, -0.05),
    (0.43, -2.0, -0.06),
    (0.65, -0.8, -0.01),
    (0.75, -1.2, -0.03),
    (0.8, -1.45, -0.04),
    (0.83, -1.65, -0.05),
]
FIST = [
    (0.0, 0.0, 0.0),
    (-0.5, -0.3, -0.05),
    (-0.7, -0.6, -0.08),
    (-0.45, -0.75, -0.10),
    (-0.2, -0.8, -0.12),
    (-0.35, -0.95, -0.02),
    (-0.4, -1.3, -0.05),
    (-0.38, -1.1, -0.20),
    (-0.35, -0.8, -0.20),
    (0.0, -1.0, 0.0),
    (0.0, -1.35, -0.05),
    (0.0, -1.1, -0.22),
    (0.0, -0.75, -0.22),
    (0.35, -0.95, -0.02),
    (0.4, -1.3, -0.05),
    (0.38, -1.08, -0.20),
    (0.35, -0.75, -0.20),
    (0.65, -0.8, -0.01),
    (0.7, -1.05, -0.04),
    (0.65, -0.9, -0.18),
    (0.55, -0.65, -0.18),
]


def _round(values, decimals):
    return [round(float(v), decimals) for v in values]


def _place(template, wrist, scale, mirror=False):
    """Return a flat 63-value hand: the template scaled and moved to ``wrist``."""
    out = []
    for x, y, z in template:
        out.extend((wrist[0] + (-x if mirror else x) * scale, wrist[1] + y * scale, z * scale))
    return _round(out, INPUT_DECIMALS)


def _blank_hand():
    return [0.0] * 63


def _hide(hand, landmarks):
    out = list(hand)
    for i in landmarks:
        out[i * 3 : i * 3 + 3] = [0.0, 0.0, 0.0]
    return out


# ---------------------------------------------------------------------------
# Letter
# ---------------------------------------------------------------------------


def _letter_primary(case) -> np.ndarray:
    """The hand the web policy feeds to normalization, as the case declares it.

    ``source`` is authored with the case, not derived, so the browser's choice
    of hand is checked against a stated expectation. A left hand is mirrored
    with 1 - x, and a landmark that is missing stays at zero.
    """
    source = case["source"]
    if source == "right":
        return np.array(case["right"], dtype=np.float32)
    if source == "left_mirrored":
        hand = np.array(case["left"], dtype=np.float32).reshape(21, 3)
        visible = np.any(hand != 0, axis=1)
        hand[visible, 0] = 1.0 - hand[visible, 0]
        return hand.reshape(-1)
    return np.zeros(63, dtype=np.float32)


def letter_vector(case) -> list[float]:
    """The 93-D vector the Python source of truth makes for one case."""
    primary = _letter_primary(case)
    vector = extract_features(normalize_landmarks(primary))
    return _round(vector, OUTPUT_DECIMALS)


def build_letter_cases():
    collapsed = _round([0.5, 0.5, 0.1] * 21, INPUT_DECIMALS)
    cases = [
        {
            "name": "open_palm_right",
            "note": "all five extension flags are 1",
            "source": "right",
            "right": _place(OPEN_PALM, (0.45, 0.85), 0.18),
            "left": _blank_hand(),
        },
        {
            "name": "fist_right",
            "note": "all five extension flags are 0",
            "source": "right",
            "right": _place(FIST, (0.5, 0.8), 0.15),
            "left": _blank_hand(),
        },
        {
            "name": "far_open_palm_right",
            "note": "wrist to landmark 9 is 0.05: small, but not degenerate",
            "source": "right",
            "right": _place(OPEN_PALM, (0.62, 0.55), 0.05),
            "left": _blank_hand(),
        },
        {
            "name": "fist_left_alone",
            "note": "a left hand alone is mirrored with 1 - x",
            "source": "left_mirrored",
            "right": _blank_hand(),
            "left": _place(FIST, (0.58, 0.78), 0.2, mirror=True),
        },
        {
            "name": "left_more_visible_than_right",
            "note": "the hand with more visible landmarks wins",
            "source": "left_mirrored",
            "right": _hide(_place(OPEN_PALM, (0.3, 0.8), 0.15), range(4, 21)),
            "left": _place(OPEN_PALM, (0.7, 0.85), 0.17, mirror=True),
        },
        {
            "name": "equally_visible_prefers_right",
            "note": "a tie goes to the right hand",
            "source": "right",
            "right": _place(OPEN_PALM, (0.4, 0.82), 0.16),
            "left": _place(FIST, (0.7, 0.82), 0.16, mirror=True),
        },
        {
            "name": "right_with_hidden_pinky",
            "note": "missing landmarks inside a visible hand stay as they are",
            "source": "right",
            "right": _hide(_place(OPEN_PALM, (0.5, 0.85), 0.2), range(17, 21)),
            "left": _blank_hand(),
        },
        {
            "name": "no_hands",
            "note": "nothing visible gives an all-zero vector",
            "source": "none",
            "right": _blank_hand(),
            "left": _blank_hand(),
        },
        {
            "name": "collapsed_hand",
            "note": "every landmark in one place has no scale, so it is zeroed",
            "source": "right",
            "right": collapsed,
            "left": _blank_hand(),
        },
    ]
    for case in cases:
        case["expect"] = letter_vector(case)
    return cases


# ---------------------------------------------------------------------------
# Word
# ---------------------------------------------------------------------------

FRAMES_PER_SEQUENCE = 5


def _blend(a, b, t):
    return [(1 - t) * p + t * q for p, q in zip(a, b)]


def _word_hand(t, mirror=False, drift=0.0):
    """A hand closing from an open palm to a fist as ``t`` goes 0 -> 1."""
    template = [tuple(_blend(o, f, t)) for o, f in zip(OPEN_PALM, FIST)]
    return _place(template, (0.55 + drift * t, 0.62 - 0.1 * t), 0.2, mirror=mirror)


def _word_face(t):
    """40 face points; nose, mouth and forehead are the anchors the code reads."""
    face = []
    for j in range(40):
        face.extend(
            (
                0.5 + 0.08 * math.sin(j * 0.7) + 0.01 * t,
                0.3 + 0.06 * math.cos(j * 0.5),
                0.01 * math.sin(j + t),
            )
        )
    face[32 * 3 : 32 * 3 + 3] = [0.5, 0.30, -0.02]  # nose, face landmark 1
    face[13 * 3 : 13 * 3 + 3] = [0.5, 0.36, -0.03]  # mouth, face landmark 13
    face[36 * 3 : 36 * 3 + 3] = [0.5, 0.22, -0.01]  # forehead, face landmark 168
    return _round(face, INPUT_DECIMALS)


def _word_pose(t, shoulders=True):
    """25 pose points; indices 11 and 12 are the shoulders."""
    pose = []
    for j in range(25):
        pose.extend(
            (0.5 + 0.2 * math.sin(j), 0.5 + 0.1 * math.cos(j * 0.9), 0.02 * math.sin(j * 1.3))
        )
    pose[0:3] = [0.5, 0.28, -0.05]
    if shoulders:
        pose[11 * 3 : 11 * 3 + 3] = [0.34 + 0.004 * t, 0.46, 0.0]
        pose[12 * 3 : 12 * 3 + 3] = [0.66 - 0.004 * t, 0.47, 0.01]
    else:
        pose[11 * 3 : 11 * 3 + 3] = [0.0, 0.0, 0.0]
        pose[12 * 3 : 12 * 3 + 3] = [0.0, 0.0, 0.0]
    return _round(pose, INPUT_DECIMALS)


def _frame(right, left, t, shoulders=True):
    return right + left + _word_face(t) + _word_pose(t, shoulders)


def _sequence(builder):
    frames = []
    for i in range(FRAMES_PER_SEQUENCE):
        t = i / (FRAMES_PER_SEQUENCE - 1)
        frames.append(builder(i, t))
    return frames


def word_sequence_features(frames) -> list[list[float]]:
    """Notebook contract: normalize each frame, then build all 168-D rows."""
    raw = np.array(frames, dtype=np.float32)
    normalized = np.stack([normalize_shoulders(raw[i]) for i in range(raw.shape[0])])
    return [_round(row, OUTPUT_DECIMALS) for row in build_compact_features(normalized)]


def build_word_sequences():
    specs = [
        (
            "right_sign_left_flickers_in",
            "right",
            "the left hand shows for two frames only; right stays dominant",
            lambda i, t: _frame(
                _word_hand(t, drift=0.1),
                _word_hand(0.5, mirror=True) if i < 2 else _blank_hand(),
                t,
            ),
        ),
        (
            "left_sign_only",
            "left",
            "a dominant left hand is mirrored by negating x",
            lambda i, t: _frame(_blank_hand(), _word_hand(t, mirror=True, drift=-0.1), t),
        ),
        (
            "hand_switches_mid_sign",
            "left",
            "dominance is chosen once for the recording, not per frame",
            lambda i, t: _frame(
                _word_hand(t) if i < 2 else _blank_hand(),
                _word_hand(t, mirror=True) if i >= 2 else _blank_hand(),
                t,
            ),
        ),
        (
            "right_sign_without_shoulders",
            "right",
            "no shoulders in view falls back to min-max scaling",
            lambda i, t: _frame(_word_hand(t, drift=0.05), _blank_hand(), t, shoulders=False),
        ),
    ]
    sequences = []
    for name, side, note, builder in specs:
        frames = _sequence(builder)
        sequences.append(
            {
                "name": name,
                "note": note,
                "dominant": side,
                "frames": frames,
                "expect": word_sequence_features(frames),
            }
        )
    return sequences


# ---------------------------------------------------------------------------


def build_golden() -> dict:
    return {
        "about": (
            "Generated by scripts/evaluation/export_feature_goldens.py from the Python "
            "feature code. Do not edit by hand."
        ),
        "tolerance": TOLERANCE,
        "letter": {"cases": build_letter_cases()},
        "word": {"sequences": build_word_sequences()},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=GOLDEN_PATH)
    args = parser.parse_args(argv)

    golden = build_golden()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(golden, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {args.output} ({args.output.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
