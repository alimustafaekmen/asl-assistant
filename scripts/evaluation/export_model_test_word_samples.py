#!/usr/bin/env python3
"""Export browser model-test fixtures from Kaggle ASL Signs data.

This script does not train or modify model artifacts. It reads the Kaggle
`train.csv` + landmark parquet files, rebuilds the word model input contract,
runs the deployed web ONNX model, and writes small JSON fixtures for the
`asl-web` Model Test panel:

    task="word", features[45*168], mask[45], expected_label

Example:
    python3 scripts/evaluation/export_model_test_word_samples.py \
      --kaggle-dir /path/to/asl-signs \
      --samples-per-word 1

The Kaggle directory must contain `train.csv` and the relative parquet paths
listed in its `path` column, usually under `train_landmark_files/`.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_DATA_DIR = PROJECT_ROOT / "asl-web" / "data"
WEB_MODEL_PATH = PROJECT_ROOT / "asl-web" / "models" / "word_model.onnx"
WORD_LABELS_PATH = WEB_DATA_DIR / "word_labels.json"
TEMP_PATH = WEB_DATA_DIR / "temperature.json"
MODEL_TEST_DIR = WEB_DATA_DIR / "model-test-samples"
WORD_OUT_DIR = MODEL_TEST_DIR / "words"
MANIFEST_PATH = MODEL_TEST_DIR / "manifest.json"

SEED = 42
TARGET_LEN = 45
FEATURE_DIM = 168

FACE_INDICES = [
    61,
    146,
    91,
    181,
    84,
    17,
    314,
    405,
    321,
    375,
    78,
    191,
    80,
    13,
    312,
    308,
    33,
    133,
    159,
    145,
    263,
    362,
    386,
    374,
    70,
    63,
    105,
    66,
    300,
    293,
    334,
    296,
    1,
    2,
    98,
    327,
    168,
    197,
    195,
    5,
]
POSE_INDICES = list(range(17)) + list(range(23, 31))
NUM_RIGHT = 21
NUM_LEFT = 21
NUM_FACE = 40
NUM_POSE = 25
NUM_TOTAL = (NUM_RIGHT + NUM_LEFT + NUM_FACE + NUM_POSE) * 3

WRIST = 0
FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_MCPS = [1, 5, 9, 13, 17]
FINGER_PIPS = [2, 6, 10, 14, 18]
FINGER_DIPS = [3, 7, 11, 15, 19]


def _slug(value: str) -> str:
    value = value.strip().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "sample"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _safe_norm(v: np.ndarray, axis: int = -1) -> np.ndarray:
    return np.maximum(np.linalg.norm(v, axis=axis), 1e-8)


def _angle_between_vectors(a: np.ndarray, b: np.ndarray) -> float:
    cos = np.sum(a * b) / (_safe_norm(a) * _safe_norm(b))
    return float(np.arccos(np.clip(cos, -1.0, 1.0)))


def normalize_shoulders(frame_data: np.ndarray) -> np.ndarray:
    normalized_frame = frame_data.copy()
    pose_start_index = (NUM_RIGHT + NUM_LEFT + NUM_FACE) * 3
    left_shoulder_position = POSE_INDICES.index(11)
    right_shoulder_position = POSE_INDICES.index(12)
    ls_start = pose_start_index + left_shoulder_position * 3
    rs_start = pose_start_index + right_shoulder_position * 3
    ls = normalized_frame[ls_start : ls_start + 3]
    rs = normalized_frame[rs_start : rs_start + 3]

    if np.any(ls != 0) and np.any(rs != 0):
        shoulder_center = (ls + rs) / 2.0
        shoulder_width = np.linalg.norm(ls - rs)
        if shoulder_width > 1e-6:
            lm3 = normalized_frame.reshape(-1, 3)
            visible = np.any(lm3 != 0, axis=1)
            lm3[visible] = (lm3[visible] - shoulder_center) / shoulder_width
            return lm3.flatten().astype(np.float32)

    nonzero_values = normalized_frame[normalized_frame != 0]
    if len(nonzero_values) > 0:
        mn, mx = nonzero_values.min(), nonzero_values.max()
        rng = mx - mn
        if rng > 1e-6:
            normalized_frame = np.where(normalized_frame == 0, 0.0, (normalized_frame - mn) / rng)
    return normalized_frame.astype(np.float32)


def _target_columns() -> list[str]:
    columns = []
    for prefix, indices in (
        ("right_hand", range(NUM_RIGHT)),
        ("left_hand", range(NUM_LEFT)),
        ("face", FACE_INDICES),
        ("pose", POSE_INDICES),
    ):
        for idx in indices:
            columns.extend([f"x_{prefix}_{idx}", f"y_{prefix}_{idx}", f"z_{prefix}_{idx}"])
    return columns


TARGET_COLS = _target_columns()


def _load_long_format_fast(df) -> np.ndarray | None:
    frames = sorted(df["frame"].unique())
    if len(frames) < 5:
        return None

    landmark_matrix = np.full((len(frames), NUM_TOTAL), np.nan, dtype=np.float32)
    frame_to_row = {frame_number: row_index for row_index, frame_number in enumerate(frames)}

    column_start = 0
    specs = [
        ("right_hand", NUM_RIGHT, list(range(NUM_RIGHT))),
        ("left_hand", NUM_LEFT, list(range(NUM_LEFT))),
        ("face", NUM_FACE, FACE_INDICES),
        ("pose", NUM_POSE, POSE_INDICES),
    ]
    for body_part_name, landmark_count, landmark_indices in specs:
        body_part_df = df[df["type"] == body_part_name]
        if body_part_df.empty:
            column_start += landmark_count * 3
            continue

        for coordinate_offset, coordinate_name in enumerate(("x", "y", "z")):
            pivot_table = body_part_df.pivot_table(
                index="frame",
                columns="landmark_index",
                values=coordinate_name,
                aggfunc="first",
            )
            for local_landmark_index, landmark_index in enumerate(landmark_indices):
                if landmark_index not in pivot_table.columns:
                    continue
                for frame_number, coordinate_value in pivot_table[landmark_index].items():
                    if frame_number in frame_to_row and not np.isnan(coordinate_value):
                        row_index = frame_to_row[frame_number]
                        col = column_start + local_landmark_index * 3 + coordinate_offset
                        landmark_matrix[row_index, col] = coordinate_value
        column_start += landmark_count * 3
    return landmark_matrix


def load_single_parquet(parquet_path: Path):
    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas is required. Install project dev requirements first.") from exc

    try:
        df = pd.read_parquet(parquet_path)
    except ImportError as exc:
        raise SystemExit("pandas could not read parquet. Install pyarrow or fastparquet.") from exc

    if "type" in df.columns and "landmark_index" in df.columns:
        landmark_sequence = _load_long_format_fast(df)
        if landmark_sequence is None:
            return None
    elif any(c in df.columns for c in ("x_right_hand_0", "x_left_hand_0")):
        available = [c for c in TARGET_COLS if c in df.columns]
        if len(available) < NUM_TOTAL * 0.3:
            return None
        landmark_sequence = np.full((len(df), NUM_TOTAL), np.nan, dtype=np.float32)
        for column_index, column_name in enumerate(TARGET_COLS):
            if column_name in df.columns:
                landmark_sequence[:, column_index] = df[column_name].values
    else:
        return None

    import pandas as pd

    landmark_df = pd.DataFrame(landmark_sequence)
    landmark_df = landmark_df.interpolate(method="linear", limit_direction="both")
    landmark_df = landmark_df.ffill().bfill()
    landmark_sequence = np.nan_to_num(landmark_df.values.astype(np.float32), nan=0.0)
    landmark_sequence = landmark_sequence[np.any(landmark_sequence != 0, axis=1)]
    if len(landmark_sequence) < 5:
        return None

    normalized = np.zeros_like(landmark_sequence)
    for frame_index in range(len(landmark_sequence)):
        if np.any(landmark_sequence[frame_index] != 0):
            normalized[frame_index] = normalize_shoulders(landmark_sequence[frame_index])
    return normalized


def compute_per_frame_shape_features(hand_21x3: np.ndarray) -> np.ndarray:
    feats: list[float] = []
    wrist = hand_21x3[WRIST]
    palm_size = _safe_norm(hand_21x3[9] - wrist)
    norm = (hand_21x3 - wrist) / palm_size

    for tip in FINGER_TIPS:
        feats.append(float(_safe_norm(norm[tip])))
    for i in range(len(FINGER_TIPS) - 1):
        feats.append(float(_safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[i + 1]])))
    for i in range(len(FINGER_TIPS)):
        for j in range(i + 1, len(FINGER_TIPS)):
            feats.append(float(_safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[j]])))
    for tip, mcp in zip(FINGER_TIPS, FINGER_MCPS):
        feats.append(1.0 if _safe_norm(norm[tip]) > _safe_norm(norm[mcp]) else 0.0)
    for fp in (1, 2, 3):
        v1 = norm[FINGER_MCPS[fp]] - norm[FINGER_PIPS[fp]]
        v2 = norm[FINGER_DIPS[fp]] - norm[FINGER_PIPS[fp]]
        feats.append(_angle_between_vectors(v1, v2))

    visible = norm[np.any(norm != 0, axis=1)]
    if len(visible) > 2:
        wh = visible.max(axis=0)[:2] - visible.min(axis=0)[:2]
        feats.append(float(wh[0] / max(wh[1], 1e-8)))
        feats.append(float(wh[0] * wh[1]))
    else:
        feats.extend([0.0, 0.0])
    feats.append(float(np.mean([_safe_norm(norm[t]) for t in FINGER_TIPS])))
    return np.array(feats, dtype=np.float32)


def compute_dominant_hand_features(seq_321d: np.ndarray) -> np.ndarray:
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
    t_count = seq_321d.shape[0]
    out = np.zeros((t_count, 12), dtype=np.float32)
    face_start = 126
    nose_idx = FACE_INDICES.index(1)
    mouth_idx = FACE_INDICES.index(13)
    forehead_idx = FACE_INDICES.index(168)
    for t in range(t_count):
        for hand_index in range(2):
            hs = hand_index * 63
            wrist = seq_321d[t, hs : hs + 3]
            tip = seq_321d[t, hs + 8 * 3 : hs + 8 * 3 + 3]
            nose = seq_321d[t, face_start + nose_idx * 3 : face_start + nose_idx * 3 + 3]
            mouth = seq_321d[t, face_start + mouth_idx * 3 : face_start + mouth_idx * 3 + 3]
            forehead = seq_321d[
                t, face_start + forehead_idx * 3 : face_start + forehead_idx * 3 + 3
            ]
            fs = hand_index * 6
            out[t, fs + 0] = _safe_norm(tip - nose)
            out[t, fs + 1] = _safe_norm(tip - mouth)
            out[t, fs + 2] = _safe_norm(tip - forehead)
            out[t, fs + 3] = _safe_norm(wrist - nose)
            out[t, fs + 4] = tip[1] - nose[1] if len(tip) >= 2 else 0.0
            out[t, fs + 5] = _safe_norm(tip - wrist)
    return out


def build_compact_features(seq_321d: np.ndarray) -> np.ndarray:
    t_count = seq_321d.shape[0]
    dom = compute_dominant_hand_features(seq_321d)
    dom3 = dom.reshape(t_count, 21, 3)
    shape = np.array([compute_per_frame_shape_features(dom3[t]) for t in range(t_count)])
    rel = compute_hand_body_relations(seq_321d)
    motion = np.zeros_like(dom)
    motion[1:] = dom[1:] - dom[:-1]
    out = np.hstack([dom, shape, rel, motion])
    if out.shape[1] != FEATURE_DIM:
        raise ValueError(f"compact dim {FEATURE_DIM} expected, got {out.shape[1]}")
    return out.astype(np.float32)


def pad_or_truncate(
    sequence: np.ndarray, target_len: int = TARGET_LEN
) -> tuple[np.ndarray, np.ndarray, int]:
    real_len = min(len(sequence), target_len)
    mask = np.zeros(target_len, dtype=bool)
    mask[:real_len] = True
    if len(sequence) == target_len:
        return sequence.astype(np.float32), mask, real_len
    if len(sequence) > target_len:
        selected_indices = np.linspace(0, len(sequence) - 1, target_len, dtype=int)
        return (
            sequence[selected_indices].astype(np.float32),
            np.ones(target_len, dtype=bool),
            target_len,
        )
    padding = np.zeros((target_len - len(sequence), sequence.shape[1]), dtype=np.float32)
    return np.vstack([sequence, padding]).astype(np.float32), mask, real_len


def _stable_softmax(logits: np.ndarray) -> np.ndarray:
    logits = logits.astype(np.float64)
    exp_scores = np.exp(logits - logits.max())
    return exp_scores / exp_scores.sum()


def _load_onnx_session():
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise SystemExit("onnxruntime is required for expected top-3 export.") from exc
    return ort.InferenceSession(str(WEB_MODEL_PATH), providers=["CPUExecutionProvider"])


def predict_word(
    session,
    features45: np.ndarray,
    mask45: np.ndarray,
    idx_to_word: dict[int, str],
    temperature: float,
):
    input_names = [i.name for i in session.get_inputs()]
    output_name = session.get_outputs()[0].name
    feeds = {
        input_names[0]: features45.reshape(1, TARGET_LEN, FEATURE_DIM).astype(np.float32),
        input_names[1]: mask45.reshape(1, TARGET_LEN).astype(bool),
    }
    logits = session.run([output_name], feeds)[0][0]
    probs = _stable_softmax(logits / temperature)
    top3 = np.argsort(probs)[-3:][::-1]
    return [
        {"label": idx_to_word[int(idx)], "confidence": float(probs[int(idx)])} for idx in top3
    ], logits.tolist()


def _split_test_rows(train_df, selected_words: set[str]):
    filtered = train_df[train_df["sign"].isin(selected_words)].copy()
    rng = np.random.default_rng(SEED)
    signers = filtered["participant_id"].unique().copy()
    rng.shuffle(signers)
    n_train = int(len(signers) * 0.70)
    n_val = int(len(signers) * 0.15)
    test_signers = set(signers[n_train + n_val :])
    return filtered[filtered["participant_id"].isin(test_signers)].reset_index(drop=True)


def _resolve_parquet_path(kaggle_dir: Path, rel_path: str) -> Path:
    path = kaggle_dir / rel_path
    if path.exists():
        return path
    path = kaggle_dir / "train_landmark_files" / rel_path
    if path.exists():
        return path
    # `kaggle competitions download -f train_landmark_files/<pid>/<seq>.parquet`
    # may extract the file directly into the target directory as
    # `<seq>.parquet`. Support that small-subset layout too.
    path = kaggle_dir / Path(rel_path).name
    if path.exists():
        return path
    return kaggle_dir / rel_path


def _update_manifest(new_word_items: list[dict]) -> None:
    manifest = (
        _load_json(MANIFEST_PATH)
        if MANIFEST_PATH.exists()
        else {
            "schema_version": "asl-model-test-manifest-v1",
            "letters": [],
            "words": [],
        }
    )
    existing = {item.get("id"): item for item in manifest.get("words", [])}
    for item in new_word_items:
        existing[item["id"]] = item
    manifest["words"] = sorted(
        existing.values(), key=lambda item: (item.get("label", ""), item.get("id", ""))
    )
    manifest["word_count"] = len(manifest["words"])
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def export_samples(
    kaggle_dir: Path, samples_per_word: int, max_words: int | None, overwrite: bool
) -> int:
    train_csv = kaggle_dir / "train.csv"
    if not train_csv.exists():
        raise SystemExit(
            f"train.csv not found under {kaggle_dir}. Download Kaggle ASL Signs data first."
        )

    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas is required. Install project dev requirements first.") from exc

    word_to_idx = _load_json(WORD_LABELS_PATH)
    selected_words = set(word_to_idx)
    idx_to_word = {int(v): k for k, v in word_to_idx.items()}
    temperature_data = _load_json(TEMP_PATH)
    temperature = float(temperature_data.get("T") or temperature_data.get("temperature") or 1.0)

    train_df = pd.read_csv(train_csv)
    required_cols = {"path", "sign", "participant_id"}
    if not required_cols.issubset(train_df.columns):
        raise SystemExit(f"train.csv must contain columns: {sorted(required_cols)}")

    test_df = _split_test_rows(train_df, selected_words)
    session = _load_onnx_session()
    WORD_OUT_DIR.mkdir(parents=True, exist_ok=True)

    exported: list[dict] = []
    per_word_count: dict[str, int] = {}
    for _, row in test_df.iterrows():
        word = str(row["sign"])
        if word not in selected_words:
            continue
        if (
            max_words is not None
            and len(per_word_count) >= max_words
            and word not in per_word_count
        ):
            continue
        if per_word_count.get(word, 0) >= samples_per_word:
            continue

        sample_no = per_word_count.get(word, 0) + 1
        sample_id = f"word-{_slug(word)}-{sample_no:02d}"
        out_path = WORD_OUT_DIR / f"{sample_id}.json"
        if out_path.exists() and not overwrite:
            per_word_count[word] = sample_no
            exported.append(
                {
                    "id": sample_id,
                    "label": word,
                    "title": f"Kelime {word} #{sample_no}",
                    "path": f"./data/model-test-samples/words/{out_path.name}",
                    "expected_label": word,
                }
            )
            continue

        parquet_path = _resolve_parquet_path(kaggle_dir, str(row["path"]))
        if not parquet_path.exists():
            continue
        seq_321 = load_single_parquet(parquet_path)
        if seq_321 is None:
            continue
        compact = build_compact_features(seq_321)
        features45, mask45, real_frames = pad_or_truncate(compact)
        expected_top3, logits = predict_word(session, features45, mask45, idx_to_word, temperature)

        fixture = {
            "schema_version": "asl-sample-v1",
            "task": "word",
            "sample_id": sample_id,
            "features": features45.flatten().astype(float).tolist(),
            "mask": mask45.astype(bool).tolist(),
            "expected_label": word,
            "expected_word": word,
            "model_prediction": expected_top3[0]["label"],
            "expected_confidence": expected_top3[0]["confidence"],
            "expected_top3": expected_top3,
            "expected_logits": logits,
            "temperature": temperature,
            "actual_frames": int(real_frames),
            "source": "Kaggle ASL Signs train.csv test split",
            "source_path": str(row["path"]),
            "participant_id": int(row["participant_id"]),
            "feature_contract": "word-45x168-v1",
            "note": "Model Test fixture exported from Kaggle ASL Signs parquet through the notebook feature pipeline.",
        }
        out_path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
        per_word_count[word] = sample_no
        exported.append(
            {
                "id": sample_id,
                "label": word,
                "title": f"Kelime {word} #{sample_no}",
                "path": f"./data/model-test-samples/words/{out_path.name}",
                "expected_label": word,
                "source": "Kaggle ASL Signs test split",
                "confidence": expected_top3[0]["confidence"],
                "kind": "kaggle-heldout",
            }
        )

        if len(per_word_count) == len(selected_words) and all(
            count >= samples_per_word for count in per_word_count.values()
        ):
            break

    _update_manifest(exported)
    print(f"Exported/registered {len(exported)} word fixture(s)")
    print(
        f"Covered {len({item['label'] for item in exported})}/{len(selected_words)} deployed word classes"
    )
    print(f"Output dir: {WORD_OUT_DIR}")
    return 0 if exported else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export word fixtures for the browser Model Test panel"
    )
    parser.add_argument(
        "--kaggle-dir", type=Path, required=True, help="Directory containing train.csv"
    )
    parser.add_argument("--samples-per-word", type=int, default=1)
    parser.add_argument("--max-words", type=int, default=None)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if args.samples_per_word < 1:
        raise SystemExit("--samples-per-word must be >= 1")
    if args.max_words is not None and args.max_words < 1:
        raise SystemExit("--max-words must be >= 1")

    return export_samples(args.kaggle_dir, args.samples_per_word, args.max_words, args.overwrite)


if __name__ == "__main__":
    raise SystemExit(main())
