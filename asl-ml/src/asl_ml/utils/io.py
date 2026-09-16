"""Filesystem I/O helpers.

Originally located at `src/utils.py::ensure_dir` (asl-desktop legacy).
"""
import os


def ensure_dir(path: str) -> str:
    """Dizin yoksa olusturur, yolu dondurur."""
    os.makedirs(path, exist_ok=True)
    return path
