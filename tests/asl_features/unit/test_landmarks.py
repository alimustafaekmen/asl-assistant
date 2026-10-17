"""Behavior tests for the landmark normalization helper."""

import numpy as np
import pytest
from asl_features.landmarks import normalize_landmarks


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


class TestSquareUnits:
    """MediaPipe gives x over the frame's width and y over its height.

    The letter model was trained on square photographs, so a hand from a
    non-square camera has to be put back into square units before the
    features; the browser does the same (``letter-aspect.test.js``).
    """

    @staticmethod
    def _golden(name):
        import json
        from pathlib import Path

        golden = (
            Path(__file__).resolve().parents[3]
            / "tests"
            / "web"
            / "fixtures"
            / "feature-golden.json"
        )
        cases = json.loads(golden.read_text(encoding="utf-8"))["letter"]["cases"]
        return next(case for case in cases if case["name"] == name)

    @staticmethod
    def _in_frame(square_hand, width, height):
        """The hand drawn in a centred square, as MediaPipe reports it in the frame."""
        edge = min(width, height)
        coords = np.asarray(square_hand, dtype=np.float64).reshape(21, 3)
        frame = np.empty_like(coords)
        frame[:, 0] = ((width - edge) / 2 + coords[:, 0] * edge) / width
        frame[:, 1] = ((height - edge) / 2 + coords[:, 1] * edge) / height
        frame[:, 2] = coords[:, 2] * edge / width
        return frame.reshape(-1).astype(np.float32)

    @pytest.mark.parametrize(
        ("width", "height"), [(1280, 720), (720, 1280), (640, 480), (720, 720)]
    )
    def test_a_hand_in_any_frame_gives_the_square_frame_features(self, width, height):
        from asl_features.landmarks import to_square_units
        from asl_features.letter import extract_features

        case = self._golden("open_palm_right")
        hand = self._in_frame(case["right"], width, height)

        features = extract_features(normalize_landmarks(to_square_units(hand, width, height)))

        np.testing.assert_allclose(features, case["expect"], atol=1e-5)

    def test_a_square_frame_or_an_unknown_size_leaves_the_hand_alone(self, hand_landmarks):
        from asl_features.landmarks import to_square_units

        np.testing.assert_array_equal(to_square_units(hand_landmarks, 720, 720), hand_landmarks)
        np.testing.assert_array_equal(to_square_units(hand_landmarks, 0, 0), hand_landmarks)
