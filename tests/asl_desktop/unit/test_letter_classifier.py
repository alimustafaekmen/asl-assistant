"""Isolated tests for the desktop classifier adapter.

The real LightGBM artifact belongs to integration validation. These tests use
a tiny deterministic fake so classifier behavior can be checked on every
machine without loading a particular model file or native OpenMP runtime.
"""

from __future__ import annotations

import json

import asl_desktop.models.letter_classifier as classifier_module
import numpy as np
import pytest
from asl_desktop.models.letter_classifier import LetterClassifier


class FakeProbabilityModel:
    def __init__(self, probabilities: list[float]):
        self.probabilities = np.asarray(probabilities, dtype=np.float32)
        self.last_input_shape: tuple[int, ...] | None = None

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        self.last_input_shape = features.shape
        return self.probabilities.reshape(1, -1)

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Support the adapter's metadata-free feature-width probe."""
        self.last_input_shape = features.shape
        return np.asarray([int(np.argmax(self.probabilities))])


@pytest.fixture
def classifier_files(tmp_path):
    model_path = tmp_path / "letter_model.pkl"
    label_path = tmp_path / "letter_labels.json"
    model_path.touch()
    label_path.write_text(json.dumps({"A": 0, "B": 1, "C": 2}), encoding="utf-8")
    return model_path, label_path


def _load_with_fake(monkeypatch, classifier_files, *, feature_engineering=False):
    model_path, label_path = classifier_files
    fake = FakeProbabilityModel([0.1, 0.7, 0.2])
    monkeypatch.setattr(classifier_module.joblib, "load", lambda _: fake)

    if feature_engineering:
        model_path.with_name("letter_model_meta.json").write_text(
            json.dumps({"feature_engineering": True, "num_features": 93}),
            encoding="utf-8",
        )

    classifier = LetterClassifier()
    assert classifier.load(str(model_path), str(label_path)) is True
    return classifier, fake


@pytest.mark.parametrize(("feature_engineering", "expected_width"), [(False, 63), (True, 93)])
def test_predict_respects_model_feature_contract(
    monkeypatch, classifier_files, hand_landmarks, feature_engineering, expected_width
):
    classifier, fake = _load_with_fake(
        monkeypatch,
        classifier_files,
        feature_engineering=feature_engineering,
    )

    label, confidence, top3 = classifier.predict(hand_landmarks)

    assert fake.last_input_shape == (1, expected_width)
    assert label == "B"
    assert confidence == pytest.approx(0.7)
    assert [item[0] for item in top3] == ["B", "C", "A"]
    assert sum(score for _, score in top3) == pytest.approx(1.0)


def test_predict_before_load_returns_safe_unknown(hand_landmarks):
    assert LetterClassifier().predict(hand_landmarks) == ("?", 0.0, [])


def test_load_rejects_missing_inputs(tmp_path):
    classifier = LetterClassifier()
    assert classifier.load(str(tmp_path / "missing.pkl"), str(tmp_path / "missing.json")) is False
    assert classifier.is_loaded is False


def test_a_label_map_with_string_indices_still_names_the_classes(monkeypatch, tmp_path):
    """A label map may hold the class index as a JSON string; it must still map."""
    model_path = tmp_path / "letter_model.pkl"
    label_path = tmp_path / "letter_labels.json"
    model_path.touch()
    label_path.write_text(json.dumps({"A": "0", "B": "1", "C": "2"}), encoding="utf-8")
    monkeypatch.setattr(
        classifier_module.joblib, "load", lambda _: FakeProbabilityModel([0.1, 0.7, 0.2])
    )

    classifier = LetterClassifier()
    assert classifier.load(str(model_path), str(label_path)) is True
    label, _, top3 = classifier.predict(np.zeros(63, dtype=np.float32))

    assert label == "B"
    assert [item[0] for item in top3] == ["B", "C", "A"]
