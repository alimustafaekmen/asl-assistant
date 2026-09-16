"""
Tahmin Yumusatma — Majority Voting
===================================
Her frame'de model farkli harf tahmin edebilir (titresme).
Bu modul son N frame uzerinden en sik olan tahmini secer.
"""
from collections import deque, Counter

from config.settings import (
    PREDICTION_SMOOTHING_WINDOW,
    CONFIDENCE_THRESHOLD,
    NEUTRAL_THRESHOLD,
)


class PredictionSmoother:
    """
    Sliding window majority voting ile tahmin kararliligi saglar.

    Kullanim:
        smoother = PredictionSmoother()
        result = smoother.update("A", 0.92)  # -> "A" veya None
    """

    def __init__(self, window_size: int = PREDICTION_SMOOTHING_WINDOW,
                 confidence_threshold: float | None = None):
        self.window_size = window_size
        self._threshold = confidence_threshold if confidence_threshold is not None else CONFIDENCE_THRESHOLD
        self._history: deque = deque(maxlen=window_size)
        self._confidence_history: deque = deque(maxlen=window_size)

    def update(self, label: str | None, confidence: float = 1.0) -> str | None:
        """
        Yeni tahmin ekler ve yumusatilmis sonucu dondurur.

        Returns:
            Yumusatilmis etiket veya None (karar verilemedi)
        """
        # El bulunamadi veya guven cok dusuk
        if label is None or confidence < NEUTRAL_THRESHOLD:
            self._history.append(None)
            self._confidence_history.append(0.0)
            return None

        # Guven esiginin altinda
        if confidence < self._threshold:
            self._history.append(None)
            self._confidence_history.append(confidence)
            return None

        self._history.append(label)
        self._confidence_history.append(confidence)

        # Majority voting
        valid = [h for h in self._history if h is not None]
        if not valid:
            return None

        counter = Counter(valid)
        most_common, count = counter.most_common(1)[0]

        # Window'un yarisindan fazlasi ayni label ise onay
        if count >= len(self._history) / 2:
            return most_common

        return None

    def get_smoothed_confidence(self) -> float:
        """Son window'un ortalama guven skoru."""
        valid = [c for c in self._confidence_history if c > 0]
        return sum(valid) / len(valid) if valid else 0.0

    def reset(self) -> None:
        """Gecmis tahminleri temizler."""
        self._history.clear()
        self._confidence_history.clear()
