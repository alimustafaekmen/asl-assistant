#!/usr/bin/env python3
"""Extract MediaPipe Holistic landmarks from exploratory MS-ASL clips.

The output follows the narrow Parquet layout expected by the historical word
notebook loader. This experiment is separate from the Google ASL Signs data
used to train the published 50-word model.

Examples:
    python scripts/data_preparation/extract_msasl_landmarks.py
    python scripts/data_preparation/extract_msasl_landmarks.py --no-crop
    python scripts/data_preparation/extract_msasl_landmarks.py --validate-only

Outputs:
    data/processed/msasl_landmarks/{class_id}_{word}/{entry_id}.parquet
    data/processed/msasl_landmarks/train.csv
    data/processed/msasl_landmarks/extraction_state.json
    data/processed/msasl_landmarks/extraction_metadata.json
"""

import argparse
import gc
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import cv2

# This script targets the MediaPipe 0.10.18 Solutions API.
import mediapipe as mp
import numpy as np
import pandas as pd

# Frozen desktop 25-word landmark order. Keep aligned with HolisticDetector;
# this is not the compact 168D feature contract of the web 50-word model.
FACE_INDICES = [
    61,
    185,
    40,
    39,
    37,
    0,
    267,
    269,
    270,
    409,
    291,
    375,
    321,
    405,
    314,
    17,
    46,
    53,
    52,
    65,
    276,
    283,
    282,
    295,
    33,
    7,
    163,
    144,
    362,
    382,
    381,
    263,
    1,
    2,
    98,
    327,
    168,
    197,
    195,
    5,
]
POSE_INDICES = list(range(25))

NUM_RIGHT_HAND = 21
NUM_LEFT_HAND = 21
NUM_FACE = len(FACE_INDICES)  # 40
NUM_POSE = len(POSE_INDICES)  # 25
NUM_LANDMARKS = NUM_RIGHT_HAND + NUM_LEFT_HAND + NUM_FACE + NUM_POSE  # 107
NUM_FEATURES = NUM_LANDMARKS * 3  # 321

# Video-level quality thresholds for the exploratory extraction pipeline.
MIN_HAND_FRAME_RATIO = 0.60
MIN_FRAMES = 10
MAX_FRAMES = 120
MIN_HAND_FRAMES_ABS = 5
OUTLIER_Z_THRESHOLD = 5.0

# Keep this mapping aligned with ``download_msasl_videos.py``.
WORD_TO_MSASL_CLASS = {
    "hello": 0,
    "eat": 3,
    "food": 3,
    "no": 4,
    "happy": 5,
    "like": 6,
    "finish": 12,
    "friend": 17,
    "mom": 19,
    "yes": 20,
    "good": 24,
    "again": 26,
    "sad": 27,
    "need": 29,
    "dad": 31,
    "brother": 34,
    "book": 38,
    "please": 47,
    "water": 48,
    "help": 50,
    "hungry": 54,
    "different": 55,
    "drink": 56,
    "sick": 63,
    "name": 67,
    "day": 72,
    "thankyou": 75,
    "go": 87,
    "big": 88,
    "work": 90,
    "know": 97,
    "dog": 108,
    "have": 111,
    "home": 118,
    "all": 134,
    "hot": 135,
    "can": 142,
    "more": 164,
    "cold": 177,
    "bye": 216,
    "new": 271,
    "give": 288,
    "talk": 355,
    "sleep": 361,
    "before": 387,
    "wait": 400,
    "child": 525,
    "look": 613,
    "open": 702,
    "come": 801,
}

CLASS_TO_WORDS: dict[int, list[str]] = {}
for _w, _c in WORD_TO_MSASL_CLASS.items():
    CLASS_TO_WORDS.setdefault(_c, []).append(_w)

# MediaPipe settings aligned with the shared Python ML defaults.
MP_MODEL_COMPLEXITY = 1
MP_MIN_DETECTION_CONFIDENCE = 0.5
MP_MIN_TRACKING_CONFIDENCE = 0.4

# Paths
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MSASL_DIR = PROJECT_ROOT / "data" / "raw" / "MS-ASL"
DEFAULT_VIDEO_DIR = MSASL_DIR / "videos"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "processed" / "msasl_landmarks"
DEFAULT_STATE_FILE = DEFAULT_OUTPUT_DIR / "extraction_state.json"

# Offset source signer IDs to avoid collisions if datasets are combined.
SIGNER_ID_OFFSET = 1_000_000


def setup_logging(output_dir: Path) -> logging.Logger:
    """Create an INFO console logger and a DEBUG file logger."""
    logger = logging.getLogger("msasl_extract")
    logger.setLevel(logging.DEBUG)

    output_dir.mkdir(parents=True, exist_ok=True)
    log_file = output_dir / "extraction.log"

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(ch)

    return logger


def load_state(state_file: Path) -> dict:
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {"version": 1, "completed": {}, "failed": {}}


def save_state(state: dict, state_file: Path) -> None:
    tmp = state_file.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    tmp.replace(state_file)


def crop_to_bbox(
    frame: np.ndarray,
    box: list[float],
    padding: float = 0.1,
) -> np.ndarray:
    """Crop a frame to a padded normalized MS-ASL bounding box.

    Args:
        frame: BGR frame with shape ``(height, width, 3)``.
        box: Normalized ``[y0, x0, y1, x1]`` coordinates.
        padding: Relative padding added on every side.

    Returns:
        The cropped frame, or the original frame for a degenerate box.
    """
    h, w = frame.shape[:2]
    y0, x0, y1, x1 = box

    # Expand the normalized box without leaving the image bounds.
    pad_h = (y1 - y0) * padding
    pad_w = (x1 - x0) * padding
    y0 = max(0.0, y0 - pad_h)
    x0 = max(0.0, x0 - pad_w)
    y1 = min(1.0, y1 + pad_h)
    x1 = min(1.0, x1 + pad_w)

    # Convert normalized bounds to pixel coordinates.
    py0, py1 = int(y0 * h), int(y1 * h)
    px0, px1 = int(x0 * w), int(x1 * w)

    # Very small boxes are less useful than the uncropped frame.
    if py1 - py0 < 20 or px1 - px0 < 20:
        return frame

    return frame[py0:py1, px0:px1]


def extract_frame_landmarks(
    results,
    frame_num: int,
) -> tuple[list[dict], bool]:
    """Extract the desktop contract's 107 landmarks from one frame.

    Returns:
        Narrow-format rows and whether at least one hand was detected.
    """
    rows = []
    hands_detected = False

    # Right hand (21 landmarks).
    if results.right_hand_landmarks:
        hands_detected = True
        for i, lm in enumerate(results.right_hand_landmarks.landmark):
            if i < NUM_RIGHT_HAND:
                rows.append(
                    {
                        "frame": frame_num,
                        "type": "right_hand",
                        "landmark_index": i,
                        "x": float(lm.x),
                        "y": float(lm.y),
                        "z": float(lm.z),
                    }
                )

    # Left hand (21 landmarks).
    if results.left_hand_landmarks:
        hands_detected = True
        for i, lm in enumerate(results.left_hand_landmarks.landmark):
            if i < NUM_LEFT_HAND:
                rows.append(
                    {
                        "frame": frame_num,
                        "type": "left_hand",
                        "landmark_index": i,
                        "x": float(lm.x),
                        "y": float(lm.y),
                        "z": float(lm.z),
                    }
                )

    # Selected face landmarks, preserving original MediaPipe indices.
    if results.face_landmarks:
        lms = results.face_landmarks.landmark
        for fi in FACE_INDICES:
            if fi < len(lms):
                lm = lms[fi]
                rows.append(
                    {
                        "frame": frame_num,
                        "type": "face",
                        "landmark_index": fi,
                        "x": float(lm.x),
                        "y": float(lm.y),
                        "z": float(lm.z),
                    }
                )

    # Pose landmarks 0-24.
    if results.pose_landmarks:
        lms = results.pose_landmarks.landmark
        for pi in POSE_INDICES:
            if pi < len(lms):
                lm = lms[pi]
                rows.append(
                    {
                        "frame": frame_num,
                        "type": "pose",
                        "landmark_index": pi,
                        "x": float(lm.x),
                        "y": float(lm.y),
                        "z": float(lm.z),
                    }
                )

    return rows, hands_detected


def check_outlier_frames(all_rows: list[dict]) -> set[int]:
    """Identify frames whose mean landmark position exceeds the z-score limit."""
    if not all_rows:
        return set()

    # Reduce every frame to a mean x/y position for a coarse jump check.
    frame_stats: dict[int, list[float]] = {}
    for row in all_rows:
        fnum = row["frame"]
        frame_stats.setdefault(fnum, []).extend([row["x"], row["y"]])

    frame_means = {}
    for fnum, vals in frame_stats.items():
        frame_means[fnum] = np.mean(vals)

    if len(frame_means) < 5:
        return set()

    values = np.array(list(frame_means.values()))
    mean = np.mean(values)
    std = np.std(values)

    if std < 1e-6:
        return set()

    outliers = set()
    for fnum, val in frame_means.items():
        z = abs(val - mean) / std
        if z > OUTLIER_Z_THRESHOLD:
            outliers.add(fnum)

    return outliers


def process_video(
    video_path: Path,
    box: Optional[list[float]],
    use_crop: bool = True,
    logger: Optional[logging.Logger] = None,
) -> tuple[Optional[pd.DataFrame], dict]:
    """Extract and quality-filter landmark rows from one video.

    Returns:
        A narrow-format DataFrame (or ``None`` after rejection) and metadata.
    """
    meta = {
        "total_frames": 0,
        "hand_frames": 0,
        "face_frames": 0,
        "pose_frames": 0,
        "valid_frames": 0,
        "outlier_frames": 0,
        "reject_reason": None,
    }

    # Validate that OpenCV can read the source before initializing MediaPipe.
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        meta["reject_reason"] = "cannot_open_video"
        return None, meta

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total < 3:
        cap.release()
        meta["reject_reason"] = "too_few_frames"
        return None, meta

    # One Holistic instance tracks all frames in this clip.
    holistic = mp.solutions.holistic.Holistic(
        static_image_mode=False,
        model_complexity=MP_MODEL_COMPLEXITY,
        min_detection_confidence=MP_MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence=MP_MIN_TRACKING_CONFIDENCE,
    )

    all_rows = []
    hand_frame_count = 0
    face_frame_count = 0
    pose_frame_count = 0
    frame_num = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Crop to the annotated signer region when requested.
            if use_crop and box is not None:
                frame = crop_to_bbox(frame, box)

            # MediaPipe expects RGB input.
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = holistic.process(rgb)

            rows, hands = extract_frame_landmarks(results, frame_num)

            if hands:
                hand_frame_count += 1
            if results.face_landmarks:
                face_frame_count += 1
            if results.pose_landmarks:
                pose_frame_count += 1

            all_rows.extend(rows)
            frame_num += 1

    finally:
        holistic.close()
        cap.release()

    meta["total_frames"] = frame_num
    meta["hand_frames"] = hand_frame_count
    meta["face_frames"] = face_frame_count
    meta["pose_frames"] = pose_frame_count

    # Reject clips outside the supported duration bounds.
    if frame_num < MIN_FRAMES:
        meta["reject_reason"] = f"too_short ({frame_num} < {MIN_FRAMES})"
        return None, meta

    if frame_num > MAX_FRAMES:
        meta["reject_reason"] = f"too_long ({frame_num} > {MAX_FRAMES})"
        return None, meta

    # Require reliable hand visibility across the clip.
    hand_ratio = hand_frame_count / frame_num if frame_num > 0 else 0
    if hand_ratio < MIN_HAND_FRAME_RATIO:
        meta["reject_reason"] = f"low_hand_ratio ({hand_ratio:.2f} < {MIN_HAND_FRAME_RATIO})"
        return None, meta

    if hand_frame_count < MIN_HAND_FRAMES_ABS:
        meta["reject_reason"] = f"too_few_hand_frames ({hand_frame_count} < {MIN_HAND_FRAMES_ABS})"
        return None, meta

    # Reject clips without any extracted modality.
    if not all_rows:
        meta["reject_reason"] = "no_landmarks"
        return None, meta

    # Remove abrupt coordinate jumps and compact the frame indices.
    outlier_frames = check_outlier_frames(all_rows)
    meta["outlier_frames"] = len(outlier_frames)

    if outlier_frames:
        all_rows = [r for r in all_rows if r["frame"] not in outlier_frames]
        remaining_frames = sorted(set(r["frame"] for r in all_rows))
        frame_remap = {old: new for new, old in enumerate(remaining_frames)}
        for row in all_rows:
            row["frame"] = frame_remap[row["frame"]]

    valid_frames = len(set(r["frame"] for r in all_rows))
    meta["valid_frames"] = valid_frames

    if valid_frames < MIN_FRAMES:
        meta["reject_reason"] = f"too_few_valid ({valid_frames} < {MIN_FRAMES})"
        return None, meta

    # Freeze dtypes before writing Parquet.
    df = pd.DataFrame(all_rows)
    df["frame"] = df["frame"].astype(np.int32)
    df["landmark_index"] = df["landmark_index"].astype(np.int32)
    df["x"] = df["x"].astype(np.float32)
    df["y"] = df["y"].astype(np.float32)
    df["z"] = df["z"].astype(np.float32)

    return df, meta


def find_video_files(video_dir: Path) -> dict[str, Path]:
    """Index downloaded MP4 clips by entry identifier.

    Expected layout: ``{class_id}_{word}/{split}_{idx}.mp4``.
    """
    videos = {}
    if not video_dir.exists():
        return videos

    for class_dir in video_dir.iterdir():
        if not class_dir.is_dir():
            continue
        for mp4 in class_dir.glob("*.mp4"):
            entry_id = mp4.stem
            videos[entry_id] = mp4

    return videos


def load_download_state(msasl_dir: Path) -> dict:
    """Load metadata recorded by the companion download script."""
    state_file = msasl_dir / "download_state.json"
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {}


def load_msasl_entries_for_extraction(msasl_dir: Path) -> dict[str, dict]:
    """Load extraction metadata for target entries from MS-ASL JSON files.

    Returns:
        A mapping from entry identifier to source metadata.
    """
    with open(msasl_dir / "MSASL_classes.json") as f:
        class_names = json.load(f)

    target_ids = set(WORD_TO_MSASL_CLASS.values())
    entries = {}

    for split_name in ("train", "val", "test"):
        with open(msasl_dir / f"MSASL_{split_name}.json") as f:
            split_data = json.load(f)

        for idx, item in enumerate(split_data):
            label = item["label"]
            if label not in target_ids:
                continue

            entry_id = f"{split_name}_{idx}"
            entries[entry_id] = {
                "entry_id": entry_id,
                "class_id": label,
                "ms_class": class_names[label],
                "signer_id": item.get("signer_id", -1),
                "box": item.get("box"),
                "split": split_name,
                "words": CLASS_TO_WORDS[label],
            }

    return entries


def validate_outputs(output_dir: Path, logger: logging.Logger) -> dict:
    """Check the parquet files already written, and nothing else.

    This reads only `output_dir`. Auditing existing outputs must not require
    the raw MS-ASL metadata or the downloaded clips: someone who has the
    extracted landmarks but not the source corpus is exactly who runs this.

    Returns:
        Counts of the files read and the ones that did not hold a usable clip.
    """
    logger.info("\n[VALIDATE] Mevcut parquet dosyalarını kontrol ediyorum...")
    parquet_count = 0
    bad_count = 0
    for pq in sorted(output_dir.rglob("*.parquet")):
        try:
            df = pd.read_parquet(pq)
            frames = df["frame"].nunique()
            types = set(df["type"].unique())
            if frames < 5 or "right_hand" not in types and "left_hand" not in types:
                logger.warning(f"  UYARI: {pq.name}: {frames} frame, types={types}")
                bad_count += 1
            parquet_count += 1
        except Exception as e:
            logger.error(f"  HATA: {pq.name}: {e}")
            bad_count += 1
    logger.info(f"Toplam parquet: {parquet_count}, sorunlu: {bad_count}")
    return {"validated": parquet_count, "invalid": bad_count}


def extract_all(
    video_dir: Path,
    output_dir: Path,
    msasl_dir: Path,
    state_file: Path,
    logger: logging.Logger,
    use_crop: bool = True,
) -> dict:
    """Process every downloaded video and persist accepted landmarks."""
    output_dir.mkdir(parents=True, exist_ok=True)
    state = load_state(state_file)

    # Index local clips and their source metadata independently.
    video_files = find_video_files(video_dir)
    logger.info(f"Bulunan video dosyası: {len(video_files)}")

    entry_metadata = load_msasl_entries_for_extraction(msasl_dir)
    logger.info(f"Hedef entry metadata: {len(entry_metadata)}")

    # Track run-level and per-class outcomes.
    stats = {
        "processed": 0,
        "success": 0,
        "rejected": 0,
        "skipped": 0,
        "no_metadata": 0,
        "total": len(video_files),
        "validated": 0,
        "invalid": 0,
    }
    reject_reasons: dict[str, int] = {}
    word_success: dict[int, int] = {}
    word_total: dict[int, int] = {}

    # Process clips in deterministic entry-id order.
    total = len(video_files)
    for i, (entry_id, video_path) in enumerate(sorted(video_files.items())):
        # Resume from the state file without rewriting completed entries.
        if entry_id in state["completed"]:
            stats["skipped"] += 1
            continue

        # Every local clip must map back to source metadata.
        meta_info = entry_metadata.get(entry_id)
        if meta_info is None:
            stats["no_metadata"] += 1
            logger.debug(f"  {entry_id}: Metadata bulunamadı, atlanıyor")
            continue

        cid = meta_info["class_id"]
        box = meta_info["box"]

        word_total[cid] = word_total.get(cid, 0) + 1

        # Isolate per-video failures so the batch can continue.
        try:
            df, meta = process_video(video_path, box, use_crop=use_crop, logger=logger)
        except Exception as e:
            logger.error(f"  HATA: {entry_id}: exception: {e}")
            state["failed"][entry_id] = {"reason": str(e)[:200]}
            stats["rejected"] += 1
            reject_reasons["exception"] = reject_reasons.get("exception", 0) + 1
            continue

        stats["processed"] += 1

        if df is None:
            # Record the quality-gate rejection for later reporting.
            reason = meta.get("reject_reason", "unknown")
            stats["rejected"] += 1
            state["failed"][entry_id] = {"reason": reason, **meta}
            reason_key = reason.split(" ")[0] if " " in reason else reason
            reject_reasons[reason_key] = reject_reasons.get(reason_key, 0) + 1
            logger.debug(f"  {entry_id} reddedildi: {reason}")
            continue

        # Persist one narrow-format Parquet file per accepted clip.
        safe_name = meta_info["ms_class"].replace(" ", "_").replace("/", "_")
        parquet_dir = output_dir / f"{cid}_{safe_name}"
        parquet_dir.mkdir(parents=True, exist_ok=True)
        parquet_path = parquet_dir / f"{entry_id}.parquet"
        df.to_parquet(parquet_path, index=False, engine="pyarrow")

        stats["success"] += 1
        word_success[cid] = word_success.get(cid, 0) + 1

        state["completed"][entry_id] = {
            "status": "success",
            "path": str(parquet_path.relative_to(output_dir)),
            "class_id": cid,
            "signer_id": meta_info["signer_id"],
            "frames": meta["valid_frames"],
            "hand_frames": meta["hand_frames"],
        }

        # Save progress periodically for crash-safe resume.
        done = stats["processed"]
        if done % 20 == 0 or done == total:
            save_state(state, state_file)
            pct = (i + 1) / total * 100 if total > 0 else 0
            logger.info(
                f"[{i + 1}/{total}] {pct:.0f}%: "
                f"success={stats['success']} rejected={stats['rejected']} "
                f"skipped={stats['skipped']}"
            )

        # Release accumulated native and DataFrame objects in long runs.
        if done % 100 == 0:
            gc.collect()

    # Save final state even when the last batch is incomplete.
    save_state(state, state_file)
    return stats


def generate_csv(
    output_dir: Path,
    state_file: Path,
    logger: logging.Logger,
) -> Path:
    """Create the index CSV expected by the historical notebook loader.

    Schema:
        path,sign,participant_id
        0_hello/train_0.parquet,hello,1000114
    """
    state = load_state(state_file)

    rows = []
    for entry_id, info in state.get("completed", {}).items():
        if info.get("status") != "success":
            continue

        rel_path = info.get("path", "")
        cid = info.get("class_id")
        signer_id = info.get("signer_id", -1)
        participant_id = signer_id + SIGNER_ID_OFFSET

        # A source class may intentionally map to more than one target word.
        words = CLASS_TO_WORDS.get(cid, [])

        for word in words:
            rows.append(
                {
                    "path": rel_path,
                    "sign": word,
                    "participant_id": participant_id,
                }
            )

    df = pd.DataFrame(rows)
    csv_path = output_dir / "train.csv"
    df.to_csv(csv_path, index=False)

    # Report the resulting vocabulary and signer coverage.
    unique_words = df["sign"].nunique() if len(df) > 0 else 0
    unique_signers = df["participant_id"].nunique() if len(df) > 0 else 0
    logger.info(f"\nCSV oluşturuldu: {csv_path}")
    logger.info(f"   Satır: {len(df)}")
    logger.info(f"   Benzersiz kelime: {unique_words}")
    logger.info(f"   Benzersiz signer: {unique_signers}")
    logger.info("   (eat/food çift satır dahil)")

    return csv_path


def generate_metadata(
    output_dir: Path,
    state_file: Path,
    logger: logging.Logger,
) -> None:
    """Write per-word extraction coverage and rejection metadata."""
    state = load_state(state_file)

    word_stats: dict[str, dict] = {}

    for entry_id, info in state.get("completed", {}).items():
        if info.get("status") != "success":
            continue
        cid = info.get("class_id")
        words = CLASS_TO_WORDS.get(cid, [])
        frames = info.get("frames", 0)

        for word in words:
            if word not in word_stats:
                word_stats[word] = {
                    "class_id": cid,
                    "count": 0,
                    "total_frames": 0,
                    "signers": set(),
                }
            word_stats[word]["count"] += 1
            word_stats[word]["total_frames"] += frames
            word_stats[word]["signers"].add(info.get("signer_id", -1))

    # Aggregate failure reasons independently of accepted word counts.
    failed_stats: dict[str, int] = {}
    for entry_id, info in state.get("failed", {}).items():
        reason = info.get("reason", "unknown")
        reason_key = reason.split(" ")[0] if " " in reason else reason
        failed_stats[reason_key] = failed_stats.get(reason_key, 0) + 1

    # Convert sets and derived counts into a JSON-compatible report.
    metadata = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_success": sum(ws["count"] for ws in word_stats.values()),
        "total_failed": sum(failed_stats.values()),
        "rejection_reasons": failed_stats,
        "per_word": {},
    }

    for word in sorted(word_stats.keys()):
        ws = word_stats[word]
        metadata["per_word"][word] = {
            "class_id": ws["class_id"],
            "parquet_count": ws["count"],
            "total_frames": ws["total_frames"],
            "avg_frames": ws["total_frames"] / ws["count"] if ws["count"] > 0 else 0,
            "unique_signers": len(ws["signers"]),
        }

    meta_path = output_dir / "extraction_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    logger.info(f"Metadata: {meta_path}")

    # Print a compact human-readable coverage table.
    logger.info("\n" + "=" * 65)
    logger.info("KELIME BAZINDA EXTRACTION ÖZETİ")
    logger.info("=" * 65)
    logger.info(f"{'Kelime':<15} {'Parquet':>8} {'Ort.Frame':>10} {'Signer':>8}")
    logger.info("-" * 65)

    for word in sorted(word_stats.keys()):
        ws = word_stats[word]
        avg_f = ws["total_frames"] / ws["count"] if ws["count"] > 0 else 0
        flag = " LOW" if ws["count"] < 5 else ""
        logger.info(
            f"  {word:<15} {ws['count']:>5}     {avg_f:>7.1f}   {len(ws['signers']):>5}{flag}"
        )

    total_parquets = sum(ws["count"] for ws in word_stats.values())
    total_signers = set()
    for ws in word_stats.values():
        total_signers |= ws["signers"]
    logger.info("-" * 65)
    logger.info(f"  {'TOPLAM':<15} {total_parquets:>5}                  {len(total_signers):>5}")

    if failed_stats:
        logger.info("\nReddedilme sebepleri:")
        for reason, count in sorted(failed_stats.items(), key=lambda x: -x[1]):
            logger.info(f"  {reason}: {count}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MS-ASL videolarından MediaPipe landmark çıkar",
    )
    parser.add_argument(
        "--video-dir",
        type=Path,
        default=DEFAULT_VIDEO_DIR,
        help=f"Video giriş dizini (varsayılan: {DEFAULT_VIDEO_DIR})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Landmark çıktı dizini (varsayılan: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--no-crop",
        action="store_true",
        help="Bounding box cropping'i devre dışı bırak",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Mevcut parquet dosyalarını doğrula (extraction yapma)",
    )
    parser.add_argument(
        "--min-hand-ratio",
        type=float,
        default=MIN_HAND_FRAME_RATIO,
        help=f"Minimum el tespit oranı (varsayılan: {MIN_HAND_FRAME_RATIO})",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=DEFAULT_STATE_FILE,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Apply the CLI override to the module-level quality gate.
    global MIN_HAND_FRAME_RATIO
    MIN_HAND_FRAME_RATIO = args.min_hand_ratio

    logger = setup_logging(args.output_dir)

    # Auditing existing outputs comes first: it needs neither the downloaded
    # clips nor the MS-ASL metadata, so it works for someone who has only the
    # extracted landmarks.
    if args.validate_only:
        stats = validate_outputs(args.output_dir, logger)
        return 1 if stats["invalid"] else 0

    logger.info("=" * 60)
    logger.info("MS-ASL Landmark Extraction Başlıyor")
    logger.info("=" * 60)
    logger.info(f"  Video dizini: {args.video_dir}")
    logger.info(f"  Çıktı dizini: {args.output_dir}")
    logger.info(f"  Crop: {'KAPALI' if args.no_crop else 'AÇIK'}")
    logger.info(f"  Min el oranı: {MIN_HAND_FRAME_RATIO:.0%}")
    logger.info(f"  Landmark yapısı: {NUM_LANDMARKS} landmark × 3 = {NUM_FEATURES}D")
    logger.info(
        f"  Kalite filtreleri: frame[{MIN_FRAMES}-{MAX_FRAMES}], "
        f"el≥{MIN_HAND_FRAME_RATIO:.0%}, outlier Z>{OUTLIER_Z_THRESHOLD}"
    )

    start_time = time.time()

    stats = extract_all(
        video_dir=args.video_dir,
        output_dir=args.output_dir,
        msasl_dir=MSASL_DIR,
        state_file=args.state_file,
        logger=logger,
        use_crop=not args.no_crop,
    )

    elapsed = time.time() - start_time
    logger.info(f"\nExtraction tamamlandı: {elapsed:.0f}s ({elapsed / 60:.1f} dk)")
    logger.info(
        f"  İşlenen: {stats['processed']}, Başarılı: {stats['success']}, "
        f"Reddedilen: {stats['rejected']}, Atlanan: {stats['skipped']}"
    )

    # Build the notebook-compatible index.
    generate_csv(args.output_dir, args.state_file, logger)

    # Persist a reusable coverage report.
    generate_metadata(args.output_dir, args.state_file, logger)
    return 0


if __name__ == "__main__":
    sys.exit(main())
