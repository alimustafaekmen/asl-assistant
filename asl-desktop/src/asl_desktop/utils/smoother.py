"""Sliding-window majority vote for stabilizing frame-level predictions."""

from collections import Counter, deque

from asl_desktop.config import (
    CONFIDENCE_THRESHOLD,
    NEUTRAL_THRESHOLD,
    PREDICTION_SMOOTHING_WINDOW,
)


class PredictionSmoother:
    """Accept a label only when it dominates the recent prediction window.

    Example:
        smoother = PredictionSmoother()
        result = smoother.update("A", 0.92)  # -> "A" veya None
    """

    def __init__(
        self,
        window_size: int = PREDICTION_SMOOTHING_WINDOW,
        confidence_threshold: float | None = None,
    ):
        self.window_size = window_size
        self._threshold = (
            confidence_threshold if confidence_threshold is not None else CONFIDENCE_THRESHOLD
        )
        self._history: deque = deque(maxlen=window_size)
        self._confidence_history: deque = deque(maxlen=window_size)

    def update(self, label: str | None, confidence: float = 1.0) -> str | None:
        """Add one prediction and return the current stable label.

        Returns:
            A stable label, or ``None`` when the window has no decision.
        """
        # Treat a missing or nearly neutral result as an empty vote.
        if label is None or confidence < NEUTRAL_THRESHOLD:
            self._history.append(None)
            self._confidence_history.append(0.0)
            return None

        # Keep sub-threshold confidence for diagnostics without voting on it.
        if confidence < self._threshold:
            self._history.append(None)
            self._confidence_history.append(confidence)
            return None

        self._history.append(label)
        self._confidence_history.append(confidence)

        # Vote only across accepted labels.
        valid = [h for h in self._history if h is not None]
        if not valid:
            return None

        counter = Counter(valid)
        most_common, count = counter.most_common(1)[0]

        # Confirm once the leading label fills at least half of the window.
        if count >= len(self._history) / 2:
            return most_common

        return None

    def get_smoothed_confidence(self) -> float:
        """Return the mean nonzero confidence in the current window."""
        valid = [c for c in self._confidence_history if c > 0]
        return sum(valid) / len(valid) if valid else 0.0

    def reset(self) -> None:
        """Clear all temporal prediction state."""
        self._history.clear()
        self._confidence_history.clear()
