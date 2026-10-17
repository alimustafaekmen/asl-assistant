"""Build the frozen 93D feature vector used by the static-letter model.

Feature order is part of the model contract and must remain aligned with
``asl-web/js/ml/features.js`` and the training pipeline:

1. normalized landmark coordinates (63)
2. fingertip-to-wrist distances (5)
3. adjacent-fingertip distances (4)
4. finger-joint angles (14)
5. hand bounding-box aspect ratio and area (2)
6. binary finger-extension flags (5)
"""

import numpy as np

# MediaPipe hand-landmark indices.
_WRIST = 0
_FINGERTIP_IDS = [4, 8, 12, 16, 20]
_ADJACENT_PAIRS = [(4, 8), (8, 12), (12, 16), (16, 20)]

# Each triplet (a, b, c) measures the angle at joint b.
_THUMB_ANGLES = [
    (1, 2, 3),  # CMC-MCP-IP
    (2, 3, 4),  # MCP-IP-Tip
]
_INDEX_ANGLES = [
    (0, 5, 6),  # Wrist-MCP-PIP
    (5, 6, 7),  # MCP-PIP-DIP
    (6, 7, 8),  # PIP-DIP-Tip
]
_MIDDLE_ANGLES = [
    (0, 9, 10),  # Wrist-MCP-PIP
    (9, 10, 11),  # MCP-PIP-DIP
    (10, 11, 12),  # PIP-DIP-Tip
]
_RING_ANGLES = [
    (0, 13, 14),  # Wrist-MCP-PIP
    (13, 14, 15),  # MCP-PIP-DIP
    (14, 15, 16),  # PIP-DIP-Tip
]
_PINKY_ANGLES = [
    (0, 17, 18),  # Wrist-MCP-PIP
    (17, 18, 19),  # MCP-PIP-DIP
    (18, 19, 20),  # PIP-DIP-Tip
]
_ALL_ANGLE_TRIPLETS = (
    _THUMB_ANGLES + _INDEX_ANGLES + _MIDDLE_ANGLES + _RING_ANGLES + _PINKY_ANGLES
)  # 2 + 3 + 3 + 3 + 3 = 14 angles.

# Fingertip and MCP pairs used by the extension heuristic.
_FINGER_EXTENDED_PAIRS = [
    (4, 2),  # Thumb.
    (8, 5),  # Index finger.
    (12, 9),  # Middle finger.
    (16, 13),  # Ring finger.
    (20, 17),  # Little finger.
]


def _angle_between(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Return the angle at point ``b`` in radians."""
    ba = a - b
    bc = c - b
    norm_ba = np.linalg.norm(ba)
    norm_bc = np.linalg.norm(bc)
    if norm_ba < 1e-8 or norm_bc < 1e-8:
        return 0.0
    cos_angle = np.dot(ba, bc) / (norm_ba * norm_bc)
    return float(np.arccos(np.clip(cos_angle, -1.0, 1.0)))


def _fingertip_wrist_distances(coords: np.ndarray) -> list[float]:
    """Return the five fingertip-to-wrist distances."""
    wrist = coords[_WRIST]
    return [float(np.linalg.norm(coords[tip] - wrist)) for tip in _FINGERTIP_IDS]


def _adjacent_fingertip_distances(coords: np.ndarray) -> list[float]:
    """Return distances between adjacent fingertips."""
    return [float(np.linalg.norm(coords[a] - coords[b])) for a, b in _ADJACENT_PAIRS]


def _finger_joint_angles(coords: np.ndarray) -> list[float]:
    """Return 14 joint angles: two for the thumb and three per other finger."""
    return [_angle_between(coords[a], coords[b], coords[c]) for a, b, c in _ALL_ANGLE_TRIPLETS]


def _hand_bounding_box(coords: np.ndarray) -> list[float]:
    """Return the hand bounding box's aspect ratio and area."""
    xs = coords[:, 0]
    ys = coords[:, 1]
    width = float(xs.max() - xs.min())
    height = float(ys.max() - ys.min())
    aspect_ratio = width / (height + 1e-8)
    area = width * height
    return [aspect_ratio, area]


def _finger_extended_flags(coords: np.ndarray) -> list[float]:
    """Return one binary extension flag per finger."""
    wrist = coords[_WRIST]
    flags = []
    for tip_id, mcp_id in _FINGER_EXTENDED_PAIRS:
        tip_dist = np.linalg.norm(coords[tip_id] - wrist)
        mcp_dist = np.linalg.norm(coords[mcp_id] - wrist)
        flags.append(1.0 if tip_dist > mcp_dist else 0.0)
    return flags


def extract_features(landmarks_63: np.ndarray) -> np.ndarray:
    """Build the 93D model input from 63 normalized coordinates.

    Args:
        landmarks_63: Flat ``(63,)`` array ordered as
            ``[x0, y0, z0, x1, y1, z1, ...]``.

    Returns:
        The frozen ``(93,)`` static-letter feature vector.
    """
    coords = landmarks_63.reshape(21, 3)

    features = []
    # Group 0: normalized coordinates (63).
    features.extend(landmarks_63.tolist())
    # Group 1: fingertip-to-wrist distances (+5).
    features.extend(_fingertip_wrist_distances(coords))
    # Group 2: adjacent-fingertip distances (+4).
    features.extend(_adjacent_fingertip_distances(coords))
    # Group 3: joint angles (+14).
    features.extend(_finger_joint_angles(coords))
    # Group 4: hand bounding-box features (+2).
    features.extend(_hand_bounding_box(coords))
    # Group 5: finger-extension flags (+5).
    features.extend(_finger_extended_flags(coords))

    result = np.array(features, dtype=np.float32)
    # Degenerate poses can produce zero distances or overlapping landmarks.
    return np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)
