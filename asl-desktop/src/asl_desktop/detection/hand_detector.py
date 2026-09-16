"""
MediaPipe El Tespiti
====================
- 21 keypoint (63 ozellik) cikarimi
- Otomatik normalizasyon
- Overlay cizimi
- Context manager destegi
"""
import logging

import cv2
import numpy as np
import mediapipe as mp

from asl_ml.utils import normalize_landmarks
from asl_desktop.utils.landmark_smoother import LandmarkSmoother
from config.settings import (
    NUM_HANDS, MIN_DETECTION_CONFIDENCE, MIN_TRACKING_CONFIDENCE,
    LANDMARK_QUALITY_THRESHOLD,
)

_logger = logging.getLogger("ASL.HandDetector")


class HandDetector:
    """
    MediaPipe Hands wrapper.

    Kullanim:
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
        """
        Frame'den normalize edilmis (63,) keypoint dizisi dondurur.
        El bulunamazsa None dondurur.
        """
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        self._last_results = self.hands.process(rgb)

        if self._last_results.multi_hand_landmarks:
            # Quality gate: MediaPipe handedness confidence score kontrolu
            handedness_score = 1.0
            if self._last_results.multi_handedness:
                handedness_score = (
                    self._last_results.multi_handedness[0]
                    .classification[0].score
                )
            if handedness_score < LANDMARK_QUALITY_THRESHOLD:
                self._smoother.reset()
                return None

            lms = []
            for lm in self._last_results.multi_hand_landmarks[0].landmark:
                lms.extend([lm.x, lm.y, lm.z])
            normalized = normalize_landmarks(np.array(lms, dtype=np.float32))
            if normalized is not None and not np.all(normalized == 0):
                return self._smoother.smooth(normalized)
            return normalized
        self._smoother.reset()
        return None

    def draw_landmarks(self, frame: np.ndarray) -> np.ndarray:
        """Son detect() sonuclarini frame uzerine cizer."""
        if self._last_results and self._last_results.multi_hand_landmarks:
            for h in self._last_results.multi_hand_landmarks:
                self.mp_draw.draw_landmarks(
                    frame, h, self.mp_hands.HAND_CONNECTIONS,
                    self.mp_draw.DrawingSpec(color=(0, 220, 100), thickness=2, circle_radius=3),
                    self.mp_draw.DrawingSpec(color=(255, 255, 255), thickness=1),
                )
        return frame

    def detect_and_draw(self, frame: np.ndarray) -> tuple[np.ndarray | None, np.ndarray]:
        """Tek cagrida hem keypoint cikarir hem cizim yapar."""
        keypoints = self.detect(frame)
        frame = self.draw_landmarks(frame)
        return keypoints, frame

    @property
    def hand_detected(self) -> bool:
        return (
            self._last_results is not None
            and self._last_results.multi_hand_landmarks is not None
        )

    def close(self) -> None:
        if hasattr(self, "hands") and self.hands is not None:
            try:
                self.hands.close()
            except Exception as exc:
                # Cleanup yolu: kapatma asamasinda hata kritik degil
                # (MediaPipe Hands zaten release edilmis olabilir).
                _logger.debug("HandDetector.close() swallow: %s", exc)
            self.hands = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
