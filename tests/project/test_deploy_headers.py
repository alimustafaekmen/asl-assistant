"""The response headers the published site is served with.

A deploy uploads asl-web/ only, so the headers live in asl-web/_headers, which
Cloudflare Pages reads from the uploaded folder.
`make web` is a plain file server that ignores the file, so these tests read
it directly; the browser checks' own server (tests/browser/serve.mjs) applies
it.
"""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _parse_headers_file(text: str) -> dict[str, dict[str, str]]:
    """Parse a ``_headers`` file into path -> {lower-case name: value}.

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
    """A deploy uploads asl-web/ only, so headers must live there."""
    headers_path = PROJECT_ROOT / "asl-web" / "_headers"
    assert headers_path.is_file(), "asl-web/_headers is missing; the site would ship without it"

    site = _parse_headers_file(headers_path.read_text(encoding="utf-8")).get("/*", {})
    permissions = [item.strip() for item in site.get("permissions-policy", "").split(",")]

    assert site.get("x-content-type-options") == "nosniff"
    assert "camera=(self)" in permissions
    assert site.get("x-frame-options") == "DENY"


def _site_headers() -> dict[str, str]:
    text = (PROJECT_ROOT / "asl-web" / "_headers").read_text(encoding="utf-8")
    return _parse_headers_file(text).get("/*", {})


def _content_security_policy(site: dict[str, str]) -> dict[str, list[str]]:
    """The policy's directives, whether it is enforced or only reported.

    It is Report-Only until it has been read on the deployed site in a real
    browser. Promoting it must not need this test changed, and renaming or
    dropping the line must fail it.
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


def _remote_sources(sources: list[str]) -> list[str]:
    return [source for source in sources if source.startswith(("http:", "https:"))]


def _is_pinned_package(source: str) -> bool:
    """A jsDelivr npm package directory at one exact version, such as kjua@0.9.0/."""
    parts = urlsplit(source)
    segments = parts.path.split("/")
    if parts.scheme != "https" or parts.netloc != "cdn.jsdelivr.net":
        return False
    if len(segments) < 4 or segments[1] != "npm" or segments[-1] != "":
        return False
    name, _, version = "/".join(segments[2:-1]).rpartition("@")
    numbers = version.split(".")
    return bool(name) and len(numbers) == 3 and all(number.isdigit() for number in numbers)


def test_scripts_come_only_from_the_site_and_pinned_packages() -> None:
    """ONNX Runtime and MediaPipe compile WASM, so that one keyword is allowed.

    No inline script and no eval: every start-up step lives in a file under js/.
    A CDN is allowed only for the exact package versions the app loads, never
    as a whole host that serves anyone's package or repository.
    """
    script_src = _content_security_policy(_site_headers()).get("script-src", [])
    remote = _remote_sources(script_src)

    assert set(script_src) - set(remote) == {"'self'", "'wasm-unsafe-eval'"}
    assert remote and all(_is_pinned_package(source) for source in remote), remote


def test_the_page_connects_only_to_pinned_packages_and_the_mediapipe_models() -> None:
    """The WASM files and the MediaPipe models are fetched; nothing else leaves the site."""
    connect_src = _content_security_policy(_site_headers()).get("connect-src", [])
    remote = _remote_sources(connect_src)
    models = "https://storage.googleapis.com/mediapipe-models/"

    assert set(connect_src) - set(remote) == {"'self'"}
    assert models in remote
    assert all(source == models or _is_pinned_package(source) for source in remote), remote


def test_no_remote_source_allows_a_whole_host() -> None:
    csp = _content_security_policy(_site_headers())

    whole_hosts = [
        f"{directive} {source}"
        for directive, sources in csp.items()
        for source in _remote_sources(sources)
        if urlsplit(source).path in {"", "/"}
    ]
    assert whole_hosts == []


def test_a_page_that_opens_the_site_gets_no_handle_to_its_window() -> None:
    assert _site_headers().get("cross-origin-opener-policy") == "same-origin"


def test_other_sites_cannot_embed_its_files() -> None:
    assert _site_headers().get("cross-origin-resource-policy") == "same-origin"


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


def _source_allows(source: str, url: str) -> bool:
    """CSP source matching for a remote source: same origin, then the path.

    A source path ending in "/" allows everything below it; any other path
    allows that one file.
    """
    allowed, wanted = urlsplit(source), urlsplit(url)
    if (allowed.scheme, allowed.netloc) != (wanted.scheme, wanted.netloc):
        return False
    if allowed.path in {"", "/"}:
        return True
    if allowed.path.endswith("/"):
        return wanted.path.startswith(allowed.path)
    return wanted.path == allowed.path


def test_every_file_the_page_loads_from_another_site_is_allowed() -> None:
    """A script moved to another CDN or version is blocked once the policy is enforced.

    The origins the scripts themselves request (the MediaPipe bundle, its WASM
    and models, ONNX Runtime's WASM) are not in the markup and are not covered
    here.
    """
    csp = _content_security_policy(_site_headers())
    page = _Subresources()
    page.feed((PROJECT_ROOT / "asl-web" / "index.html").read_text(encoding="utf-8"))

    blocked = []
    for directive, url in page.loads:
        if not urlsplit(url).scheme:
            continue  # Relative: the site's own origin, which 'self' covers.
        allowed = csp.get(directive, csp.get("default-src", []))
        if not any(_source_allows(source, url) for source in _remote_sources(allowed)):
            blocked.append(f"{directive} {url}")

    assert any(directive == "script-src" for directive, _ in page.loads), "no script found"
    assert blocked == []
