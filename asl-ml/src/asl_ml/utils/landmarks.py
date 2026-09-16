"""Landmark normalization helpers.

Originally located at `src/utils.py::normalize_landmarks` (asl-desktop legacy).
Moved here because this is the SINGLE SOURCE OF TRUTH for the letter-model
93D feature pipeline: training scripts (`scripts/model_training/`),
data-preparation scripts (`scripts/data_preparation/`), tests (`tests/`),
and the desktop prototype (`asl-desktop/`) all consume this function.

The browser runtime (`asl-web/js/ml/features.js::normalizeHandForLetter`)
implements the same algorithm in JavaScript. Numerical parity is verified
in `scripts/validation/check_runtime_assets.py`.
"""
import numpy as np


def normalize_landmarks(landmarks: np.ndarray, num_landmarks: int = 21) -> np.ndarray:
    """
    21 el landmark'ini (63 deger) bilege gore normalize eder.
    Normalizes 21 hand landmarks (63 values) relative to the wrist.

    MediaPipe koordinatlari elin konumuna ve kameraya uzakligina gore degisir;
    bu fonksiyon ikisini de sabitler ki model her zaman ayni "eli" gorsun:
    MediaPipe coords depend on hand position and camera distance; this pins
    both down so the model always sees the same normalized hand:
      1. Bilek (Landmark 0) orijine cekilir / recenter on the wrist  -> konum bagimsiz
      2. Bilek-orta parmak MCP mesafesine bolunur / scale by that dist -> boyut bagimsiz

    Args:
        landmarks: (63,) [x0, y0, z0, x1, y1, z1, ...] dizisi / array
        num_landmarks: landmark sayisi / count (varsayilan/default 21)

    Returns:
        (63,) normalize edilmis dizi / normalized array
    """
    coords = landmarks.reshape(num_landmarks, 3).copy()

    # 1. Bilege gore oteleme
    wrist = coords[0].copy()
    coords -= wrist

    # 2. Olcekleme: bilek -> orta parmak MCP (Landmark 9) mesafesine gore
    ref_dist = np.linalg.norm(coords[9])
    if ref_dist > 1e-6:
        coords /= ref_dist
    else:
        return np.zeros(num_landmarks * 3, dtype=np.float32)

    return coords.flatten().astype(np.float32)
