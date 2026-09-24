#!/usr/bin/env python3
"""Compare desktop pickle and web ONNX letter-model top-1 outputs.

This is a read-only validation script. It does not export, rewrite, or copy any
model. It feeds deterministic 93D fixtures to:

  - models/letter/letter_model.pkl
  - asl-web/models/letter_model.onnx

and checks whether top-1 labels match.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PKL_PATH = PROJECT_ROOT / "models" / "letter" / "letter_model.pkl"
ONNX_PATH = PROJECT_ROOT / "asl-web" / "models" / "letter_model.onnx"
LABEL_PATH = PROJECT_ROOT / "models" / "letter" / "letter_label_map.json"


def _fixture_hands() -> dict[str, np.ndarray]:
    base = np.array(
        [
            [0.52, 0.82, 0.00],
            [0.48, 0.74, -0.01],
            [0.44, 0.67, -0.02],
            [0.41, 0.61, -0.03],
            [0.39, 0.56, -0.04],
            [0.52, 0.66, -0.01],
            [0.52, 0.55, -0.02],
            [0.52, 0.45, -0.03],
            [0.52, 0.36, -0.04],
            [0.57, 0.66, -0.01],
            [0.59, 0.54, -0.02],
            [0.60, 0.43, -0.03],
            [0.61, 0.33, -0.04],
            [0.62, 0.68, -0.01],
            [0.65, 0.58, -0.02],
            [0.67, 0.49, -0.03],
            [0.68, 0.41, -0.04],
            [0.66, 0.72, -0.01],
            [0.71, 0.65, -0.02],
            [0.74, 0.58, -0.03],
            [0.77, 0.51, -0.04],
        ],
        dtype=np.float32,
    )
    compact = base.copy()
    compact[:, 1] = 0.82 - (0.82 - compact[:, 1]) * 0.58
    compact[:, 0] = 0.52 + (compact[:, 0] - 0.52) * 0.75
    tilted = base.copy()
    tilted[:, 0] += np.linspace(-0.04, 0.04, 21, dtype=np.float32)
    return {
        "open_hand": base.reshape(-1),
        "compact_hand": compact.reshape(-1),
        "tilted_hand": tilted.reshape(-1),
    }


def _features(raw63: np.ndarray) -> np.ndarray:
    import sys

    sys.path.insert(0, str(PROJECT_ROOT / "asl-ml" / "src"))
    from asl_ml.features.letter_features import extract_features
    from asl_ml.utils.landmarks import normalize_landmarks

    return extract_features(normalize_landmarks(raw63)).astype(np.float32)


def _label_map() -> dict[int, str]:
    data = json.loads(LABEL_PATH.read_text())
    return {int(v): k for k, v in data.items()}


def _onnx_top1(sess, input_name: str, output_names: list[str], x: np.ndarray) -> tuple[str, str]:
    outputs = sess.run(output_names, {input_name: x.reshape(1, -1)})
    label_out = outputs[0]
    idx = int(np.asarray(label_out).reshape(-1)[0])
    return str(idx), type(outputs[1]).__name__ if len(outputs) > 1 else "label-only"


def main() -> int:
    import joblib
    import onnxruntime as ort

    model = joblib.load(PKL_PATH)
    sess = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    output_names = [o.name for o in sess.get_outputs()]
    idx_to_label = _label_map()

    print("fixture,pickle_top1,onnx_top1,same,pickle_conf,onnx_output_type,note")
    ok = True
    for name, raw in _fixture_hands().items():
        x = _features(raw)
        probs = model.predict_proba(x.reshape(1, -1))[0]
        p_idx = int(np.argmax(probs))
        p_label = idx_to_label[p_idx]
        p_conf = float(probs[p_idx])

        onnx_idx_text, onnx_type = _onnx_top1(sess, input_name, output_names, x)
        o_idx = int(onnx_idx_text)
        o_label = idx_to_label[o_idx]
        same = p_label == o_label
        ok = ok and same
        print(
            f"{name},{p_label},{o_label},{same},"
            f"{p_conf:.8f},{onnx_type},outputs={'+'.join(output_names)}"
        )

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
