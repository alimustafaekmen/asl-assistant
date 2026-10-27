"""Word-model sequence features: the Python reference for the 45 x 168 input.

The published word model was trained in ``notebooks/word_50_training.ipynb``.
These functions are its feature code (constants from cell 1,
``normalize_shoulders`` from cell 6, the compact features from cell 10),
kept here so the parity check, the golden fixtures and future training share
one copy. ``tests/asl_features/unit/test_word.py`` runs the notebook's own
functions and requires these to return the same values, so the two cannot
drift apart unnoticed.

Do not edit these to chase a parity difference with the browser: they are the
trained contract. If the contract truly changes, the model in
``models/word/web-50/`` must be retrained first.

A frame is the 321-D holistic layout: right hand ``0..62``, left hand
``63..125``, face ``126..245`` (the 40 points of ``FACE_INDICES``) and pose
``246..320`` (the 25 points of ``POSE_INDICES``).
"""

import numpy as np

FACE_INDICES = [
    61,
    146,
    91,
    181,
    84,
    17,
    314,
    405,
    321,
    375,
    78,
    191,
    80,
    13,
    312,
    308,
    33,
    133,
    159,
    145,
    263,
    362,
    386,
    374,
    70,
    63,
    105,
    66,
    300,
    293,
    334,
    296,
    1,
    2,
    98,
    327,
    168,
    197,
    195,
    5,
]
NUM_FACE = 40
POSE_INDICES = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
]
NUM_POSE = 25
NUM_RIGHT = 21
NUM_LEFT = 21
NUM_TOTAL = (NUM_RIGHT + NUM_LEFT + NUM_FACE + NUM_POSE) * 3  # 321

WRIST = 0
FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_MCPS = [1, 5, 9, 13, 17]
FINGER_PIPS = [2, 6, 10, 14, 18]
FINGER_DIPS = [3, 7, 11, 15, 19]

assert len(FACE_INDICES) == NUM_FACE
assert len(POSE_INDICES) == NUM_POSE
assert NUM_TOTAL == 321


def safe_norm(v, axis=-1):
    return np.maximum(np.linalg.norm(v, axis=axis), 1e-8)


def angle_between_vectors(a, b):
    cos = np.sum(a * b) / (safe_norm(a) * safe_norm(b))
    cos = np.clip(cos, -1.0, 1.0)
    return np.arccos(cos)


def normalize_shoulders(frame_data: np.ndarray) -> np.ndarray:
    """Notebook cell 6 `normalize_shoulders`, verbatim semantics."""
    normalized_frame = frame_data.copy()
    pose_start_index = (NUM_RIGHT + NUM_LEFT + NUM_FACE) * 3
    if 11 in POSE_INDICES and 12 in POSE_INDICES:
        left_shoulder_position = POSE_INDICES.index(11)
        right_shoulder_position = POSE_INDICES.index(12)
        ls = normalized_frame[
            pose_start_index + left_shoulder_position * 3 : pose_start_index
            + left_shoulder_position * 3
            + 3
        ]
        rs = normalized_frame[
            pose_start_index + right_shoulder_position * 3 : pose_start_index
            + right_shoulder_position * 3
            + 3
        ]
        if np.any(ls != 0) and np.any(rs != 0):
            shoulder_center = (ls + rs) / 2.0
            shoulder_width = np.linalg.norm(ls - rs)
            if shoulder_width > 1e-6:
                lm3 = normalized_frame.reshape(-1, 3)
                visible = np.any(lm3 != 0, axis=1)
                lm3[visible] = (lm3[visible] - shoulder_center) / shoulder_width
                return lm3.flatten().astype(np.float32)
    # Notebook fallback: min-max normalization over nonzero values.
    nonzero_values = normalized_frame[normalized_frame != 0]
    if len(nonzero_values) > 0:
        mn, mx = nonzero_values.min(), nonzero_values.max()
        rng = mx - mn
        if rng > 1e-6:
            normalized_frame = np.where(normalized_frame == 0, 0.0, (normalized_frame - mn) / rng)
    return normalized_frame.astype(np.float32)


def compute_per_frame_shape_features(hand_21x3: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_per_frame_shape_features`, verbatim."""
    feats = []
    wrist = hand_21x3[WRIST]
    palm_size = safe_norm(hand_21x3[9] - wrist)
    norm = (hand_21x3 - wrist) / palm_size

    # 5 fingertip distances from wrist
    for tip in FINGER_TIPS:
        feats.append(safe_norm(norm[tip]))
    # 4 adjacent fingertip distances
    for i in range(len(FINGER_TIPS) - 1):
        feats.append(safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[i + 1]]))
    # 10 pairwise fingertip distances
    for i in range(len(FINGER_TIPS)):
        for j in range(i + 1, len(FINGER_TIPS)):
            feats.append(safe_norm(norm[FINGER_TIPS[i]] - norm[FINGER_TIPS[j]]))
    # 5 finger extension flags
    for tip, mcp in zip(FINGER_TIPS, FINGER_MCPS):
        feats.append(1.0 if safe_norm(norm[tip]) > safe_norm(norm[mcp]) else 0.0)
    # 3 PIP-DIP angles (index, middle, ring)
    for fp in [1, 2, 3]:
        v1 = norm[FINGER_MCPS[fp]] - norm[FINGER_PIPS[fp]]
        v2 = norm[FINGER_DIPS[fp]] - norm[FINGER_PIPS[fp]]
        feats.append(angle_between_vectors(v1, v2))
    # 2 bounding box (aspect, area) over visible points
    visible = norm[np.any(norm != 0, axis=1)]
    if len(visible) > 2:
        wh = visible.max(axis=0)[:2] - visible.min(axis=0)[:2]
        feats.append(wh[0] / max(wh[1], 1e-8))
        feats.append(wh[0] * wh[1])
    else:
        feats.extend([0.0, 0.0])
    # 1 average fingertip distance
    feats.append(np.mean([safe_norm(norm[t]) for t in FINGER_TIPS]))
    return np.array(feats, dtype=np.float32)


def compute_dominant_hand_features(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_dominant_hand_features`, sequence level.

    The notebook decides which hand is dominant over the entire sequence
    by averaging zero-fraction across all T frames, and mirrors a left hand
    by negating its x. The browser chooses once per recording in the same
    way (``computeDominantHandSequence``); the word parity check covers a
    recording where the hand switches sides.
    """
    right_hand = seq_321d[:, :63]
    left_hand = seq_321d[:, 63:126]
    right_zero = (right_hand == 0).mean()
    left_zero = (left_hand == 0).mean()
    if right_zero <= left_zero:
        return right_hand
    mirrored = left_hand.copy()
    mirrored[:, 0::3] = -mirrored[:, 0::3]
    return mirrored


def compute_hand_body_relations(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `compute_hand_body_relations`, verbatim.

    Per frame: for each hand (right, left) compute 6 distances/relations
    to face anchors (nose=FACE 1, mouth=FACE 13, forehead=FACE 168).
    """
    T = seq_321d.shape[0]
    out = np.zeros((T, 12), dtype=np.float32)
    face_start = 126
    nose_idx = FACE_INDICES.index(1) if 1 in FACE_INDICES else 0
    mouth_idx = FACE_INDICES.index(13) if 13 in FACE_INDICES else 5
    forehead_idx = FACE_INDICES.index(168) if 168 in FACE_INDICES else 10
    for t in range(T):
        for h in range(2):
            hs = h * 63
            wrist = seq_321d[t, hs : hs + 3]
            tip = seq_321d[t, hs + 8 * 3 : hs + 8 * 3 + 3]
            nose = seq_321d[t, face_start + nose_idx * 3 : face_start + nose_idx * 3 + 3]
            mouth = seq_321d[t, face_start + mouth_idx * 3 : face_start + mouth_idx * 3 + 3]
            forehead = seq_321d[
                t, face_start + forehead_idx * 3 : face_start + forehead_idx * 3 + 3
            ]
            fs = h * 6
            out[t, fs + 0] = safe_norm(tip - nose)
            out[t, fs + 1] = safe_norm(tip - mouth)
            out[t, fs + 2] = safe_norm(tip - forehead)
            out[t, fs + 3] = safe_norm(wrist - nose)
            out[t, fs + 4] = (tip[1] - nose[1]) if len(tip) >= 2 else 0.0
            out[t, fs + 5] = safe_norm(tip - wrist)
    return out


def build_compact_features(seq_321d: np.ndarray) -> np.ndarray:
    """Notebook cell 10 `build_compact_features`, verbatim.

    Output (T, 168):
      [0..62]    dominant hand 63D (sequence-level mirror if needed)
      [63..92]   per-frame shape  30D (computed on dominant hand)
      [93..104]  hand-body        12D (uses raw seq_321d both hands)
      [105..167] dominant motion  63D (dom_t - dom_{t-1}, first frame=0)
    """
    T = seq_321d.shape[0]
    dom = compute_dominant_hand_features(seq_321d)
    dom3 = dom.reshape(T, 21, 3)
    shape = np.array([compute_per_frame_shape_features(dom3[t]) for t in range(T)])
    rel = compute_hand_body_relations(seq_321d)
    motion = np.zeros_like(dom)
    motion[1:] = dom[1:] - dom[:-1]
    out = np.hstack([dom, shape, rel, motion])
    assert out.shape[1] == 168, f"compact dim 168 expected, got {out.shape[1]}"
    return out.astype(np.float32)
