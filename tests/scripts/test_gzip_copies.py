"""The runtime asset validator's check on compressed deploy copies.

The browser downloads the gzipped letter model and falls back to the raw file,
so both are published and nothing at runtime compares them. A model exported
again without regenerating its copy would ship two different models, one per
code path. Each fault is built here as a pair of small files.
"""

from __future__ import annotations

import gzip
from pathlib import Path

from scripts.validation.check_runtime_assets import find_gzip_drift
from scripts.validation.contracts import ALL_ARTIFACTS, gzip_pairs

RAW = b"onnx bytes" * 1000


def write_pair(tmp_path: Path, compressed: bytes | None, raw: bytes | None = RAW):
    """A raw file and its compressed copy, either of which may be absent."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    raw_path = tmp_path / "model.onnx"
    gz_path = tmp_path / "model.onnx.gz"
    if raw is not None:
        raw_path.write_bytes(raw)
    if compressed is not None:
        gz_path.write_bytes(compressed)
    return [("model.onnx.gz", gz_path, raw_path)]


def test_a_copy_of_exactly_the_raw_bytes_reports_nothing(tmp_path: Path) -> None:
    assert find_gzip_drift(write_pair(tmp_path, gzip.compress(RAW, mtime=0))) == []


def test_a_copy_of_other_bytes_is_reported(tmp_path: Path) -> None:
    """The raw model was exported again and its copy was not regenerated."""
    issues = find_gzip_drift(write_pair(tmp_path, gzip.compress(RAW + b"x", mtime=0)))

    assert len(issues) == 1 and "model.onnx.gz" in issues[0], issues


def test_a_copy_that_is_not_gzip_is_reported(tmp_path: Path) -> None:
    """A host or tool that decoded the file in place leaves raw bytes behind."""
    issues = find_gzip_drift(write_pair(tmp_path, RAW))

    assert len(issues) == 1 and "gzip" in issues[0], issues


def test_a_truncated_copy_is_reported(tmp_path: Path) -> None:
    compressed = gzip.compress(RAW, mtime=0)

    issues = find_gzip_drift(write_pair(tmp_path, compressed[: len(compressed) // 2]))

    assert len(issues) == 1, issues


def test_a_missing_copy_or_raw_file_is_reported(tmp_path: Path) -> None:
    assert len(find_gzip_drift(write_pair(tmp_path / "a", None))) == 1

    assert len(find_gzip_drift(write_pair(tmp_path / "b", gzip.compress(RAW), raw=None))) == 1


def test_every_compressed_copy_pairs_with_a_published_artifact() -> None:
    """The raw half is what the browser falls back to, so it must be deployed."""
    deployed = {artifact.deploy_path for artifact in ALL_ARTIFACTS}
    pairs = gzip_pairs()

    assert pairs, "no compressed copy is declared"
    for name, compressed, raw in pairs:
        assert compressed in deployed, name
        assert raw in deployed, name


def test_the_published_copies_match_their_raw_files() -> None:
    assert find_gzip_drift(gzip_pairs()) == []
