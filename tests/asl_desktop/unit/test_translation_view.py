"""Focused tests for translation-view state transitions."""

from types import SimpleNamespace
from unittest.mock import Mock, call

import numpy as np
from asl_desktop.ui.translation_view import TranslationView


def test_calibration_batch_is_persisted_once() -> None:
    classifier = Mock()
    view = SimpleNamespace(
        _is_calibrating=True,
        _classifier=classifier,
        _calib_target="A",
        _calib_frames=0,
        _dwell_progress=Mock(),
        _feedback_label=Mock(),
        _prediction_label=Mock(),
        _confidence_label=Mock(),
        _top3_label=Mock(),
        _cooldown_frames=0,
    )
    keypoints = np.arange(63, dtype=np.float32)
    frame = object()

    for _ in range(29):
        result = TranslationView._process_letter_mode(view, keypoints, frame, False)

    assert result is frame
    assert classifier.calibrate.call_count == 29
    assert classifier.calibrate.call_args_list == [
        call("A", keypoints, persist=False) for _ in range(29)
    ]
    classifier.save_calibration.assert_not_called()

    result = TranslationView._process_letter_mode(view, keypoints, frame, False)

    assert result is frame
    assert classifier.calibrate.call_count == 30
    classifier.save_calibration.assert_called_once_with()
    assert view._is_calibrating is False
    assert view._cooldown_frames == 30
