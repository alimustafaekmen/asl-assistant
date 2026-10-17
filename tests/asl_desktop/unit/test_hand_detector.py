"""The desktop hand detector gives the letter model the hand's real shape.

MediaPipe reports x as a fraction of the frame's width and y of its height,
and a desktop webcam frame is usually 640 by 480. The letter model was trained
on square photographs, so the detector must put the hand back into square
units before normalizing it. MediaPipe is replaced at its boundary: the fake
hands solution returns a chosen hand for whatever frame it is given.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import asl_desktop.detection.hand_detector as detector_module
import numpy as np
import pytest
from asl_desktop.detection.hand_detector import HandDetector
from asl_features.landmarks import normalize_landmarks

GOLDEN = Path(__file__).resolve().parents[3] / "tests" / "web" / "fixtures" / "feature-golden.json"
SQUARE_HAND = next(
    case["right"]
    for case in json.loads(GOLDEN.read_text(encoding="utf-8"))["letter"]["cases"]
    if case["name"] == "open_palm_right"
)


def _in_frame(width: int, height: int) -> list[SimpleNamespace]:
    """The golden hand drawn in a centred square, as MediaPipe reports it."""
    edge = min(width, height)
    coords = np.asarray(SQUARE_HAND, dtype=np.float64).reshape(21, 3)
    return [
        SimpleNamespace(
            x=((width - edge) / 2 + x * edge) / width,
            y=((height - edge) / 2 + y * edge) / height,
            z=z * edge / width,
        )
        for x, y, z in coords
    ]


class FakeHands:
    """MediaPipe's hands solution, answering every frame with one hand."""

    landmarks: list[SimpleNamespace] = []

    def __init__(self, **_options):
        pass

    def process(self, _rgb):
        return SimpleNamespace(
            multi_hand_landmarks=[SimpleNamespace(landmark=FakeHands.landmarks)],
            multi_handedness=[SimpleNamespace(classification=[SimpleNamespace(score=0.99)])],
        )

    def close(self):
        pass


@pytest.fixture
def detector(monkeypatch):
    monkeypatch.setattr(detector_module.mp.solutions.hands, "Hands", FakeHands)
    return HandDetector()


@pytest.mark.parametrize(("width", "height"), [(640, 480), (1280, 720), (480, 640), (480, 480)])
def test_a_hand_from_any_camera_frame_reaches_the_model_in_square_units(detector, width, height):
    FakeHands.landmarks = _in_frame(width, height)
    frame = np.zeros((height, width, 3), dtype=np.uint8)

    detected = detector.detect(frame)

    expected = normalize_landmarks(np.asarray(SQUARE_HAND, dtype=np.float32))
    np.testing.assert_allclose(detected, expected, atol=1e-5)
