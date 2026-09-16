"""
Birim Testleri — asl_ml.features.letter_features
(eskiden `src/feature_engineer.py`; Custom Package M / 2026-04-26 refactor sonrasi taşındı)
"""
import numpy as np
import pytest

from asl_ml.features.letter_features import extract_features


class TestExtractFeatures:
    def test_output_size(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        assert result.shape[0] == 93
        assert result.dtype == np.float32

    def test_no_nan_in_output(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        assert not np.any(np.isnan(result))

    def test_zero_input_no_nan(self):
        raw = np.zeros(63, dtype=np.float32)
        result = extract_features(raw)
        assert not np.any(np.isnan(result))
        assert np.all(np.isfinite(result))

    def test_first_63_are_raw(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        np.testing.assert_allclose(result[:63], raw, atol=1e-6)

    def test_distances_nonnegative(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        fingertip_dists = result[63:68]
        assert np.all(fingertip_dists >= 0)

    def test_adjacent_distances_nonnegative(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        adj_dists = result[68:72]
        assert np.all(adj_dists >= 0)

    def test_angles_in_range(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        angles = result[72:86]
        assert np.all(angles >= 0)
        assert np.all(angles <= np.pi + 1e-6)

    def test_finger_flags_binary(self):
        raw = np.random.randn(63).astype(np.float32)
        result = extract_features(raw)
        flags = result[88:93]
        for f in flags:
            assert f in (0.0, 1.0)

    def test_deterministic(self):
        raw = np.random.randn(63).astype(np.float32)
        r1 = extract_features(raw)
        r2 = extract_features(raw)
        np.testing.assert_array_equal(r1, r2)

    def test_overlapping_landmarks_no_crash(self):
        raw = np.zeros(63, dtype=np.float32)
        raw[:3] = [0.5, 0.5, 0.0]
        for i in range(1, 21):
            raw[i*3:i*3+3] = [0.5, 0.5, 0.0]
        result = extract_features(raw)
        assert result.shape[0] == 93
        assert np.all(np.isfinite(result))
