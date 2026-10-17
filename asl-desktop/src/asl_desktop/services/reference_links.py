"""Load the coach's reference video links from the first usable data file."""

import json
import logging
import os
from collections.abc import Iterable

_logger = logging.getLogger("ASL.Reference")


def load_video_links(paths: Iterable[str | os.PathLike]) -> tuple[dict[str, str], str]:
    """Read ``(word links, alphabet link)`` from the first readable file.

    The local ``data/reference`` copy is ignored by git and absent in a fresh
    clone, so callers list it first and the tracked web copy after it. A file
    that cannot be read is logged and skipped.

    Returns:
        The word-to-URL mapping and the alphabet video URL, both empty when no
        file could be used.
    """
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            words = dict(data.get("words", {}))
            alphabet = str(data.get("alphabet_video", ""))
        except (OSError, ValueError, AttributeError, TypeError) as e:
            _logger.warning("Video links could not be loaded (%s): %s", path, e)
            continue
        return words, alphabet
    return {}, ""
