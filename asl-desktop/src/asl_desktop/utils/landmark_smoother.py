"""Exponential moving average for reducing frame-to-frame landmark jitter."""

import numpy as np


class LandmarkSmoother:
    """Maintain an exponential moving average of a landmark vector."""

    def __init__(self, alpha: float = 0.6):
        """Configure the smoothing response.

        Args:
            alpha: Weight of the current frame in the range 0-1. A value of
                ``1.0`` disables smoothing; lower values respond more slowly.
        """
        self.alpha = alpha
        self._prev: np.ndarray | None = None

    def smooth(self, landmarks: np.ndarray) -> np.ndarray:
        """Apply the moving average to one landmark vector.

        Args:
            landmarks: A normalized one-dimensional landmark vector.

        Returns:
            A smoothed vector with the same shape.
        """
        if self._prev is None or self._prev.shape != landmarks.shape:
            self._prev = landmarks.copy()
            return landmarks

        smoothed = self.alpha * landmarks + (1.0 - self.alpha) * self._prev
        self._prev = smoothed.copy()
        return smoothed

    def reset(self):
        """Forget temporal state, for example after the hand disappears."""
        self._prev = None
