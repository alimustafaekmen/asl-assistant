"""The models read the camera frame as captured; only the screen is mirrored.

The letter model was trained on landmarks extracted from unmirrored photos and
the desktop word model on landmarks from unmirrored video, so a detector given
the mirrored preview hands both models the other hand's shape. The user still
sees a mirror, and the landmarks drawn over it must sit on their hand in that
mirror.

Every test runs the real path from the camera to the screen: a fake capture
device returns one asymmetric frame, the real camera widget and views pass it
on, the real detectors call a fake MediaPipe solution that records the pixels
it was given and reports one hand on the frame's left side, and a stand-in for
the Tk label records the picture shown.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import Mock

import asl_desktop.camera.camera_widget as camera_module
import cv2
import mediapipe as mp
import numpy as np
import pytest
from asl_desktop.camera.camera_widget import CameraWidget
from asl_desktop.detection.hand_detector import HandDetector
from asl_desktop.detection.holistic_detector import HolisticDetector
from asl_desktop.models.letter_classifier import LetterClassifier
from asl_desktop.ui.learning_coach_view import LearningCoachView
from asl_desktop.ui.translation_view import TranslationView
from asl_desktop.utils.motion_tracker import MotionTracker
from mediapipe.framework.formats import landmark_pb2

HEIGHT, WIDTH = 120, 160


def _captured_frame() -> np.ndarray:
    """A frame that is different from its mirror image in every column."""
    columns = np.linspace(0, 255, WIDTH).astype(np.uint8)
    rows = np.linspace(0, 255, HEIGHT).astype(np.uint8)
    frame = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
    frame[:, :, 0] = columns
    frame[:, :, 1] = 255 - columns
    frame[:, :, 2] = rows[:, None]
    return frame


def _hand_on_the_left() -> landmark_pb2.NormalizedLandmarkList:
    """Twenty-one landmarks inside the leftmost third of the camera frame."""
    return landmark_pb2.NormalizedLandmarkList(
        landmark=[
            landmark_pb2.NormalizedLandmark(x=0.10 + 0.01 * i, y=0.30 + 0.019 * i, z=0.0)
            for i in range(21)
        ]
    )


class FakeHands:
    """MediaPipe's hands solution: records each frame and finds one hand."""

    seen: list[np.ndarray] = []

    def __init__(self, **_options):
        pass

    def process(self, rgb):
        FakeHands.seen.append(rgb.copy())
        return SimpleNamespace(
            multi_hand_landmarks=[_hand_on_the_left()],
            multi_handedness=[
                SimpleNamespace(classification=[SimpleNamespace(label="Left", score=0.99)])
            ],
        )

    def close(self):
        pass


class FakeHolistic:
    """MediaPipe's holistic solution: records each frame and finds one hand."""

    seen: list[np.ndarray] = []

    def __init__(self, **_options):
        pass

    def process(self, rgb):
        FakeHolistic.seen.append(rgb.copy())
        return SimpleNamespace(
            right_hand_landmarks=_hand_on_the_left(),
            left_hand_landmarks=None,
            face_landmarks=None,
            pose_landmarks=None,
        )

    def close(self):
        pass


class FakeCapture:
    """An opened camera that returns the same frame on every read."""

    def __init__(self, frame: np.ndarray):
        self._frame = frame

    def isOpened(self):  # noqa: N802 - mirrors cv2.VideoCapture
        return True

    def set(self, _prop, _value):
        return True

    def read(self):
        return True, self._frame.copy()

    def release(self):
        pass


class FakeLabel:
    """The Tk label the widget shows frames in; keeps what it was given."""

    def __init__(self):
        self.shown = None

    def configure(self, **options):
        if "image" in options:
            self.shown = options["image"]


@pytest.fixture(autouse=True)
def fake_mediapipe(monkeypatch):
    FakeHands.seen = []
    FakeHolistic.seen = []
    monkeypatch.setattr(mp.solutions.hands, "Hands", FakeHands)
    monkeypatch.setattr(mp.solutions.holistic, "Holistic", FakeHolistic)


def _show_one_frame(monkeypatch, frame: np.ndarray, callback) -> np.ndarray:
    """Start a camera widget on ``frame`` and return the BGR picture it shows."""
    monkeypatch.setattr(camera_module.cv2, "VideoCapture", lambda *_args: FakeCapture(frame))
    widget = CameraWidget.__new__(CameraWidget)
    widget.display_width = WIDTH
    widget.display_height = HEIGHT
    widget.callback = callback
    widget._cap = None
    widget._running = False
    widget._after_id = None
    widget._fail_count = 0
    widget.image_label = FakeLabel()
    widget.after = lambda _delay, _next: "next-frame"

    assert widget.start() is True

    shown = widget.image_label.shown
    assert shown is not None, "the widget showed no frame"
    return cv2.cvtColor(np.asarray(shown.cget("light_image")), cv2.COLOR_RGB2BGR)


def _translation_view(mode: str) -> TranslationView:
    """The state ``_process_frame`` reads, without building the Tk window."""
    view = TranslationView.__new__(TranslationView)
    view._mode = mode
    view._fps_count = 0
    view._fps_time = time.time()
    view._fps_label = Mock()
    view._detector = HandDetector()
    view._holistic_detector = HolisticDetector()
    view._motion_tracker = MotionTracker()
    view._cooldown_frames = 0
    # No model runs: this test is about what reaches the detectors.
    view._letter_loaded = False
    view._jz_loaded = False
    view._word_loaded = False
    return view


def _coach_view(mode: str) -> LearningCoachView:
    """The state ``_process_frame`` reads, without building the Tk window."""
    view = LearningCoachView.__new__(LearningCoachView)
    view._mode = mode
    view._selected_word = "A" if mode == "letter" else "hello"
    view._hand_detector = HandDetector()
    view._holistic_detector = HolisticDetector()
    # The coach detects only when a model is loaded. An unloaded classifier
    # answers "?", which is scored as a miss.
    view._letter_loaded = True
    view._letter_classifier = LetterClassifier()
    view._word_loaded = True
    view._word_state = "idle"
    view._is_successful = False
    view._success_frames = 0
    view._needed_success_frames = 15
    view._last_feedback_time = 0.0
    view._letter_hints = {}
    view._confidence_progress = Mock()
    view._feedback_label = Mock()
    view._hint_label = Mock()
    return view


def test_without_a_callback_the_screen_shows_the_mirrored_frame(monkeypatch):
    frame = _captured_frame()

    shown = _show_one_frame(monkeypatch, frame, callback=None)

    np.testing.assert_array_equal(shown, cv2.flip(frame, 1))


@pytest.mark.parametrize(
    ("make_view", "mode", "solution"),
    [
        (_translation_view, "letter", FakeHands),
        (_translation_view, "word", FakeHolistic),
        (_coach_view, "letter", FakeHands),
        (_coach_view, "word", FakeHolistic),
    ],
    ids=["translation-letter", "translation-word", "coach-letter", "coach-word"],
)
def test_detection_reads_the_captured_frame_and_the_hand_is_drawn_in_the_mirror(
    monkeypatch, make_view, mode, solution
):
    frame = _captured_frame()
    view = make_view(mode)

    shown = _show_one_frame(monkeypatch, frame, view._process_frame)

    assert len(solution.seen) == 1, "the detector did not run once on the frame"
    np.testing.assert_array_equal(
        solution.seen[0],
        cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
        err_msg="the detector was not given the frame as the camera captured it",
    )
    # The hand is on the camera frame's left, so in the mirror it is on the
    # right: the overlay must change the right half and leave the left alone.
    drawn = np.any(shown != cv2.flip(frame, 1), axis=2)
    assert not drawn[:, : WIDTH // 2].any(), "landmarks were drawn where the hand is not"
    assert drawn[:, WIDTH // 2 :].any(), "the hand's landmarks were not drawn"
