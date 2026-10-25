"""Landmark normalization helpers.

This is the single source of truth for the letter model's landmark step:
training (`scripts/model_training/`), data preparation
(`scripts/data_preparation/`), the tests and the desktop prototype
(`asl-desktop/`) all call it.

The browser runtime (`asl-web/js/ml/features.js::normalizeHandForLetter`)
implements the same algorithm in JavaScript. Numerical parity is verified
in `tests/validation/check_letter_feature_parity.py` (run by `make test`).
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

    wrist = coords[0].copy()
    coords -= wrist

    # Landmark 9 is the middle-finger MCP.
    ref_dist = np.linalg.norm(coords[9])
    if ref_dist > 1e-6:
        coords /= ref_dist
    else:
        return np.zeros(num_landmarks * 3, dtype=np.float32)

    return coords.flatten().astype(np.float32)


def to_square_units(landmarks: np.ndarray, width: float, height: float) -> np.ndarray:
    """Put a hand from a ``width`` by ``height`` frame into square units.

    MediaPipe reports x as a fraction of the frame's width and y of its
    height, so in a 640 by 480 or 1280 by 720 camera frame a hand comes out
    squeezed sideways. The letter model was trained on square photographs,
    where both are fractions of the same length. Multiplying x and z by the
    frame's width over its height restores the hand's shape; z is on the scale
    of x. The browser applies the same step (``computeLetterFeatures`` in
    ``asl-web/js/ml/features.js``).

    Args:
        landmarks: Flat coordinates ``[x0, y0, z0, x1, ...]`` as MediaPipe
            gives them for one hand.
        width: Frame width in pixels.
        height: Frame height in pixels.

    Returns:
        A rescaled ``float32`` copy, or ``landmarks`` itself when the frame is
        square or its size is unknown.
    """
    if not (width > 0 and height > 0) or width == height:
        return landmarks
    coords = np.asarray(landmarks, dtype=np.float32).reshape(-1, 3).copy()
    aspect = width / height
    coords[:, 0] *= aspect
    coords[:, 2] *= aspect
    return coords.reshape(-1)
