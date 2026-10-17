#!/usr/bin/env python3
"""Export the hand poses the web app's camera-free letter demo plays.

The demo feeds recorded landmarks through the live letter pipeline, so each
pose has to come from the extractor the browser runs and has to be one the
published model reads without doubt. For every candidate letter this script
runs MediaPipe HandLandmarker (the browser's hand_landmarker.task, in video
mode) on the CC0 American Sign Language Dataset images, keeps right hands,
and scores each pose with the deployed ONNX letter model, also under small
seeded jitter like the demo's. The best pose per letter is kept, the word
whose weakest letter is strongest is chosen, and the result is written to
asl-web/data/demo-letters.json.

The candidate letters are the ones outside the model's known confusion
groups (the thumb-hidden fists M, N, T, S, E, A and the near pairs R/U/V/H,
G/K, X/D, O/C).

Usage:
    python scripts/evaluation/export_demo_letters.py --task hand_landmarker.task

The task file is published at
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Exit codes: 0 written, 1 no candidate word is read confidently enough,
2 a required input or package is missing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
_ASL_FEATURES_SRC = str(PROJECT_ROOT / "asl-features" / "src")
if _ASL_FEATURES_SRC not in sys.path:
    sys.path.insert(0, _ASL_FEATURES_SRC)

from asl_features.landmarks import normalize_landmarks, to_square_units  # noqa: E402
from asl_features.letter import extract_features  # noqa: E402

DEFAULT_DATASET = PROJECT_ROOT / "data" / "raw" / "American Sign Language Dataset"
DEFAULT_OUTPUT = PROJECT_ROOT / "asl-web" / "data" / "demo-letters.json"
MODEL_PATH = PROJECT_ROOT / "asl-web" / "models" / "letter_model.onnx"
LABELS_PATH = PROJECT_ROOT / "asl-web" / "data" / "letter_labels.json"

CANDIDATE_LETTERS = "BFILPQWY"
CANDIDATE_WORDS = ("FLY", "WIFI", "FLIP", "LILY", "BILL")
# Fraction of the frame by which each point may move under jitter; larger
# than the demo's own wobble, so a pose that passes here passes there.
JITTER = 0.005
JITTER_TRIALS = 50
MIN_CONFIDENCE = 0.9
DECIMALS = 5


def load_model():
    """The deployed letter model and its labels in output order."""
    import onnxruntime as ort

    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    names = sorted(labels, key=labels.get)
    session = ort.InferenceSession(str(MODEL_PATH))
    output = next(o.name for o in session.get_outputs() if "prob" in o.name)
    return session, session.get_inputs()[0].name, output, names


def letter_probabilities(model, landmarks: np.ndarray, width: int, height: int) -> np.ndarray:
    """Probabilities for one hand, through the feature path the browser uses."""
    session, input_name, output_name, _ = model
    square = to_square_units(landmarks.reshape(-1).astype(np.float32), width, height)
    features = extract_features(normalize_landmarks(square)).reshape(1, -1).astype(np.float32)
    return session.run([output_name], {input_name: features})[0][0]


def robustness(model, landmarks: np.ndarray, width: int, height: int, letter: str) -> float:
    """The lowest probability of `letter` over seeded jitter, or 0 if any trial misreads it."""
    names = model[3]
    index = names.index(letter)
    rng = np.random.default_rng(0)
    lowest = 1.0
    for _ in range(JITTER_TRIALS):
        shaken = landmarks.copy()
        shaken[:, :2] += rng.uniform(-JITTER, JITTER, size=(21, 2))
        probs = letter_probabilities(model, shaken, width, height)
        if int(np.argmax(probs)) != index:
            return 0.0
        lowest = min(lowest, float(probs[index]))
    return lowest


def track(task_path: Path, rgb: np.ndarray):
    """HandLandmarker in video mode over three copies of the image, as a webcam settles."""
    import mediapipe as mp

    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(task_path)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    with mp.tasks.vision.HandLandmarker.create_from_options(options) as tracker:
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = None
        for frame in range(3):
            result = tracker.detect_for_video(image, 33 * (frame + 1))
    if not result or not result.hand_landmarks:
        return None
    category = result.handedness[0][0]
    points = np.array([[p.x, p.y, p.z] for p in result.hand_landmarks[0]], dtype=np.float32)
    return points, category.category_name, float(category.score)


def best_pose(model, task_path: Path, folder: Path, letter: str):
    """The right-hand image of `letter` whose reading survives jitter best."""
    import cv2

    best = None
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        image = cv2.imread(str(path))
        if image is None:
            continue
        height, width = image.shape[:2]
        tracked = track(task_path, cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        if tracked is None:
            continue
        points, handedness, score = tracked
        # The demo publishes a right hand, as the camera does for a right-handed
        # signer; a hand labelled otherwise would be mirrored by the web rule.
        if handedness != "Right" or score < 0.5 or width != height:
            continue
        strength = robustness(model, points, width, height, letter)
        if best is None or strength > best["strength"]:
            best = {"letter": letter, "image": path.name, "points": points, "strength": strength}
    return best


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--task", type=Path, required=True, help="path to hand_landmarker.task")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="CC0 dataset root")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    if not args.task.is_file() or not args.dataset.is_dir():
        print(f"ERROR: need the task file and the dataset folder: {args.task}, {args.dataset}")
        return 2
    try:
        model = load_model()
        import cv2  # noqa: F401
        import mediapipe  # noqa: F401
    except ImportError as error:
        print(f"ERROR: a required package is missing: {error}")
        return 2

    poses = {}
    for letter in CANDIDATE_LETTERS:
        folder = args.dataset / letter.lower()
        pose = best_pose(model, args.task, folder, letter) if folder.is_dir() else None
        strength = pose["strength"] if pose else 0.0
        print(
            f"  {letter}: {strength:.3f}"
            + (f"  ({pose['image']})" if pose else "  (no usable image)")
        )
        if pose:
            poses[letter] = pose

    scores = {
        word: min((poses[c]["strength"] if c in poses else 0.0) for c in word)
        for word in CANDIDATE_WORDS
    }
    for word, score in sorted(scores.items(), key=lambda item: -item[1]):
        print(f"  {word:5s} weakest letter {score:.3f}")
    word = max(scores, key=lambda w: (scores[w], -len(w)))
    if scores[word] < MIN_CONFIDENCE:
        print(f"ERROR: no candidate word is read at {MIN_CONFIDENCE} or more under jitter")
        return 1

    document = {
        "schema": "asl-demo-letters-v1",
        "word": word,
        "source": "American Sign Language Dataset (Ayush Thakur), CC0 1.0",
        "extractor": "MediaPipe HandLandmarker hand_landmarker.task float16/1, video mode",
        "letters": [
            {
                "letter": letter,
                "image": poses[letter]["image"],
                "handedness": "Right",
                "landmarks": np.round(poses[letter]["points"], DECIMALS).tolist(),
            }
            for letter in word
        ],
    }
    args.output.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {args.output.relative_to(PROJECT_ROOT)}: {word}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
