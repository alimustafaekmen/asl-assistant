"""
Harf Siniflandirici (LightGBM / RF / XGBoost) / Static letter classifier.
=========================================================================
Desktop (legacy) harf modeli sarmalayicisi. ONEMLI: aktif web urunu bunu
KULLANMAZ; web kendi ONNX + JS pipeline'ini calistirir
(asl-web/js/ml/letter-model.js). Bu sinif yalnizca masaustu prototip icindir.
Wrapper around the desktop (legacy) letter model. NOTE: the active web app
does NOT use this — it runs its own ONNX + JS pipeline. Desktop prototype only.

- Model yukleme (.pkl) + metadata / load model + check metadata
- Keypoint'ten harf tahmini / predict a letter from keypoints (auto feature eng.)
- Guven skoru + Top-3 / confidence + top-3
- Kisisellestirilmis K-NN kalibrasyon destegi / personalized K-NN calibration
"""
import os
import json
import logging
import numpy as np
import joblib

from asl_ml.utils import load_label_map, invert_label_map
from asl_ml.features.letter_features import extract_features
from config.settings import LETTER_MODEL_PATH, LETTER_LABEL_MAP_PATH
from asl_desktop.services.personalization import PersonalizedKNN


import warnings

_logger = logging.getLogger("ASL.LetterClassifier")

class LetterClassifier:
    """
    Statik harf siniflandirici (A-Y, J/Z haric).

    Model metadata dosyasindan feature engineering gerekip gerekmedigini
    otomatik belirler. Eski (63D) ve yeni (93D) modellerle uyumludur.

    Kullanim:
        clf = LetterClassifier()
        if clf.load():
            harf, guven, top3 = clf.predict(keypoints)
    """

    def __init__(self):
        self.model = None
        self.label_map: dict = {}
        self.inv_label_map: dict = {}
        self._loaded = False
        self._use_features = False
        self.personalized_knn = PersonalizedKNN(threshold=0.94)

    def load(
        self,
        model_path: str = LETTER_MODEL_PATH,
        label_map_path: str = LETTER_LABEL_MAP_PATH,
    ) -> bool:
        """Model, label map ve metadata yukler. True = basarili."""
        if not os.path.exists(model_path):
            _logger.warning("Model bulunamadi: %s", model_path)
            return False
        if not os.path.exists(label_map_path):
            _logger.warning("Label map bulunamadi: %s", label_map_path)
            return False

        self.model = joblib.load(model_path)
        self.label_map = load_label_map(label_map_path)
        self.inv_label_map = invert_label_map(self.label_map)

        meta_path = os.path.splitext(model_path)[0] + "_meta.json"
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            self._use_features = meta.get("feature_engineering", False)
            num_features = meta.get("num_features", 63)
            _logger.info("Harf modeli yuklendi: %d sinif, %dD, FE=%s",
                         len(self.label_map), num_features,
                         'acik' if self._use_features else 'kapali')
        else:
            self._use_features = False
            try:
                test_input = np.zeros(63, dtype=np.float32).reshape(1, -1)
                self.model.predict(test_input)
                _logger.info("Harf modeli yuklendi: %d sinif (metadata yok, 63D)", len(self.label_map))
            except Exception:
                self._use_features = True
                _logger.info("Harf modeli yuklendi: %d sinif (metadata yok, FE=acik varsayildi)", len(self.label_map))

        self._loaded = True
        return True

    def predict(
        self, keypoints: np.ndarray
    ) -> tuple[str, float, list[tuple[str, float]]]:
        """
        Keypoint'lerden harf tahmini yapar.

        Args:
            keypoints: (63,) normalize edilmis landmark dizisi

        Returns:
            (tahmin_edilen_harf, guven_skoru, top3_listesi)
        """
        if not self._loaded:
            return ("?", 0.0, [])

        if self._use_features:
            X = extract_features(keypoints).reshape(1, -1)
        else:
            X = keypoints.reshape(1, -1)

        # 1. Once K-NN (Kisisellestirilmis) modele sor
        pers_result = self.personalized_knn.predict(X)
        if pers_result:
            pers_label, pers_conf = pers_result
            # Kullaniciya ozel sablon esiği gectiyse %100 guvenle dondur
            return (pers_label, pers_conf, [(pers_label, pers_conf), ("(KNN)", 0.0)])

        # 2. Base Model Fallback (LightGBM/RF)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=UserWarning)
            probs = self.model.predict_proba(X)[0]
        top_indices = np.argsort(probs)[::-1][:3]

        predicted_idx = top_indices[0]
        confidence = float(probs[predicted_idx])
        label = self.inv_label_map.get(predicted_idx, "?")

        top3 = [
            (self.inv_label_map.get(idx, "?"), float(probs[idx]))
            for idx in top_indices
        ]

        return (label, confidence, top3)

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def num_classes(self) -> int:
        return len(self.label_map) if self._loaded else 0

    def calibrate(self, letter: str, keypoints: np.ndarray) -> None:
        """
        Kullanicinin anlik el pozisyonunu K-NN sablon havuzuna kaydeder.
        app.py kalibrasyon modundan cagrilir.

        Args:
            letter: Hedef harf (orn: 'A')
            keypoints: (63,) normalize edilmis landmark dizisi
        """
        if self._use_features:
            features = extract_features(keypoints)
        else:
            features = keypoints
        self.personalized_knn.record_template(letter, features)
