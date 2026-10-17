"""The Model Test exporter must build word features exactly as asl_features does.

The exporter's fixtures hold the features and the model's answer for them. If
its feature code drifted from the one the app and the training notebook use, the
fixtures would describe input the product never sends, and nothing else would
notice.
"""

from __future__ import annotations

import numpy as np
import pytest
from asl_features import word as reference

from scripts.evaluation import export_model_test_word_samples as exporter

FRAMES = 12


def synthetic_sequence(seed: int, *, shoulders: bool = True, left_only: bool = False):
    """A 321D landmark sequence with missing parts, as real recordings have."""
    rng = np.random.default_rng(seed)
    seq = rng.uniform(0.05, 0.95, size=(FRAMES, reference.NUM_TOTAL)).astype(np.float32)
    seq[3:6, :126] = 0.0  # both hands lost for a few frames
    if left_only:
        seq[:, :63] = 0.0  # right hand never seen: the left one is mirrored
    if not shoulders:
        seq[:, 246:] = 0.0  # no pose at all: the fallback scaling is used
    return seq


def test_landmark_layout_constants_match() -> None:
    assert exporter.FACE_INDICES == reference.FACE_INDICES
    assert exporter.POSE_INDICES == reference.POSE_INDICES
    assert exporter.NUM_TOTAL == reference.NUM_TOTAL


@pytest.mark.parametrize(
    "options",
    [{}, {"left_only": True}, {"shoulders": False}],
    ids=["both-hands", "left-hand-only", "no-pose"],
)
def test_shoulder_normalisation_matches(options) -> None:
    for frame in synthetic_sequence(1, **options):
        np.testing.assert_array_equal(
            exporter.normalize_shoulders(frame), reference.normalize_shoulders(frame)
        )


@pytest.mark.parametrize(
    "options",
    [{}, {"left_only": True}, {"shoulders": False}],
    ids=["both-hands", "left-hand-only", "no-pose"],
)
def test_compact_features_match(options) -> None:
    seq = synthetic_sequence(2, **options)

    np.testing.assert_array_equal(
        exporter.build_compact_features(seq), reference.build_compact_features(seq)
    )
