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

The fixtures are derived from the competition data, whose rules forbid
redistributing it, so they are written to the ignored
`asl-web/data/model-test-samples/local/` folder with a manifest of their own.
The Model Test panel lists them when that folder exists.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# The feature code is shared with training, the desktop app and the parity
# checks. A private copy here would drift without any test noticing.
_ASL_FEATURES_SRC = str(PROJECT_ROOT / "asl-features" / "src")
if _ASL_FEATURES_SRC not in sys.path:
    sys.path.insert(0, _ASL_FEATURES_SRC)

from asl_features.word import (  # noqa: E402
    FACE_INDICES,
    NUM_FACE,
    NUM_LEFT,
    NUM_POSE,
    NUM_RIGHT,
    NUM_TOTAL,
    POSE_INDICES,
    build_compact_features,
    normalize_shoulders,
)

WEB_DATA_DIR = PROJECT_ROOT / "asl-web" / "data"
WEB_MODEL_PATH = PROJECT_ROOT / "asl-web" / "models" / "word_model.onnx"
WORD_LABELS_PATH = WEB_DATA_DIR / "word_labels.json"
TEMP_PATH = WEB_DATA_DIR / "temperature.json"
MODEL_TEST_DIR = WEB_DATA_DIR / "model-test-samples"
WORD_OUT_DIR = MODEL_TEST_DIR / "local"
MANIFEST_PATH = WORD_OUT_DIR / "manifest.json"

SEED = 42
TARGET_LEN = 45
FEATURE_DIM = 168


def _slug(value: str) -> str:
    value = value.strip().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "sample"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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
    # The same split as download_kaggle_sample_subset.py. The notebook uses the
    # legacy np.random.shuffle, so its test signers are different ones.
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
                    "path": f"./data/model-test-samples/local/{out_path.name}",
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
                "path": f"./data/model-test-samples/local/{out_path.name}",
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
