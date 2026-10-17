"""Open reference links from local data files in the default browser."""

import logging
import webbrowser
from urllib.parse import urlparse

_logger = logging.getLogger("ASL.Links")

_ALLOWED_SCHEMES = {"http", "https"}


def open_web_link(url: str) -> bool:
    """Open ``url`` only when it is an http or https address.

    The links come from a JSON file on disk. ``webbrowser`` would also hand
    ``file://`` paths and application schemes to the operating system, so
    anything else is logged and ignored.

    Returns:
        ``True`` when the link was passed to the browser.
    """
    if not url:
        return False
    if urlparse(url.strip()).scheme.lower() not in _ALLOWED_SCHEMES:
        _logger.warning("Web olmayan baglanti acilmadi: %r", url)
        return False
    return bool(webbrowser.open(url.strip()))
