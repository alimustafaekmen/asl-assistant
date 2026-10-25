"""The page the host answers an unknown path with.

Cloudflare Pages treats a site without a top-level 404.html as a single-page
app and answers every unknown path with index.html and a 200. A mistyped model
or data path then arrives as a page of HTML instead of a 404, and a search
engine sees one copy of the app per wrong link. The 404 page is served at any
depth, so it can only reach its stylesheets and links from the site root.
"""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
NOT_FOUND = PROJECT_ROOT / "asl-web" / "404.html"


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lang: str | None = None
        self.title = ""
        self.scripts = 0
        self.references: list[str] = []
        self.home_links = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.lang = values.get("lang")
        if tag == "title":
            self._in_title = True
        if tag == "script":
            self.scripts += 1
        for name in ("href", "src"):
            if values.get(name):
                self.references.append(values[name])
        if tag == "a" and values.get("href") == "/":
            self.home_links += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def _page() -> _Page:
    assert NOT_FOUND.is_file(), "asl-web/404.html is missing; unknown paths would get the app"
    page = _Page()
    page.feed(NOT_FOUND.read_text(encoding="utf-8"))
    return page


def test_unknown_paths_get_a_page_of_their_own() -> None:
    page = _page()
    assert page.lang, "the page names its language"
    assert page.title.strip(), "the page has a title"
    assert page.home_links >= 1, "the page links back to the app"
    assert page.scripts == 0, "the CSP allows no inline script, and the page needs none"


def test_the_page_reaches_everything_from_the_site_root() -> None:
    relative = [ref for ref in _page().references if not ref.startswith(("/", "https://"))]
    assert relative == [], f"served at /a/b/, these would resolve under it: {relative}"
