"""The J/Z collector records the hand the desktop app later feeds its J/Z model.

The desktop app detects on the camera frame as captured, puts the hand into
square units, mirrors a left hand into the right-hand convention and smooths
it (asl_desktop.detection.hand_detector). A collector that mirrored the frame
before detecting, and skipped those steps, would record sequences of a
different hand shape from the one the trained model is shown live. The camera
frame and MediaPipe's hands solution are the boundaries faked here.
"""

from __future__ import annotations

from types import SimpleNamespace

import cv2
import mediapipe as mp
import numpy as np
import pytest
from mediapipe.framework.formats import landmark_pb2

jz = pytest.importorskip("scripts.model_training.train_dynamic_jz_model")
from asl_desktop.detection.hand_detector import HandDetector  # noqa: E402

HEIGHT, WIDTH = 120, 160


def _captured_frame() -> np.ndarray:
    """A frame that differs from its mirror image in every column."""
    columns = np.linspace(0, 255, WIDTH).astype(np.uint8)
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    frame[:, :, 0] = columns
    frame[:, :, 1] = 255 - columns
    return frame


def _hand(label: str):
    landmarks = landmark_pb2.NormalizedLandmarkList(
        landmark=[
            landmark_pb2.NormalizedLandmark(
                x=0.10 + 0.012 * i + 0.002 * (i % 4), y=0.30 + 0.02 * i, z=-0.002 * i
            )
            for i in range(21)
        ]
    )
    return SimpleNamespace(
        multi_hand_landmarks=[landmarks],
        multi_handedness=[
            SimpleNamespace(classification=[SimpleNamespace(label=label, score=0.99)])
        ],
    )


@pytest.fixture
def fake_hands(monkeypatch):
    """MediaPipe's hands solution: records the pixels and reports one hand."""
    seen: list[np.ndarray] = []
    state = {"label": "Left"}

    class FakeHands:
        def __init__(self, **_options):
            pass

        def process(self, rgb):
            seen.append(rgb.copy())
            return _hand(state["label"])

        def close(self):
            pass

    monkeypatch.setattr(mp.solutions.hands, "Hands", FakeHands)
    return SimpleNamespace(seen=seen, state=state)


@pytest.mark.parametrize("label", ["Left", "Right"])
def test_a_recorded_frame_is_what_the_desktop_feeds_its_jz_model(fake_hands, label) -> None:
    fake_hands.state["label"] = label
    frame = _captured_frame()

    keypoints, preview = jz.capture_frame(HandDetector(), frame.copy())
    expected = HandDetector().detect(frame.copy())

    np.testing.assert_array_equal(
        cv2.cvtColor(fake_hands.seen[0], cv2.COLOR_RGB2BGR),
        frame,
        "the collector detected on a mirrored frame",
    )
    assert keypoints is not None
    np.testing.assert_allclose(
        keypoints, expected, atol=1e-6, err_msg="recorded keypoints differ from the live input"
    )


def test_the_collector_shows_the_mirror(fake_hands) -> None:
    frame = _captured_frame()
    _, preview = jz.capture_frame(HandDetector(), frame.copy())
    # The hand is drawn over it, so compare a row the landmarks do not reach.
    np.testing.assert_array_equal(preview[2], cv2.flip(frame, 1)[2])
