"""
Hareket Algilayici (Motion Tracker)
===================================
Iki frame arasindaki el hareketinin hizini (velocity) hesaplar.
El sabitlendiginde tahmin yapilmasini saglayarak "hareket bulanikligini" omler.
"""
import numpy as np

from config.settings import VELOCITY_THRESHOLD


class MotionTracker:
    """
    Landmark koordinatlarinin zamansal degisimini (hizini) takip eder.
    El ivmeli hareket ediyorsa (geçiş) True, sabit pozisyondaysa False döner.
    """
    def __init__(self, history_size: int = 3, threshold: float = VELOCITY_THRESHOLD):
        """
        Args:
            history_size: Hiz hesabi icin tutulacak frame sayisi.
            threshold: Sabit/Hareketli ayrimini yapan hiz esigi.
                       (L2 norm cinsinden, normalize edilmis uzayda)
        """
        self.history_size = history_size
        self.threshold = threshold
        self._history: list[np.ndarray] = []
        self._current_speed: float = 0.0

    def update(self, landmarks: np.ndarray | None) -> bool:
        """
        Yeni frame'i ekler ve elin hareket halinde olup olmadigini dondurur.

        Args:
            landmarks: (63,) shape'li normalize edilmis landmark veya None.

        Returns:
            is_moving: El hareketliyse True (tahminleri sustur),
                       sabitse False (tahmin yap).
        """
        if landmarks is None:
            self._history.clear()
            self._current_speed = 0.0
            return True  # El yoksa hareket halinde kabul et (guvenli)

        # Harf↔Kelime mod geçişinde shape değişir (63D↔321D) → history temizle
        if self._history and self._history[-1].shape != landmarks.shape:
            self._history.clear()

        self._history.append(landmarks.copy())

        if len(self._history) > self.history_size:
            self._history.pop(0)

        if len(self._history) < self.history_size:
            return True  # Yeterli veri yoksa hareket halinde kabul et

        # Ardisik frameler arasi L2 mesafe (hiz/velocity)
        displacements = []
        for i in range(1, len(self._history)):
            dist = float(np.linalg.norm(self._history[i] - self._history[i-1]))
            displacements.append(dist)

        self._current_speed = sum(displacements) / len(displacements)
        
        return self._current_speed > self.threshold

    @property
    def speed(self) -> float:
        """Hesaplanan anlik hiz (debug icin)."""
        return self._current_speed

    def reset(self) -> None:
        self._history.clear()
        self._current_speed = 0.0
