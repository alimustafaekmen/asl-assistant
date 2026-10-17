"""The camera-free demo's hand poses are ones the published letter model reads.

The demo plays recorded landmarks through the live letter pipeline and asks
the visitor to add each letter it shows. If a model update stopped reading a
pose as its letter, the demo would teach the wrong thing while every other
gate stayed green. These tests read the committed demo file and score it
with the deployed ONNX model through asl_features, the feature code the
browser's features.js mirrors.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

ort = pytest.importorskip("onnxruntime")

from asl_features.landmarks import normalize_landmarks, to_square_units  # noqa: E402
from asl_features.letter import extract_features  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "asl-web" / "data" / "demo-letters.json"
STATIC_LETTERS = set("ABCDEFGHIKLMNOPQRSTUVWXY")


@pytest.fixture(scope="module")
def demo() -> dict:
    return json.loads(DEMO.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def model():
    labels = json.loads(
        (ROOT / "asl-web" / "data" / "letter_labels.json").read_text(encoding="utf-8")
    )
    session = ort.InferenceSession(str(ROOT / "asl-web" / "models" / "letter_model.onnx"))
    output = next(o.name for o in session.get_outputs() if "prob" in o.name)
    return session, session.get_inputs()[0].name, output, sorted(labels, key=labels.get)


def _probabilities(model, landmarks) -> np.ndarray:
    session, input_name, output_name, _ = model
    square = to_square_units(np.asarray(landmarks, dtype=np.float32).reshape(-1), 1, 1)
    features = extract_features(normalize_landmarks(square)).reshape(1, -1).astype(np.float32)
    return session.run([output_name], {input_name: features})[0][0]


def test_the_demo_spells_its_word_with_static_letters_in_order(demo) -> None:
    assert demo["schema"] == "asl-demo-letters-v1"
    word = demo["word"]
    assert word and set(word) <= STATIC_LETTERS, f"{word!r} needs a letter the model does not know"
    assert [entry["letter"] for entry in demo["letters"]] == list(word)
    assert "CC0" in demo["source"], "the poses must come from a source that may be redistributed"


def test_every_pose_is_a_right_hand_of_21_points_inside_the_frame(demo) -> None:
    for entry in demo["letters"]:
        points = np.asarray(entry["landmarks"], dtype=float)
        assert entry["handedness"] == "Right"
        assert points.shape == (21, 3), entry["letter"]
        assert np.isfinite(points).all(), entry["letter"]
        assert ((points[:, :2] >= 0) & (points[:, :2] <= 1)).all(), entry["letter"]


def test_the_published_model_reads_each_pose_as_its_letter(demo, model) -> None:
    names = model[3]
    for entry in demo["letters"]:
        probs = _probabilities(model, entry["landmarks"])
        read = names[int(np.argmax(probs))]
        assert read == entry["letter"], f"the pose for {entry['letter']} is read as {read}"
        assert probs[names.index(entry["letter"])] >= 0.9, entry["letter"]


def test_a_held_pose_wobbling_slightly_is_still_read_as_its_letter(demo, model) -> None:
    names = model[3]
    rng = np.random.default_rng(7)
    for entry in demo["letters"]:
        points = np.asarray(entry["landmarks"], dtype=np.float32)
        for _ in range(10):
            shaken = points.copy()
            shaken[:, :2] += rng.uniform(-0.005, 0.005, size=(21, 2))
            read = names[int(np.argmax(_probabilities(model, shaken)))]
            assert read == entry["letter"], f"a wobbling {entry['letter']} is read as {read}"
