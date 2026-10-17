"""The deploy check holds the folder about to be uploaded to what the site ships.

The site is deployed by dragging asl-web/ into the host's UI, which uploads the
folder as it is on disk. The Model Test word fixtures exported from the
competition data live in an ignored folder inside it, and a stray `.env`, a
private folder or a note in `data/` would be uploaded with the rest.
`--deploy` lists every file in the working tree and fails on each of them,
while the plain run only warns about the fixture folder, so local testing
with the fixtures still works.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.validation.check_runtime_assets import find_deploy_inventory_issues

LOCAL_FIXTURES = "asl-web/data/model-test-samples/local"


def minimal_site(root: Path) -> Path:
    """One file of every kind the site ships, and nothing else."""
    web = root / "asl-web"
    for name in (
        "index.html",
        "favicon.ico",
        "_headers",
        "README.md",
        "js/core/app.js",
        "js/README.md",
        "css/style.css",
        "data/word_labels.json",
        "data/model-test-samples/words/README.md",
        "models/letter_model.onnx",
        "models/letter_model.onnx.gz",
        "assets/social-preview.png",
        "assets/signs/letters.png",
        "assets/signs/letters.webp",
        "assets/fonts/atkinson.woff2",
        "assets/fonts/OFL.txt",
        "types/browser-globals.d.ts",
    ):
        path = web / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")
    return web


def _add(web: Path, name: str) -> None:
    path = web / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")


def test_a_site_of_shipped_kinds_reports_nothing(tmp_path: Path) -> None:
    web = minimal_site(tmp_path)

    result = find_deploy_inventory_issues(web)

    assert result.issues == []
    assert result.files == 17


@pytest.mark.parametrize(
    "stray",
    [
        ".env",
        "private/a.txt",
        "data/notes-private.txt",
        "js/core/app.js.orig",
        "models/letter_model.pkl",
        "assets/fonts/notes.txt",
        "index.html.bak",
        "notes.md",
        # A shipped ending is not enough when the name is hidden.
        "js/.eslintrc.js",
    ],
)
def test_a_file_the_site_does_not_ship_is_reported(tmp_path: Path, stray: str) -> None:
    web = minimal_site(tmp_path)
    _add(web, stray)

    issues = find_deploy_inventory_issues(web).issues

    assert len(issues) == 1 and f"asl-web/{stray}" in issues[0], issues


@pytest.mark.parametrize("where", [".DS_Store", "assets/signs/.DS_Store"])
def test_finder_metadata_is_reported_with_the_way_to_remove_it(tmp_path: Path, where: str) -> None:
    web = minimal_site(tmp_path)
    _add(web, where)

    issues = find_deploy_inventory_issues(web).issues

    assert len(issues) == 1 and "make clean" in issues[0], issues


@pytest.mark.parametrize("contents", [[], ["manifest.json", "word-hello.json"]])
def test_the_local_fixture_folder_is_reported_once_whatever_it_holds(
    tmp_path: Path, contents: list[str]
) -> None:
    """Every file in it is valid JSON under data/, so only its location gives it away."""
    web = minimal_site(tmp_path)
    local = tmp_path / LOCAL_FIXTURES
    local.mkdir(parents=True)
    for name in contents:
        (local / name).write_text("{}", encoding="utf-8")

    issues = find_deploy_inventory_issues(web).issues

    assert len(issues) == 1 and "model-test-samples/local" in issues[0], issues


def test_a_file_git_ignores_is_reported_even_when_its_kind_ships(tmp_path: Path) -> None:
    """An exported QR snapshot is a PNG under assets/, and ignored for a reason."""
    web = minimal_site(tmp_path)
    _add(web, "assets/qr-demo.png")

    assert find_deploy_inventory_issues(web).issues == []
    issues = find_deploy_inventory_issues(web, ignored=[web / "assets" / "qr-demo.png"]).issues

    assert len(issues) == 1 and "asl-web/assets/qr-demo.png" in issues[0], issues


# The command, on a full copy of the checkout.


def _with_local_fixture_folder(checkout) -> None:
    """The folder as an export leaves it, holding no words, so nothing else fails."""
    checkout.write(f"{LOCAL_FIXTURES}/manifest.json", json.dumps({"words": []}))


def test_a_clean_copy_passes_the_deploy_check(checkout) -> None:
    result = checkout.check("--deploy")

    assert result.returncode == 0, result.stdout + result.stderr
    assert checkout.failures(result) == []


def test_the_local_fixture_folder_fails_the_deploy_check(checkout) -> None:
    _with_local_fixture_folder(checkout)

    result = checkout.check("--deploy")

    assert result.returncode == 1, result.stdout + result.stderr
    assert "SAFE TO DEPLOY" not in result.stdout
    failed = checkout.failures(result)
    assert len(failed) == 1 and "model-test-samples/local" in failed[0], failed


def test_the_local_fixture_folder_only_warns_in_a_development_run(checkout) -> None:
    """Testing the 50 words locally needs the folder in place."""
    _with_local_fixture_folder(checkout)

    result = checkout.check()

    assert result.returncode == 0, result.stdout + result.stderr
    assert "model-test-samples/local/ is present" in result.stdout


@pytest.mark.parametrize("stray", ["asl-web/.env", "asl-web/private/a.txt", "asl-web/.DS_Store"])
def test_a_stray_file_fails_the_deploy_check(checkout, stray: str) -> None:
    checkout.write(stray, "SECRET=1\n")

    result = checkout.check("--deploy")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and stray in failed[0], failed


def test_the_deploy_check_reads_git_ignore_rules_in_a_git_checkout(checkout) -> None:
    """Without Git the allowlist alone decides, and a QR snapshot is a shipped kind."""
    if shutil.which("git") is None:
        pytest.skip("git is not on PATH")
    shutil.copy(Path(__file__).resolve().parents[2] / ".gitignore", checkout.path(".gitignore"))
    checkout.write("asl-web/assets/qr-demo.png", b"png")
    assert checkout.check("--deploy", "--no-onnx").returncode == 0

    subprocess.run(["git", "init", "-q", str(checkout.root)], check=True, timeout=60)
    result = checkout.check("--deploy", "--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "asl-web/assets/qr-demo.png" in failed[0], failed
