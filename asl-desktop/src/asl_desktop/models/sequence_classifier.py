"""Sequence models retained for the desktop prototype.

This module supports an optional J/Z LSTM and the older 25-word desktop
LSTM/GRU family. The primary web application's 50-word SignTransformer is a
separate ONNX model with a different feature contract and does not use these
classes.

Architecture parameters are read from the model's metadata when available.
Metadata-free checkpoints fall back to the original unidirectional LSTM so
older J/Z artifacts remain loadable.
"""

import json
import logging
import os
import re
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from asl_features.config import HAND_LANDMARK_DIM

from asl_desktop.config import (
    DEVICE,
    ENTROPY_PENALTY,
    ENTROPY_THRESHOLD,
    JZ_LABEL_MAP_PATH,
    JZ_MODEL_PATH,
    LSTM_DROPOUT,
    LSTM_HIDDEN_SIZE,
    LSTM_NUM_LAYERS,
    MOTION_VARIANCE_THRESHOLD,
    SEQUENCE_LENGTH,
    WORD_LABEL_MAP_PATH,
    WORD_MODEL_PATH,
    WORD_STRIDE,
)

_logger = logging.getLogger("ASL.SequenceClassifier")


class SignLanguageLSTM(nn.Module):
    """LSTM sequence classifier used by the optional J/Z workflow.

    Input shape: ``(batch, sequence_length=30, features=63)``.
    Output shape: ``(batch, num_classes)``.

    Keep this architecture aligned with
    ``scripts/model_training/train_dynamic_jz_model.py``.
    """

    def __init__(
        self,
        input_size: int = HAND_LANDMARK_DIM,
        hidden_size: int = LSTM_HIDDEN_SIZE,
        num_layers: int = LSTM_NUM_LAYERS,
        num_classes: int = 2,
        dropout: float = LSTM_DROPOUT,
        bidirectional: bool = False,
    ):
        super().__init__()
        dir_factor = 2 if bidirectional else 1

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=bidirectional,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Sequential(
            nn.Linear(hidden_size * dir_factor, hidden_size),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        last = self.dropout(out[:, -1, :])
        return self.fc(last)


class SignLanguageGRU(nn.Module):
    """Desktop V3 GRU classifier using the final hidden state."""

    def __init__(
        self,
        input_size: int = HAND_LANDMARK_DIM,
        hidden_size: int = LSTM_HIDDEN_SIZE,
        num_layers: int = LSTM_NUM_LAYERS,
        num_classes: int = 25,
        dropout: float = LSTM_DROPOUT,
        bidirectional: bool = True,
    ):
        super().__init__()
        dir_factor = 2 if bidirectional else 1

        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=bidirectional,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Sequential(
            nn.Linear(hidden_size * dir_factor, hidden_size),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        last = self.dropout(out[:, -1, :])
        return self.fc(last)


class AttentionPooling(nn.Module):
    """Learn a weighted representation across all sequence steps."""

    def __init__(self, hidden_size: int):
        super().__init__()
        self.attention = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.Tanh(),
            nn.Linear(hidden_size // 2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        scores = self.attention(x).squeeze(-1)
        weights = F.softmax(scores, dim=1).unsqueeze(-1)
        return (x * weights).sum(dim=1)


class SignLanguageGRUv4(nn.Module):
    """Desktop V4 bidirectional GRU with attention pooling."""

    def __init__(
        self,
        input_size: int = HAND_LANDMARK_DIM,
        hidden_size: int = LSTM_HIDDEN_SIZE,
        num_layers: int = LSTM_NUM_LAYERS,
        num_classes: int = 25,
        dropout: float = LSTM_DROPOUT,
        bidirectional: bool = True,
    ):
        super().__init__()
        dir_factor = 2 if bidirectional else 1

        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=bidirectional,
        )
        self.attention_pool = AttentionPooling(hidden_size * dir_factor)
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Sequential(
            nn.Linear(hidden_size * dir_factor, hidden_size),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        pooled = self.attention_pool(out)
        pooled = self.dropout(pooled)
        return self.fc(pooled)


class SequenceClassifier:
    """Buffer frames and run the selected desktop LSTM or GRU.

    ``model_type="jz"`` uses a non-overlapping window for the optional dynamic
    letters. ``model_type="word"`` uses overlapping windows for the desktop
    25-word model. Model metadata selects the checkpoint-compatible
    architecture.
    """

    def __init__(self, model_type: str = "jz"):
        self.model_type = model_type
        self.model: nn.Module | None = None
        self.label_map: dict = {}
        self.inv_label_map: dict = {}
        self._loaded = False

        self._sliding = model_type == "word"
        self._stride = WORD_STRIDE
        self._frames_since_predict = 0
        self._last_top3: list[tuple[str, float]] = []

        if self._sliding:
            self._frame_buffer: deque[np.ndarray] = deque(maxlen=SEQUENCE_LENGTH)
        else:
            self._frame_buffer: list[np.ndarray] = []

        if model_type == "jz":
            self._model_path = JZ_MODEL_PATH
            self._label_map_path = JZ_LABEL_MAP_PATH
        else:
            self._model_path = WORD_MODEL_PATH
            self._label_map_path = WORD_LABEL_MAP_PATH

    def _load_meta(self) -> dict | None:
        """Load adjacent model metadata when present."""
        meta_path = os.path.splitext(self._model_path)[0] + "_meta.json"
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                return json.load(f)
        return None

    def _create_model(self, num_classes: int, meta: dict | None) -> nn.Module:
        """Construct the architecture described by checkpoint metadata."""
        # Use backward-compatible defaults for metadata-free J/Z checkpoints.
        input_size = meta.get("num_features", HAND_LANDMARK_DIM) if meta else HAND_LANDMARK_DIM
        hidden_size = meta.get("hidden_size", LSTM_HIDDEN_SIZE) if meta else LSTM_HIDDEN_SIZE
        num_layers = meta.get("num_layers", LSTM_NUM_LAYERS) if meta else LSTM_NUM_LAYERS
        dropout = meta.get("dropout", LSTM_DROPOUT) if meta else LSTM_DROPOUT
        bidirectional = meta.get("bidirectional", False) if meta else False
        arch_type = meta.get("model_type", "LSTM").upper() if meta else "LSTM"
        version = meta.get("version", "").upper() if meta else ""

        model_kwargs = dict(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            num_classes=num_classes,
            dropout=dropout,
            bidirectional=bidirectional,
        )

        if arch_type == "GRU" and version == "V4":
            model = SignLanguageGRUv4(**model_kwargs)
            label = f"{'Bi-' if bidirectional else ''}GRU-V4 (Attention)"
        elif arch_type == "GRU":
            model = SignLanguageGRU(**model_kwargs)
            label = f"{'Bi-' if bidirectional else ''}GRU"
        else:
            model = SignLanguageLSTM(**model_kwargs)
            label = f"{'Bi-' if bidirectional else ''}LSTM"

        _logger.info(
            "Mimari: %s (in=%d, hidden=%d, layers=%d)", label, input_size, hidden_size, num_layers
        )
        return model

    def load(self) -> bool:
        """Load the selected checkpoint and label map."""
        if not os.path.exists(self._model_path):
            _logger.info(
                "%s modeli henuz egitilmedi: %s", self.model_type.upper(), self._model_path
            )
            return False
        if not os.path.exists(self._label_map_path):
            _logger.info(
                "%s label map bulunamadi: %s", self.model_type.upper(), self._label_map_path
            )
            return False

        # The label count determines the classifier output width.
        with open(self._label_map_path, encoding="utf-8") as f:
            self.label_map = json.load(f)
        # Older exports wrote the class index as a string.
        self.inv_label_map = {int(index): label for label, index in self.label_map.items()}
        num_classes = len(self.label_map)

        # Build the exact architecture before loading its state dictionary.
        meta = self._load_meta()
        self.model = self._create_model(num_classes, meta)

        # Restrict deserialization to weights on PyTorch versions that support it.
        load_kwargs = {"map_location": DEVICE}
        _ver_match = re.match(r"(\d+)\.(\d+)", torch.__version__)
        if _ver_match and (int(_ver_match.group(1)), int(_ver_match.group(2))) >= (2, 6):
            load_kwargs["weights_only"] = True
        state_dict = torch.load(self._model_path, **load_kwargs)
        self.model.load_state_dict(state_dict)
        self.model.to(DEVICE)
        self.model.eval()

        self._loaded = True
        _logger.info("%s modeli yuklendi: %d sinif", self.model_type.upper(), num_classes)
        return True

    def add_frame(self, keypoints: np.ndarray) -> tuple[str, float] | None:
        """Append one feature vector and predict when its window is ready.

        Returns ``None`` until enough frames are available; otherwise returns a
        ``(label, confidence)`` tuple.
        """
        if not self._loaded:
            return None

        self._frame_buffer.append(keypoints.copy())
        self._frames_since_predict += 1

        if self._sliding:
            # Predict whenever the full overlapping window advances by one stride.
            if (
                len(self._frame_buffer) >= SEQUENCE_LENGTH
                and self._frames_since_predict >= self._stride
            ):
                frames = list(self._frame_buffer)
                self._frames_since_predict = 0
                return self.predict_sequence(frames)
        else:
            # A J/Z gesture consumes one complete, non-overlapping window.
            if len(self._frame_buffer) >= SEQUENCE_LENGTH:
                result = self.predict_sequence(self._frame_buffer[:SEQUENCE_LENGTH])
                self._frame_buffer.clear()
                self._frames_since_predict = 0
                return result

        return None

    def predict_sequence(self, sequence: list[np.ndarray]) -> tuple[str, float]:
        """Predict one sequence and apply desktop word-mode quality gates."""
        if not self._loaded:
            return ("?", 0.0)

        seq_array = np.array(sequence, dtype=np.float32)

        # Word gate 1: require enough visible-hand frames and measurable motion.
        if self._sliding:
            hand_data = seq_array[:, :126]  # Right hand (63) + left hand (63).
            nonzero_mask = np.any(hand_data != 0, axis=1)
            if nonzero_mask.sum() < 10:
                self._last_top3 = []
                return ("?", 0.0)
            # Measure motion only across frames with at least one visible hand.
            active_frames = hand_data[nonzero_mask]
            if len(active_frames) > 1:
                frame_diffs = np.diff(active_frames, axis=0)
                motion_var = np.mean(np.abs(frame_diffs))
                if motion_var < MOTION_VARIANCE_THRESHOLD:
                    self._last_top3 = []
                    return ("?", 0.0)

        tensor = torch.tensor(seq_array).unsqueeze(0).to(DEVICE)

        with torch.no_grad():
            logits = self.model(tensor)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]

        predicted_idx = int(np.argmax(probs))
        confidence = float(probs[predicted_idx])
        label = self.inv_label_map.get(predicted_idx, "?")

        top3_indices = np.argsort(probs)[::-1][:3]
        self._last_top3 = [
            (self.inv_label_map.get(int(i), "?"), float(probs[i])) for i in top3_indices
        ]

        # Word gate 2: penalize a flat, high-entropy class distribution.
        entropy = -np.sum(probs * np.log(probs + 1e-9))
        max_entropy = np.log(len(probs))
        norm_entropy = entropy / max_entropy
        if norm_entropy > ENTROPY_THRESHOLD:
            confidence *= ENTROPY_PENALTY

        return (label, confidence)

    @property
    def last_top3(self) -> list[tuple[str, float]]:
        """Return the last top-three predictions, or an empty list after rejection."""
        return self._last_top3.copy()

    def reset_buffer(self) -> None:
        self._frame_buffer.clear()
        self._frames_since_predict = 0

    @property
    def buffer_progress(self) -> float:
        """Return current window or stride progress in the range 0-1."""
        if self._sliding:
            # Once full, report progress toward the next overlapping prediction.
            if len(self._frame_buffer) >= SEQUENCE_LENGTH:
                return self._frames_since_predict / self._stride
            return len(self._frame_buffer) / SEQUENCE_LENGTH
        return len(self._frame_buffer) / SEQUENCE_LENGTH

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def num_classes(self) -> int:
        return len(self.label_map) if self._loaded else 0
