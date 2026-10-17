"""Few-shot letter personalization with cosine-similarity templates."""

import logging
import os

import numpy as np

from asl_desktop.config import KNN_MAX_TEMPLATES, KNN_THRESHOLD, MODELS_DIR

_logger = logging.getLogger("ASL.Personalization")

PROFILES_DIR = os.path.join(MODELS_DIR, "profiles")


class PersonalizedKNN:
    """Persist user-recorded hand templates and match them by cosine similarity."""

    def __init__(self, threshold: float = KNN_THRESHOLD):
        """Initialize the template store.

        Args:
            threshold: Minimum cosine similarity; ``1.0`` is an exact match.
        """
        self.threshold = threshold
        self.templates: dict[str, np.ndarray] = {}
        self._load_templates()

    def _get_path(self) -> str:
        os.makedirs(PROFILES_DIR, exist_ok=True)
        return os.path.join(PROFILES_DIR, "user_templates.npz")

    def _load_templates(self) -> None:
        """Load persisted templates into memory."""
        path = self._get_path()
        if os.path.exists(path):
            # The app writes plain float arrays, so pickled objects are never
            # needed; refusing them keeps a tampered profile file from running code.
            try:
                with np.load(path, allow_pickle=False) as data:
                    templates = {letter: data[letter] for letter in data.files}
            except (ValueError, OSError) as e:
                _logger.warning("KNN profiles could not be read; templates ignored: %s", e)
                return
            self.templates.update(templates)
            _logger.info("KNN profiles loaded: %d letters", len(self.templates))

    def save_templates(self) -> None:
        """Persist all in-memory templates."""
        path = self._get_path()
        if self.templates:
            np.savez(path, **self.templates)

    def record_template(self, letter: str, features: np.ndarray, *, persist: bool = True) -> None:
        """Record one feature vector and retain only the configured recent set.

        Args:
            letter: Target letter for the template.
            features: Feature vector to append.
            persist: Write the full template store immediately. Batch callers
                can defer this and call :meth:`save_templates` once.
        """
        if letter not in self.templates:
            self.templates[letter] = np.array([features.flatten()])
        else:
            self.templates[letter] = np.vstack([self.templates[letter], features.flatten()])[
                -KNN_MAX_TEMPLATES:
            ]
        if persist:
            self.save_templates()

    def predict(self, features: np.ndarray) -> tuple[str, float] | None:
        """Match a feature vector against recorded templates.

        Returns:
            The best ``(letter, similarity)`` pair above the threshold, or
            ``None`` when no template qualifies.
        """
        if not self.templates:
            return None

        feat_flat = features.flatten().astype(np.float64)
        norm_feat = np.linalg.norm(feat_flat)
        if norm_feat < 1e-12:
            return None

        feat_unit = feat_flat / norm_feat
        best_match: str | None = None
        best_score: float = -1.0

        for letter, temps in self.templates.items():
            # Vectorized cosine similarity: (N, D) @ (D,) → (N,)
            norms = np.linalg.norm(temps, axis=1, keepdims=True)
            # Zero-norm templates do not define a cosine similarity.
            valid_mask = norms.squeeze() > 1e-12
            if not np.any(valid_mask):
                continue
            valid_temps = temps[valid_mask]
            valid_norms = norms[valid_mask]
            unit_temps = valid_temps / valid_norms
            similarities = unit_temps @ feat_unit
            max_sim = float(np.max(similarities))
            if max_sim > best_score:
                best_score = max_sim
                best_match = letter

        if best_match and best_score >= self.threshold:
            return (best_match, best_score)

        return None
