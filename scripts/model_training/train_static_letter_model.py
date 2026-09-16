#!/usr/bin/env python3
"""
============================================================
  ASL Harf Modeli — Tek Komutlu Eğitim Pipeline'ı
============================================================

Bu script tek komutla tüm eğitim sürecini gerçekleştirir:
  1. Dataset görsellerinden MediaPipe keypoint çıkarımı
  2. Normalizasyon + augmentation (63D ham landmark üzerine)
  3. Feature engineering (63D → ~93D zenginleştirilmiş özellikler)
  4. Train/test bölme
  5. Model eğitimi (RF / XGBoost / LightGBM / MLP karşılaştırması)
  6. Model + metadata + görselleştirmeler kaydetme

Kullanım:
  conda activate isaret_dili
  python scripts/model_training/train_static_letter_model.py                         # Varsayılan
  python scripts/model_training/train_static_letter_model.py --max-images 500        # Hızlı test
  python scripts/model_training/train_static_letter_model.py --full-comparison        # 4 model + tüm görseller
  python scripts/model_training/train_static_letter_model.py --no-features            # Feature engineering olmadan
  python scripts/model_training/train_static_letter_model.py --no-augment             # Augmentation olmadan
  python scripts/model_training/train_static_letter_model.py --model xgboost          # Sadece XGBoost

Çıktılar:
  models/letter/letter_model.pkl                   — Eğitilmiş model
  models/letter/letter_label_map.json              — Harf → sayı eşlemesi
  models/letter/letter_model_meta.json             — Model metadata (boyut, FE, doğruluk)
  models/letter/static_letter_confusion_matrix.png — Confusion matrix görseli
  docs/assets/static-letter-model-comparison.png   — Model karşılaştırma (--full-comparison)
  docs/assets/static-letter-class-f1.png           — Sınıf bazlı F1 (--full-comparison)
  docs/assets/static-letter-feature-importance.png — Feature importance (--full-comparison)
  docs/assets/static-letter-tsne.png               — t-SNE (--full-comparison)
  models/letter/letter_model_comparison.csv        — Metrik tablosu (--full-comparison)
============================================================
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime
import numpy as np
import cv2
import mediapipe as mp
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.metrics import (
    classification_report, confusion_matrix, accuracy_score, f1_score,
)
import xgboost as xgb
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import torch
import torch.nn as nn
from sklearn.base import BaseEstimator, ClassifierMixin

# LightGBM fallback mekanizması
try:
    from lightgbm import LGBMClassifier
    LGBM_AVAILABLE = True
except ImportError:
    LGBM_AVAILABLE = False
    print("⚠ LightGBM bulunamadı, SVM kullanılacak")
    from sklearn.svm import SVC


# ═══════════════════════════════════════════════════════
#  1D CNN — PyTorch modeli, sklearn-uyumlu wrapper
# ═══════════════════════════════════════════════════════

class _Conv1DNet(nn.Module):
    """1D CNN: landmark koordinatlarını 1D sinyal olarak işler."""
    def __init__(self, input_size: int, n_classes: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(8),
            nn.Flatten(),
            nn.Linear(64 * 8, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, n_classes),
        )

    def forward(self, x):
        # x shape: (batch, features) → (batch, 1, features)
        x = x.unsqueeze(1)
        return self.net(x)


class Conv1DClassifier(BaseEstimator, ClassifierMixin):
    """
    sklearn-uyumlu PyTorch 1D CNN wrapper.
    cross_val_score, fit/predict/predict_proba destekler.
    """
    def __init__(self, epochs=100, lr=0.001, batch_size=64, patience=10):
        self.epochs = epochs
        self.lr = lr
        self.batch_size = batch_size
        self.patience = patience
        self.device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        self.model_ = None
        self.classes_ = None

    def fit(self, X, y):
        self.classes_ = np.unique(y)
        n_classes = len(self.classes_)
        # Label mapping (sklearn cross_val_score farklı subset'ler verebilir)
        label_map = {lbl: i for i, lbl in enumerate(self.classes_)}
        y_mapped = np.array([label_map[yi] for yi in y])

        X_t = torch.tensor(X, dtype=torch.float32)
        y_t = torch.tensor(y_mapped, dtype=torch.long)

        self.model_ = _Conv1DNet(X.shape[1], n_classes).to(self.device)
        optimizer = torch.optim.Adam(self.model_.parameters(), lr=self.lr)
        criterion = nn.CrossEntropyLoss()

        # Mini-batch eğitim + early stopping
        best_loss = float('inf')
        patience_counter = 0
        dataset = torch.utils.data.TensorDataset(X_t, y_t)
        loader = torch.utils.data.DataLoader(dataset, batch_size=self.batch_size, shuffle=True)

        self.model_.train()
        for epoch in range(self.epochs):
            epoch_loss = 0.0
            for xb, yb in loader:
                xb, yb = xb.to(self.device), yb.to(self.device)
                optimizer.zero_grad()
                out = self.model_(xb)
                loss = criterion(out, yb)
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()

            avg_loss = epoch_loss / len(loader)
            if avg_loss < best_loss - 1e-4:
                best_loss = avg_loss
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= self.patience:
                    break
        return self

    def predict(self, X):
        return self.classes_[self._predict_idx(X)]

    def predict_proba(self, X):
        self.model_.eval()
        X_t = torch.tensor(X, dtype=torch.float32).to(self.device)
        with torch.no_grad():
            logits = self.model_(X_t)
            probs = torch.softmax(logits, dim=1).cpu().numpy()
        return probs

    def _predict_idx(self, X):
        self.model_.eval()
        X_t = torch.tensor(X, dtype=torch.float32).to(self.device)
        with torch.no_grad():
            logits = self.model_(X_t)
            preds = logits.argmax(dim=1).cpu().numpy()
        return preds

# ── Proje kökünü Python path'e ekle ──
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from config.settings import (
    NUM_LANDMARKS, NUM_FEATURES, STATIC_LETTERS,
    NUM_HANDS, MIN_DETECTION_CONFIDENCE,
    LETTER_MODELS_DIR, LETTER_MODEL_PATH, LETTER_LABEL_MAP_PATH,
    AUGMENTATION_NOISE_STD, AUGMENTATION_ROTATION_RANGE, AUGMENTATION_MULTIPLIER,
    AUGMENTATION_SCALE_RANGE,
    PROCESSED_DATA_DIR,
)
from asl_ml.utils import normalize_landmarks
from asl_ml.features.letter_features import extract_features

DOCS_ASSETS_DIR = os.path.join(PROJECT_ROOT, "docs", "assets")

# ═══════════════════════════════════════════════════════
#  Dataset yollarını otomatik bul
# ═══════════════════════════════════════════════════════

RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")

DATASET_CANDIDATES = [
    ("ASL Alphabet (Kaggle)",   os.path.join(RAW_DIR, "ASL Alphabet", "asl_alphabet_train", "asl_alphabet_train"), "3000"),
    ("American Sign Language",  os.path.join(RAW_DIR, "American Sign Language Dataset"), "~70"),
    ("MediaPipe_Processed_Asl", os.path.join(RAW_DIR, "MediaPipe_Processed_Asl"), "~3000-5000"),
]


def find_dataset():
    """Kullanılabilir en iyi dataset'i otomatik bulur."""
    for name, path, per_class in DATASET_CANDIDATES:
        if os.path.isdir(path):
            for letter in ["a", "A", "b", "B"]:
                letter_dir = os.path.join(path, letter)
                if os.path.isdir(letter_dir):
                    files = [f for f in os.listdir(letter_dir) if f.lower().endswith(('.jpg','.jpeg','.png'))]
                    if len(files) > 10:
                        return name, path, per_class
    return None, None, None


# ═══════════════════════════════════════════════════════
#  Keypoint çıkarımı (görsellerden)
# ═══════════════════════════════════════════════════════

def extract_all_keypoints(dataset_dir: str, max_per_class: int = 0) -> tuple:
    """
    Tüm harf klasörlerinden keypoint çıkarır.

    Returns:
        X:     (N, 63) numpy dizisi (ham, normalize edilmiş)
        y_str: (N,)    harf etiketleri (string)
        stats: {harf: {'found': n, 'missed': n}}
    """
    hands = mp.solutions.hands.Hands(
        static_image_mode=True,
        max_num_hands=NUM_HANDS,
        min_detection_confidence=MIN_DETECTION_CONFIDENCE,
    )

    all_X = []
    all_y = []
    stats = {}
    t_start = time.time()

    for letter in STATIC_LETTERS:
        letter_dir = None
        for name_try in [letter.upper(), letter.lower()]:
            candidate = Path(dataset_dir) / name_try
            if candidate.exists():
                letter_dir = candidate
                break

        if letter_dir is None:
            print(f"  [{letter}] ✗ Klasör bulunamadı")
            stats[letter] = {"found": 0, "missed": 0}
            continue

        images = sorted([
            f for f in letter_dir.iterdir()
            if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
        ])

        if max_per_class > 0:
            images = images[:max_per_class]

        found = 0
        missed = 0

        for img_path in images:
            img = cv2.imread(str(img_path))
            if img is None:
                continue

            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb)

            if results.multi_hand_landmarks:
                lms = []
                for lm in results.multi_hand_landmarks[0].landmark:
                    lms.extend([lm.x, lm.y, lm.z])
                raw = np.array(lms, dtype=np.float32)
                kp = normalize_landmarks(raw)
                all_X.append(kp)
                all_y.append(letter.upper())
                found += 1
            else:
                missed += 1

        stats[letter] = {"found": found, "missed": missed}
        elapsed = time.time() - t_start
        print(f"  [{letter}] ✓ {found} keypoint, {missed} el bulunamadı  ({elapsed:.0f}s)")

    hands.close()

    X = np.array(all_X, dtype=np.float32)
    y_str = np.array(all_y)

    total = sum(s["found"] for s in stats.values())
    print(f"\n  Toplam: {total} örnek, {len(set(all_y))} sınıf")

    return X, y_str, stats


# ═══════════════════════════════════════════════════════
#  Augmentation (ham 63D landmark üzerine)
# ═══════════════════════════════════════════════════════

def augment_data(
    X: np.ndarray,
    y: np.ndarray,
    multiplier: int = AUGMENTATION_MULTIPLIER,
) -> tuple:
    """
    Veri setini gürültü + rotasyon ile çoğaltır.
    Augmentasyon ham 63D landmark'lara uygulanır (feature engineering'den ÖNCE).
    """
    print(f"\n  Augmentation ({multiplier}x) uygulanıyor...")

    aug_X_list = []
    aug_y_list = []

    for sample, label in zip(X, y):
        for _ in range(multiplier):
            aug = sample.copy()
            # 1. Gaussian gürültü
            aug += np.random.normal(0, AUGMENTATION_NOISE_STD, aug.shape).astype(np.float32)

            # 2. 2D rotasyon (z ekseni etrafında)
            angle = np.radians(np.random.uniform(
                -AUGMENTATION_ROTATION_RANGE, AUGMENTATION_ROTATION_RANGE
            ))
            cos_a, sin_a = np.cos(angle), np.sin(angle)
            rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)
            coords = aug.reshape(NUM_LANDMARKS, 3)
            coords[:, :2] = (rot @ coords[:, :2].T).T

            # 3. Scale perturbasyonu (el-kamera mesafesi degisimini simule eder)
            scale = 1.0 + np.random.uniform(-AUGMENTATION_SCALE_RANGE, AUGMENTATION_SCALE_RANGE)
            coords *= scale

            aug_X_list.append(coords.flatten())
            aug_y_list.append(label)

    if aug_X_list:
        X_aug = np.vstack([X, np.array(aug_X_list, dtype=np.float32)])
        y_aug = np.concatenate([y, np.array(aug_y_list)])
    else:
        X_aug = X
        y_aug = y

    print(f"  {X.shape[0]} → {X_aug.shape[0]} örnek")
    return X_aug, y_aug


# ═══════════════════════════════════════════════════════
#  Feature Engineering uygulama
# ═══════════════════════════════════════════════════════

def apply_feature_engineering(X_raw: np.ndarray) -> np.ndarray:
    """
    Ham 63D landmark dizisine feature engineering uygular.

    Args:
        X_raw: (N, 63) ham landmark dizisi

    Returns:
        (N, ~93) zenginleştirilmiş özellik dizisi
    """
    print(f"\n  Feature engineering uygulanıyor ({X_raw.shape[0]} örnek)...")
    X_features = np.array([extract_features(row) for row in X_raw])
    print(f"  {X_raw.shape[1]}D → {X_features.shape[1]}D")
    return X_features


# ═══════════════════════════════════════════════════════
#  Model eğitimi — Tek model
# ═══════════════════════════════════════════════════════

def train_single_model(
    X: np.ndarray,
    y_str: np.ndarray,
    model_type: str = "rf",
    use_features: bool = True,
    use_augment: bool = True,
) -> tuple:
    """
    Tek model eğitir, değerlendirir ve kaydeder.

    Returns:
        (model, label_map, accuracy, metadata)
    """
    # Label map
    unique = sorted(set(y_str))
    label_map = {lbl: i for i, lbl in enumerate(unique)}
    y = np.array([label_map[l] for l in y_str], dtype=np.int32)

    print(f"\n  Sınıf sayısı: {len(label_map)}")
    print(f"  Toplam örnek: {len(y)}")
    print(f"  Özellik boyutu: {X.shape[1]}")

    # Train / Test bölme
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )
    print(f"  Train: {len(y_train)}, Test: {len(y_test)}")

    # Model oluştur
    model = _create_model(model_type)
    model_name = _model_display_name(model_type)

    # Eğitim
    print(f"\n  {model_name} eğitiliyor...")
    t0 = time.time()
    if model_type == "xgboost":
        model.fit(X_train, y_train, verbose=False)
    else:
        model.fit(X_train, y_train)
    train_time = time.time() - t0

    # Test
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    # Inference süresi
    t0 = time.time()
    model.predict(X_test[:min(1000, len(X_test))])
    inference_ms = (time.time() - t0) / min(1000, len(X_test)) * 1000

    inv_map = {v: k for k, v in label_map.items()}
    target_names = [inv_map[i] for i in sorted(inv_map.keys())]

    print(f"\n{'='*50}")
    print(f"  TEST DOĞRULUĞU: {acc:.4f} ({acc*100:.1f}%)")
    print(f"  Eğitim süresi:  {train_time:.1f}s")
    print(f"  Inference:      {inference_ms:.3f}ms/tahmin")
    print(f"{'='*50}")
    print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))

    # Kaydet
    os.makedirs(os.path.dirname(LETTER_MODEL_PATH), exist_ok=True)
    joblib.dump(model, LETTER_MODEL_PATH)
    print(f"  Model → {LETTER_MODEL_PATH}")

    with open(LETTER_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"  Label map → {LETTER_LABEL_MAP_PATH}")

    # Metadata
    metadata = {
        "num_features": int(X.shape[1]),
        "feature_engineering": use_features,
        "augmentation": use_augment,
        "model_type": model_name,
        "accuracy": float(acc),
        "train_time_seconds": float(train_time),
        "inference_ms": float(inference_ms),
        "classes": len(label_map),
        "train_samples": int(len(y_train)),
        "test_samples": int(len(y_test)),
        "trained_at": datetime.now().isoformat(),
    }
    meta_path = os.path.splitext(LETTER_MODEL_PATH)[0] + "_meta.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  Metadata → {meta_path}")

    # Confusion matrix
    _save_confusion_matrix(y_test, y_pred, target_names, acc)

    return model, label_map, acc, metadata


# ═══════════════════════════════════════════════════════
#  Model eğitimi — Tam karşılaştırma (4 model)
# ═══════════════════════════════════════════════════════

def train_full_comparison(
    X: np.ndarray,
    y_str: np.ndarray,
    use_features: bool = True,
    use_augment: bool = True,
) -> tuple:
    """
    4 modeli karşılaştırmalı eğitir, en iyisini kaydeder.

    Returns:
        (best_model, label_map, best_accuracy, all_results)
    """
    # Label map
    unique = sorted(set(y_str))
    label_map = {lbl: i for i, lbl in enumerate(unique)}
    y = np.array([label_map[l] for l in y_str], dtype=np.int32)
    inv_map = {v: k for k, v in label_map.items()}
    target_names = [inv_map[i] for i in sorted(inv_map.keys())]

    print(f"\n  Sınıf sayısı: {len(label_map)}")
    print(f"  Toplam örnek: {len(y)}")
    print(f"  Özellik boyutu: {X.shape[1]}")

    # Train / Test
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )
    print(f"  Train: {len(y_train)}, Test: {len(y_test)}")

    # Model listesi (4 klasik ML + 1 derin öğrenme)
    model_configs = [
        ("rf", "Random Forest"),
        ("xgboost", "XGBoost"),
        ("lgbm_or_svm", "LightGBM" if LGBM_AVAILABLE else "SVM"),
        ("mlp", "MLP"),
        ("conv1d", "1D CNN"),
    ]

    print(f"\n{'='*60}")
    print(f"  MODEL KARŞILAŞTIRMASI (5 model, 5-fold CV)")
    print(f"{'='*60}")

    results = {}
    all_models = {}

    for model_key, model_name in model_configs:
        print(f"\n  ── {model_name} ──")
        model = _create_model(model_key)

        # Eğitim süresi
        t0 = time.time()
        if model_key == "xgboost":
            model.fit(X_train, y_train, verbose=False)
        else:
            model.fit(X_train, y_train)
        train_time = time.time() - t0

        # Test doğruluğu
        y_pred = model.predict(X_test)
        acc = accuracy_score(y_test, y_pred)

        # Inference süresi
        n_test = min(1000, len(X_test))
        t0 = time.time()
        model.predict(X_test[:n_test])
        inference_ms = (time.time() - t0) / n_test * 1000

        # Cross validation
        print(f"    5-fold CV hesaplanıyor...")
        cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring='accuracy', n_jobs=-1)

        # F1 scores per class
        f1_per_class = f1_score(y_test, y_pred, average=None, zero_division=0)
        min_f1 = float(f1_per_class.min())
        min_f1_class = target_names[int(f1_per_class.argmin())]

        results[model_name] = {
            "accuracy": float(acc),
            "train_time": float(train_time),
            "inference_ms": float(inference_ms),
            "cv_mean": float(cv_scores.mean()),
            "cv_std": float(cv_scores.std()),
            "min_f1": min_f1,
            "min_f1_class": min_f1_class,
            "f1_per_class": f1_per_class.tolist(),
            "y_pred": y_pred,
        }
        all_models[model_name] = model

        print(f"    Accuracy:  {acc:.4f} ({acc*100:.1f}%)")
        print(f"    CV:        {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")
        print(f"    Eğitim:    {train_time:.1f}s")
        print(f"    Inference: {inference_ms:.3f}ms/tahmin")
        print(f"    En zayıf:  {min_f1_class} (F1={min_f1:.3f})")

    # En iyi model seçimi
    best_name = max(results, key=lambda k: results[k]["accuracy"])
    best_model = all_models[best_name]
    best_acc = results[best_name]["accuracy"]
    best_pred = results[best_name]["y_pred"]

    print(f"\n{'='*60}")
    print(f"  ★ KAZANAN: {best_name} (Accuracy: {best_acc:.4f})")
    print(f"{'='*60}")
    print(classification_report(
        y_test, best_pred, target_names=target_names, zero_division=0
    ))

    # ── Kaydetme ──
    os.makedirs(os.path.dirname(LETTER_MODEL_PATH), exist_ok=True)
    os.makedirs(DOCS_ASSETS_DIR, exist_ok=True)

    # En iyi model
    joblib.dump(best_model, LETTER_MODEL_PATH)
    print(f"\n  Model → {LETTER_MODEL_PATH}")

    with open(LETTER_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"  Label map → {LETTER_LABEL_MAP_PATH}")

    # Metadata
    metadata = {
        "num_features": int(X.shape[1]),
        "feature_engineering": use_features,
        "augmentation": use_augment,
        "model_type": best_name,
        "accuracy": float(best_acc),
        "cv_mean": results[best_name]["cv_mean"],
        "cv_std": results[best_name]["cv_std"],
        "train_time_seconds": results[best_name]["train_time"],
        "inference_ms": results[best_name]["inference_ms"],
        "classes": len(label_map),
        "train_samples": int(len(y_train)),
        "test_samples": int(len(y_test)),
        "trained_at": datetime.now().isoformat(),
    }
    meta_path = os.path.splitext(LETTER_MODEL_PATH)[0] + "_meta.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  Metadata → {meta_path}")

    # ── Görselleştirmeler ──
    _save_confusion_matrix(y_test, best_pred, target_names, best_acc)
    _save_model_comparison_chart(results)
    _save_class_f1_chart(results[best_name]["f1_per_class"], target_names, best_name)
    _save_feature_importance(all_models.get("Random Forest", best_model), X.shape[1])
    _save_tsne(X_test, y_test, target_names)
    _save_comparison_csv(results)

    return best_model, label_map, best_acc, results


# ═══════════════════════════════════════════════════════
#  Model fabrikası
# ═══════════════════════════════════════════════════════

def _create_model(model_type: str):
    """Model tipi string'inden model nesnesi oluşturur."""
    if model_type == "rf":
        return RandomForestClassifier(
            n_estimators=300, random_state=42, n_jobs=-1, class_weight="balanced"
        )
    elif model_type == "xgboost":
        return xgb.XGBClassifier(
            n_estimators=300, max_depth=6, learning_rate=0.1,
            random_state=42, n_jobs=-1, eval_metric="mlogloss",
        )
    elif model_type == "lgbm_or_svm":
        if LGBM_AVAILABLE:
            return LGBMClassifier(
                n_estimators=300, random_state=42, verbose=-1, n_jobs=-1,
            )
        else:
            return SVC(kernel='rbf', C=10, probability=True, random_state=42)
    elif model_type == "mlp":
        return MLPClassifier(
            hidden_layer_sizes=(256, 128, 64), max_iter=500,
            random_state=42, early_stopping=True,
        )
    elif model_type == "conv1d":
        return Conv1DClassifier(
            epochs=100, lr=0.001, batch_size=64, patience=10,
        )
    else:
        raise ValueError(f"Bilinmeyen model tipi: {model_type}")


def _model_display_name(model_type: str) -> str:
    """Model tipi için gösterim adı."""
    names = {
        "rf": "Random Forest",
        "xgboost": "XGBoost",
        "lgbm_or_svm": "LightGBM" if LGBM_AVAILABLE else "SVM",
        "mlp": "MLP",
        "conv1d": "1D CNN",
    }
    return names.get(model_type, model_type)


# ═══════════════════════════════════════════════════════
#  Görselleştirmeler
# ═══════════════════════════════════════════════════════

def _save_confusion_matrix(y_test, y_pred, target_names, accuracy):
    """Confusion matrix heatmap kaydeder."""
    cm = confusion_matrix(y_test, y_pred)
    fig, ax = plt.subplots(figsize=(14, 12))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=target_names, yticklabels=target_names, ax=ax)
    ax.set_xlabel("Tahmin", fontsize=12)
    ax.set_ylabel("Gerçek", fontsize=12)
    ax.set_title(f"Confusion Matrix — Doğruluk: {accuracy:.1%}", fontsize=14)
    plt.tight_layout()
    cm_path = os.path.join(LETTER_MODELS_DIR, "static_letter_confusion_matrix.png")
    fig.savefig(cm_path, dpi=150)
    plt.close(fig)
    print(f"  Confusion matrix → {cm_path}")


def _save_model_comparison_chart(results: dict):
    """Model karşılaştırma bar chart (accuracy + inference time)."""
    names = list(results.keys())
    accuracies = [results[n]["accuracy"] for n in names]
    inf_times = [results[n]["inference_ms"] for n in names]
    cv_stds = [results[n]["cv_std"] for n in names]

    fig, ax1 = plt.subplots(figsize=(10, 6))

    x = np.arange(len(names))
    width = 0.35

    # Accuracy (sol eksen)
    bars1 = ax1.bar(x - width/2, accuracies, width, label='Doğruluk', color='#2196F3', alpha=0.8)
    ax1.set_ylabel('Doğruluk', color='#2196F3', fontsize=12)
    ax1.set_ylim(min(accuracies) - 0.02, 1.01)
    ax1.tick_params(axis='y', labelcolor='#2196F3')

    # Accuracy değerlerini bar üzerine yaz
    for bar, acc in zip(bars1, accuracies):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.002,
                 f'{acc:.3f}', ha='center', va='bottom', fontsize=10, fontweight='bold')

    # Inference time (sağ eksen)
    ax2 = ax1.twinx()
    bars2 = ax2.bar(x + width/2, inf_times, width, label='Inference (ms)', color='#FF9800', alpha=0.8)
    ax2.set_ylabel('Inference Süresi (ms)', color='#FF9800', fontsize=12)
    ax2.tick_params(axis='y', labelcolor='#FF9800')

    ax1.set_xlabel('Model', fontsize=12)
    ax1.set_xticks(x)
    ax1.set_xticklabels(names, fontsize=11)
    ax1.set_title('Model Karşılaştırması — Doğruluk vs Inference Süresi', fontsize=14)

    # Birleşik legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='lower right')

    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-model-comparison.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Model karşılaştırma → {path}")


def _save_class_f1_chart(f1_scores: list, target_names: list, model_name: str):
    """Sınıf bazlı F1-score bar chart."""
    fig, ax = plt.subplots(figsize=(12, 6))

    colors = ['#F44336' if f < 0.9 else '#FF9800' if f < 0.95 else '#4CAF50' for f in f1_scores]
    bars = ax.bar(target_names, f1_scores, color=colors, alpha=0.85)

    ax.set_xlabel('Harf', fontsize=12)
    ax.set_ylabel('F1-Score', fontsize=12)
    ax.set_title(f'Sınıf Bazlı F1-Score — {model_name}', fontsize=14)
    ax.set_ylim(min(f1_scores) - 0.05, 1.02)
    ax.axhline(y=0.95, color='gray', linestyle='--', alpha=0.5, label='%95 eşiği')
    ax.legend()

    # Düşük F1 değerlerini işaretle
    for bar, f1, name in zip(bars, f1_scores, target_names):
        if f1 < 0.95:
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.005,
                    f'{f1:.2f}', ha='center', va='bottom', fontsize=8, color='red')

    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-class-f1.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  F1-score chart → {path}")


def _save_feature_importance(model, n_features: int):
    """RF feature importance bar chart (top 20)."""
    if not hasattr(model, 'feature_importances_'):
        print("  Feature importance atlandı (model desteklemiyor)")
        return

    importances = model.feature_importances_

    # Özellik isimleri oluştur
    feature_names = []
    # 0-62: Ham koordinatlar
    for i in range(21):
        for axis in ['x', 'y', 'z']:
            feature_names.append(f"lm{i}_{axis}")
    # 63-67: Parmak ucu-bilek mesafeleri
    for finger in ['thumb', 'index', 'middle', 'ring', 'pinky']:
        feature_names.append(f"tip_wrist_{finger}")
    # 68-71: Komşu parmak mesafeleri
    for pair in ['thumb_index', 'index_middle', 'middle_ring', 'ring_pinky']:
        feature_names.append(f"adj_{pair}")
    # 72-85: Açılar
    angle_names = [
        'thumb_CMC_MCP_IP', 'thumb_MCP_IP_Tip',
        'index_W_MCP_PIP', 'index_MCP_PIP_DIP', 'index_PIP_DIP_Tip',
        'middle_W_MCP_PIP', 'middle_MCP_PIP_DIP', 'middle_PIP_DIP_Tip',
        'ring_W_MCP_PIP', 'ring_MCP_PIP_DIP', 'ring_PIP_DIP_Tip',
        'pinky_W_MCP_PIP', 'pinky_MCP_PIP_DIP', 'pinky_PIP_DIP_Tip',
    ]
    feature_names.extend(angle_names)
    # 86-87: Bounding box
    feature_names.extend(['bbox_aspect', 'bbox_area'])
    # 88-92: Parmak uzatılmışlık
    for finger in ['thumb', 'index', 'middle', 'ring', 'pinky']:
        feature_names.append(f"ext_{finger}")

    # Fazla veya eksik isim varsa genel isim kullan
    if len(feature_names) != n_features:
        feature_names = [f"f{i}" for i in range(n_features)]

    # Top 20
    top_k = min(20, n_features)
    top_indices = np.argsort(importances)[::-1][:top_k]
    top_names = [feature_names[i] for i in top_indices]
    top_values = importances[top_indices]

    fig, ax = plt.subplots(figsize=(10, 8))
    ax.barh(range(top_k), top_values[::-1], color='#2196F3', alpha=0.85)
    ax.set_yticks(range(top_k))
    ax.set_yticklabels(top_names[::-1], fontsize=9)
    ax.set_xlabel('Önem Skoru', fontsize=12)
    ax.set_title(f'Top {top_k} Özellik Önem Sırası (Random Forest)', fontsize=14)
    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-feature-importance.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Feature importance → {path}")


def _save_tsne(X_test, y_test, target_names):
    """t-SNE 2D görselleştirme."""
    from sklearn.manifold import TSNE

    n_samples = min(2000, len(X_test))
    indices = np.random.RandomState(42).choice(len(X_test), n_samples, replace=False)
    X_sub = X_test[indices]
    y_sub = y_test[indices]

    print(f"  t-SNE hesaplanıyor ({n_samples} örnek)...")
    tsne = TSNE(n_components=2, random_state=42, perplexity=30, n_iter=1000)
    X_2d = tsne.fit_transform(X_sub)

    fig, ax = plt.subplots(figsize=(14, 12))
    scatter = ax.scatter(
        X_2d[:, 0], X_2d[:, 1],
        c=y_sub, cmap='tab20', s=8, alpha=0.7,
    )

    # Her sınıf için etiket ekle
    for cls_idx in range(len(target_names)):
        mask = y_sub == cls_idx
        if mask.sum() > 0:
            cx = X_2d[mask, 0].mean()
            cy = X_2d[mask, 1].mean()
            ax.annotate(target_names[cls_idx], (cx, cy),
                        fontsize=9, fontweight='bold', ha='center',
                        bbox=dict(boxstyle='round,pad=0.2', facecolor='white', alpha=0.7))

    ax.set_title('t-SNE: ASL Harflerinin Özellik Uzayında Dağılımı', fontsize=14)
    ax.set_xlabel('t-SNE 1')
    ax.set_ylabel('t-SNE 2')
    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-tsne.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  t-SNE → {path}")


def _save_comparison_csv(results: dict):
    """Model karşılaştırma tablosunu CSV olarak kaydeder."""
    rows = []
    for name, r in results.items():
        rows.append({
            "Model": name,
            "Accuracy": f"{r['accuracy']:.4f}",
            "CV Mean": f"{r['cv_mean']:.4f}",
            "CV Std": f"{r['cv_std']:.4f}",
            "Train Time (s)": f"{r['train_time']:.1f}",
            "Inference (ms)": f"{r['inference_ms']:.3f}",
            "Min F1": f"{r['min_f1']:.3f}",
            "Min F1 Class": r['min_f1_class'],
        })

    df = pd.DataFrame(rows)
    path = os.path.join(LETTER_MODELS_DIR, "letter_model_comparison.csv")
    df.to_csv(path, index=False)
    print(f"  Karşılaştırma CSV → {path}")
    print(f"\n{df.to_string(index=False)}")


# ═══════════════════════════════════════════════════════
#  Ana akış
# ═══════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="ASL Harf Modeli — Tek Komutlu Eğitim",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Örnekler:
  python scripts/model_training/train_static_letter_model.py                          # Varsayılan
  python scripts/model_training/train_static_letter_model.py --max-images 500         # Hızlı test
  python scripts/model_training/train_static_letter_model.py --full-comparison         # 5 model
  python scripts/model_training/train_static_letter_model.py --no-features             # FE kapalı
  python scripts/model_training/train_static_letter_model.py --model xgboost           # Sadece XGBoost
        """,
    )
    parser.add_argument("--max-images", type=int, default=0,
                        help="Harf başına max görsel (0=sınırsız)")
    parser.add_argument("--model", choices=["rf", "xgboost", "lgbm_or_svm", "mlp", "conv1d"], default="rf",
                        help="Model tipi (varsayılan: rf, --full-comparison ile kullanılmaz)")
    parser.add_argument("--full-comparison", action="store_true",
                        help="5 modeli karşılaştır + tüm görselleştirmeler")
    parser.add_argument("--no-features", action="store_true",
                        help="Feature engineering olmadan eğit (63D)")
    parser.add_argument("--no-augment", action="store_true",
                        help="Augmentation uygulama")
    parser.add_argument("--dataset", type=str, default=None,
                        help="Dataset klasörü (otomatik bulunur)")
    parser.add_argument("--from-csv", action="store_true",
                        help="Önceden hazırlanmış CSV'den yükle (extract_landmarks + merge_datasets)")
    parser.add_argument("--train-csv", type=str, default=None,
                        help="Eğitim CSV dosyası (--from-csv ile)")
    parser.add_argument("--test-csv", type=str, default=None,
                        help="Test CSV dosyası (--from-csv ile, opsiyonel)")
    args = parser.parse_args()

    # ── Başlık ──
    print("=" * 60)
    print("  🔤 ASL Harf Modeli Eğitimi")
    print("=" * 60)

    use_features = not args.no_features
    use_augment = not args.no_augment

    # ── CSV'den yükleme modu ──
    if args.from_csv:
        t0 = time.time()
        train_csv = args.train_csv or os.path.join(PROCESSED_DATA_DIR, "train_landmarks.csv")
        test_csv = args.test_csv

        if not os.path.exists(train_csv):
            print(f"\n❌ HATA: CSV bulunamadı: {train_csv}")
            print("  Önce dataset hazırlığını yapın:")
            print('  python scripts/data_preparation/extract_static_letter_landmarks.py --input "data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train" --output "data/processed/asl_alphabet_landmarks.csv"')
            print("  python scripts/data_preparation/merge_static_letter_datasets.py")
            sys.exit(1)

        print(f"\n  Mod:           CSV'den yükleme")
        print(f"  Train CSV:     {train_csv}")
        if test_csv:
            print(f"  Test CSV:      {test_csv}")
        print(f"  Feature Eng.:  {'✓ Açık' if use_features else '✗ Kapalı'}")
        print(f"  Augmentation:  {'✗ Kapalı' if args.no_augment else f'✓ {AUGMENTATION_MULTIPLIER}x'}")
        print(f"  Mod:           {'Tam Karşılaştırma (5 model)' if args.full_comparison else args.model.upper()}")

        import pandas as _pd
        train_df = _pd.read_csv(train_csv)
        y_str = train_df["label"].values
        X = train_df.drop(columns=["label"]).values.astype(np.float32)
        print(f"\n  Yüklendi: {len(X)} örnek, {len(set(y_str))} sınıf, {X.shape[1]}D")

        if test_csv and os.path.exists(test_csv):
            test_df = _pd.read_csv(test_csv)
            print(f"  Test CSV: {len(test_df)} örnek yüklendi ({test_csv})")

        # Augmentation
        if use_augment:
            print(f"\n{'─'*60}")
            print("  🔄 Augmentation")
            print(f"{'─'*60}")
            X, y_str = augment_data(X, y_str)
        else:
            print("  Augmentation atlandı.")

    else:
        # ── Görsellerden çıkarım modu (mevcut davranış) ──
        if args.dataset:
            ds_name = "Kullanıcı belirtti"
            ds_path = args.dataset
        else:
            ds_name, ds_path, ds_size = find_dataset()

        if not ds_path or not os.path.isdir(ds_path):
            print("\n❌ HATA: Dataset bulunamadı!")
            print("  Beklenen konumlar:")
            for name, path, _ in DATASET_CANDIDATES:
                exists = "✓" if os.path.isdir(path) else "✗"
                print(f"    {exists} {name}: {path}")
            print("\n  Dataset'i data/raw/ altına indirin.")
            print("\n  Alternatif: Önceden hazırlanmış CSV ile:")
            print("    python scripts/model_training/train_static_letter_model.py --from-csv")
            sys.exit(1)

        print(f"\n  Dataset:          {ds_name}")
        print(f"  Yol:              {ds_path}")
        print(f"  Max görsel:       {'sınırsız' if args.max_images == 0 else args.max_images}")
        print(f"  Feature Eng.:     {'✓ Açık' if use_features else '✗ Kapalı'}")
        print(f"  Augmentation:     {'✗ Kapalı' if args.no_augment else f'✓ {AUGMENTATION_MULTIPLIER}x'}")
        print(f"  Mod:              {'Tam Karşılaştırma (5 model)' if args.full_comparison else args.model.upper()}")

        # ── Adım 1: Keypoint çıkarımı ──
        print(f"\n{'─'*60}")
        print("  📸 Adım 1/4: Görsellerden keypoint çıkarımı")
        print(f"{'─'*60}")

        t0 = time.time()
        X, y_str, stats = extract_all_keypoints(ds_path, args.max_images)
        t1 = time.time()
        print(f"\n  ⏱ Süre: {t1-t0:.0f} saniye")

        if len(X) == 0:
            print("\n❌ HATA: Hiç keypoint çıkarılamadı!")
            sys.exit(1)

        # ── Adım 2: Augmentation (ham 63D üzerine) ──
        print(f"\n{'─'*60}")
        print("  🔄 Adım 2/4: Augmentation")
        print(f"{'─'*60}")

        if use_augment:
            X, y_str = augment_data(X, y_str)
        else:
            print("  Augmentation atlandı.")

    # ── Adım 3: Feature Engineering ──
    print(f"\n{'─'*60}")
    print("  🧬 Adım 3/4: Feature Engineering")
    print(f"{'─'*60}")

    if use_features:
        X = apply_feature_engineering(X)
    else:
        print("  Feature engineering atlandı (63D ham koordinatlar kullanılacak).")

    # ── Adım 4: Model eğitimi ──
    print(f"\n{'─'*60}")
    print("  🎯 Adım 4/4: Model eğitimi ve değerlendirme")
    print(f"{'─'*60}")

    if args.full_comparison:
        model, label_map, acc, results = train_full_comparison(
            X, y_str, use_features=use_features, use_augment=use_augment,
        )
    else:
        model, label_map, acc, metadata = train_single_model(
            X, y_str, model_type=args.model,
            use_features=use_features, use_augment=use_augment,
        )

    t_total = time.time() - t0

    # ── Özet ──
    print(f"\n{'═'*60}")
    print(f"  ✅ TAMAMLANDI!")
    print(f"  Doğruluk:    {acc:.1%}")
    print(f"  Özellikler:  {X.shape[1]}D ({'feature engineering' if use_features else 'ham'})")
    print(f"  Süre:        {t_total/60:.1f} dakika")
    print(f"  Model:       {LETTER_MODEL_PATH}")
    print(f"{'═'*60}")
    print(f"\n  Sonraki adım:")
    print(f"    python scripts/model_training/train_dynamic_jz_model.py")


if __name__ == "__main__":
    main()
