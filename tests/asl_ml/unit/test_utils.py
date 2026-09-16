"""
Birim Testleri — asl_ml.utils (landmarks, labels, io)
(eskiden `src/utils.py`; Custom Package M / 2026-04-26 refactor sonrasi taşındı)
"""
import os
import json
import tempfile

import numpy as np
import pytest

from asl_ml.utils import normalize_landmarks, load_label_map, save_label_map, invert_label_map, ensure_dir


class TestNormalizeLandmarks:
    def test_output_shape(self):
        raw = np.random.randn(63).astype(np.float32)
        result = normalize_landmarks(raw)
        assert result.shape == (63,)
        assert result.dtype == np.float32

    def test_wrist_is_origin(self):
        raw = np.random.randn(63).astype(np.float32)
        result = normalize_landmarks(raw)
        coords = result.reshape(21, 3)
        np.testing.assert_allclose(coords[0], [0.0, 0.0, 0.0], atol=1e-6)

    def test_scale_invariance(self):
        raw = np.random.randn(63).astype(np.float32)
        scaled = raw * 2.5
        r1 = normalize_landmarks(raw)
        r2 = normalize_landmarks(scaled)
        np.testing.assert_allclose(r1, r2, atol=1e-5)

    def test_zero_input(self):
        raw = np.zeros(63, dtype=np.float32)
        result = normalize_landmarks(raw)
        assert result.shape == (63,)
        assert np.all(np.isfinite(result))

    def test_translation_invariance(self):
        raw = np.random.randn(63).astype(np.float32)
        shifted = raw.copy()
        coords = shifted.reshape(21, 3)
        coords += np.array([10.0, -5.0, 3.0])
        shifted = coords.flatten()

        r1 = normalize_landmarks(raw)
        r2 = normalize_landmarks(shifted)
        np.testing.assert_allclose(r1, r2, atol=1e-5)


class TestLabelMap:
    def test_save_and_load(self, tmp_path):
        label_map = {"A": 0, "B": 1, "C": 2}
        filepath = str(tmp_path / "test_label_map.json")
        save_label_map(label_map, filepath)
        loaded = load_label_map(filepath)
        assert loaded == {"A": 0, "B": 1, "C": 2}

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
        assert os.path.isdir(target)
        assert result == target

    def test_existing_dir(self, tmp_path):
        result = ensure_dir(str(tmp_path))
        assert os.path.isdir(str(tmp_path))
        assert result == str(tmp_path)
