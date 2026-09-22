"""Deterministic contract tests for holistic landmark extraction.

MediaPipe model startup and camera/GL availability are environment smoke
checks, not extraction logic. These tests replace the detector backend with
small result objects so every branch is exercised without a webcam or GPU
context.
"""

from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("cv2")
pytest.importorskip("mediapipe")

from asl_desktop.detection.holistic_detector import (
    NUM_FACE,
    NUM_FEATURES,
    NUM_LEFT_HAND,
    NUM_POSE,
    NUM_RIGHT_HAND,
    HolisticDetector,
)
from asl_desktop.utils.landmark_smoother import LandmarkSmoother


def _landmark_group(count: int, *, offset: float = 0.0):
    points = [
        SimpleNamespace(x=offset + i * 0.01, y=offset + i * 0.02, z=-i * 0.005)
        for i in range(count)
    ]
    return SimpleNamespace(landmark=points)


def _detector_for(results) -> HolisticDetector:
    detector = HolisticDetector.__new__(HolisticDetector)
    detector.holistic = SimpleNamespace(process=lambda _: results)
    detector._last_results = None
    detector._smoother = LandmarkSmoother(alpha=1.0)
    detector._last_right_hand = np.zeros(NUM_RIGHT_HAND * 3, dtype=np.float32)
    detector._last_left_hand = np.zeros(NUM_LEFT_HAND * 3, dtype=np.float32)
    detector._last_face = np.zeros(NUM_FACE * 3, dtype=np.float32)
    detector._last_pose = np.zeros(NUM_POSE * 3, dtype=np.float32)
    return detector


def _results(*, right=None, left=None, face=None, pose=None):
    return SimpleNamespace(
        right_hand_landmarks=right,
        left_hand_landmarks=left,
        face_landmarks=face,
        pose_landmarks=pose,
    )


def _frame() -> np.ndarray:
    return np.zeros((16, 16, 3), dtype=np.uint8)


def test_completely_empty_result_returns_explicit_absence():
    keypoints, hands_detected = _detector_for(_results()).detect(_frame())

    assert keypoints is None
    assert hands_detected is False


@pytest.mark.parametrize("side", ["right", "left"])
def test_either_hand_produces_finite_321d_output(side):
    kwargs = {side: _landmark_group(21, offset=0.1)}
    keypoints, hands_detected = _detector_for(_results(**kwargs)).detect(_frame())

    assert hands_detected is True
    assert keypoints is not None
    assert keypoints.shape == (NUM_FEATURES,)
    assert keypoints.dtype == np.float32
    assert np.all(np.isfinite(keypoints))


def test_face_without_hands_preserves_the_idle_signal():
    detector = _detector_for(_results(face=_landmark_group(478, offset=0.2)))

    keypoints, hands_detected = detector.detect(_frame())

    assert keypoints is not None
    assert keypoints.shape == (NUM_FEATURES,)
    assert hands_detected is False


def test_missing_hand_uses_previous_hand_values_but_not_detection_flag():
    detector = _detector_for(_results(right=_landmark_group(21, offset=0.1)))
    first, first_detected = detector.detect(_frame())
    detector.holistic = SimpleNamespace(
        process=lambda _: _results(face=_landmark_group(478, offset=0.2))
    )

    second, second_detected = detector.detect(_frame())

    assert first is not None and first_detected is True
    assert second is not None and second_detected is False
    assert np.any(detector._last_right_hand != 0)
