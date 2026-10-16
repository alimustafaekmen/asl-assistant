"""The response headers the published site is served with.

Drag-and-drop deploys upload asl-web/ only, never the root netlify.toml, so the
headers live in asl-web/_headers, which Netlify reads on every deploy method.
They cannot be read back locally: `make web` is a plain file server.
"""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[2]


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


def _site_headers() -> dict[str, str]:
    text = (PROJECT_ROOT / "asl-web" / "_headers").read_text(encoding="utf-8")
    return _netlify_headers(text).get("/*", {})


def _content_security_policy(site: dict[str, str]) -> dict[str, list[str]]:
    """The policy's directives, whether it is enforced or only reported.

    It is Report-Only until it has been read on the deployed site in a real
    browser (backlog #6). Promoting it must not need this test changed, and
    renaming or dropping the line must fail it.
    """
    policies = [
        site[name]
        for name in ("content-security-policy", "content-security-policy-report-only")
        if name in site
    ]
    assert len(policies) == 1, f"expected one CSP header for /*, found {len(policies)}"
    directives: dict[str, list[str]] = {}
    for part in policies[0].split(";"):
        name, *sources = part.split() or [""]
        if name:
            assert name.lower() not in directives, f"directive {name} given twice"
            directives[name.lower()] = sources
    return directives


def test_the_full_address_is_not_sent_to_other_sites() -> None:
    """The video and QR links open other sites; the page URL must not follow them."""
    assert _site_headers().get("referrer-policy") in {
        "no-referrer",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
    }


def test_the_policy_forbids_framing_plugins_and_base_rewrites() -> None:
    csp = _content_security_policy(_site_headers())

    assert csp.get("frame-ancestors") == ["'none'"]
    assert csp.get("object-src") == ["'none'"]
    assert csp.get("base-uri") == ["'self'"]
    assert csp.get("default-src") == ["'self'"]


def test_scripts_come_only_from_the_site_and_jsdelivr() -> None:
    """ONNX Runtime and MediaPipe compile WASM, so that one keyword is allowed.

    No inline script and no eval: every start-up step lives in a file under js/.
    """
    script_src = _content_security_policy(_site_headers()).get("script-src", [])

    assert set(script_src) == {"'self'", "https://cdn.jsdelivr.net", "'wasm-unsafe-eval'"}


class _Subresources(HTMLParser):
    """The URLs index.html makes the browser load, with the directive governing each.

    Links a visitor follows (<a href>) and metadata (<meta content>) load
    nothing, so the policy does not apply to them.
    """

    LINK_DIRECTIVES = {
        "stylesheet": "style-src",
        "icon": "img-src",
        "apple-touch-icon": "img-src",
        "manifest": "manifest-src",
    }

    def __init__(self) -> None:
        super().__init__()
        self.loads: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "script" and values.get("src"):
            self.loads.append(("script-src", values["src"]))
        elif tag == "img" and values.get("src"):
            self.loads.append(("img-src", values["src"]))
        elif tag == "link" and values.get("href"):
            for rel in values.get("rel", "").lower().split():
                if rel in self.LINK_DIRECTIVES:
                    self.loads.append((self.LINK_DIRECTIVES[rel], values["href"]))


def test_every_origin_the_page_loads_from_is_allowed() -> None:
    """A script or stylesheet moved to another CDN is blocked once the policy is enforced.

    The origins the scripts themselves request (the MediaPipe bundle, its WASM
    and models, ONNX Runtime's WASM) are not in the markup and are not covered
    here.
    """
    csp = _content_security_policy(_site_headers())
    page = _Subresources()
    page.feed((PROJECT_ROOT / "asl-web" / "index.html").read_text(encoding="utf-8"))

    blocked = []
    for directive, url in page.loads:
        parts = urlsplit(url)
        if not parts.scheme:
            continue  # Relative: the site's own origin, which 'self' covers.
        origin = f"{parts.scheme}://{parts.netloc}"
        allowed = csp.get(directive, csp.get("default-src", []))
        if origin not in allowed:
            blocked.append(f"{directive} {url}")

    assert any(directive == "script-src" for directive, _ in page.loads), "no script found"
    assert blocked == []
