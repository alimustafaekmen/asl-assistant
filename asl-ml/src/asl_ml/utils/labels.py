"""Label-map JSON I/O helpers.

Originally located at `src/utils.py` (asl-desktop legacy). Moved here because
label maps are model contract data shared across training scripts, validation,
tests, and the desktop prototype.
"""
import json
import os


def save_label_map(label_map: dict, filepath: str) -> None:
    """Label map'i JSON olarak kaydeder."""
    d = os.path.dirname(filepath)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(label_map, f, indent=2, ensure_ascii=False)


def load_label_map(filepath: str) -> dict:
    """JSON'dan label map yukler. {str_label: int_idx} formatinda."""
    with open(filepath, "r") as f:
        return json.load(f)


def invert_label_map(label_map: dict) -> dict:
    """Label map'i ters cevirir: {int_idx: str_label}."""
    return {int(v): k for k, v in label_map.items()}
