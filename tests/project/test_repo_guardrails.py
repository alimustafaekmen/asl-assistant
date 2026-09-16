"""Repository guardrails that catch drift before a demo or commit."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]

TEXT_SKIP_SUFFIXES = {
    ".avif",
    ".bin",
    ".bmp",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp4",
    ".onnx",
    ".parquet",
    ".pdf",
    ".pkl",
    ".png",
    ".pyc",
    ".task",
    ".webm",
    ".wasm",
    ".zip",
}

RUNTIME_ARTIFACTS = [
    "asl-web/models/letter_model.onnx",
    "asl-web/models/word_model.onnx",
    "asl-web/assets/signs/letters.png",
    "asl-web/assets/signs/kelime.png",
    "asl-web/assets/signs/word-1.png",
    "asl-web/assets/signs/word-2.png",
    "asl-web/assets/signs/word-3.png",
    "asl-web/assets/signs/word-4.png",
    "asl-web/assets/signs/word-5.png",
]


def _git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.skip("Git metadata is not available")
    return [line for line in result.stdout.splitlines() if line]


def test_makefile_exposes_core_workflow_targets() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    targets = set(re.findall(r"^([A-Za-z0-9_.-]+):(?:\s|$)", text, flags=re.MULTILINE))

    expected = {
        "doctor",
        "setup",
        "web",
        "test",
        "test-full",
        "validate",
        "validate-full",
    }
    assert expected <= targets


def test_make_validate_runs_js_and_runtime_asset_checks() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")

    assert "node --check $(WEB_DIR)/js/core/app.js" in text
    assert "node --check $(WEB_DIR)/js/media/camera.js" in text
    assert "$(PYTHON) $(CHECK_RUNTIME)" in text


def test_web_classic_script_order_matches_runtime_contract() -> None:
    html = (PROJECT_ROOT / "asl-web" / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script\b[^>]*\bsrc=[\"']([^\"']+)", html, flags=re.IGNORECASE)
    local_scripts = [src.split("?", 1)[0].lstrip("./") for src in scripts]

    expected_order = [
        "js/ml/landmarks.js",
        "js/ml/features.js",
        "js/services/benchmark.js",
        "js/ml/gating.js",
        "js/ml/letter-model.js",
        "js/ml/word-model.js",
        "js/media/camera.js",
        "js/core/app.js",
    ]
    runtime_scripts = [src for src in local_scripts if src in expected_order]

    assert runtime_scripts == expected_order


def test_no_git_conflict_markers_in_tracked_text_files() -> None:
    offenders: list[str] = []
    marker_re = re.compile(r"^(<<<<<<<|>>>>>>>)\s+\S+")

    for rel_path in _git_ls_files():
        path = PROJECT_ROOT / rel_path
        if path.suffix.lower() in TEXT_SKIP_SUFFIXES or not path.is_file():
            continue

        head = path.read_bytes()[:4096]
        if b"\0" in head:
            continue

        text = path.read_text(encoding="utf-8", errors="replace")
        if any(marker_re.match(line) for line in text.splitlines()):
            offenders.append(rel_path)

    assert offenders == []


def test_no_python_cache_files_are_tracked() -> None:
    tracked_cache = [
        rel_path
        for rel_path in _git_ls_files()
        if "__pycache__/" in rel_path
        or rel_path.endswith(".pyc")
        or rel_path.startswith(".pytest_cache/")
        or "/.pytest_cache/" in rel_path
    ]

    assert tracked_cache == []


def test_runtime_artifacts_are_real_files_not_lfs_pointers() -> None:
    pointer_prefix = b"version https://git-lfs.github.com/spec/v1"

    for rel_path in RUNTIME_ARTIFACTS:
        path = PROJECT_ROOT / rel_path
        assert path.exists(), f"{rel_path} is missing"
        assert path.stat().st_size > 1024, f"{rel_path} is unexpectedly small"
        assert not path.read_bytes()[:128].startswith(pointer_prefix), f"{rel_path} is a Git LFS pointer"
