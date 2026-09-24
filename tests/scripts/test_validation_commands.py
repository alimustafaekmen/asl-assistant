"""Behaviour of the runtime asset validator's web source inspection.

These faults are why the byte-size floors were replaced. A module that is
shipped but never loaded, or loaded but never shipped, breaks the page and
changes no file size at all, so nothing about a size check could have found
them. Each one is built as a small tree here rather than being checked by hand.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.validation.check_runtime_assets import find_web_source_issues

INDEX_TEMPLATE = """<!doctype html>
<html>
  <head><link rel="stylesheet" href="./css/style.css" /></head>
  <body>
{scripts}
  </body>
</html>
"""


def build_web_tree(root: Path, modules: list[str], loaded: list[str] | None = None) -> Path:
    """A minimal asl-web/ tree: one stylesheet and the given modules."""
    web = root / "asl-web"
    (web / "css").mkdir(parents=True)
    (web / "css" / "style.css").write_text("body { margin: 0; }\n", encoding="utf-8")
    for name in modules:
        path = web / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("function stub() { return 1; }\n", encoding="utf-8")
    tags = "\n".join(
        f'    <script src="./{name}"></script>' for name in (modules if loaded is None else loaded)
    )
    (web / "index.html").write_text(INDEX_TEMPLATE.format(scripts=tags), encoding="utf-8")
    return web


def test_a_consistent_tree_reports_nothing(tmp_path: Path) -> None:
    web = build_web_tree(tmp_path, ["js/core/app.js", "js/ui/prediction.js"])

    result = find_web_source_issues(web)

    assert result.issues == []
    assert result.modules == 2
    assert result.stylesheets == 1


def test_an_empty_module_is_reported(tmp_path: Path) -> None:
    """A truncated copy leaves a file that exists and does nothing."""
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    (web / "js" / "core" / "app.js").write_text("", encoding="utf-8")

    issues = find_web_source_issues(web).issues

    assert any("app.js" in issue and "BOS" in issue for issue in issues), issues


def test_a_module_index_html_does_not_load_is_reported(tmp_path: Path) -> None:
    """Dead weight that ships to users and no size check could ever see."""
    web = build_web_tree(
        tmp_path,
        ["js/core/app.js", "js/ui/orphan.js"],
        loaded=["js/core/app.js"],
    )

    issues = find_web_source_issues(web).issues

    assert any("orphan.js" in issue and "yuklemiyor" in issue for issue in issues), issues


def test_a_module_index_html_loads_but_is_missing_is_reported(tmp_path: Path) -> None:
    """The browser stops at the failed request, so the page comes up blank."""
    web = build_web_tree(
        tmp_path,
        ["js/core/app.js"],
        loaded=["js/core/app.js", "js/ml/gone.js"],
    )

    issues = find_web_source_issues(web).issues

    assert any("gone.js" in issue and "dosya yok" in issue for issue in issues), issues


def test_an_unresolved_stylesheet_reference_is_reported(tmp_path: Path) -> None:
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    (web / "css" / "style.css").write_text("", encoding="utf-8")

    issues = find_web_source_issues(web).issues

    assert any("style.css" in issue for issue in issues), issues


def test_a_tree_with_no_modules_is_reported(tmp_path: Path) -> None:
    web = build_web_tree(tmp_path, [])

    issues = find_web_source_issues(web).issues

    assert any("JavaScript modulu bulunamadi" in issue for issue in issues), issues


@pytest.mark.parametrize("missing", ["index.html", None])
def test_a_missing_or_empty_index_stops_the_inspection(tmp_path: Path, missing: str | None) -> None:
    """Nothing else can be concluded without the document that loads it all."""
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    if missing:
        (web / missing).unlink()
    else:
        (web / "index.html").write_text("", encoding="utf-8")

    result = find_web_source_issues(web)

    assert len(result.issues) == 1
    assert "index.html" in result.issues[0]


def test_external_scripts_and_stylesheets_are_left_alone(tmp_path: Path) -> None:
    """CDN assets are not this repository's files to account for."""
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    html = (web / "index.html").read_text(encoding="utf-8")
    html = html.replace(
        "<body>",
        '<body>\n    <script src="https://cdn.example.com/ort.min.js"></script>',
    )
    (web / "index.html").write_text(html, encoding="utf-8")

    assert find_web_source_issues(web).issues == []


def _with_head_links(web: Path, links: str) -> None:
    html = (web / "index.html").read_text(encoding="utf-8")
    (web / "index.html").write_text(html.replace("<head>", f"<head>{links}"), encoding="utf-8")


def test_a_missing_icon_link_is_reported(tmp_path: Path) -> None:
    """A renamed icon would 404 silently; every local link must resolve."""
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    _with_head_links(web, '<link rel="apple-touch-icon" href="./assets/icons/gone.png" />')

    issues = find_web_source_issues(web).issues

    assert any("gone.png" in issue for issue in issues), issues


def test_only_stylesheets_are_counted_as_stylesheets(tmp_path: Path) -> None:
    web = build_web_tree(tmp_path, ["js/core/app.js"])
    (web / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")
    _with_head_links(web, '<link rel="icon" href="favicon.ico" />')

    result = find_web_source_issues(web)

    assert result.issues == []
    assert result.stylesheets == 1
