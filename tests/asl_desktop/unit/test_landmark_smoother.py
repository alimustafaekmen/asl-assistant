"""Behavior tests for stateful landmark EMA smoothing."""

import numpy as np
import pytest
from asl_desktop.utils.landmark_smoother import LandmarkSmoother


def test_first_frame_passthrough_copies_internal_state():
    s = LandmarkSmoother(alpha=0.6)
    data = np.ones(63, dtype=np.float32)
    result = s.smooth(data)
    np.testing.assert_array_equal(result, data)

    # Mutating the caller-owned array must not corrupt the smoother history.
    data[:] = 5.0
    next_result = s.smooth(np.ones(63, dtype=np.float32))
    np.testing.assert_allclose(next_result, 1.0)


def test_ema_smoothing():
    s = LandmarkSmoother(alpha=0.6)
    s.smooth(np.zeros(63, dtype=np.float32))
    result = s.smooth(np.ones(63, dtype=np.float32))
    assert np.allclose(result, 0.6, atol=1e-6)


@pytest.mark.parametrize(
    ("alpha", "expected"),
    [(0.0, 0.0), (0.25, 0.25), (1.0, 1.0)],
)
def test_alpha_controls_new_frame_weight(alpha, expected):
    s = LandmarkSmoother(alpha=alpha)
    s.smooth(np.zeros(63))
    result = s.smooth(np.ones(63))
    np.testing.assert_allclose(result, expected)


def test_reset():
    s = LandmarkSmoother(alpha=0.6)
    s.smooth(np.zeros(63))
    s.smooth(np.ones(63))
    s.reset()
    data = np.full(63, 5.0)
    result = s.smooth(data)
    np.testing.assert_array_equal(result, data)


def test_shape_change_starts_a_new_smoothing_sequence():
    s = LandmarkSmoother()
    s.smooth(np.ones(63, dtype=np.float32))
    replacement = np.full(321, 3.0, dtype=np.float32)
    result = s.smooth(replacement)
    np.testing.assert_array_equal(result, replacement)
