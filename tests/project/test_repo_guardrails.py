"""Repository guardrails that catch drift before a demo or commit."""

from __future__ import annotations

import ast
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote

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
    ".pt",
    ".pth",
    ".pyc",
    ".task",
    ".webm",
    ".wasm",
    ".zip",
}

LOCAL_ONLY_PREFIXES = ("legacy/",)

STALE_NOTEBOOK_REFERENCES = {
    "notebooks/train_word_model_final" + ".ipynb",
    "notebooks/kelime-modeli-results" + ".ipynb",
    "notebooks/" + "results/",
}


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


def _public_worktree_files() -> list[str]:
    """Return tracked and non-ignored untracked files that currently exist."""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.skip("Git metadata is not available")
    return sorted(
        rel_path
        for rel_path in set(result.stdout.splitlines())
        if rel_path and (PROJECT_ROOT / rel_path).is_file()
    )


def _markdown_prose(text: str) -> str:
    """Return Markdown outside fenced code blocks.

    Shell comments such as ``# activate the environment`` are code, not H1
    headings. Link-like examples inside a fence are not documentation links
    either, so both checks use the same prose-only view.
    """
    prose: list[str] = []
    fence: str | None = None

    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token[0]
            elif token[0] == fence:
                fence = None
            continue
        if fence is None:
            prose.append(line)

    return "\n".join(prose)


def _make_target_recipe(text: str, target: str) -> str:
    """Extract a Make target recipe without depending on line numbers."""
    match = re.search(
        rf"^{re.escape(target)}:(?:[^\n]*)\n(?P<body>(?:\t[^\n]*(?:\n|$)|\s*\n)*)",
        text,
        flags=re.MULTILINE,
    )
    assert match is not None, f"Missing Make target: {target}"
    return match.group("body")


def _netlify_headers(text: str) -> dict[str, dict[str, str]]:
    """Parse a Netlify ``_headers`` file into path -> {lower-case name: value}.

    Mirrors the published format: an unindented path line, then indented
    ``Name: value`` lines. A header line that lost its indentation reads as a
    path here too, so it cannot pass as a header for ``/*``.
    """
    rules: dict[str, dict[str, str]] = {}
    current: dict[str, str] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line[0].isspace():
            current = rules.setdefault(stripped, {})
            continue
        assert current is not None, f"Header before any path: {line!r}"
        name, separator, value = stripped.partition(":")
        assert separator, f"Header line without a colon: {line!r}"
        current[name.strip().lower()] = value.strip()
    return rules


def test_deployed_folder_carries_the_security_headers() -> None:
    """Drag-and-drop deploys upload asl-web/ only, so headers must live there."""
    headers_path = PROJECT_ROOT / "asl-web" / "_headers"
    assert headers_path.is_file(), "asl-web/_headers is missing; the site would ship without it"

    site = _netlify_headers(headers_path.read_text(encoding="utf-8")).get("/*", {})
    permissions = [item.strip() for item in site.get("permissions-policy", "").split(",")]

    assert site.get("x-content-type-options") == "nosniff"
    assert "camera=(self)" in permissions
    assert site.get("x-frame-options") == "DENY"


def test_makefile_exposes_core_workflow_targets() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    targets = set(re.findall(r"^([A-Za-z0-9_.-]+):(?:\s|$)", text, flags=re.MULTILINE))

    expected = {
        "doctor",
        "setup",
        "web",
        "test",
        "test-full",
        "js-check",
        "js-test",
        "js-typecheck",
        "validate",
        "validate-full",
        "git-hygiene",
    }
    assert expected <= targets


def test_make_js_check_covers_every_web_script() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    recipe = _make_target_recipe(text, "js-check")

    assert "node --check" in recipe
    assert "$(JS_FILES)" in recipe
    assert "Node.js bulunamad" in recipe


def test_make_validate_requires_js_and_runtime_asset_checks() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    target = re.search(r"^validate:([^\n]*)$", text, flags=re.MULTILINE)
    recipe = _make_target_recipe(text, "validate")

    assert target is not None
    assert "js-check" in target.group(1).split()
    assert "$(CHECK_RUNTIME)" in recipe


def test_make_setup_installs_only_this_project() -> None:
    """Setup installs the two local packages and upgrades nothing else.

    Whether setup refuses to run in the wrong environment is behaviour, and is
    covered by the guard's own tests in tests/scripts/. What belongs here is
    the install policy, which lives in the recipe.
    """
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    recipe = _make_target_recipe(text, "setup")

    # No environment variable may turn the base-environment refusal off.
    assert "ALLOW_BASE" + "_SETUP" not in text
    assert "install --upgrade" not in recipe
    assert "install --no-deps -e $(ASL_ML_DIR)" in recipe
    assert "install --no-deps -e $(ASL_DESKTOP_DIR)" in recipe


def _resolved_recipe(target: str) -> str:
    """What `make <target>` would actually run, with variables expanded.

    Asking make rather than reading the Makefile keeps these checks on the
    command's effect, so renaming a variable or reordering the file does not
    break them.
    """
    result = subprocess.run(
        ["make", "--dry-run", target],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


@pytest.mark.parametrize("target", ["lint", "format-check"])
def test_quality_gate_covers_test_sources(target: str) -> None:
    """Test code is read and maintained like product code, so it is linted too.

    The gate covered only the three product trees for a long time, which let
    unsorted imports, unused imports and an ambiguous variable name accumulate
    in tests/ without anything reporting them.
    """
    if shutil.which("make") is None:
        pytest.skip("make is not on PATH")

    recipe = _resolved_recipe(target)

    assert "tests" in recipe.split(), f"{target} does not cover tests/: {recipe.strip()}"
    for tree in ("asl-desktop", "asl-ml", "scripts"):
        assert tree in recipe.split(), f"{target} stopped covering {tree}"


def test_public_environment_matches_dependency_contract() -> None:
    environment = (PROJECT_ROOT / "environment.yml").read_text(encoding="utf-8")
    requirements = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    dev_requirements = (PROJECT_ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    desktop_metadata = (PROJECT_ROOT / "asl-desktop/pyproject.toml").read_text(encoding="utf-8")
    ml_metadata = (PROJECT_ROOT / "asl-ml/pyproject.toml").read_text(encoding="utf-8")

    assert (PROJECT_ROOT / ".node-version").read_text(encoding="utf-8") == "24\n"
    assert "name: asl-assistant" in environment
    assert "python=3.12" in environment
    assert "nodejs=24" in environment
    assert "-r requirements-dev.txt" in environment
    assert "scikit-learn==1.8.0" in requirements
    assert "onnx==1.22.0" in requirements
    assert "onnxruntime==1.23.2" in requirements
    assert "pytest==9.1.1" in requirements
    assert "ruff==0.16.8" in dev_requirements
    assert "opencv-contrib-python>=4.5,<5" in desktop_metadata
    assert '"opencv-python' not in desktop_metadata
    assert "pytest-cov" not in requirements + desktop_metadata + ml_metadata


def test_make_test_uses_the_portable_source_suite() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    recipe = _make_target_recipe(text, "test")

    assert "$(TEST_PYTHONPATH)" in recipe
    assert "$(PYTEST) $(TEST_FAST)" in recipe
    assert "find_spec" not in recipe


def test_make_health_runs_git_hygiene_gate() -> None:
    text = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    target = re.search(r"^health:([^\n]*)$", text, flags=re.MULTILINE)
    recipe = _make_target_recipe(text, "health")

    assert target is not None
    assert {"lint", "format-check", "js-check"} <= set(target.group(1).split())
    assert "git-hygiene" in recipe
    assert "check_word_feature_parity.py" in recipe
    assert "check_letter_feature_parity.py" in recipe


def test_web_typecheck_is_a_developer_tool_only() -> None:
    """The app and the health gate must keep working without a package install."""
    import json

    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    tsconfig_text = (PROJECT_ROOT / "tsconfig.web.json").read_text(encoding="utf-8")
    makefile = (PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    health_line = re.search(r"^health:([^\n]*)$", makefile, flags=re.MULTILINE)
    health_recipe = _make_target_recipe(makefile, "health")

    assert (PROJECT_ROOT / "package-lock.json").exists(), "the install must be reproducible"
    assert package["private"] is True
    assert package.get("dependencies") in (None, {}), "no runtime dependency may be added"
    assert package["devDependencies"] == {"typescript": "5.9.3"}, "pin the checker exactly"

    # noEmit is what keeps the deployed sources the .js files the browser loads.
    tsconfig = json.loads(re.sub(r'^\s*"//":\s*\[.*?\],\n', "", tsconfig_text, flags=re.S | re.M))
    assert tsconfig["compilerOptions"]["noEmit"] is True
    assert tsconfig["compilerOptions"]["checkJs"] is True
    assert tsconfig["compilerOptions"]["allowJs"] is True
    assert "outDir" not in tsconfig["compilerOptions"]

    assert health_line is not None
    assert "js-typecheck" not in health_line.group(1).split()
    assert "js-typecheck" not in health_recipe


def test_web_sources_stay_javascript() -> None:
    """TypeScript is a checker here, not a source language."""
    web_js = PROJECT_ROOT / "asl-web" / "js"

    assert not list(web_js.rglob("*.ts")), "application sources must stay .js"
    # Declarations are allowed, but only for globals the app does not own.
    declarations = sorted(p.name for p in (PROJECT_ROOT / "asl-web" / "types").glob("*.d.ts"))
    assert declarations == ["browser-globals.d.ts"]


def test_python_configuration_follows_package_ownership() -> None:
    """Reject imports from the retired root config package."""
    assert not (PROJECT_ROOT / "config").exists()

    stale_imports: list[str] = []
    for path in PROJECT_ROOT.rglob("*.py"):
        # The setup docs create .venv inside the checkout; its third-party
        # sources are not project code and need not be UTF-8.
        if {".git", "legacy", "site-packages"} & set(path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "config.settings":
                stale_imports.append(path.relative_to(PROJECT_ROOT).as_posix())
            elif isinstance(node, ast.Import) and any(
                alias.name == "config.settings" for alias in node.names
            ):
                stale_imports.append(path.relative_to(PROJECT_ROOT).as_posix())

    assert sorted(set(stale_imports)) == []


def test_no_ignored_or_local_only_files_are_tracked() -> None:
    ignored = subprocess.run(
        ["git", "ls-files", "-ci", "--exclude-standard"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if ignored.returncode != 0:
        pytest.skip("Git metadata is not available")

    # A tracked file that is deleted in the worktree may already match the new
    # ignore policy before its deletion is committed. That is the desired
    # migration state, not an ignored file leaking into the repository.
    ignored_tracked = [
        line for line in ignored.stdout.splitlines() if line and (PROJECT_ROOT / line).exists()
    ]
    assert ignored_tracked == [], (
        f"Files matching .gitignore must be removed from the public Git index: {ignored_tracked}"
    )

    tracked = _git_ls_files()
    local_only_tracked = [
        rel_path for rel_path in tracked if rel_path.startswith(LOCAL_ONLY_PREFIXES)
    ]
    assert local_only_tracked == []


def test_public_text_has_no_machine_specific_environment_markers() -> None:
    markers = ("ml" + "-ds", "/" + "Users/")
    matches: list[str] = []

    for rel_path in _public_worktree_files():
        path = PROJECT_ROOT / rel_path
        if path.suffix.lower() in TEXT_SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for marker in markers:
            if marker in text:
                matches.append(f"{rel_path}: {marker}")

    assert matches == [], f"Machine-specific public text: {matches}"


def test_public_markdown_has_one_title_and_valid_local_links() -> None:
    """Public docs should not drift into duplicate titles or broken paths."""
    bad_titles: list[str] = []
    broken_links: list[str] = []

    for rel_path in _public_worktree_files():
        if not rel_path.lower().endswith(".md"):
            continue

        path = PROJECT_ROOT / rel_path
        text = path.read_text(encoding="utf-8")
        prose = _markdown_prose(text)
        if not prose.startswith("# ") or len(re.findall(r"^# ", prose, flags=re.MULTILINE)) != 1:
            bad_titles.append(rel_path)

        for raw_target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", prose):
            target = raw_target.strip().split(maxsplit=1)[0].strip("<>")
            if not target or target.startswith(("#", "http://", "https://", "mailto:")):
                continue

            local_path = unquote(target.split("#", 1)[0])
            if local_path and not (path.parent / local_path).resolve().exists():
                broken_links.append(f"{rel_path} -> {target}")

    assert bad_titles == [], f"Markdown files must have exactly one H1: {bad_titles}"
    assert broken_links == [], f"Broken local Markdown links: {broken_links}"


def test_docs_are_flat_and_discoverable_from_the_index() -> None:
    """Allow useful new docs while preventing hidden parallel doc trees."""
    docs_dir = PROJECT_ROOT / "docs"
    index = docs_dir / "README.md"
    prose = _markdown_prose(index.read_text(encoding="utf-8"))
    linked_names = {
        Path(unquote(target.split("#", 1)[0])).name
        for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", prose)
        if target and not target.startswith(("#", "http://", "https://", "mailto:"))
    }
    public_docs = {path.name for path in docs_dir.glob("*.md") if path != index}
    nested_docs = [path for path in docs_dir.rglob("*.md") if path.parent != docs_dir]

    assert nested_docs == [], "Public documentation should use one shallow docs/ index"
    assert public_docs <= linked_names, "Every public document must be linked from docs/README.md"


def test_published_notebook_layout_and_references_are_current() -> None:
    stale_hits: list[str] = []
    broken_notebook_refs: list[str] = []
    notebook_ref_pattern = re.compile(
        r"(?<![A-Za-z0-9_])((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.ipynb)"
    )
    text_suffixes = {".html", ".ipynb", ".js", ".json", ".md", ".py", ".toml", ".txt"}
    for rel_path in _public_worktree_files():
        path = PROJECT_ROOT / rel_path
        if path.suffix.lower() not in text_suffixes:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for stale in STALE_NOTEBOOK_REFERENCES:
            if stale in text:
                stale_hits.append(f"{rel_path}: {stale}")

        for reference in notebook_ref_pattern.findall(text):
            ref_path = Path(reference)
            if reference.startswith(("./", "../")):
                candidates = [path.parent / ref_path]
            elif "/" in reference:
                candidates = [PROJECT_ROOT / ref_path, path.parent / ref_path]
            else:
                candidates = [
                    path.parent / ref_path,
                    PROJECT_ROOT / "notebooks" / ref_path,
                    PROJECT_ROOT / ref_path,
                ]

            if not any(candidate.is_file() for candidate in candidates):
                broken_notebook_refs.append(f"{rel_path}: {reference}")

    assert stale_hits == [], f"Stale notebook path references: {stale_hits}"
    assert broken_notebook_refs == [], f"Broken notebook path references: {broken_notebook_refs}"


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
