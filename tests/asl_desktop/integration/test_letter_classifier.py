"""
LetterClassifier birim testleri.
Gercek model dosyalari mevcutsa yukleme ve tahmin test edilir.
Dosya yoksa testler atlanir (skip).
"""
import os
import numpy as np
import pytest

pytest.importorskip("joblib")

from config.settings import LETTER_MODEL_PATH, LETTER_LABEL_MAP_PATH
from asl_desktop.models.letter_classifier import LetterClassifier

MODEL_EXISTS = os.path.exists(LETTER_MODEL_PATH) and os.path.exists(LETTER_LABEL_MAP_PATH)


def test_load_success():
    """Model dosyalari varsa yukleme basarili olmali."""
    if not MODEL_EXISTS:
        print("  ⏭ Model dosyasi yok, atlandi")
        return
    clf = LetterClassifier()
    if not clf.load():
        pytest.skip("Letter model runtime dependency unavailable")
    assert clf.is_loaded
    assert clf.num_classes == 24


def test_predict_returns_tuple():
    """predict() (label, confidence, top3) donmeli."""
    if not MODEL_EXISTS:
        print("  ⏭ Model dosyasi yok, atlandi")
        return
    clf = LetterClassifier()
    if not clf.load():
        pytest.skip("Letter model runtime dependency unavailable")
    kp = np.random.randn(63).astype(np.float32)
    label, conf, top3 = clf.predict(kp)
    assert isinstance(label, str)
    assert 0.0 <= conf <= 1.0
    assert len(top3) == 3
    assert all(isinstance(l, str) and isinstance(s, float) for l, s in top3)


def test_predict_without_load():
    """Model yuklenmeden predict '?' donmeli."""
    clf = LetterClassifier()
    label, conf, top3 = clf.predict(np.zeros(63))
    assert label == "?"
    assert conf == 0.0
    assert top3 == []


def test_missing_model_path():
    """Var olmayan dosya ile load False donmeli."""
    clf = LetterClassifier()
    result = clf.load(model_path="/tmp/yok.pkl", label_map_path="/tmp/yok.json")
    assert result is False
    assert not clf.is_loaded


if __name__ == "__main__":
    test_load_success()
    test_predict_returns_tuple()
    test_predict_without_load()
    test_missing_model_path()
    print("✅ test_letter_classifier: tamamlandi")
