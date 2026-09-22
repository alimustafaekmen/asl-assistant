"""Label-map JSON I/O helpers.

Originally located at `src/utils.py` (asl-desktop legacy). Moved here because
label maps are model contract data shared across training scripts, validation,
tests, and the desktop prototype.
"""

import json
import os


def save_label_map(label_map: dict, filepath: str) -> None:
    """Write a label-to-index mapping as UTF-8-compatible JSON."""
    d = os.path.dirname(filepath)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(label_map, f, indent=2, ensure_ascii=False)


def load_label_map(filepath: str) -> dict:
    """Load a ``{label: index}`` mapping from JSON."""
    with open(filepath, "r") as f:
        return json.load(f)


def invert_label_map(label_map: dict) -> dict:
    """Return the inverse ``{index: label}`` mapping."""
    return {int(v): k for k, v in label_map.items()}
