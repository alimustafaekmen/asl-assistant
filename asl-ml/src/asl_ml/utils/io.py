"""Filesystem I/O helpers.

Originally located at `src/utils.py::ensure_dir` (asl-desktop legacy).
"""

import os


def ensure_dir(path: str) -> str:
    """Create a directory when needed and return its path."""
    os.makedirs(path, exist_ok=True)
    return path
