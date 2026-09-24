"""Behavior tests for reusable landmark, label-map, and directory helpers."""

import numpy as np
import pytest
from asl_ml.utils import (
    ensure_dir,
    invert_label_map,
    load_label_map,
    normalize_landmarks,
    save_label_map,
)


class TestNormalizeLandmarks:
    def test_output_contract_and_wrist_origin(self, hand_landmarks):
        result = normalize_landmarks(hand_landmarks)
        assert result.shape == (63,)
        assert result.dtype == np.float32
        coords = result.reshape(21, 3)
        np.testing.assert_allclose(coords[0], [0.0, 0.0, 0.0], atol=1e-6)
        assert np.all(np.isfinite(result))

    def test_positive_scale_invariance(self, hand_landmarks):
        scaled = hand_landmarks * 2.5
        r1 = normalize_landmarks(hand_landmarks)
        r2 = normalize_landmarks(scaled)
        np.testing.assert_allclose(r1, r2, atol=1e-5)

    def test_zero_input(self):
        raw = np.zeros(63, dtype=np.float32)
        result = normalize_landmarks(raw)
        assert result.shape == (63,)
        assert np.all(np.isfinite(result))

    def test_translation_invariance(self, hand_landmarks):
        shifted = hand_landmarks.copy()
        coords = shifted.reshape(21, 3)
        coords += np.array([10.0, -5.0, 3.0])
        shifted = coords.flatten()

        r1 = normalize_landmarks(hand_landmarks)
        r2 = normalize_landmarks(shifted)
        np.testing.assert_allclose(r1, r2, atol=1e-5)

    @pytest.mark.parametrize("size", [0, 62, 64])
    def test_invalid_input_size_fails_early(self, size):
        with pytest.raises(ValueError):
            normalize_landmarks(np.zeros(size, dtype=np.float32))


class TestLabelMap:
    def test_save_and_load(self, tmp_path):
        label_map = {"A": 0, "B": 1, "C": 2}
        filepath = str(tmp_path / "nested" / "label_map.json")
        save_label_map(label_map, filepath)
        loaded = load_label_map(filepath)
        assert loaded == label_map

    def test_invert(self):
        label_map = {"A": 0, "B": 1, "C": 2}
        inv = invert_label_map(label_map)
        assert inv == {0: "A", 1: "B", 2: "C"}

    def test_invert_string_values(self):
        label_map = {"hello": "0", "world": "1"}
        inv = invert_label_map(label_map)
        assert inv == {0: "hello", 1: "world"}


class TestEnsureDir:
    def test_creates_dir(self, tmp_path):
        target = str(tmp_path / "subdir" / "nested")
        result = ensure_dir(target)
        assert (tmp_path / "subdir" / "nested").is_dir()
        assert result == target

    def test_existing_dir(self, tmp_path):
        result = ensure_dir(str(tmp_path))
        assert tmp_path.is_dir()
        assert result == str(tmp_path)
