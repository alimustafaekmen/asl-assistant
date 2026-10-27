"""Shared Python-side ML contracts and preprocessing defaults.

This module contains values that must agree across data preparation, model
training, Python inference, and parity tests. It deliberately contains no UI
settings, camera lifecycle policy, repository paths, or browser configuration.
The browser keeps its independent JavaScript contract under ``asl-web/``.
"""

# MediaPipe hand-landmark contract shared by extraction and Python inference.
NUM_HANDS = 1
MIN_DETECTION_CONFIDENCE = 0.5
# Desktop detectors and the MS-ASL extractor only; the web word model was
# trained on the Kaggle competition's own landmarks.
MIN_TRACKING_CONFIDENCE = 0.4
NUM_LANDMARKS = 21
HAND_LANDMARK_DIM = NUM_LANDMARKS * 3

# The published letter classifier contains 24 static classes. J and Z remain
# separate because they require motion; no trained J/Z artifact is published.
STATIC_LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")
DYNAMIC_LETTERS = ["J", "Z"]

# Static-letter training augmentation defaults.
AUGMENTATION_NOISE_STD = 0.02
AUGMENTATION_ROTATION_RANGE = 45
AUGMENTATION_MULTIPLIER = 5
AUGMENTATION_SCALE_RANGE = 0.2
