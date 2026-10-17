"""MediaPipe Holistic extraction for the desktop 25-word model.

The legacy desktop contract contains 107 landmarks (321 coordinates): 21 per
hand, 40 selected face landmarks, and 25 pose landmarks. It uses the
shoulder-centered normalization and face indices from the desktop model's
training pipeline. This is not the compact 168D contract used by the primary
web application's 50-word model.
"""

import cv2
import mediapipe as mp
import numpy as np
from asl_features.config import MIN_DETECTION_CONFIDENCE, MIN_TRACKING_CONFIDENCE

from asl_desktop.config import HOLISTIC_MODEL_COMPLEXITY
from asl_desktop.utils.landmark_smoother import LandmarkSmoother

# Frozen face-landmark order used to train the desktop 25-word model.
FACE_INDICES = [
    61,
    185,
    40,
    39,
    37,
    0,
    267,
    269,
    270,
    409,
    291,
    375,
    321,
    405,
    314,
    17,
    46,
    53,
    52,
    65,
    276,
    283,
    282,
    295,
    33,
    7,
    163,
    144,
    362,
    382,
    381,
    263,
    1,
    2,
    98,
    327,
    168,
    197,
    195,
    5,
]
POSE_INDICES = list(range(25))

NUM_RIGHT_HAND = 21
NUM_LEFT_HAND = 21
NUM_FACE = len(FACE_INDICES)
NUM_POSE = len(POSE_INDICES)
NUM_LANDMARKS = NUM_RIGHT_HAND + NUM_LEFT_HAND + NUM_FACE + NUM_POSE  # 107
NUM_FEATURES = NUM_LANDMARKS * 3  # 321


class HolisticDetector:
    """Extract the multimodal sequence consumed by desktop word mode."""

    def __init__(self, static_mode: bool = False, smoothing_alpha: float = 0.6):
        self.mp_holistic = mp.solutions.holistic
        self.mp_draw = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles

        self.holistic = self.mp_holistic.Holistic(
            static_image_mode=static_mode,
            model_complexity=HOLISTIC_MODEL_COMPLEXITY,
            min_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
        )
        self._last_results = None

        # This smoother is intentionally scoped to the 321D desktop contract.
        self._smoother = LandmarkSmoother(alpha=smoothing_alpha)

        # Match training-time forward filling when a landmark group disappears.
        self._last_right_hand = np.zeros(NUM_RIGHT_HAND * 3, dtype=np.float32)
        self._last_left_hand = np.zeros(NUM_LEFT_HAND * 3, dtype=np.float32)
        self._last_face = np.zeros(NUM_FACE * 3, dtype=np.float32)
        self._last_pose = np.zeros(NUM_POSE * 3, dtype=np.float32)

    def _normalize_multimodal(self, data: np.ndarray) -> np.ndarray:
        """Apply the desktop model's shoulder-centered 321D normalization."""
        norm_data = data.copy()

        pose_offset = (NUM_RIGHT_HAND + NUM_LEFT_HAND + NUM_FACE) * 3

        if 11 in POSE_INDICES and 12 in POSE_INDICES:
            idx_11 = POSE_INDICES.index(11)
            idx_12 = POSE_INDICES.index(12)

            left_shoulder = norm_data[pose_offset + idx_11 * 3 : pose_offset + idx_11 * 3 + 3]
            right_shoulder = norm_data[pose_offset + idx_12 * 3 : pose_offset + idx_12 * 3 + 3]

            # Center and scale only when both shoulders are present.
            if np.any(left_shoulder != 0) and np.any(right_shoulder != 0):
                center = (left_shoulder + right_shoulder) / 2.0
                width = np.linalg.norm(left_shoulder - right_shoulder)

                if width > 1e-6:
                    reshaped = norm_data.reshape(-1, 3)
                    zero_mask = np.all(reshaped == 0, axis=1)
                    reshaped[~zero_mask] = (reshaped[~zero_mask] - center) / width
                    return reshaped.flatten().astype(np.float32)

        # Use the training pipeline's min-max fallback when shoulders are absent.
        nonzero = norm_data[norm_data != 0]
        if len(nonzero) > 0:
            vmin, vmax = nonzero.min(), nonzero.max()
            rng = vmax - vmin
            if rng > 1e-6:
                norm_data = np.where(norm_data == 0, 0.0, (norm_data - vmin) / rng)

        return norm_data.astype(np.float32)

    def detect(self, frame: np.ndarray) -> tuple[np.ndarray | None, bool]:
        """Return normalized keypoints and whether a hand is currently visible.

        Returns:
            A ``(keypoints, hands_detected)`` tuple. ``keypoints`` is ``None``
            only when every landmark group is empty.
        """
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        self._last_results = self.holistic.process(rgb)

        result = np.zeros(NUM_FEATURES, dtype=np.float32)
        offset = 0
        hands_detected = False

        # Right hand (63 coordinates).
        if self._last_results.right_hand_landmarks:
            hands_detected = True
            for i, lm in enumerate(self._last_results.right_hand_landmarks.landmark):
                if i < NUM_RIGHT_HAND:
                    result[offset + i * 3 : offset + (i + 1) * 3] = [lm.x, lm.y, lm.z]
            self._last_right_hand = result[offset : offset + NUM_RIGHT_HAND * 3].copy()
        else:
            result[offset : offset + NUM_RIGHT_HAND * 3] = self._last_right_hand
        offset += NUM_RIGHT_HAND * 3

        # Left hand (63 coordinates).
        if self._last_results.left_hand_landmarks:
            hands_detected = True
            for i, lm in enumerate(self._last_results.left_hand_landmarks.landmark):
                if i < NUM_LEFT_HAND:
                    result[offset + i * 3 : offset + (i + 1) * 3] = [lm.x, lm.y, lm.z]
            self._last_left_hand = result[offset : offset + NUM_LEFT_HAND * 3].copy()
        else:
            result[offset : offset + NUM_LEFT_HAND * 3] = self._last_left_hand
        offset += NUM_LEFT_HAND * 3

        # Selected face landmarks (40 x 3 = 120 coordinates).
        if self._last_results.face_landmarks:
            lms = self._last_results.face_landmarks.landmark
            for j, fi in enumerate(FACE_INDICES):
                if fi < len(lms):
                    lm = lms[fi]
                    result[offset + j * 3 : offset + (j + 1) * 3] = [lm.x, lm.y, lm.z]
            self._last_face = result[offset : offset + NUM_FACE * 3].copy()
        else:
            result[offset : offset + NUM_FACE * 3] = self._last_face
        offset += NUM_FACE * 3

        # Pose landmarks (25 x 3 = 75 coordinates).
        if self._last_results.pose_landmarks:
            lms = self._last_results.pose_landmarks.landmark
            for j, pi in enumerate(POSE_INDICES):
                if pi < len(lms):
                    lm = lms[pi]
                    result[offset + j * 3 : offset + (j + 1) * 3] = [lm.x, lm.y, lm.z]
            self._last_pose = result[offset : offset + NUM_POSE * 3].copy()
        else:
            result[offset : offset + NUM_POSE * 3] = self._last_pose

        # Face or pose data may keep the vector nonzero when no hand is present.
        # ``hands_detected`` stays false so the caller can suppress word inference.

        if np.all(result == 0):
            self._smoother.reset()
            return None, False

        normalized = self._normalize_multimodal(result)
        smoothed = self._smoother.smooth(normalized)

        return smoothed, hands_detected

    def draw_landmarks(self, frame: np.ndarray) -> np.ndarray:
        """Draw the most recently detected holistic landmarks on ``frame``."""
        if not self._last_results:
            return frame

        # Draw the standard contour rather than only the selected feature points.
        if self._last_results.face_landmarks:
            self.mp_draw.draw_landmarks(
                frame,
                self._last_results.face_landmarks,
                self.mp_holistic.FACEMESH_CONTOURS,
                landmark_drawing_spec=None,
                connection_drawing_spec=self.mp_drawing_styles.get_default_face_mesh_contours_style(),
            )

        if self._last_results.pose_landmarks:
            self.mp_draw.draw_landmarks(
                frame,
                self._last_results.pose_landmarks,
                self.mp_holistic.POSE_CONNECTIONS,
                landmark_drawing_spec=self.mp_drawing_styles.get_default_pose_landmarks_style(),
            )

        if self._last_results.left_hand_landmarks:
            self.mp_draw.draw_landmarks(
                frame,
                self._last_results.left_hand_landmarks,
                self.mp_holistic.HAND_CONNECTIONS,
                self.mp_draw.DrawingSpec(color=(0, 220, 100), thickness=2, circle_radius=3),
                self.mp_draw.DrawingSpec(color=(255, 255, 255), thickness=1),
            )

        if self._last_results.right_hand_landmarks:
            self.mp_draw.draw_landmarks(
                frame,
                self._last_results.right_hand_landmarks,
                self.mp_holistic.HAND_CONNECTIONS,
                self.mp_draw.DrawingSpec(color=(0, 220, 100), thickness=2, circle_radius=3),
                self.mp_draw.DrawingSpec(color=(255, 255, 255), thickness=1),
            )

        return frame

    def close(self) -> None:
        if hasattr(self, "holistic") and self.holistic is not None:
            self.holistic.close()
            self.holistic = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
