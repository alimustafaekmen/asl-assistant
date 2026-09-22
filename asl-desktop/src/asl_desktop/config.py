"""Configuration for the legacy Python desktop application.

Only desktop runtime, UI, and desktop-specific training values belong here.
Shared landmark and label contracts live in :mod:`asl_ml.config`; browser
runtime values remain in ``asl-web/js/core/config.js``.
"""

import os
from pathlib import Path

try:
    import torch
except ImportError:  # Lightweight tooling may import this module without torch.
    torch = None


# ---------------------------------------------------------------------------
# Repository and desktop artifact paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = str(Path(__file__).resolve().parents[3])
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
DYNAMIC_DATA_DIR = os.path.join(DATA_DIR, "raw", "dynamic")
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")
LETTER_MODEL_DIR = os.path.join(MODELS_DIR, "letter")
JZ_MODEL_DIR = os.path.join(LETTER_MODEL_DIR, "dynamic_jz")
DESKTOP_WORD_MODEL_DIR = os.path.join(MODELS_DIR, "word", "desktop-25")
REFERENCE_DIR = os.path.join(DATA_DIR, "reference")
ASSET_SIGNS_DIR = os.path.join(PROJECT_ROOT, "asl-web", "assets", "signs")

LETTER_MODEL_PATH = os.path.join(LETTER_MODEL_DIR, "letter_model.pkl")
LETTER_LABEL_MAP_PATH = os.path.join(LETTER_MODEL_DIR, "letter_label_map.json")
JZ_MODEL_PATH = os.path.join(JZ_MODEL_DIR, "jz_model.pt")
JZ_LABEL_MAP_PATH = os.path.join(JZ_MODEL_DIR, "jz_label_map.json")
WORD_MODEL_PATH = os.path.join(DESKTOP_WORD_MODEL_DIR, "word_model.pt")
WORD_LABEL_MAP_PATH = os.path.join(DESKTOP_WORD_MODEL_DIR, "word_labels.json")


# ---------------------------------------------------------------------------
# Compute device
# ---------------------------------------------------------------------------


def get_torch_device():
    """Select the best available PyTorch device, falling back to CPU."""
    if torch is None:
        return "cpu"
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


DEVICE = get_torch_device()


# ---------------------------------------------------------------------------
# Camera, MediaPipe, and recording
# ---------------------------------------------------------------------------

CAMERA_INDEX = 0
CAMERA_WIDTH = 1280
CAMERA_HEIGHT = 720
TARGET_FPS = 30
CAMERA_WARN_THRESHOLD = 30
CAMERA_STOP_THRESHOLD = 150
LANDMARK_QUALITY_THRESHOLD = 0.75
HOLISTIC_MODEL_COMPLEXITY = 1


# ---------------------------------------------------------------------------
# Desktop prediction and sequence behavior
# ---------------------------------------------------------------------------

PREDICTION_SMOOTHING_WINDOW = 5
CONFIDENCE_THRESHOLD = 0.78
LETTER_CONFIDENCE_THRESHOLD = 0.55
NEUTRAL_THRESHOLD = 0.2
WORD_STRIDE = 10
WORD_IDLE_RESET_FRAMES = 15
DWELL_THRESHOLD = 20

MOTION_VARIANCE_THRESHOLD = 0.003
ENTROPY_THRESHOLD = 0.85
ENTROPY_PENALTY = 0.5
VELOCITY_THRESHOLD = 0.05

KNN_THRESHOLD = 0.94
KNN_MAX_TEMPLATES = 50


# ---------------------------------------------------------------------------
# Text-to-speech and coach behavior
# ---------------------------------------------------------------------------

TTS_RATE = 150
TTS_VOLUME = 0.9
TTS_JOIN_TIMEOUT = 2.0

FEEDBACK_DELAY = 1.5
COACH_SUCCESS_THRESHOLD = 0.65
WORD_COACH_SUCCESS_THRESHOLD = 0.50
COACH_SUCCESS_FRAMES = 60


# ---------------------------------------------------------------------------
# Desktop sequence models and reserved J/Z training
# ---------------------------------------------------------------------------

SEQUENCE_LENGTH = 30
LSTM_HIDDEN_SIZE = 128
LSTM_NUM_LAYERS = 2
LSTM_DROPOUT = 0.3

TRAIN_BATCH_SIZE = 32
TRAIN_EPOCHS = 50
TRAIN_LR = 0.001
EARLY_STOPPING_PATIENCE = 10


# ---------------------------------------------------------------------------
# Desktop interface
# ---------------------------------------------------------------------------

WINDOW_WIDTH = 1360
WINDOW_HEIGHT = 900
THEME = "dark-blue"

COLOR_PRIMARY = "#4d8eff"
COLOR_PRIMARY_HOVER = "#3a7eff"
COLOR_SUCCESS = "#4ae176"
COLOR_WARNING = "#ff9f0a"
COLOR_ERROR = "#ffb4ab"
COLOR_PURPLE = "#571bc1"
COLOR_PURPLE_HOVER = "#6b33d4"
COLOR_PURPLE_TEXT = "#d0bcff"

COLOR_BG_BASE = "#131316"
COLOR_BG_CARD = "#1f1f22"
COLOR_BG_ELEVATED = "#2a2a2d"
COLOR_BG_HOVER = "#353438"
COLOR_BORDER = "#2c2c2c"

COLOR_TEXT_PRIMARY = "#e4e1e6"
COLOR_TEXT_SECONDARY = "#c2c6d6"
COLOR_TEXT_TERTIARY = "#8c909f"
COLOR_TEXT_MUTED = "#5c5f6e"

FONT_FAMILY = "Inter"
PREDICTION_FONT_SIZE = 72
PREDICTION_FONT_SIZE_WORD = 48

BG_BASE = ("#f8f9fc", COLOR_BG_BASE)
BG_CARD = ("#ffffff", COLOR_BG_CARD)
BG_ELEVATED = ("#ecedf2", COLOR_BG_ELEVATED)
BG_HOVER = ("#dcdde5", COLOR_BG_HOVER)
BG_LOWEST = ("#f0f1f6", "#0e0e11")

TEXT_PRIMARY = ("#1a1a2e", COLOR_TEXT_PRIMARY)
TEXT_SECONDARY = ("#2d2d44", COLOR_TEXT_SECONDARY)
TEXT_TERTIARY = ("#5a5a7a", COLOR_TEXT_TERTIARY)
TEXT_MUTED = ("#8e8ea0", COLOR_TEXT_MUTED)

ACCENT_SUCCESS = ("#1a8f3c", COLOR_SUCCESS)
ACCENT_WARNING = ("#c47a00", COLOR_WARNING)
ACCENT_ERROR = ("#c62828", COLOR_ERROR)
ACCENT_PRIMARY = ("#1a5cd6", COLOR_PRIMARY)
ACCENT_PURPLE = ("#7c3aed", COLOR_PURPLE)
BORDER = ("#d0d1d9", COLOR_BORDER)


# Keep this order aligned with models/word/desktop-25/word_labels.json.
DEFAULT_WORDS = [
    "bye",
    "child",
    "dad",
    "drink",
    "finish",
    "food",
    "give",
    "go",
    "happy",
    "hello",
    "home",
    "hungry",
    "look",
    "mom",
    "no",
    "open",
    "please",
    "sad",
    "sick",
    "sleep",
    "talk",
    "thankyou",
    "wait",
    "water",
    "yes",
]
