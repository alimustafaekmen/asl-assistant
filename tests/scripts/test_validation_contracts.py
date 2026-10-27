"""The canonical artifact contracts.

Both validators read these from one module. With a copy in each, moving an
artifact would mean editing two files, and nothing would report it if only
one had changed.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.validation.contracts import (
    ALL_ARTIFACTS,
    PROJECT_ROOT,
    WEB_DIR,
    ArtifactContract,
    provenance_pairs,
    relative,
)


def test_every_artifact_is_named_once() -> None:
    """A repeated name means two entries claim the same artifact."""
    names = [artifact.name for artifact in ALL_ARTIFACTS]

    assert len(names) == len(set(names)), "duplicate artifact names"


def test_every_deploy_path_is_inside_the_published_directory() -> None:
    """A deploy path outside asl-web/ would not reach the hosted site."""
    outside = [
        relative(artifact.deploy_path)
        for artifact in ALL_ARTIFACTS
        if WEB_DIR not in artifact.deploy_path.parents
    ]

    assert outside == []


def test_deploy_and_source_paths_are_distinct() -> None:
    """A pair pointing at one file would compare it with itself."""
    same = [
        artifact.name
        for artifact in ALL_ARTIFACTS
        if artifact.source_path is not None and artifact.deploy_path == artifact.source_path
    ]

    assert same == []


@pytest.mark.parametrize("artifact", ALL_ARTIFACTS, ids=lambda a: a.name)
def test_required_artifacts_are_present(artifact: ArtifactContract) -> None:
    """The contract names what the published site needs, so it must be there."""
    if not artifact.required:
        pytest.skip(f"{artifact.name} is optional")

    assert artifact.deploy_path.is_file(), f"missing: {relative(artifact.deploy_path)}"


def test_provenance_pairs_cover_every_artifact_with_a_source() -> None:
    pairs = provenance_pairs()
    with_source = [a for a in ALL_ARTIFACTS if a.source_path is not None]

    assert len(pairs) == len(with_source)
    for _, deploy, source in pairs:
        assert isinstance(deploy, Path)
        assert isinstance(source, Path)


def test_every_provenance_source_is_tracked() -> None:
    """The validators fail on a missing source, which is right only if Git keeps it.

    A source that existed only on one machine would fail every clone, so a pair
    added later must point at a tracked file too.
    """
    if shutil.which("git") is None:
        pytest.skip("git is not on PATH")
    sources = [relative(source) for _, _, source in provenance_pairs()]
    listed = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "ls-files", "--", *sources],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if listed.returncode != 0:
        pytest.skip("Git metadata is not available")

    assert sorted(set(sources) - set(listed.stdout.splitlines())) == []


def test_size_floors_are_coarse_and_only_apply_to_binaries_and_data() -> None:
    """Source files are checked by content, not by how large they are.

    A floor on source code only forbids it getting smaller, so it fails the
    first time anything is minified or a module is genuinely simplified.
    """
    source_suffixes = {".js", ".css", ".html"}
    gated_sources = [
        artifact.name
        for artifact in ALL_ARTIFACTS
        if artifact.deploy_path.suffix in source_suffixes
    ]

    assert gated_sources == []
    assert all(artifact.min_size_kb > 0 for artifact in ALL_ARTIFACTS)


def test_relative_reports_repository_paths() -> None:
    assert relative(WEB_DIR / "index.html") == "asl-web/index.html"
    # A path outside the repository is reported as it is rather than raising.
    assert relative(Path("/elsewhere/file.json")) == "/elsewhere/file.json"
    assert PROJECT_ROOT.is_dir()
