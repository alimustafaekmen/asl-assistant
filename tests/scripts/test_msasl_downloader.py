"""The MS-ASL downloader against a stand-in for yt-dlp.

`download_clip` is the real function; only the executable it starts is fake.
It prints a chosen message to stderr and fails, which is how yt-dlp reports
every kind of problem. What matters is how each message is classified: a
permanent verdict is saved and skipped on resume, a transient one is retried.
"""

from __future__ import annotations

import logging
import os
import stat

import pytest

from scripts.data_preparation import download_msasl_videos as downloader

ENTRY = {
    "class_id": 1,
    "ms_class": "hello",
    "entry_id": "clip1",
    "url": "https://example.invalid/watch?v=x",
    "start_time": 0.0,
    "end_time": 1.0,
}


@pytest.fixture
def fake_ytdlp(tmp_path, monkeypatch):
    """Put a yt-dlp on PATH that fails with a given message and counts its runs."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls.txt"
    message = tmp_path / "message.txt"
    script = bin_dir / "yt-dlp"
    script.write_text(f'#!/bin/sh\necho x >> "{calls}"\ncat "{message}" >&2\nexit 1\n')
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setattr(downloader.time, "sleep", lambda _seconds: None)

    def run(stderr: str, max_retries: int = 2) -> tuple[dict, int]:
        message.write_text(stderr)
        out = tmp_path / "out"
        result = downloader.download_clip(ENTRY, out, logging.getLogger("test"), max_retries)
        return result, len(calls.read_text().splitlines()) if calls.exists() else 0

    return run


@pytest.mark.parametrize(
    "stderr",
    [
        "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.",
        "ERROR: [youtube] abc: This video is age-restricted",
        "ERROR: Age restricted content",
    ],
)
def test_real_age_restrictions_are_a_permanent_skip(fake_ytdlp, stderr) -> None:
    result, runs = fake_ytdlp(stderr)

    assert result["status"] == "age_restricted"
    assert "age_restricted" in downloader.PERMANENT_SKIP_REASONS
    assert runs == 1, "a permanent verdict needs no retry"


@pytest.mark.parametrize(
    "stderr",
    [
        "ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests",
        "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser",
        "yt-dlp: error: no such option: --bogus\nusage: yt-dlp [OPTIONS] URL [URL...]",
        "ERROR: unexpected message from the server",
    ],
)
def test_transient_failures_are_retried_not_recorded_as_age_restricted(fake_ytdlp, stderr) -> None:
    result, runs = fake_ytdlp(stderr, max_retries=2)

    assert result["status"] == "error"
    assert result["reason"] == "exit_code_1"
    assert runs == 3, "a transient failure gets every retry"


def test_unavailable_videos_are_still_a_permanent_skip(fake_ytdlp) -> None:
    result, runs = fake_ytdlp("ERROR: [youtube] abc: Video unavailable")

    assert result["status"] == "unavailable"
    assert runs == 1


def test_download_command_does_not_disable_certificate_checks(tmp_path) -> None:
    command = downloader.build_download_command(ENTRY, tmp_path / "clip.mp4")

    assert "--no-check-certificates" not in command
