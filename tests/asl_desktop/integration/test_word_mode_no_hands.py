"""Desktop word-buffer and no-hands regression tests.

The important regression is tested at the orchestration boundary: forwarded
face/body landmarks must not reach ``SequenceClassifier.add_frame`` when no
hand was detected.
"""
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

pytest.importorskip("torch")
pytest.importorskip("customtkinter")

from asl_desktop.models.sequence_classifier import SequenceClassifier
from asl_desktop.ui.translation_view import TranslationView
from asl_desktop.config import SEQUENCE_LENGTH, WORD_IDLE_RESET_FRAMES

WORD_FEATURE_DIM = 321  # Holistic: 107 landmark × 3


def test_buffer_empty_on_init():
    """Başlangıçta buffer boş olmalı."""
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
    """add_frame() çağrıldığında (hands_detected=True simüle) buffer dolmalı."""
    clf = SequenceClassifier(model_type="word")
    # add_frame(), _loaded=False iken erken çıkıyor — buffer davranışını test etmek
    # için _loaded=True set ediyoruz (birim testi: sadece buffer mantığını izole et)
    clf._loaded = True

    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)

    for i in range(1, 6):
        clf.add_frame(fake_kp)
        assert len(clf._frame_buffer) == i, f"{i}. frame sonrasi buffer {i} olmali"

    assert clf.buffer_progress > 0.0


def test_buffer_reset_clears_all_frames():
    """reset_buffer() sonrası buffer sıfırlanmalı (el kaybında uygulanan temizlik)."""
    clf = SequenceClassifier(model_type="word")
    clf._loaded = True  # buffer davranışı için gerekli

    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)
    for _ in range(15):
        clf.add_frame(fake_kp)

    assert len(clf._frame_buffer) == 15

    clf.reset_buffer()

    assert len(clf._frame_buffer) == 0, "reset_buffer() sonrasi buffer bos olmali"
    assert clf.buffer_progress == 0.0


def test_no_prediction_without_model():
    """Model yüklü değilken add_frame() None dönmeli (güvenli başlangıç durumu)."""
    clf = SequenceClassifier(model_type="word")
    # _loaded=False (model yok) → add_frame erken çıkar
    fake_kp = np.zeros(WORD_FEATURE_DIM, dtype=np.float32)
    result = clf.add_frame(fake_kp)
    assert result is None, "Modelsiz durumda tahmin yapilmamali"
    # Buffer da dokunulmamali
    assert len(clf._frame_buffer) == 0
