"""Static-letter classifier for the desktop prototype.

This wrapper loads a scikit-learn-compatible pickle, chooses either the raw
63D landmark vector or the engineered 93D feature vector, and optionally
checks user-recorded K-NN templates before the base model. The primary web
application uses a separate ONNX runtime path.
"""

import json
import logging
import os
import warnings

import joblib
import numpy as np
from asl_features.letter import extract_features

from asl_desktop.config import LETTER_LABEL_MAP_PATH, LETTER_MODEL_PATH
from asl_desktop.services.personalization import PersonalizedKNN

_logger = logging.getLogger("ASL.LetterClassifier")


class LetterClassifier:
    """Classify the 24 supported static letters (A-Y, excluding J and Z).

    Model metadata selects the expected feature contract. If metadata is not
    available, a small compatibility probe distinguishes older 63D models from
    the current 93D feature-engineered model.

    Example:
        clf = LetterClassifier()
        if clf.load():
            letter, confidence, top3 = clf.predict(keypoints)
    """

    def __init__(self):
        self.model = None
        self.label_map: dict = {}
        self.inv_label_map: dict = {}
        self._loaded = False
        self._use_features = False
        self.personalized_knn = PersonalizedKNN()

    def load(
        self,
        model_path: str = LETTER_MODEL_PATH,
        label_map_path: str = LETTER_LABEL_MAP_PATH,
    ) -> bool:
        """Load the model, label map, and optional metadata."""
        if not os.path.exists(model_path):
            _logger.warning("Model bulunamadi: %s", model_path)
            return False
        if not os.path.exists(label_map_path):
            _logger.warning("Label map bulunamadi: %s", label_map_path)
            return False

        self.model = joblib.load(model_path)
        with open(label_map_path, encoding="utf-8") as f:
            self.label_map = json.load(f)
        # Older exports wrote the class index as a string.
        self.inv_label_map = {int(index): label for label, index in self.label_map.items()}

        meta_path = os.path.splitext(model_path)[0] + "_meta.json"
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            self._use_features = meta.get("feature_engineering", False)
            num_features = meta.get("num_features", 63)
            _logger.info(
                "Harf modeli yuklendi: %d sinif, %dD, FE=%s",
                len(self.label_map),
                num_features,
                "acik" if self._use_features else "kapali",
            )
        else:
            self._use_features = False
            try:
                test_input = np.zeros(63, dtype=np.float32).reshape(1, -1)
                self.model.predict(test_input)
                _logger.info(
                    "Harf modeli yuklendi: %d sinif (metadata yok, 63D)", len(self.label_map)
                )
            except Exception:
                self._use_features = True
                _logger.info(
                    "Harf modeli yuklendi: %d sinif (metadata yok, FE=acik varsayildi)",
                    len(self.label_map),
                )

        self._loaded = True
        return True

    def predict(self, keypoints: np.ndarray) -> tuple[str, float, list[tuple[str, float]]]:
        """Predict a letter from a normalized hand-landmark vector.

        Args:
            keypoints: Normalized hand landmarks with shape ``(63,)``.

        Returns:
            A ``(label, confidence, top3)`` tuple.
        """
        if not self._loaded:
            return ("?", 0.0, [])

        if self._use_features:
            X = extract_features(keypoints).reshape(1, -1)
        else:
            X = keypoints.reshape(1, -1)

        # Prefer a high-confidence user template over the shared base model.
        pers_result = self.personalized_knn.predict(X)
        if pers_result:
            pers_label, pers_conf = pers_result
            return (pers_label, pers_conf, [(pers_label, pers_conf), ("(KNN)", 0.0)])

        # Fall back to the shared probabilistic classifier.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=UserWarning)
            probs = self.model.predict_proba(X)[0]
        top_indices = np.argsort(probs)[::-1][:3]

        predicted_idx = top_indices[0]
        confidence = float(probs[predicted_idx])
        label = self.inv_label_map.get(predicted_idx, "?")

        top3 = [(self.inv_label_map.get(idx, "?"), float(probs[idx])) for idx in top_indices]

        return (label, confidence, top3)

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def num_classes(self) -> int:
        return len(self.label_map) if self._loaded else 0

    def calibrate(self, letter: str, keypoints: np.ndarray, *, persist: bool = True) -> None:
        """Add the current hand pose to the user's K-NN template pool.

        Args:
            letter: Target letter, for example ``"A"``.
            keypoints: Normalized hand landmarks with shape ``(63,)``.
        """
        if self._use_features:
            features = extract_features(keypoints)
        else:
            features = keypoints
        self.personalized_knn.record_template(letter, features, persist=persist)

    def save_calibration(self) -> None:
        """Persist all templates collected during a calibration batch."""
        self.personalized_knn.save_templates()
