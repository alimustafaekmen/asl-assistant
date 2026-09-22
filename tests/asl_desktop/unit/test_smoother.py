"""Behavior tests for prediction voting and confidence handling."""

import pytest

from asl_desktop.utils.smoother import PredictionSmoother
from asl_desktop.config import NEUTRAL_THRESHOLD


def test_consistent_predictions_are_stable():
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    assert [smoother.update("A", 0.9) for _ in range(3)] == ["A", "A", "A"]


def test_mixed_predictions():
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    smoother.update("A", 0.9)
    smoother.update("B", 0.9)
    result = smoother.update("C", 0.9)
    assert result is None


@pytest.mark.parametrize(
    "confidence",
    [0.0, max(0.0, NEUTRAL_THRESHOLD - 0.01), 0.49],
)
def test_predictions_below_acceptance_threshold_are_ignored(confidence):
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    assert smoother.update("A", confidence) is None


def test_none_label():
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    assert smoother.update(None, 1.0) is None
    assert smoother.get_smoothed_confidence() == 0.0


def test_reset():
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    smoother.update("A", 0.8)
    smoother.update("A", 1.0)
    assert smoother.get_smoothed_confidence() == pytest.approx(0.9)

    smoother.reset()

    assert smoother.get_smoothed_confidence() == 0.0
    assert smoother.update("B", 0.9) == "B"


def test_smoothed_confidence():
    smoother = PredictionSmoother(window_size=3, confidence_threshold=0.5)
    for confidence in (0.8, 0.9, 1.0):
        smoother.update("A", confidence)
    assert smoother.get_smoothed_confidence() == pytest.approx(0.9)
