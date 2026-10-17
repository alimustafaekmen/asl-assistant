"""The desktop word buffer, and what happens to a frame without hands.

The fault that matters is tested at the orchestration boundary: forwarded
face/body landmarks must not reach ``SequenceClassifier.add_frame`` when no
hand was detected.
"""

from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

pytest.importorskip("torch")
pytest.importorskip("customtkinter")

from asl_desktop.config import WORD_IDLE_RESET_FRAMES
from asl_desktop.models.sequence_classifier import SequenceClassifier
from asl_desktop.ui.translation_view import TranslationView

WORD_FEATURE_DIM = 321  # Holistic: 107 landmarks × 3


def test_buffer_empty_on_init():
    """A new classifier starts with an empty buffer."""
    clf = SequenceClassifier(model_type="word")
    assert len(clf._frame_buffer) == 0
    assert clf.buffer_progress == 0.0


def _word_view_without_gui() -> TranslationView:
    """Build only the state used by _process_word_mode; do not start Tk."""
    view = TranslationView.__new__(TranslationView)
    view._word_loaded = True
    view._cooldown_frames = 0
    view._word_idle_frames = 0
    view._current_prediction = "stale"
    view._current_confidence = 0.9
    view._word_classifier = Mock(buffer_progress=0.0)
    view._motion_tracker = SimpleNamespace(speed=0.0)
    view._logger = Mock()
    view._prediction_label = Mock()
    view._confidence_label = Mock()
    view._top3_label = Mock()
    view._buffer_progress_label = Mock()
    return view


def test_no_hands_never_reaches_word_classifier():
    view = _word_view_without_gui()
    frame = np.zeros((8, 8, 3), dtype=np.uint8)
    forwarded_landmarks = np.ones(WORD_FEATURE_DIM, dtype=np.float32)

    returned = TranslationView._process_word_mode(
        view,
        forwarded_landmarks,
        frame,
        is_moving=True,
        hands_detected=False,
    )

    assert returned is frame
    view._word_classifier.add_frame.assert_not_called()
    assert view._current_prediction == ""
    assert view._current_confidence == 0.0


def test_prolonged_hand_absence_resets_stale_word_buffer():
    view = _word_view_without_gui()
    view._word_idle_frames = WORD_IDLE_RESET_FRAMES - 1

    TranslationView._process_word_mode(
        view,
        np.ones(WORD_FEATURE_DIM, dtype=np.float32),
        np.zeros((8, 8, 3), dtype=np.uint8),
        is_moving=True,
        hands_detected=False,
    )

    view._word_classifier.add_frame.assert_not_called()
    view._word_classifier.reset_buffer.assert_called_once_with()
    assert view._word_idle_frames == 0


def test_buffer_fills_only_when_add_frame_called():
    """Each add_frame() call, standing for a frame with a hand, adds one frame."""
    clf = SequenceClassifier(model_type="word")
    # add_frame() returns early while _loaded is False; setting it tests the
    # buffer on its own, without a model.
    clf._loaded = True

    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)

    for i in range(1, 6):
        clf.add_frame(fake_kp)
        assert len(clf._frame_buffer) == i, f"the buffer should hold {i} frames after frame {i}"

    assert clf.buffer_progress > 0.0


def test_buffer_reset_clears_all_frames():
    """reset_buffer(), the clean-up a lost hand triggers, empties the buffer."""
    clf = SequenceClassifier(model_type="word")
    clf._loaded = True  # reaches the buffer without a model, as above

    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)
    for _ in range(15):
        clf.add_frame(fake_kp)

    assert len(clf._frame_buffer) == 15

    clf.reset_buffer()

    assert len(clf._frame_buffer) == 0, "the buffer should be empty after reset_buffer()"
    assert clf.buffer_progress == 0.0


def test_no_prediction_without_model():
    """Without a loaded model, add_frame() predicts nothing and returns None."""
    clf = SequenceClassifier(model_type="word")
    # _loaded is False (no model), so add_frame() returns early.
    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)
    result = clf.add_frame(fake_kp)
    assert result is None, "no prediction should be made without a model"
    # It leaves the buffer untouched as well.
    assert len(clf._frame_buffer) == 0
