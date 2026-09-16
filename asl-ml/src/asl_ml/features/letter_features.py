"""
Feature Engineering — Landmark Ozellik Turetme / Landmark feature extraction
============================================================================
63 ham landmark koordinatindan zenginlestirilmis ozellik vektoru turetir.
Turns 63 raw landmark coordinates into an enriched feature vector.

Bu 93D sira (grup + tanim) DONUK bir sozlesmedir: tarayici (asl-web/js/ml/
features.js) ve egitim ayni sirayi kullanir. Sirayi degistirirsen harf
modeli "farkli bir girdi" gorur ve yanlis tahmin eder.
This 93D layout is a FROZEN contract shared with the browser (features.js)
and training. Reordering it silently breaks the letter model.

Ozellik gruplari / feature groups:
  0. Ham koordinatlar / raw coords                          (63)
  1. Parmak ucu-bilek mesafeleri / fingertip-to-wrist dist  (+5)
  2. Komsu parmak ucu mesafeleri / adjacent fingertip dist  (+4)
  3. Parmak bukume acilari / finger joint angles            (+14)
  4. El bounding box / hand bbox aspect+area                (+2)
  5. Parmak uzatilmislik / finger-extended flags (binary)   (+5)

Toplam / total: ~93 (boyut dinamik hesaplanir, hardcode edilmez)
"""
import numpy as np


# ── MediaPipe landmark indeksleri ──────────────────────
_WRIST = 0
_FINGERTIP_IDS = [4, 8, 12, 16, 20]
_ADJACENT_PAIRS = [(4, 8), (8, 12), (12, 16), (16, 20)]

# Parmak eklem uclulerı (a, b, c) → b noktasindaki aci
_THUMB_ANGLES = [
    (1, 2, 3),   # CMC-MCP-IP
    (2, 3, 4),   # MCP-IP-Tip
]
_INDEX_ANGLES = [
    (0, 5, 6),   # Wrist-MCP-PIP
    (5, 6, 7),   # MCP-PIP-DIP
    (6, 7, 8),   # PIP-DIP-Tip
]
_MIDDLE_ANGLES = [
    (0, 9, 10),  # Wrist-MCP-PIP
    (9, 10, 11), # MCP-PIP-DIP
    (10, 11, 12),# PIP-DIP-Tip
]
_RING_ANGLES = [
    (0, 13, 14), # Wrist-MCP-PIP
    (13, 14, 15),# MCP-PIP-DIP
    (14, 15, 16),# PIP-DIP-Tip
]
_PINKY_ANGLES = [
    (0, 17, 18), # Wrist-MCP-PIP
    (17, 18, 19),# MCP-PIP-DIP
    (18, 19, 20),# PIP-DIP-Tip
]
_ALL_ANGLE_TRIPLETS = (
    _THUMB_ANGLES + _INDEX_ANGLES + _MIDDLE_ANGLES
    + _RING_ANGLES + _PINKY_ANGLES
)  # 2 + 3 + 3 + 3 + 3 = 14 aci

# Parmak uzatilmislik kontrolu icin (tip_id, mcp_id) ciftleri
_FINGER_EXTENDED_PAIRS = [
    (4, 2),   # Basparmak: tip=4, mcp=2
    (8, 5),   # Isaret: tip=8, mcp=5
    (12, 9),  # Orta: tip=12, mcp=9
    (16, 13), # Yuzuk: tip=16, mcp=13
    (20, 17), # Serce: tip=20, mcp=17
]


# ── Yardimci fonksiyonlar ──────────────────────────────

def _angle_between(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Uc nokta arasindaki aciyi radyan olarak hesaplar (b noktasindaki aci)."""
    ba = a - b
    bc = c - b
    norm_ba = np.linalg.norm(ba)
    norm_bc = np.linalg.norm(bc)
    if norm_ba < 1e-8 or norm_bc < 1e-8:
        return 0.0
    cos_angle = np.dot(ba, bc) / (norm_ba * norm_bc)
    return float(np.arccos(np.clip(cos_angle, -1.0, 1.0)))


# ── Ozellik grubu fonksiyonlari ────────────────────────

def _fingertip_wrist_distances(coords: np.ndarray) -> list[float]:
    """5 parmak ucunun bilege olan mesafesi."""
    wrist = coords[_WRIST]
    return [
        float(np.linalg.norm(coords[tip] - wrist))
        for tip in _FINGERTIP_IDS
    ]


def _adjacent_fingertip_distances(coords: np.ndarray) -> list[float]:
    """Komsu parmak uclari arasindaki mesafeler."""
    return [
        float(np.linalg.norm(coords[a] - coords[b]))
        for a, b in _ADJACENT_PAIRS
    ]


def _finger_joint_angles(coords: np.ndarray) -> list[float]:
    """14 parmak eklem acisi (basparmak 2, diger 4 parmak 3'er)."""
    return [
        _angle_between(coords[a], coords[b], coords[c])
        for a, b, c in _ALL_ANGLE_TRIPLETS
    ]


def _hand_bounding_box(coords: np.ndarray) -> list[float]:
    """El bounding box en-boy orani ve normalize alani."""
    xs = coords[:, 0]
    ys = coords[:, 1]
    width = float(xs.max() - xs.min())
    height = float(ys.max() - ys.min())
    aspect_ratio = width / (height + 1e-8)
    area = width * height
    return [aspect_ratio, area]


def _finger_extended_flags(coords: np.ndarray) -> list[float]:
    """Her parmak icin uzatilmis mi (1.0) yoksa kapali mi (0.0)."""
    wrist = coords[_WRIST]
    flags = []
    for tip_id, mcp_id in _FINGER_EXTENDED_PAIRS:
        tip_dist = np.linalg.norm(coords[tip_id] - wrist)
        mcp_dist = np.linalg.norm(coords[mcp_id] - wrist)
        flags.append(1.0 if tip_dist > mcp_dist else 0.0)
    return flags


# ── Ana fonksiyon ──────────────────────────────────────

def extract_features(landmarks_63: np.ndarray) -> np.ndarray:
    """
    63 ham landmark koordinatindan zenginlestirilmis ozellik vektoru turetir.
    Builds the enriched (~93D) feature vector from 63 normalized coordinates.

    Args:
        landmarks_63: (63,) normalize edilmis landmark dizisi / normalized
                      landmark array [x0, y0, z0, x1, y1, z1, ...]

    Returns:
        (~93,) ozellik vektoru / feature vector (boyut dinamik hesaplanir)
    """
    coords = landmarks_63.reshape(21, 3)

    features = []
    # Grup 0: Ham koordinatlar (63)
    features.extend(landmarks_63.tolist())
    # Grup 1: Parmak ucu-bilek mesafeleri (+5)
    features.extend(_fingertip_wrist_distances(coords))
    # Grup 2: Komsu parmak ucu mesafeleri (+4)
    features.extend(_adjacent_fingertip_distances(coords))
    # Grup 3: Parmak bukume acilari (+14)
    features.extend(_finger_joint_angles(coords))
    # Grup 4: El bounding box (+2)
    features.extend(_hand_bounding_box(coords))
    # Grup 5: Parmak uzatilmislik (+5)
    features.extend(_finger_extended_flags(coords))

    result = np.array(features, dtype=np.float32)
    # NaN korumasi: kapali yumruklarda landmark'lar ust uste binebilir
    return np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)
