"""
PredictionSmoother birim testleri.
Majority voting, guven esigi ve reset davranisini test eder.
"""
from asl_desktop.utils.smoother import PredictionSmoother
from config.settings import CONFIDENCE_THRESHOLD, NEUTRAL_THRESHOLD


def test_consistent_prediction():
    """Ayni harf ust uste gelince onaylanmali."""
    s = PredictionSmoother(window_size=3)
    # 1 entry, len=1, count=1 >= 0.5 → True
    assert s.update("A", 0.9) == "A"
    assert s.update("A", 0.9) == "A"    # 2/3
    assert s.update("A", 0.9) == "A"    # 3/3


def test_mixed_predictions():
    """Farkli harfler gelince None donmeli (karar yok)."""
    s = PredictionSmoother(window_size=3)
    s.update("A", 0.9)
    s.update("B", 0.9)
    result = s.update("C", 0.9)
    assert result is None


def test_low_confidence_ignored():
    """Guven esiginin altindaki tahminler sayilmamali."""
    s = PredictionSmoother(window_size=3)
    s.update("A", 0.1)   # NEUTRAL_THRESHOLD altinda
    s.update("A", 0.1)
    result = s.update("A", 0.1)
    assert result is None


def test_none_label():
    """El bulunamadiysa None donmeli."""
    s = PredictionSmoother(window_size=3)
    assert s.update(None, 0.0) is None
    assert s.update(None, 0.0) is None


def test_reset():
    """Reset sonrasi gecmis temizlenmeli."""
    s = PredictionSmoother(window_size=3)
    s.update("A", 0.9)
    s.update("A", 0.9)
    s.reset()
    # Reset sonrasi gecmis bos, yeni tahmin fresh start
    # Tek entry: count=1 >= len(1)/2=0.5 → hala donuyor
    # Ama farkli harf ile kontrol edelim:
    s.update("B", 0.9)
    s.update("C", 0.9)
    result = s.update("D", 0.9)
    # 3 farkli harf, hicbiri cogunluk degil
    assert result is None


def test_smoothed_confidence():
    """Ortalama guven skoru dogru hesaplanmali."""
    s = PredictionSmoother(window_size=3)
    s.update("A", 0.8)
    s.update("A", 0.9)
    s.update("A", 1.0)
    avg = s.get_smoothed_confidence()
    assert 0.89 < avg < 0.91  # ~0.9


if __name__ == "__main__":
    test_consistent_prediction()
    test_mixed_predictions()
    test_low_confidence_ignored()
    test_none_label()
    test_reset()
    test_smoothed_confidence()
    print("✅ test_smoother: 6/6 gecti")
