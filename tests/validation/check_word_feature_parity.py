#!/usr/bin/env python3
"""Diagnostic parity test for the WORD 168D compact feature pipeline.

Compares asl_features.word (the Python port of the feature cells in
`notebooks/word_50_training.ipynb`) against the live web
JavaScript runtime (`asl-web/js/ml/landmarks.js` + `features.js`,
executed under Node).

Output: CSV-like rows with one of three statuses:

    PASS       max_abs_diff < 1e-4: Python and JS produce equivalent
               168D features for this fixture. Used as the parity bar.
    KNOWN_GAP  fixture marked KNOWN_GAP in FIXTURES, for a divergence that
               is understood and accepted; reported so its size is visible,
               not a failure. No fixture is marked so.
    FAIL       fixture was expected to PASS but did not. Returns
               exit code 1; investigate before any runtime change.

The script only reads: it changes no notebook, model artifact, runtime JSON or
web runtime file. It exits 0 when only PASS and KNOWN_GAP rows are present, so
an accepted gap does not block `make health`, which runs it.

Usage:
    python3 tests/validation/check_word_feature_parity.py

Requires `node` on PATH (the web runtime is JS); without it the script exits
2, because nothing was compared.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
# Runnable straight from a clone, before `make setup` installs asl-features.
sys.path.insert(0, str(PROJECT_ROOT / "asl-features" / "src"))

# The Python reference is the trained notebook's feature code, kept in
# asl-features. It is imported, not copied, so this check compares the browser
# against the same code the tests pin to the notebook.
from asl_features.word import (  # noqa: E402
    NUM_FACE,
    NUM_POSE,
    build_compact_features,
    normalize_shoulders,
)

# JS runner: the web JS files and a small driver are concatenated into a
# temporary .js file, which `node` runs; the (T, 168) result comes back on
# stdout.

WEB_LANDMARKS = PROJECT_ROOT / "asl-web" / "js" / "ml" / "landmarks.js"
WEB_FEATURES = PROJECT_ROOT / "asl-web" / "js" / "ml" / "features.js"


def _check_node_available() -> bool:
    try:
        r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def run_js_compact(seq_321d: np.ndarray, features_js: Path = WEB_FEATURES) -> np.ndarray:
    """Apply the web JS pipeline (normalizeShoulders → buildCompactFeatures)
    to a (T, 321) sequence and return (T, 168).

    The JS files declare classic global functions, so they are concatenated
    into one temporary script that Node loads as top-level declarations.
    `CONFIG` and `recordBenchmark` are stubbed: only the letter feature path
    reads them, and it is not exercised here.
    """
    if not WEB_LANDMARKS.exists() or not features_js.exists():
        raise FileNotFoundError(f"Web JS missing: {WEB_LANDMARKS}, {features_js}")

    landmarks_src = WEB_LANDMARKS.read_text(encoding="utf-8")
    features_src = features_js.read_text(encoding="utf-8")

    payload_obj = seq_321d.astype(np.float32).tolist()

    with tempfile.TemporaryDirectory() as tmpdir:
        payload_path = Path(tmpdir) / "fixture.json"
        payload_path.write_text(json.dumps(payload_obj), encoding="utf-8")

        # Placeholders rather than an f-string: the JS source contains
        # backticks and `${...}` template literals.
        template = (
            "// Auto-generated harness. DO NOT EDIT.\n"
            "global.CONFIG = global.CONFIG || {};\n"
            "global.recordBenchmark = function () {};\n"
            "const fs = require('fs');\n"
            "const data = JSON.parse(fs.readFileSync(__PAYLOAD_PATH__, 'utf8'));\n"
            "// ----- BEGIN asl-web/js/ml/landmarks.js -----\n"
            "__LANDMARKS_JS__\n"
            "// ----- END asl-web/js/ml/landmarks.js -----\n"
            "// ----- BEGIN asl-web/js/ml/features.js -----\n"
            "__FEATURES_JS__\n"
            "// ----- END asl-web/js/ml/features.js -----\n"
            "const T = data.length;\n"
            "const normalizedSeq = [];\n"
            "for (let t = 0; t < T; t++) {\n"
            "  const raw = new Float32Array(data[t]);\n"
            "  const normalized = normalizeShoulders(raw);\n"
            "  normalizedSeq.push(normalized);\n"
            "}\n"
            "const compactSeq = typeof buildCompactSequenceFeatures === 'function'\n"
            "  ? buildCompactSequenceFeatures(normalizedSeq)\n"
            "  : normalizedSeq.map((frame, idx) => buildCompactFeatures(frame, idx > 0 ? normalizedSeq[idx - 1] : null));\n"
            "const out = compactSeq.map((compact) => Array.from(compact));\n"
            "process.stdout.write(JSON.stringify(out));\n"
        )
        driver_js = (
            template.replace("__PAYLOAD_PATH__", json.dumps(str(payload_path)))
            .replace("__LANDMARKS_JS__", landmarks_src)
            .replace("__FEATURES_JS__", features_src)
        )

        driver_path = Path(tmpdir) / "driver.js"
        driver_path.write_text(driver_js, encoding="utf-8")

        result = subprocess.run(
            ["node", str(driver_path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"node driver failed (exit {result.returncode}):\n"
                f"STDERR: {result.stderr}\nSTDOUT: {result.stdout[:500]}"
            )
        return np.array(json.loads(result.stdout), dtype=np.float32)


# Fixtures


def _make_hand(rng, T, dominant=True, dropouts=()):
    """Generate (T, 63) hand landmarks. If dominant=False, returns zeros."""
    hand = np.zeros((T, 63), dtype=np.float32)
    if not dominant:
        return hand
    bases = rng.uniform(0.2, 0.8, size=(21, 3)).astype(np.float32)
    for j in range(21):
        for t in range(T):
            phase = t / max(T - 1, 1)
            hand[t, j * 3 + 0] = bases[j, 0] + 0.05 * np.sin(phase * 2 * np.pi + j * 0.1)
            hand[t, j * 3 + 1] = bases[j, 1] + 0.05 * np.cos(phase * 2 * np.pi + j * 0.1)
            hand[t, j * 3 + 2] = bases[j, 2]
    for t in dropouts:
        if 0 <= t < T:
            hand[t] = 0.0
    return hand


def _make_face(rng, T):
    """Generate (T, NUM_FACE*3) with stable nose/mouth/forehead anchors."""
    face = np.zeros((T, NUM_FACE * 3), dtype=np.float32)
    face[:, 32 * 3 : 32 * 3 + 3] = [0.5, 0.30, 0.0]  # nose (FACE 1)
    face[:, 13 * 3 : 13 * 3 + 3] = [0.5, 0.35, 0.0]  # mouth (FACE 13)
    face[:, 36 * 3 : 36 * 3 + 3] = [0.5, 0.25, 0.0]  # forehead (FACE 168)
    for j in range(NUM_FACE):
        if j in (32, 13, 36):
            continue
        face[:, j * 3 : j * 3 + 3] = rng.uniform(0.3, 0.7, size=(T, 3))
    return face


def _make_pose(rng, T, has_shoulders=True):
    """Generate (T, NUM_POSE*3). POSE_INDICES[11] and [12] are shoulders."""
    pose = np.zeros((T, NUM_POSE * 3), dtype=np.float32)
    if has_shoulders:
        for t in range(T):
            pose[t, 11 * 3 : 11 * 3 + 3] = [0.3 + 0.001 * t, 0.40, 0.0]
            pose[t, 12 * 3 : 12 * 3 + 3] = [0.7 - 0.001 * t, 0.40, 0.0]
        for idx in [0, 13, 14, 15, 16]:
            pose[:, idx * 3 : idx * 3 + 3] = rng.uniform(0.2, 0.8, size=(T, 3))
    return pose


def _assemble(rh, lh, face, pose):
    return np.concatenate([rh, lh, face, pose], axis=1).astype(np.float32)


def fixture_right_only_nominal(T=45, seed=11):
    rng = np.random.default_rng(seed)
    rh = _make_hand(rng, T, dominant=True)
    lh = _make_hand(rng, T, dominant=False)
    face = _make_face(rng, T)
    pose = _make_pose(rng, T, has_shoulders=True)
    return _assemble(rh, lh, face, pose)


def fixture_left_only_mirror(T=45, seed=12):
    rng = np.random.default_rng(seed)
    rh = _make_hand(rng, T, dominant=False)
    lh = _make_hand(rng, T, dominant=True)
    face = _make_face(rng, T)
    pose = _make_pose(rng, T, has_shoulders=True)
    return _assemble(rh, lh, face, pose)


def fixture_shoulders_present(T=45, seed=13):
    return fixture_right_only_nominal(T=T, seed=seed)


def fixture_shoulders_missing(T=45, seed=14):
    rng = np.random.default_rng(seed)
    rh = _make_hand(rng, T, dominant=True)
    lh = _make_hand(rng, T, dominant=False)
    face = _make_face(rng, T)
    pose = _make_pose(rng, T, has_shoulders=False)  # shoulders zero
    return _assemble(rh, lh, face, pose)


def fixture_dominant_switch_sequence(T=45, seed=15):
    rng = np.random.default_rng(seed)
    # Frames 0..19: right hand only; frames 20..44: left hand only.
    rh = np.zeros((T, 63), dtype=np.float32)
    lh = np.zeros((T, 63), dtype=np.float32)
    rh[:20] = _make_hand(rng, 20, dominant=True)
    lh[20:] = _make_hand(np.random.default_rng(seed + 1), T - 20, dominant=True)
    face = _make_face(rng, T)
    pose = _make_pose(rng, T, has_shoulders=True)
    return _assemble(rh, lh, face, pose)


def fixture_two_hands_stable(T=45, seed=16):
    rng = np.random.default_rng(seed)
    rh = _make_hand(rng, T, dominant=True)
    # Left hand has one dropout, so right has slightly fewer zeros across
    # the whole sequence; both notebook and web should pick right.
    lh = _make_hand(np.random.default_rng(seed + 1), T, dominant=True, dropouts=(10,))
    face = _make_face(rng, T)
    pose = _make_pose(rng, T, has_shoulders=True)
    return _assemble(rh, lh, face, pose)


FIXTURES = [
    # (name, builder, expectation, note)
    ("right_only_nominal", fixture_right_only_nominal, "PASS", ""),
    ("left_only_mirror", fixture_left_only_mirror, "PASS", ""),
    ("shoulders_present", fixture_shoulders_present, "PASS", ""),
    ("shoulders_missing", fixture_shoulders_missing, "PASS", ""),
    ("dominant_switch_sequence", fixture_dominant_switch_sequence, "PASS", ""),
    ("two_hands_stable", fixture_two_hands_stable, "PASS", ""),
]


# Driver and report


def _segment_breakdown(py_compact: np.ndarray, js_compact: np.ndarray):
    """Return per-segment max_abs_diff to localize where parity diverges."""
    segs = [
        ("dominant[0..62]", 0, 63),
        ("shape[63..92]", 63, 93),
        ("relations[93..104]", 93, 105),
        ("motion[105..167]", 105, 168),
    ]
    return {
        name: float(np.abs(py_compact[:, a:b] - js_compact[:, a:b]).max()) for name, a, b in segs
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Word 168D feature parity, Python against JS")
    parser.add_argument(
        "--features-js",
        type=Path,
        default=WEB_FEATURES,
        help="features.js to compare with Python (default: the deployed one)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not _check_node_available():
        print("ERROR: `node` not found on PATH. Install Node 24 (see .node-version) and retry.")
        print("(JS runtime parity cannot be measured without Node.)")
        return 2

    print("=" * 78)
    print("WORD 168D FEATURE PARITY: diagnostic (PASS / KNOWN_GAP / FAIL)")
    print("=" * 78)
    print(f"Project root:    {PROJECT_ROOT}")
    print("Python contract: asl_features.word (the training notebook's feature code)")
    print("JS runtime:      asl-web/js/ml/landmarks.js, asl-web/js/ml/features.js")
    print("PASS tolerance:  max_abs_diff < 1e-4")
    print("KNOWN_GAP rules: fixtures marked KNOWN_GAP in FIXTURES (none are)")
    print()
    print("fixture,python_shape,js_shape,max_abs_diff,status,note")

    pass_n, gap_n, fail_n = 0, 0, 0
    breakdown_rows = []

    for name, builder, expected, note in FIXTURES:
        raw_seq = builder()
        py_norm = np.stack([normalize_shoulders(raw_seq[t]) for t in range(raw_seq.shape[0])])
        py_compact = build_compact_features(py_norm)
        try:
            js_compact = run_js_compact(raw_seq, args.features_js)
        except Exception as exc:
            print(f"{name},?,?,?,FAIL,JS runner error: {exc}")
            fail_n += 1
            continue

        diff = float(np.abs(py_compact - js_compact).max())

        if diff < 1e-4:
            status = "PASS"
            pass_n += 1
        elif expected == "KNOWN_GAP":
            status = "KNOWN_GAP"
            gap_n += 1
        else:
            status = "FAIL"
            fail_n += 1

        py_shape = f"{py_compact.shape[0]}x{py_compact.shape[1]}"
        js_shape = f"{js_compact.shape[0]}x{js_compact.shape[1]}"
        print(f"{name},{py_shape},{js_shape},{diff:.2e},{status},{note}")

        if status != "PASS":
            breakdown_rows.append((name, _segment_breakdown(py_compact, js_compact)))

    print()
    print(f"Summary: PASS={pass_n}, KNOWN_GAP={gap_n}, FAIL={fail_n}")

    if breakdown_rows:
        print()
        print("Per-segment breakdown (helps localize divergence):")
        print("fixture,dominant[0..62],shape[63..92],relations[93..104],motion[105..167]")
        for name, segs in breakdown_rows:
            print(
                "{},{:.2e},{:.2e},{:.2e},{:.2e}".format(
                    name,
                    segs["dominant[0..62]"],
                    segs["shape[63..92]"],
                    segs["relations[93..104]"],
                    segs["motion[105..167]"],
                )
            )

    return 1 if fail_n > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
