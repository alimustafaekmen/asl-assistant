"""Canonical paths and source-to-deploy pairs for the published artifacts.

Both validators used to carry their own copy of these directories and of the
nine provenance pairs. The copies were identical, which is the problem: moving
an artifact meant remembering to edit two files, and nothing would have
reported it if only one had been changed.

This module owns them. It holds paths and the relationship between a deploy
file and the source it came from, and nothing else: no dataset discovery, no UI
text, no fixture data.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

PROJECT_ROOT = Path(__file__).resolve().parents[2]

WEB_DIR = PROJECT_ROOT / "asl-web"
WEB_DATA_DIR = WEB_DIR / "data"
WEB_MODELS_DIR = WEB_DIR / "models"
WEB_JS_DIR = WEB_DIR / "js"
WEB_CSS_DIR = WEB_DIR / "css"
WEB_INDEX_HTML = WEB_DIR / "index.html"

NOTEBOOKS_RESULTS = PROJECT_ROOT / "notebooks" / "word_50_results"
LETTER_MODEL_DIR = PROJECT_ROOT / "models" / "letter"
WORD_MODEL_DIR = PROJECT_ROOT / "models" / "word" / "web-50"
RAW_DIR = PROJECT_ROOT / "data" / "raw"

ArtifactKind = Literal["model", "labels", "json", "image"]


@dataclass(frozen=True)
class ArtifactContract:
    """One published file and the source it is copied from.

    `min_size_kb` exists to catch a truncated copy or a Git LFS pointer that
    was committed instead of the file. It is a coarse floor for binaries and
    curated data, not a budget: source files are checked by their content
    instead, because a size floor there only forbids the file getting smaller.
    """

    name: str
    deploy_path: Path
    source_path: Path | None
    kind: ArtifactKind
    min_size_kb: float
    required: bool = True


# Source-to-deploy pairs documented in ``docs/models-and-data.md``.
ARTIFACTS: tuple[ArtifactContract, ...] = (
    ArtifactContract(
        "word_model.onnx",
        WEB_MODELS_DIR / "word_model.onnx",
        WORD_MODEL_DIR / "word_model.onnx",
        "model",
        1500,
    ),
    ArtifactContract(
        "letter_model.onnx",
        WEB_MODELS_DIR / "letter_model.onnx",
        LETTER_MODEL_DIR / "onnx_exports" / "letter_model_static_24_web_no_zipmap.onnx",
        "model",
        10000,
    ),
    ArtifactContract(
        "word_labels.json",
        WEB_DATA_DIR / "word_labels.json",
        WORD_MODEL_DIR / "word_labels.json",
        "labels",
        0.5,
    ),
    ArtifactContract(
        "letter_labels.json",
        WEB_DATA_DIR / "letter_labels.json",
        LETTER_MODEL_DIR / "letter_label_map.json",
        "labels",
        0.2,
    ),
    ArtifactContract(
        "temperature.json",
        WEB_DATA_DIR / "temperature.json",
        WORD_MODEL_DIR / "temperature.json",
        "json",
        0.1,
    ),
    ArtifactContract(
        "per_word_stats.json",
        WEB_DATA_DIR / "per_word_stats.json",
        NOTEBOOKS_RESULTS / "per_word_stats.json",
        "json",
        1,
    ),
    ArtifactContract(
        "confusion_pairs.json",
        WEB_DATA_DIR / "confusion_pairs.json",
        NOTEBOOKS_RESULTS / "confusion_pairs.json",
        "json",
        0.5,
    ),
    ArtifactContract(
        "curriculum.json",
        WEB_DATA_DIR / "curriculum.json",
        NOTEBOOKS_RESULTS / "curriculum.json",
        "json",
        1,
    ),
    ArtifactContract(
        "test_sample.json",
        WEB_DATA_DIR / "test_sample.json",
        NOTEBOOKS_RESULTS / "test_sample.json",
        "json",
        100,
    ),
)

# Reference imagery. These have no source outside the repository, so they carry
# no provenance pair, but a truncated image is still worth catching.
IMAGE_ARTIFACTS: tuple[ArtifactContract, ...] = (
    ArtifactContract(
        "letters.png", WEB_DIR / "assets" / "signs" / "letters.png", None, "image", 10
    ),
    ArtifactContract(
        "word-25.png", WEB_DIR / "assets" / "signs" / "word-25.png", None, "image", 100
    ),
    *(
        ArtifactContract(
            f"word-50-{page}.png",
            WEB_DIR / "assets" / "signs" / f"word-50-{page}.png",
            None,
            "image",
            100,
        )
        for page in range(1, 6)
    ),
)

# Gzipped copies of deploy files, named after the file with ".gz" appended. The
# host serves .onnx uncompressed, so the browser downloads the copy and keeps the
# raw file as its fallback; the validators and parity checks read the raw file
# too, so both are published. A copy has no source of its own: it must
# decompress to exactly the deploy file beside it.
GZIP_ARTIFACTS: tuple[ArtifactContract, ...] = (
    ArtifactContract(
        "letter_model.onnx.gz", WEB_MODELS_DIR / "letter_model.onnx.gz", None, "model", 1500
    ),
)

ALL_ARTIFACTS: tuple[ArtifactContract, ...] = (*ARTIFACTS, *IMAGE_ARTIFACTS, *GZIP_ARTIFACTS)


def provenance_pairs() -> list[tuple[str, Path, Path]]:
    """Every deploy file that must match a source file, byte for byte."""
    return [
        (artifact.name, artifact.deploy_path, artifact.source_path)
        for artifact in ALL_ARTIFACTS
        if artifact.source_path is not None
    ]


def gzip_pairs() -> list[tuple[str, Path, Path]]:
    """Every gzipped copy and the deploy file it must decompress to."""
    return [
        (artifact.name, artifact.deploy_path, artifact.deploy_path.with_suffix(""))
        for artifact in GZIP_ARTIFACTS
    ]


def relative(path: Path) -> str:
    """A repository-relative path for reporting, or the absolute one."""
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)
