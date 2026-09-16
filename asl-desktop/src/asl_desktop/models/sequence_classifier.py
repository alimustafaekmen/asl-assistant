"""
Sekans Siniflandirici (LSTM / GRU) — LEGACY DESKTOP
====================================================
KAPSAM NOTU
-----------
Bu sinif **legacy desktop** prototipi icindir:
  - J/Z dinamik harfleri (`jz_model.pt`)
  - 25-class word modeli (`word_25_v4_holistic321_bigru_attention.pt`)
Her ikisi de masaustu (CustomTkinter) uygulamasinda kullanilir.

PRODUCTION web kelime modeli **TAMAMEN AYRI** bir mimari ve dosyadir:
  - `asl-web/models/word_model.onnx` (50-class SignTransformer, 168D x 45 + bool mask)
  - Notebook kaynak: `notebooks/train_word_model_final.ipynb`
  - Web bu sinif/dosya ile **HIC** etkilesmez (asl-web/ kendi JS pipeline'i + ORT Web kullanir).

Desteklenen mimariler (bu legacy sinif icinde):
  - SignLanguageLSTM:    J/Z dinamik harfler icin (unidirectional veya bidirectional)
  - SignLanguageGRU:     Kelime tanima icin (unidirectional veya bidirectional)
  - SignLanguageGRUv4:   Bi-GRU + Attention Pooling (25-class word V4)

Model secimi otomatiktir:
  - word_25_v4_holistic321_bigru_attention_meta.json varsa → metadata'daki model_type (LSTM/GRU) ve
    bidirectional degerine gore model olusturulur
  - meta yoksa → varsayilan olarak SignLanguageLSTM (unidirectional) kullanilir
    (J/Z modeli icin backward compatible)

Kullanim:
    # J/Z icin (LSTM, unidirectional — mevcut davranis)
    jz = SequenceClassifier(model_type="jz")
    jz.load()
    result = jz.add_frame(keypoints)  # None veya ("J", 0.95)

    # Kelime icin (GRU, bidirectional — meta.json'dan okunur)
    word = SequenceClassifier(model_type="word")
    word.load()
"""
import logging
import os
import re
import json
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from asl_ml.utils import load_label_map, invert_label_map
from config.settings import (
    NUM_FEATURES, SEQUENCE_LENGTH,
    LSTM_HIDDEN_SIZE, LSTM_NUM_LAYERS, LSTM_DROPOUT,
    JZ_MODEL_PATH, JZ_LABEL_MAP_PATH,
    WORD_MODEL_PATH, WORD_LABEL_MAP_PATH,
    DEVICE, WORD_STRIDE,
    MOTION_VARIANCE_THRESHOLD, ENTROPY_THRESHOLD, ENTROPY_PENALTY,
)

_logger = logging.getLogger("ASL.SequenceClassifier")


# ═══════════════════════════════════════════════════════
#  LSTM Model Mimarisi
# ═══════════════════════════════════════════════════════

class SignLanguageLSTM(nn.Module):
    """
    LSTM tabanli zaman serisi siniflandirici.
    J/Z harfleri icin kullanilir. Bidirectional destegi vardir.

    Girdi:  (batch, seq_len=30, features=63)
    Cikti:  (batch, num_classes)

    ONEMLI: Bu mimari scripts/model_training/train_dynamic_jz_model.py ile BIREBIR AYNI olmalidir!
    """

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
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


# ═══════════════════════════════════════════════════════
#  GRU Model Mimarisi (V3)
# ═══════════════════════════════════════════════════════

class SignLanguageGRU(nn.Module):
    """
    GRU tabanli zaman serisi siniflandirici (V3).
    Son hidden state kullanir.
    """

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
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


# ═══════════════════════════════════════════════════════
#  Attention Pooling + GRU V4 Model Mimarisi
# ═══════════════════════════════════════════════════════

class AttentionPooling(nn.Module):
    """Attention-based pooling — tum timestep'lere dikkat eder."""

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
    """
    V4: Bi-GRU + Attention Pooling.
    Focal Loss ile egitilmistir — overconfidence azaltilmistir.
    """

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
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


# ═══════════════════════════════════════════════════════
#  Sekans Siniflandirici
# ═══════════════════════════════════════════════════════

class SequenceClassifier:
    """
    Frame dizisi yonetimi + LSTM/GRU inference.
    30 frame toplar, modele gonderir, sonucu dondurur.

    model_type:
        "jz"   → J/Z harfleri (jz_model.pt) — SignLanguageLSTM
        "word" → kelime tanima (word_25_v4_holistic321_bigru_attention.pt) — meta.json'a gore LSTM veya GRU

    Model secimi:
        Eger ilgili *_meta.json dosyasi varsa, model_type ve bidirectional
        degerlerini oradan okur. Yoksa varsayilan olarak unidirectional LSTM
        kullanir (J/Z backward compatibility).
    """

    def __init__(self, model_type: str = "jz"):
        self.model_type = model_type
        self.model: nn.Module | None = None
        self.label_map: dict = {}
        self.inv_label_map: dict = {}
        self._loaded = False

        # Kelime modu: sliding window (daha akici deneyim)
        # J/Z modu: tumbling window (tek hareket algilama)
        self._sliding = (model_type == "word")
        self._stride = WORD_STRIDE  # sliding window adimi (config/settings.py'den)
        self._frames_since_predict = 0
        self._last_top3: list[tuple[str, float]] = []

        if self._sliding:
            self._frame_buffer: deque[np.ndarray] = deque(maxlen=SEQUENCE_LENGTH)
        else:
            self._frame_buffer: list[np.ndarray] = []

        # Model yollarini belirle
        if model_type == "jz":
            self._model_path = JZ_MODEL_PATH
            self._label_map_path = JZ_LABEL_MAP_PATH
        else:
            self._model_path = WORD_MODEL_PATH
            self._label_map_path = WORD_LABEL_MAP_PATH

    def _load_meta(self) -> dict | None:
        """Model metadata dosyasini yukler (varsa)."""
        meta_path = os.path.splitext(self._model_path)[0] + "_meta.json"
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                return json.load(f)
        return None

    def _create_model(self, num_classes: int, meta: dict | None) -> nn.Module:
        """
        Metadata'ya gore dogru model mimarisini olusturur.

        J/Z icin: meta yoksa → SignLanguageLSTM(bidirectional=False)
        Kelime icin: meta'dan model_type okur → SignLanguageLSTM veya SignLanguageGRU
        """
        # Metadata'dan hiperparametreleri oku (varsa)
        input_size = meta.get("num_features", NUM_FEATURES) if meta else NUM_FEATURES
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

        _logger.info("Mimari: %s (in=%d, hidden=%d, layers=%d)",
                     label, input_size, hidden_size, num_layers)
        return model

    def load(self) -> bool:
        """Model ve label map yukler. True = basarili."""
        if not os.path.exists(self._model_path):
            _logger.info("%s modeli henuz egitilmedi: %s", self.model_type.upper(), self._model_path)
            return False
        if not os.path.exists(self._label_map_path):
            _logger.info("%s label map bulunamadi: %s", self.model_type.upper(), self._label_map_path)
            return False

        # Label map yukle
        self.label_map = load_label_map(self._label_map_path)
        self.inv_label_map = invert_label_map(self.label_map)
        num_classes = len(self.label_map)

        # Metadata'dan doğru mimariyi belirle
        meta = self._load_meta()
        self.model = self._create_model(num_classes, meta)

        # State dict yukle
        load_kwargs = {"map_location": DEVICE}
        # PyTorch 2.6+ icin weights_only parametresi gerekli
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
        """
        Bir frame'in keypoint'lerini buffer'a ekler.

        J/Z modu (tumbling): 30 frame topla → tahmin → temizle
        Kelime modu (sliding): 30 frame dolunca, her 15 frame'de tahmin
                               (sliding window, %50 overlap)

        Returns:
            None (buffer dolmadi) veya (label, confidence)
        """
        if not self._loaded:
            return None

        self._frame_buffer.append(keypoints.copy())
        self._frames_since_predict += 1

        if self._sliding:
            # Sliding window: buffer doluysa ve stride kosulunu karsiliyorsa tahmin
            if (len(self._frame_buffer) >= SEQUENCE_LENGTH
                    and self._frames_since_predict >= self._stride):
                frames = list(self._frame_buffer)
                self._frames_since_predict = 0
                return self.predict_sequence(frames)
        else:
            # Tumbling window: buffer dolunca tahmin yap ve temizle
            if len(self._frame_buffer) >= SEQUENCE_LENGTH:
                result = self.predict_sequence(
                    self._frame_buffer[:SEQUENCE_LENGTH])
                self._frame_buffer.clear()
                self._frames_since_predict = 0
                return result

        return None

    def predict_sequence(self, sequence: list[np.ndarray]) -> tuple[str, float]:
        """
        30 frame'lik sekanstan tahmin yapar.
        Gating: Hareket yetersizse veya model overconfident ise tahmin reddedilir.
        """
        if not self._loaded:
            return ("?", 0.0)

        seq_array = np.array(sequence, dtype=np.float32)

        # ──── GATING 1: Sekans Hareket Kontrolu ────
        # Eller yeterince hareket etmiyorsa (statik pozisyon) → kelime islami sayilmaz
        if self._sliding:  # Sadece kelime modu icin
            # El landmarklarinin (ilk 126 ozellik = sag el + sol el) frame-to-frame farklarini hesapla
            hand_data = seq_array[:, :126]  # sag el (63) + sol el (63)
            nonzero_mask = np.any(hand_data != 0, axis=1)
            if nonzero_mask.sum() < 10:  # 10'dan az aktif frame
                self._last_top3 = []
                return ("?", 0.0)
            # Aktif framelerdeki hareket varyansini hesapla
            active_frames = hand_data[nonzero_mask]
            if len(active_frames) > 1:
                frame_diffs = np.diff(active_frames, axis=0)
                motion_var = np.mean(np.abs(frame_diffs))
                if motion_var < MOTION_VARIANCE_THRESHOLD:  # Cok statik — kelime isareti degil
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
            (self.inv_label_map.get(int(i), "?"), float(probs[i]))
            for i in top3_indices
        ]

        # ──── GATING 2: Entropi Kontrolu ────
        # Eger model dagilimi cok duz ise (hicbir sinif one cikmiyor) → guvenilmez tahmin
        entropy = -np.sum(probs * np.log(probs + 1e-9))
        max_entropy = np.log(len(probs))  # uniform dagilim entropisi
        norm_entropy = entropy / max_entropy
        # Normalize entropi esikten yuksekse → model emin degil, guven dusur
        if norm_entropy > ENTROPY_THRESHOLD:
            confidence *= ENTROPY_PENALTY

        return (label, confidence)

    @property
    def last_top3(self) -> list[tuple[str, float]]:
        """Son tahminin top-3 listesi. Gating reddi veya tahmin yoksa boş liste."""
        return self._last_top3.copy()

    def reset_buffer(self) -> None:
        self._frame_buffer.clear()
        self._frames_since_predict = 0

    @property
    def buffer_progress(self) -> float:
        """Buffer doluluk orani (0.0 - 1.0)."""
        if self._sliding:
            # Sliding: buffer doluysa, stride ilerleme oranini goster
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
