"""MediaPipe hand detection for the desktop letter pipeline.

The detector extracts and normalizes one 21-landmark hand, applies temporal
smoothing, and can draw the detected landmarks on the input frame.
"""

import logging

import cv2
import mediapipe as mp
import numpy as np
from asl_features.config import MIN_DETECTION_CONFIDENCE, MIN_TRACKING_CONFIDENCE, NUM_HANDS
from asl_features.landmarks import normalize_landmarks, to_square_units

from asl_desktop.config import LANDMARK_QUALITY_THRESHOLD
from asl_desktop.utils.landmark_smoother import LandmarkSmoother

_logger = logging.getLogger("ASL.HandDetector")


class HandDetector:
    """MediaPipe Hands with smoothing and an idempotent ``close``.

    Example:
        with HandDetector() as det:
            keypoints, frame = det.detect_and_draw(frame)
    """

    def __init__(self, static_mode: bool = False, smoothing_alpha: float = 0.6):
        self.mp_hands = mp.solutions.hands
        self.mp_draw = mp.solutions.drawing_utils
        self.hands = self.mp_hands.Hands(
            static_image_mode=static_mode,
            max_num_hands=NUM_HANDS,
            min_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
        )
        self._last_results = None
        self._smoother = LandmarkSmoother(alpha=smoothing_alpha)

    def detect(self, frame: np.ndarray) -> np.ndarray | None:
        """Return a normalized ``(63,)`` vector, or ``None`` when no hand is usable."""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        self._last_results = self.hands.process(rgb)

        if self._last_results.multi_hand_landmarks:
            # Reject low-confidence detections before smoothing them into state.
            handedness_score = 1.0
            if self._last_results.multi_handedness:
                handedness_score = self._last_results.multi_handedness[0].classification[0].score
            if handedness_score < LANDMARK_QUALITY_THRESHOLD:
                self._smoother.reset()
                return None

            lms = []
            for lm in self._last_results.multi_hand_landmarks[0].landmark:
                lms.extend([lm.x, lm.y, lm.z])
            # The letter model was trained on square photographs; a webcam
            # frame is not square, so the hand is put back into square units.
            height, width = frame.shape[:2]
            square = to_square_units(np.array(lms, dtype=np.float32), width, height)
            normalized = normalize_landmarks(square)
            if normalized is not None and not np.all(normalized == 0):
                return self._smoother.smooth(normalized)
            return normalized
        self._smoother.reset()
        return None

    def draw_landmarks(self, frame: np.ndarray) -> np.ndarray:
        """Draw landmarks produced by the most recent ``detect`` call."""
        if self._last_results and self._last_results.multi_hand_landmarks:
            for h in self._last_results.multi_hand_landmarks:
                self.mp_draw.draw_landmarks(
                    frame,
                    h,
                    self.mp_hands.HAND_CONNECTIONS,
                    self.mp_draw.DrawingSpec(color=(0, 220, 100), thickness=2, circle_radius=3),
                    self.mp_draw.DrawingSpec(color=(255, 255, 255), thickness=1),
                )
        return frame

    def detect_and_draw(self, frame: np.ndarray) -> tuple[np.ndarray | None, np.ndarray]:
        """Extract keypoints and draw their overlay in one call."""
        keypoints = self.detect(frame)
        frame = self.draw_landmarks(frame)
        return keypoints, frame

    @property
    def hand_detected(self) -> bool:
        return (
            self._last_results is not None and self._last_results.multi_hand_landmarks is not None
        )

    def close(self) -> None:
        if hasattr(self, "hands") and self.hands is not None:
            try:
                self.hands.close()
            except Exception as exc:
                # Closing is idempotent from the caller's perspective; MediaPipe
                # may already have released its native resources.
                _logger.debug("HandDetector.close() ignored: %s", exc)
            self.hands = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
