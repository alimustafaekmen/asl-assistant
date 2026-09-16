#!/usr/bin/env python3
"""tests/validation/check_word_feature_parity.py

Diagnostic parity test for the WORD 168D compact feature pipeline.

Compares the notebook contract (a pure-Python port of the relevant
`notebooks/train_word_model_final.ipynb` cells) against the live web
JavaScript runtime (`asl-web/js/ml/landmarks.js` + `features.js`,
executed under Node).

Output: CSV-like rows with one of three statuses:

    PASS       max_abs_diff < 1e-4 — Python and JS produce equivalent
               168D features for this fixture. Used as the parity bar.
    KNOWN_GAP  fixture is expected to expose a documented divergence.
               Reported so we can quantify the gap; not a CI failure.
    FAIL       fixture was expected to PASS but did not. Returns
               exit code 1 — investigate before any runtime change.

This script intentionally:
  - does NOT touch `notebooks/train_word_model_final.ipynb`
  - does NOT touch any model artifact or runtime JSON
  - does NOT modify the web runtime
  - exits 0 when only PASS and KNOWN_GAP rows are present, so it can
    be wired into `make validate` later without blocking on the
    documented gaps.

Usage:
    python3 tests/validation/check_word_feature_parity.py

Requires `node` on PATH (the web runtime is JS).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

# ----------------------------------------------------------------------------
# 1. Notebook contract port — pure Python, copied from
#    notebooks/train_word_model_final.ipynb cells 1 (constants), 6
#    (normalize_shoulders), and 10 (per-frame shape, dominant hand,
#    hand-body, build_compact_features).
#
#    DO NOT edit these to chase a parity diff — they are the trained
#    contract. If the notebook contract truly changes, the artifact
#    chain in notebooks/results/ must change first and these constants
#    must be re-synced.
# ----------------------------------------------------------------------------

FACE_INDICES = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
    78, 191, 80, 13, 312, 308,
    33, 133, 159, 145, 263, 362, 386, 374,
    70, 63, 105, 66, 300, 293, 334, 296,
    1, 2, 98, 327, 168, 197, 195, 5,
]
NUM_FACE = 40
POSE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                23, 24, 25, 26, 27, 28, 29, 30]
NUM_POSE = 25
NUM_RIGHT = 21
NUM_LEFT = 21
NUM_TOTAL = (NUM_RIGHT + NUM_LEFT + NUM_FACE + NUM_POSE) * 3  # 321

WRIST = 0
FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_MCPS = [1, 5, 9, 13, 17]
FINGER_PIPS = [2, 6, 10, 14, 18]
FINGER_DIPS = [3, 7, 11, 15, 19]

assert len(FACE_INDICES) == NUM_FACE
assert len(POSE_INDICES) == NUM_POSE
assert NUM_TOTAL == 321


def safe_norm(v, axis=-1):
    return np.maximum(np.linalg.norm(v, axis=axis), 1e-8)


def angle_between_vectors(a, b):
    cos = np.sum(a * b) / (safe_norm(a) * safe_norm(b))
    cos = np.clip(cos, -1.0, 1.0)
    return np.arccos(cos)


def normalize_shoulders(frame_data: np.ndarray) -> np.ndarray:
    """Notebook cell 6 `normalize_shoulders` — verbatim semantics."""
    normalized_frame = frame_data.copy()
    pose_start_index = (NUM_RIGHT + NUM_LEFT + NUM_FACE) * 3
    if 11 in POSE_INDICES and 12 in POSE_INDICES:
        left_shoulder_position = POSE_INDICES.index(11)
        right_shoulder_position = POSE_INDICES.index(12)
        ls = normalized_frame[pose_start_index + left_shoulder_position * 3:
                              pose_start_index + left_shoulder_position * 3 + 3]
        rs = normalized_frame[pose_start_index + right_shoulder_position * 3:
                              pose_start_index + right_shoulder_position * 3 + 3]
        if np.any(ls != 0) and np.any(rs != 0):
            shoulder_center = (ls + rs) / 2.0
            shoulder_width = np.linalg.norm(ls - rs)
            if shoulder_width > 1e-6:
                lm3 = normalized_frame.reshape(-1, 3)
                visible = np.any(lm3 != 0, axis=1)
                lm3[visible] = (lm3[visible] - shoulder_center) / shoulder_width
                return lm3.flatten().astype(np.float32)
    # Notebook fallback: min-max normalization over nonzero values.
    nonzero_values = normalized_frame[normalized_frame != 0]
    if len(nonzero_values) > 0:
        mn, mx = nonzero_values.min(), nonzero_values.max()
        rng = mx - mn
        if rng > 1e-6:
            normalized_frame = np.where(
                normalized_frame == 0, 0.0, (normalized_frame - mn) / rng
            )
    return normalized_frame.astype(np.float32)


def compute_per_frame_shape_features(hand_21x3: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_per_frame_shape_features` — verbatim."""
    feats = []
    wrist = hand_21x3[WRIST]
    palm_size = safe_norm(hand_21x3[9] - wrist)
    norm = (hand_21x3 - wrist) / palm_size

    # 5 fingertip distances from wrist
    for tip in FINGER_TIPS:
        feats.append(safe_norm(norm[tip]))
    # 4 adjacent fingertip distances
    for i in range(len(FINGER_TIPS) - 1):
        feats.append(safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[i + 1]]))
    # 10 pairwise fingertip distances
    for i in range(len(FINGER_TIPS)):
        for j in range(i + 1, len(FINGER_TIPS)):
            feats.append(safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[j]]))
    # 5 finger extension flags
    for tip, mcp in zip(FINGER_TIPS, FINGER_MCPS):
        feats.append(1.0 if safe_norm(norm[tip]) > safe_norm(norm[mcp]) else 0.0)
    # 3 PIP-DIP angles (index, middle, ring)
    for fp in [1, 2, 3]:
        v1 = norm[FINGER_MCPS[fp]] - norm[FINGER_PIPS[fp]]
        v2 = norm[FINGER_DIPS[fp]] - norm[FINGER_PIPS[fp]]
        feats.append(angle_between_vectors(v1, v2))
    # 2 bounding box (aspect, area) over visible points
    visible = norm[np.any(norm != 0, axis=1)]
    if len(visible) > 2:
        wh = visible.max(axis=0)[:2] - visible.min(axis=0)[:2]
        feats.append(wh[0] / max(wh[1], 1e-8))
        feats.append(wh[0] * wh[1])
    else:
        feats.extend([0.0, 0.0])
    # 1 average fingertip distance
    feats.append(np.mean([safe_norm(norm[t]) for t in FINGER_TIPS]))
    return np.array(feats, dtype=np.float32)


def compute_dominant_hand_features(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_dominant_hand_features` — SEQUENCE-LEVEL.

    The notebook decides which hand is dominant over the entire sequence
    by averaging zero-fraction across all T frames. The web runtime makes
    this decision per frame — that asymmetry is the focus of fixture
    `dominant_switch_sequence` below.
    """
    right_hand = seq_321d[:, :63]
    left_hand = seq_321d[:, 63:126]
    right_zero = (right_hand == 0).mean()
    left_zero = (left_hand == 0).mean()
    if right_zero <= left_zero:
        return right_hand
    mirrored = left_hand.copy()
    mirrored[:, 0::3] = -mirrored[:, 0::3]
    return mirrored


def compute_hand_body_relations(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_hand_body_relations` — verbatim.

    Per frame: for each hand (right, left) compute 6 distances/relations
    to face anchors (nose=FACE 1, mouth=FACE 13, forehead=FACE 168).
    """
    T = seq_321d.shape[0]
    out = np.zeros((T, 12), dtype=np.float32)
    face_start = 126
    nose_idx = FACE_INDICES.index(1) if 1 in FACE_INDICES else 0
    mouth_idx = FACE_INDICES.index(13) if 13 in FACE_INDICES else 5
    forehead_idx = FACE_INDICES.index(168) if 168 in FACE_INDICES else 10
    for t in range(T):
        for h in range(2):
            hs = h * 63
            wrist = seq_321d[t, hs:hs + 3]
            tip = seq_321d[t, hs + 8 * 3: hs + 8 * 3 + 3]
            nose = seq_321d[t, face_start + nose_idx * 3: face_start + nose_idx * 3 + 3]
            mouth = seq_321d[t, face_start + mouth_idx * 3: face_start + mouth_idx * 3 + 3]
            forehead = seq_321d[t, face_start + forehead_idx * 3: face_start + forehead_idx * 3 + 3]
            fs = h * 6
            out[t, fs + 0] = safe_norm(tip - nose)
            out[t, fs + 1] = safe_norm(tip - mouth)
            out[t, fs + 2] = safe_norm(tip - forehead)
            out[t, fs + 3] = safe_norm(wrist - nose)
            out[t, fs + 4] = (tip[1] - nose[1]) if len(tip) >= 2 else 0.0
            out[t, fs + 5] = safe_norm(tip - wrist)
    return out


def build_compact_features(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `build_compact_features` — verbatim.

    Output (T, 168):
      [0..62]    dominant hand 63D (sequence-level mirror if needed)
      [63..92]   per-frame shape  30D (computed on dominant hand)
      [93..104]  hand-body        12D (uses raw seq_321d both hands)
      [105..167] dominant motion  63D (dom_t - dom_{t-1}, first frame=0)
    """
    T = seq_321d.shape[0]
    dom = compute_dominant_hand_features(seq_321d)
    dom3 = dom.reshape(T, 21, 3)
    shape = np.array([compute_per_frame_shape_features(dom3[t]) for t in range(T)])
    rel = compute_hand_body_relations(seq_321d)
    motion = np.zeros_like(dom)
    motion[1:] = dom[1:] - dom[:-1]
    out = np.hstack([dom, shape, rel, motion])
    assert out.shape[1] == 168, f"compact dim 168 expected, got {out.shape[1]}"
    return out.astype(np.float32)


# ----------------------------------------------------------------------------
# 2. JS runner — concatenates the web JS files plus a small driver into a
#    temp .js, runs it with `node`, captures (T, 168) result via stdout.
# ----------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_LANDMARKS = PROJECT_ROOT / "asl-web" / "js" / "ml" / "landmarks.js"
WEB_FEATURES = PROJECT_ROOT / "asl-web" / "js" / "ml" / "features.js"


def _check_node_available() -> bool:
    try:
        r = subprocess.run(["node", "--version"], capture_output=True,
                           text=True, timeout=5)
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def run_js_compact(seq_321d: np.ndarray) -> np.ndarray:
    """Apply the web JS pipeline (normalizeShoulders → buildCompactFeatures)
    to a (T, 321) sequence and return (T, 168).

    The JS files declare classic global functions so we concatenate them
    into one temp script and let Node load them as top-level declarations.
    `CONFIG` and `recordBenchmark` are stubbed because the word feature
    path doesn't actually depend on them — only the letter feature path
    does (and that path is not exercised here).
    """
    if not WEB_LANDMARKS.exists() or not WEB_FEATURES.exists():
        raise FileNotFoundError(
            f"Web JS missing: {WEB_LANDMARKS}, {WEB_FEATURES}"
        )

    landmarks_src = WEB_LANDMARKS.read_text(encoding="utf-8")
    features_src = WEB_FEATURES.read_text(encoding="utf-8")

    payload_obj = seq_321d.astype(np.float32).tolist()

    with tempfile.TemporaryDirectory() as tmpdir:
        payload_path = Path(tmpdir) / "fixture.json"
        payload_path.write_text(json.dumps(payload_obj), encoding="utf-8")

        # Use placeholder substitution (not f-string) because the JS source
        # contains backticks and `${...}` template literals.
        template = (
            "// Auto-generated harness — DO NOT EDIT.\n"
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
            template
            .replace("__PAYLOAD_PATH__", json.dumps(str(payload_path)))
            .replace("__LANDMARKS_JS__", landmarks_src)
            .replace("__FEATURES_JS__", features_src)
        )

        driver_path = Path(tmpdir) / "driver.js"
        driver_path.write_text(driver_js, encoding="utf-8")

        result = subprocess.run(
            ["node", str(driver_path)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"node driver failed (exit {result.returncode}):\n"
                f"STDERR: {result.stderr}\nSTDOUT: {result.stdout[:500]}"
            )
        return np.array(json.loads(result.stdout), dtype=np.float32)


# ----------------------------------------------------------------------------
# 3. Fixtures
# ----------------------------------------------------------------------------

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
    face[:, 32 * 3:32 * 3 + 3] = [0.5, 0.30, 0.0]  # nose (FACE 1)
    face[:, 13 * 3:13 * 3 + 3] = [0.5, 0.35, 0.0]  # mouth (FACE 13)
    face[:, 36 * 3:36 * 3 + 3] = [0.5, 0.25, 0.0]  # forehead (FACE 168)
    for j in range(NUM_FACE):
        if j in (32, 13, 36):
            continue
        face[:, j * 3:j * 3 + 3] = rng.uniform(0.3, 0.7, size=(T, 3))
    return face


def _make_pose(rng, T, has_shoulders=True):
    """Generate (T, NUM_POSE*3). POSE_INDICES[11] and [12] are shoulders."""
    pose = np.zeros((T, NUM_POSE * 3), dtype=np.float32)
    if has_shoulders:
        for t in range(T):
            pose[t, 11 * 3:11 * 3 + 3] = [0.3 + 0.001 * t, 0.40, 0.0]
            pose[t, 12 * 3:12 * 3 + 3] = [0.7 - 0.001 * t, 0.40, 0.0]
        for idx in [0, 13, 14, 15, 16]:
            pose[:, idx * 3:idx * 3 + 3] = rng.uniform(0.2, 0.8, size=(T, 3))
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


# ----------------------------------------------------------------------------
# 4. Driver / reporting
# ----------------------------------------------------------------------------

def _segment_breakdown(py_compact: np.ndarray, js_compact: np.ndarray):
    """Return per-segment max_abs_diff to localize where parity diverges."""
    segs = [("dominant[0..62]", 0, 63), ("shape[63..92]", 63, 93),
            ("relations[93..104]", 93, 105), ("motion[105..167]", 105, 168)]
    return {
        name: float(np.abs(py_compact[:, a:b] - js_compact[:, a:b]).max())
        for name, a, b in segs
    }


def main() -> int:
    if not _check_node_available():
        print("ERROR: `node` not found on PATH. Install Node 16+ and retry.")
        print("(JS runtime parity cannot be measured without Node.)")
        return 2

    print("=" * 78)
    print("WORD 168D FEATURE PARITY — diagnostic (PASS / KNOWN_GAP / FAIL)")
    print("=" * 78)
    print(f"Project root:    {PROJECT_ROOT}")
    print(f"Python contract: notebooks/train_word_model_final.ipynb cells 1, 6, 10")
    print(f"JS runtime:      asl-web/js/ml/landmarks.js, asl-web/js/ml/features.js")
    print(f"PASS tolerance:  max_abs_diff < 1e-4")
    print(f"KNOWN_GAP rules: documented divergences")
    print()
    print("fixture,python_shape,js_shape,max_abs_diff,status,note")

    pass_n, gap_n, fail_n = 0, 0, 0
    breakdown_rows = []

    for name, builder, expected, note in FIXTURES:
        raw_seq = builder()
        py_norm = np.stack([normalize_shoulders(raw_seq[t])
                            for t in range(raw_seq.shape[0])])
        py_compact = build_compact_features(py_norm)
        try:
            js_compact = run_js_compact(raw_seq)
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
            print("{},{:.2e},{:.2e},{:.2e},{:.2e}".format(
                name,
                segs["dominant[0..62]"],
                segs["shape[63..92]"],
                segs["relations[93..104]"],
                segs["motion[105..167]"],
            ))

    return 1 if fail_n > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
