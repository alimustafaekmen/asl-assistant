"""The word sample scripts must pick their samples from the notebook's test signers.

The word model was trained on the notebook's train signers. A sample from one
of them is a recording the model has already seen, so its result in Model Test
says nothing about unseen signers.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from scripts.evaluation import download_kaggle_sample_subset as downloader
from scripts.evaluation import export_model_test_word_samples as exporter

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WORDS = sorted(json.loads((PROJECT_ROOT / "asl-web/data/word_labels.json").read_text()))


@pytest.fixture
def train_csv(tmp_path) -> Path:
    """A train.csv with 21 signers, as the competition has, in a mixed order.

    Rows for words outside the 50 come first, so a split taken over all rows
    would order the signers differently from one taken over the 50 words.
    """
    rng = np.random.default_rng(7)
    participants = [int(pid) for pid in rng.choice(np.arange(1000, 70000), 21, replace=False)]
    rows = [
        {"path": f"other/{pid}.parquet", "participant_id": pid, "sign": "not-a-selected-word"}
        for pid in reversed(participants)
    ]
    for index in rng.permutation(len(participants) * 4):
        pid = participants[index % len(participants)]
        word = WORDS[index % len(WORDS)]
        rows.append({"path": f"{pid}/{index}.parquet", "participant_id": pid, "sign": word})
    path = tmp_path / "train.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "participant_id", "sign"])
        writer.writeheader()
        writer.writerows(rows)
    return path


def notebook_test_signers(train_df: pd.DataFrame) -> set[int]:
    """The split exactly as notebooks/word_50_training.ipynb runs it."""
    state = np.random.get_state()
    try:
        filtered_df = train_df[train_df["sign"].isin(WORDS)].copy()
        np.random.seed(42)
        signers = filtered_df["participant_id"].unique().copy()
        np.random.shuffle(signers)
    finally:
        np.random.set_state(state)
    n_train = int(len(signers) * 0.70)
    n_val = int(len(signers) * 0.15)
    return {int(pid) for pid in signers[n_train + n_val :]}


def test_downloaded_subset_comes_from_the_notebook_test_signers(train_csv) -> None:
    expected = notebook_test_signers(pd.read_csv(train_csv))

    rows = downloader._read_train_rows(train_csv)
    chosen = downloader._choose_rows(rows, samples_per_word=1000, max_words=None)

    assert {int(row["participant_id"]) for row in chosen} == expected


def test_exported_samples_come_from_the_notebook_test_signers(train_csv) -> None:
    train_df = pd.read_csv(train_csv)
    expected = notebook_test_signers(train_df)

    test_rows = exporter._split_test_rows(train_df, set(WORDS))

    assert set(test_rows["participant_id"].astype(int)) == expected
