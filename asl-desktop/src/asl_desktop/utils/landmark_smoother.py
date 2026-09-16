"""
Temporal Landmark Smoothing — EMA Filtresi
==========================================
Frame-to-frame landmark jitter'ini azaltmak icin
Exponential Moving Average (EMA) uygular.

Canli kamera kullaniminda MediaPipe landmark'lari frame'ler
arasinda titresebilir. EMA bu titresimi yumusatarak modele
daha temiz girdi saglar.
"""
import numpy as np


class LandmarkSmoother:
    """Exponential Moving Average tabanli landmark yumusatici."""

    def __init__(self, alpha: float = 0.6):
        """
        Args:
            alpha: Yumusatma katsayisi (0-1).
                   1.0 = yumusatma yok (ham deger),
                   0.0 = sadece gecmis (cok yavas tepki).
                   0.5-0.7 arasi iyi bir denge saglar.
        """
        self.alpha = alpha
        self._prev: np.ndarray | None = None

    def smooth(self, landmarks: np.ndarray) -> np.ndarray:
        """
        Yeni landmark vektorune EMA uygular.

        Args:
            landmarks: (63,) veya (N,) normalize edilmis landmark dizisi

        Returns:
            Yumusatilmis landmark dizisi (ayni boyut)
        """
        if self._prev is None or self._prev.shape != landmarks.shape:
            self._prev = landmarks.copy()
            return landmarks

        smoothed = self.alpha * landmarks + (1.0 - self.alpha) * self._prev
        self._prev = smoothed.copy()
        return smoothed

    def reset(self):
        """Onceki durumu sifirlar (el kaybolunca cagrilmali)."""
        self._prev = None
