"""Estimate landmark motion so letter inference can wait for a stable pose."""

import numpy as np

from asl_desktop.config import VELOCITY_THRESHOLD


class MotionTracker:
    """Track mean landmark displacement over a short frame history."""

    def __init__(self, history_size: int = 3, threshold: float = VELOCITY_THRESHOLD):
        """Configure the history window and stability threshold.

        Args:
            history_size: Number of frames retained for the speed estimate.
            threshold: Mean L2 displacement above which the hand is moving.
        """
        self.history_size = history_size
        self.threshold = threshold
        self._history: list[np.ndarray] = []
        self._current_speed: float = 0.0

    def update(self, landmarks: np.ndarray | None) -> bool:
        """Add one frame and report whether inference should remain suppressed.

        Args:
            landmarks: A normalized landmark vector, or ``None``.

        Returns:
            ``True`` while the hand is moving or insufficient history exists.
        """
        if landmarks is None:
            self._history.clear()
            self._current_speed = 0.0
            return True  # Suppress inference when no hand is visible.

        # Letter/word mode changes the vector width from 63D to 321D.
        if self._history and self._history[-1].shape != landmarks.shape:
            self._history.clear()

        self._history.append(landmarks.copy())

        if len(self._history) > self.history_size:
            self._history.pop(0)

        if len(self._history) < self.history_size:
            return True  # Wait for a complete history before accepting a pose.

        # Average the L2 displacement between adjacent frames.
        displacements = []
        for i in range(1, len(self._history)):
            dist = float(np.linalg.norm(self._history[i] - self._history[i - 1]))
            displacements.append(dist)

        self._current_speed = sum(displacements) / len(displacements)

        return self._current_speed > self.threshold

    @property
    def speed(self) -> float:
        """Return the latest displacement estimate for diagnostics."""
        return self._current_speed

    def reset(self) -> None:
        self._history.clear()
        self._current_speed = 0.0
