"""Fast contracts for data-preparation command and reporting helpers."""

from __future__ import annotations

import logging
from argparse import Namespace
from pathlib import Path

from scripts.data_preparation import extract_msasl_landmarks
from scripts.data_preparation.download_msasl_videos import (
    build_download_command,
    print_summary,
)


def test_download_command_has_one_format_option() -> None:
    entry = {
        "url": "https://example.test/video",
        "start_time": 1.25,
        "end_time": 2.5,
    }

    command = build_download_command(entry, Path("clip.mp4"))

    assert command.count("-f") == 1
    assert command[command.index("--download-sections") + 1] == "*1.25-2.5"
    assert command[command.index("-o") + 1] == "clip.mp4"
    assert command[-1] == entry["url"]


def test_download_summary_counts_each_entry_once(caplog) -> None:
    entries = [
        {"class_id": 0, "entry_id": "train_1", "signer_id": 10},
        {"class_id": 0, "entry_id": "train_2", "signer_id": 11},
    ]
    state = {
        "completed": {
            "train_1": {"status": "success", "signer_id": 10},
        }
    }
    logger = logging.getLogger("test_download_summary")

    with caplog.at_level(logging.INFO, logger=logger.name):
        print_summary(entries, state, logger)

    assert "1 / 2" in caplog.text
    assert "1 / 4" not in caplog.text


def _validate_only_args(tmp_path, output_dir):
    return Namespace(
        video_dir=tmp_path / "videos",
        output_dir=output_dir,
        no_crop=False,
        validate_only=True,
        min_hand_ratio=0.5,
        state_file=tmp_path / "state.json",
    )


def test_landmark_validate_only_fails_when_an_output_is_invalid(monkeypatch, tmp_path) -> None:
    output_dir = tmp_path / "landmarks"
    output_dir.mkdir()
    (output_dir / "broken.parquet").touch()

    monkeypatch.setattr(
        extract_msasl_landmarks, "parse_args", lambda: _validate_only_args(tmp_path, output_dir)
    )
    monkeypatch.setattr(extract_msasl_landmarks, "setup_logging", lambda _path: logging.getLogger())
    monkeypatch.setattr(
        extract_msasl_landmarks.pd,
        "read_parquet",
        lambda _path: (_ for _ in ()).throw(ValueError("invalid parquet")),
    )

    assert extract_msasl_landmarks.main() == 1


def test_landmark_validate_only_needs_no_corpus(monkeypatch, tmp_path) -> None:
    """Auditing existing outputs must not require the raw MS-ASL corpus.

    Someone who has the extracted landmarks but not the source videos and
    metadata is exactly who runs this. Nothing is stubbed here beyond the
    argument parser and the logger: the clip scan and the metadata loader are
    left in place, and both would raise if the audit still reached them.
    """
    output_dir = tmp_path / "landmarks"
    output_dir.mkdir()

    monkeypatch.setattr(
        extract_msasl_landmarks, "parse_args", lambda: _validate_only_args(tmp_path, output_dir)
    )
    monkeypatch.setattr(extract_msasl_landmarks, "setup_logging", lambda _path: logging.getLogger())
    monkeypatch.setattr(extract_msasl_landmarks, "MSASL_DIR", tmp_path / "no-such-corpus")

    assert extract_msasl_landmarks.main() == 0
