#!/usr/bin/env python3
"""Download a small Kaggle ASL Signs subset for browser model-test fixtures.

This avoids downloading the full competition archive. It first downloads
`train.csv`, then selects rows from the same signer-independent test split used
by the word notebook, and finally downloads only the chosen parquet files.

Prerequisites:
  - Kaggle API installed and authenticated (`~/.kaggle/kaggle.json`)
  - Competition rules accepted in the browser

Example:
  python3 scripts/evaluation/download_kaggle_sample_subset.py \
    --output data/raw/asl-signs-sample-subset \
    --samples-per-word 1

Then export JSON fixtures:
  python3 scripts/evaluation/export_model_test_word_samples.py \
    --kaggle-dir data/raw/asl-signs-sample-subset \
    --samples-per-word 1
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
COMPETITION = "asl-signs"
SEED = 42
WORD_LABELS_PATH = PROJECT_ROOT / "asl-web" / "data" / "word_labels.json"


def _run(cmd: list[str], dry_run: bool) -> None:
    print("+ " + " ".join(cmd))
    if dry_run:
        return
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Command failed with exit {result.returncode}: {' '.join(cmd)}")


def _extract_zips(output_dir: Path, dry_run: bool) -> None:
    if dry_run:
        return
    for zip_path in output_dir.rglob("*.zip"):
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(output_dir)


def _download_file(filename: str, output_dir: Path, dry_run: bool) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "kaggle",
            "competitions",
            "download",
            "-c",
            COMPETITION,
            "-f",
            filename,
            "-p",
            str(output_dir),
        ],
        dry_run=dry_run,
    )
    _extract_zips(output_dir, dry_run=dry_run)


def _load_selected_words() -> set[str]:
    labels = json.loads(WORD_LABELS_PATH.read_text(encoding="utf-8"))
    return set(labels)


def _read_train_rows(train_csv: Path) -> list[dict[str, str]]:
    with train_csv.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required = {"path", "sign", "participant_id"}
    if not rows or not required.issubset(rows[0]):
        raise SystemExit(f"train.csv must contain columns: {sorted(required)}")
    return rows


def _choose_rows(
    rows: list[dict[str, str]], samples_per_word: int, max_words: int | None
) -> list[dict[str, str]]:
    selected_words = _load_selected_words()
    filtered = [row for row in rows if row["sign"] in selected_words]

    participant_order: list[str] = []
    seen = set()
    for row in filtered:
        pid = row["participant_id"]
        if pid not in seen:
            seen.add(pid)
            participant_order.append(pid)

    signers = np.array(participant_order, dtype=object)
    np.random.default_rng(SEED).shuffle(signers)
    n_train = int(len(signers) * 0.70)
    n_val = int(len(signers) * 0.15)
    test_signers = set(signers[n_train + n_val :])

    chosen: list[dict[str, str]] = []
    per_word: dict[str, int] = {}
    for row in filtered:
        word = row["sign"]
        if row["participant_id"] not in test_signers:
            continue
        if max_words is not None and len(per_word) >= max_words and word not in per_word:
            continue
        if per_word.get(word, 0) >= samples_per_word:
            continue
        chosen.append(row)
        per_word[word] = per_word.get(word, 0) + 1
        if len(per_word) == len(selected_words) and all(
            v >= samples_per_word for v in per_word.values()
        ):
            break

    return chosen


def _write_selection(rows: list[dict[str, str]], output_dir: Path, dry_run: bool) -> None:
    if dry_run:
        return
    selection_path = output_dir / "sample_selection.csv"
    with selection_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=list(rows[0].keys()) if rows else ["path", "sign", "participant_id"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote selection: {selection_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download a small Kaggle ASL Signs subset")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples-per-word", type=int, default=1)
    parser.add_argument("--max-words", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not shutil.which("kaggle"):
        raise SystemExit("kaggle CLI not found. Install with: python3 -m pip install kaggle")
    if args.samples_per_word < 1:
        raise SystemExit("--samples-per-word must be >= 1")

    output_dir = args.output
    train_csv = output_dir / "train.csv"
    if not train_csv.exists():
        _download_file("train.csv", output_dir, dry_run=args.dry_run)

    if args.dry_run and not train_csv.exists():
        print("Dry-run stopped before row selection because train.csv is not present yet.")
        return 0

    rows = _read_train_rows(train_csv)
    chosen = _choose_rows(rows, args.samples_per_word, args.max_words)
    if not chosen:
        raise SystemExit("No rows selected. Check train.csv and deployed word labels.")

    _write_selection(chosen, output_dir, dry_run=args.dry_run)
    print(
        f"Selected {len(chosen)} parquet file(s), {len({r['sign'] for r in chosen})} word class(es)."
    )

    for row in chosen:
        rel_path = row["path"]
        if (output_dir / rel_path).exists():
            continue
        _download_file(rel_path, output_dir, dry_run=args.dry_run)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
