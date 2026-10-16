"""Landmark normalization helpers.

Originally located at `src/utils.py::normalize_landmarks` (asl-desktop legacy).
Moved here because this is the SINGLE SOURCE OF TRUTH for the letter-model
93D feature pipeline: training scripts (`scripts/model_training/`),
data-preparation scripts (`scripts/data_preparation/`), tests (`tests/`),
and the desktop prototype (`asl-desktop/`) all consume this function.

The browser runtime (`asl-web/js/ml/features.js::normalizeHandForLetter`)
implements the same algorithm in JavaScript. Numerical parity is verified
in `tests/validation/check_letter_feature_parity.py` (run by `make parity`).
"""

import numpy as np


def normalize_landmarks(landmarks: np.ndarray, num_landmarks: int = 21) -> np.ndarray:
    """Normalize a flat hand-landmark array for translation and scale.

    Landmark 0 (the wrist) becomes the origin. The wrist-to-middle-finger MCP
    distance then becomes the unit scale, matching the letter training and web
    inference contract.

    Args:
        landmarks: Flat coordinates ordered as
            ``[x0, y0, z0, x1, y1, z1, ...]``.
        num_landmarks: Number of landmarks, normally 21.

    Returns:
        A normalized flat ``float32`` array. Degenerate input produces zeros.
    """
    coords = landmarks.reshape(num_landmarks, 3).copy()

    # Remove translation by placing the wrist at the origin.
    wrist = coords[0].copy()
    coords -= wrist

    # Remove scale using the wrist-to-middle-MCP distance (landmark 9).
    ref_dist = np.linalg.norm(coords[9])
    if ref_dist > 1e-6:
        coords /= ref_dist
    else:
        return np.zeros(num_landmarks * 3, dtype=np.float32)

    return coords.flatten().astype(np.float32)
