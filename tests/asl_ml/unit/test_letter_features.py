"""Behavior tests for the frozen 93D static-letter feature contract."""

import numpy as np
import pytest
from asl_ml.features.letter_features import extract_features


class TestExtractFeatures:
    def test_output_contract(self, hand_landmarks):
        result = extract_features(hand_landmarks)
        assert result.shape == (93,)
        assert result.dtype == np.float32
        assert np.all(np.isfinite(result))

    @pytest.mark.parametrize(
        "raw",
        [
            np.zeros(63, dtype=np.float32),
            np.full(63, 0.5, dtype=np.float32),
            np.linspace(-1.0, 1.0, 63, dtype=np.float32),
        ],
        ids=["all-zero", "overlapping", "mixed-sign"],
    )
    def test_degenerate_inputs_stay_finite(self, raw):
        result = extract_features(raw)
        assert result.shape == (93,)
        assert np.all(np.isfinite(result))

    def test_feature_groups_keep_their_semantic_ranges(self, hand_landmarks):
        result = extract_features(hand_landmarks)

        np.testing.assert_array_equal(result[:63], hand_landmarks)
        assert np.all(result[63:72] >= 0)  # Euclidean distances
        assert np.all((0 <= result[72:86]) & (result[72:86] <= np.pi))
        assert result[86] >= 0  # bounding-box aspect ratio
        assert result[87] >= 0  # bounding-box area
        assert set(np.unique(result[88:93])) <= {0.0, 1.0}

    def test_repeated_calls_are_identical(self, hand_landmarks):
        first = extract_features(hand_landmarks)
        second = extract_features(hand_landmarks.copy())
        np.testing.assert_array_equal(first, second)

    @pytest.mark.parametrize("size", [0, 62, 64])
    def test_invalid_input_size_fails_early(self, size):
        with pytest.raises(ValueError):
            extract_features(np.zeros(size, dtype=np.float32))
