"""Optional smoke test for the real desktop letter-model artifact."""

from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("joblib")

from asl_desktop.config import LETTER_MODEL_PATH, LETTER_LABEL_MAP_PATH
from asl_desktop.models.letter_classifier import LetterClassifier

@pytest.fixture(scope="module")
def loaded_classifier() -> LetterClassifier:
    if not Path(LETTER_MODEL_PATH).is_file() or not Path(LETTER_LABEL_MAP_PATH).is_file():
        pytest.skip("Desktop letter model artifacts are not installed")

    clf = LetterClassifier()
    try:
        loaded = clf.load()
    except (ImportError, OSError) as exc:
        pytest.skip(f"Desktop model native runtime is unavailable: {exc}")
    if not loaded:
        pytest.skip("Desktop letter model could not be loaded")
    return clf


def test_real_model_loads_with_published_class_count(loaded_classifier):
    assert loaded_classifier.is_loaded
    assert loaded_classifier.num_classes == 24


def test_real_model_prediction_contract(loaded_classifier):
    keypoints = np.linspace(-0.5, 0.5, 63, dtype=np.float32)
    label, conf, top3 = loaded_classifier.predict(keypoints)
    assert isinstance(label, str)
    assert 0.0 <= conf <= 1.0
    assert len(top3) == 3
    assert all(isinstance(l, str) and isinstance(s, float) for l, s in top3)
