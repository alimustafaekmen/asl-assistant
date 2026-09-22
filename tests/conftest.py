"""Shared deterministic fixtures and import setup for the Python test suite."""

import sys
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    PROJECT_ROOT / "asl-ml" / "src",
    PROJECT_ROOT / "asl-desktop" / "src",
    PROJECT_ROOT,
)
for source_root in reversed(SOURCE_ROOTS):
    source = str(source_root)
    if source not in sys.path:
        sys.path.insert(0, source)


@pytest.fixture
def hand_landmarks() -> np.ndarray:
    """Return a deterministic, non-degenerate 21x3 hand landmark vector.

    A fixed geometric sample makes failures reproducible and avoids tests that
    occasionally pass or fail because they happened to receive different
    random coordinates.
    """
    index = np.arange(21, dtype=np.float32)
    coords = np.column_stack(
        (
            index * 0.031,
            np.sin(index * 0.37).astype(np.float32) * 0.2,
            np.cos(index * 0.23).astype(np.float32) * 0.1,
        )
    )
    return coords.reshape(-1).astype(np.float32)
