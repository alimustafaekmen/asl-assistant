#!/usr/bin/env python3
"""Compare Python and browser JS letter feature engineering.
Python ve tarayici JS harf feature'larinin ayni sonucu urettigini dogrular.

This is a production-independent validation script. It loads the classic
browser runtime feature file in Node.js and compares computeLetterFeatures()
against the Python source-of-truth pipeline:

    normalize_landmarks(raw63) -> extract_features(normalized63)

Node.js gerektirir (features.js'i calistirmak icin); runtime asset'lerini
degistirmez. / Requires Node.js to run features.js; modifies no runtime assets.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FEATURES_JS = PROJECT_ROOT / "asl-web" / "js" / "ml" / "features.js"
TOLERANCE = 1e-4


def _fixture_hand() -> np.ndarray:
    """Return one deterministic 21x3 hand in MediaPipe normalized image space."""
    pts = np.array(
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
    return pts.reshape(-1)


def _frame321(right: np.ndarray | None = None, left: np.ndarray | None = None) -> np.ndarray:
    frame = np.zeros(321, dtype=np.float32)
    if right is not None:
        frame[:63] = right
    if left is not None:
        frame[63:126] = left
    return frame


def _python_features(raw63: np.ndarray) -> np.ndarray:
    sys.path.insert(0, str(PROJECT_ROOT / "asl-ml" / "src"))
    from asl_ml.features.letter_features import extract_features
    from asl_ml.utils.landmarks import normalize_landmarks

    normalized = normalize_landmarks(raw63.astype(np.float32))
    return extract_features(normalized)


def _js_features(frames: list[np.ndarray]) -> list[np.ndarray]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js not found; cannot execute browser JS parity check")

    payload = {
        "featuresJs": str(FEATURES_JS),
        "frames": [frame.astype(float).tolist() for frame in frames],
    }
    js = r"""
const fs = require("fs");
const vm = require("vm");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const context = {
  console,
  Float32Array,
  Array,
  Math,
  performance: { now: () => 0 },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(payload.featuresJs, "utf8"), context);
const out = payload.frames.map((frame) => {
  const result = context.computeLetterFeatures(new Float32Array(frame));
  return Array.from(result);
});
process.stdout.write(JSON.stringify(out));
"""
    proc = subprocess.run(
        [node, "-e", js],
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Node parity run failed:\n{proc.stderr}")
    return [np.array(row, dtype=np.float32) for row in json.loads(proc.stdout)]


def main() -> int:
    right = _fixture_hand()
    left = right.copy()
    left[0::3] = 1.0 - left[0::3]

    fixtures = [
        ("right_slot", _frame321(right=right), right),
        ("left_slot_js_mirror", _frame321(left=left), right),
        (
            "zero_hand",
            _frame321(right=np.zeros(63, dtype=np.float32)),
            np.zeros(63, dtype=np.float32),
        ),
    ]

    js_rows = _js_features([f[1] for f in fixtures])
    print("fixture,python_shape,js_shape,max_abs_diff,result")
    ok = True
    for (name, _frame, python_raw), js_out in zip(fixtures, js_rows):
        py_out = _python_features(python_raw)
        if py_out.shape != js_out.shape:
            diff = math.inf
        else:
            diff = float(np.max(np.abs(py_out - js_out)))
        passed = py_out.shape == js_out.shape and diff < TOLERANCE
        ok = ok and passed
        print(
            f"{name},{py_out.shape[0]},{js_out.shape[0]},{diff:.8g},{'PASS' if passed else 'FAIL'}"
        )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
