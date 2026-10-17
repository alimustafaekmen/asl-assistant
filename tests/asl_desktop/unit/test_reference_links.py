"""The coach video links fall back to the tracked web copy in a fresh clone."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from asl_desktop.config import WEB_DATA_DIR
from asl_desktop.services.reference_links import load_video_links


def _write(path, words, alphabet):
    path.write_text(json.dumps({"words": words, "alphabet_video": alphabet}), encoding="utf-8")


def test_first_existing_file_wins(tmp_path):
    local = tmp_path / "local.json"
    tracked = tmp_path / "tracked.json"
    _write(local, {"hello": "https://local/hello"}, "https://local/abc")
    _write(tracked, {"hello": "https://tracked/hello"}, "https://tracked/abc")

    words, alphabet = load_video_links([local, tracked])

    assert words == {"hello": "https://local/hello"}
    assert alphabet == "https://local/abc"


def test_missing_local_file_falls_back_to_the_next(tmp_path):
    tracked = tmp_path / "tracked.json"
    _write(tracked, {"bye": "https://tracked/bye"}, "https://tracked/abc")

    words, alphabet = load_video_links([tmp_path / "absent.json", tracked])

    assert words == {"bye": "https://tracked/bye"}
    assert alphabet == "https://tracked/abc"


def test_unreadable_file_is_logged_and_skipped(tmp_path, caplog):
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    tracked = tmp_path / "tracked.json"
    _write(tracked, {"bye": "https://tracked/bye"}, "https://tracked/abc")

    with caplog.at_level(logging.WARNING):
        words, _ = load_video_links([broken, tracked])

    assert words == {"bye": "https://tracked/bye"}
    assert any(record.levelno == logging.WARNING for record in caplog.records)


def test_no_file_gives_empty_links(tmp_path):
    assert load_video_links([tmp_path / "absent.json"]) == ({}, "")


def test_the_tracked_web_file_has_the_shape_the_coach_reads():
    words, alphabet = load_video_links([Path(WEB_DATA_DIR) / "asl_video_links.json"])

    assert words
    assert all(url.startswith("https://") for url in words.values())
    assert alphabet.startswith("https://")
