#!/usr/bin/env python3
"""Train and compare models for the 24-class static-letter task.

The pipeline can extract normalized 63D MediaPipe hand landmarks from images,
augment those landmarks, build the frozen 93D engineered feature vector, split
the dataset, and train one model or compare five model families: Random Forest,
XGBoost, LightGBM (SVM fallback), MLP, and a small 1D CNN.

Examples (activate any compatible Python environment first):
  python scripts/model_training/train_static_letter_model.py                         # defaults
  python scripts/model_training/train_static_letter_model.py --max-images 500        # quick run
  python scripts/model_training/train_static_letter_model.py --full-comparison       # five models, all figures
  python scripts/model_training/train_static_letter_model.py --no-features           # raw 63D input
  python scripts/model_training/train_static_letter_model.py --no-augment            # no augmentation
  python scripts/model_training/train_static_letter_model.py --model xgboost         # XGBoost only

Every run writes ``letter_model.pkl``, ``letter_label_map.json``,
``letter_model_meta.json`` and a confusion matrix to ``models/letter/``, over the
published files. ``--full-comparison`` adds ``letter_model_comparison.csv`` there
and its charts to ``docs/assets/``.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import joblib
import matplotlib
import mediapipe as mp
import numpy as np
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import cross_val_score
from sklearn.neural_network import MLPClassifier

try:
    from .data_split import prepare_evaluation_split
except ImportError:  # Direct script execution: python scripts/model_training/...
    from data_split import prepare_evaluation_split

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
import torch
import torch.nn as nn
from sklearn.base import BaseEstimator, ClassifierMixin

# Keep the comparison runnable when LightGBM is unavailable.
try:
    from lightgbm import LGBMClassifier

    LGBM_AVAILABLE = True
except ImportError:
    LGBM_AVAILABLE = False
    print("WARNING: LightGBM not found, falling back to SVM")
    from sklearn.svm import SVC


class _Conv1DNet(nn.Module):
    """Treat a feature vector as a one-dimensional signal."""

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
        # Conv1d expects ``(batch, channels, features)``.
        x = x.unsqueeze(1)
        return self.net(x)


class Conv1DClassifier(BaseEstimator, ClassifierMixin):
    """Expose the PyTorch 1D CNN through the scikit-learn estimator API."""

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
        # Cross-validation folds may contain different encoded label subsets.
        label_map = {lbl: i for i, lbl in enumerate(self.classes_)}
        y_mapped = np.array([label_map[yi] for yi in y])

        X_t = torch.tensor(X, dtype=torch.float32)
        y_t = torch.tensor(y_mapped, dtype=torch.long)

        self.model_ = _Conv1DNet(X.shape[1], n_classes).to(self.device)
        optimizer = torch.optim.Adam(self.model_.parameters(), lr=self.lr)
        criterion = nn.CrossEntropyLoss()

        # Stops once the training loss stops improving; no data is held out here.
        best_loss = float("inf")
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


# Import asl_features from the source tree, so the script runs without an install.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASL_FEATURES_SRC = os.path.join(PROJECT_ROOT, "asl-features", "src")
if ASL_FEATURES_SRC not in sys.path:
    sys.path.insert(0, ASL_FEATURES_SRC)

from asl_features.config import (
    AUGMENTATION_MULTIPLIER,
    AUGMENTATION_NOISE_STD,
    AUGMENTATION_ROTATION_RANGE,
    AUGMENTATION_SCALE_RANGE,
    MIN_DETECTION_CONFIDENCE,
    NUM_HANDS,
    NUM_LANDMARKS,
    STATIC_LETTERS,
)
from asl_features.landmarks import normalize_landmarks
from asl_features.letter import extract_features

PROCESSED_DATA_DIR = os.path.join(PROJECT_ROOT, "data", "processed")
LETTER_MODELS_DIR = os.path.join(PROJECT_ROOT, "models", "letter")
LETTER_MODEL_PATH = os.path.join(LETTER_MODELS_DIR, "letter_model.pkl")
LETTER_LABEL_MAP_PATH = os.path.join(LETTER_MODELS_DIR, "letter_label_map.json")
DOCS_ASSETS_DIR = os.path.join(PROJECT_ROOT, "docs", "assets")

RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")

DATASET_CANDIDATES = [
    (
        "ASL Alphabet (Kaggle)",
        os.path.join(RAW_DIR, "ASL Alphabet", "asl_alphabet_train", "asl_alphabet_train"),
        "3000",
    ),
    ("American Sign Language", os.path.join(RAW_DIR, "American Sign Language Dataset"), "~70"),
    ("MediaPipe_Processed_Asl", os.path.join(RAW_DIR, "MediaPipe_Processed_Asl"), "~3000-5000"),
]


def find_dataset():
    """Return the first available dataset from the documented priority list."""
    for name, path, per_class in DATASET_CANDIDATES:
        if os.path.isdir(path):
            for letter in ["a", "A", "b", "B"]:
                letter_dir = os.path.join(path, letter)
                if os.path.isdir(letter_dir):
                    files = [
                        f
                        for f in os.listdir(letter_dir)
                        if f.lower().endswith((".jpg", ".jpeg", ".png"))
                    ]
                    if len(files) > 10:
                        return name, path, per_class
    return None, None, None


def extract_all_keypoints(dataset_dir: str, max_per_class: int = 0) -> tuple:
    """Extract normalized keypoints from every static-letter folder.

    Returns:
        Feature rows, string labels, and per-class extraction statistics.
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
            print(f"  [{letter}] Folder not found")
            stats[letter] = {"found": 0, "missed": 0}
            continue

        images = sorted(
            [
                f
                for f in letter_dir.iterdir()
                if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
            ]
        )

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
        print(f"  [{letter}] {found} keypoints, {missed} without a hand  ({elapsed:.0f}s)")

    hands.close()

    X = np.array(all_X, dtype=np.float32)
    y_str = np.array(all_y)

    total = sum(s["found"] for s in stats.values())
    print(f"\n  Total: {total} samples, {len(set(all_y))} classes")

    return X, y_str, stats


def augment_data(
    X: np.ndarray,
    y: np.ndarray,
    multiplier: int = AUGMENTATION_MULTIPLIER,
) -> tuple:
    """Augment raw 63D landmarks with noise, rotation, and scale changes."""
    print(f"\n  Augmenting ({multiplier}x)...")

    aug_X_list = []
    aug_y_list = []

    for sample, label in zip(X, y):
        for _ in range(multiplier):
            aug = sample.copy()
            aug += np.random.normal(0, AUGMENTATION_NOISE_STD, aug.shape).astype(np.float32)

            # Rotate x/y coordinates around the z axis.
            angle = np.radians(
                np.random.uniform(-AUGMENTATION_ROTATION_RANGE, AUGMENTATION_ROTATION_RANGE)
            )
            cos_a, sin_a = np.cos(angle), np.sin(angle)
            rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)
            coords = aug.reshape(NUM_LANDMARKS, 3)
            coords[:, :2] = (rot @ coords[:, :2].T).T

            # Simulate changes in hand-to-camera distance.
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

    print(f"  {X.shape[0]} -> {X_aug.shape[0]} samples")
    return X_aug, y_aug


def apply_feature_engineering(X_raw: np.ndarray) -> np.ndarray:
    """Convert raw 63D landmarks to the frozen 93D letter feature contract.

    Args:
        X_raw: Raw normalized landmarks with shape ``(N, 63)``.

    Returns:
        Engineered features with shape ``(N, 93)``.
    """
    print(f"\n  Engineering features ({X_raw.shape[0]} samples)...")
    X_features = np.array([extract_features(row) for row in X_raw])
    print(f"  {X_raw.shape[1]}D -> {X_features.shape[1]}D")
    return X_features


def train_single_model(
    X: np.ndarray,
    y_str: np.ndarray,
    model_type: str = "rf",
    use_features: bool = True,
    use_augment: bool = True,
    X_external: np.ndarray | None = None,
    y_external_str: np.ndarray | None = None,
) -> tuple:
    """Train, evaluate, and persist one selected model family.

    Returns:
        The fitted model, label map, test accuracy, and metadata.
    """
    label_map, X_train, X_test, y_train, y_test, evaluation_source = prepare_evaluation_split(
        X,
        y_str,
        X_external,
        y_external_str,
    )

    print(f"\n  Classes: {len(label_map)}")
    print(f"  Total samples: {len(y_train) + len(y_test)}")
    print(f"  Feature size: {X.shape[1]}")
    print(f"  Train: {len(y_train)}, Test: {len(y_test)} ({evaluation_source})")

    model = _create_model(model_type)
    model_name = _model_display_name(model_type)

    print(f"\n  Training {model_name}...")
    t0 = time.time()
    if model_type == "xgboost":
        model.fit(X_train, y_train, verbose=False)
    else:
        model.fit(X_train, y_train)
    train_time = time.time() - t0

    # Evaluate the held-out split.
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    # Per-sample time of one batched predict call, not single-request latency.
    t0 = time.time()
    model.predict(X_test[: min(1000, len(X_test))])
    inference_ms = (time.time() - t0) / min(1000, len(X_test)) * 1000

    inv_map = {v: k for k, v in label_map.items()}
    target_names = [inv_map[i] for i in sorted(inv_map.keys())]

    print(f"\n{'=' * 50}")
    print(f"  TEST ACCURACY: {acc:.4f} ({acc * 100:.1f}%)")
    print(f"  Training time:  {train_time:.1f}s")
    print(f"  Inference:      {inference_ms:.3f}ms/prediction")
    print(f"{'=' * 50}")
    print(
        classification_report(
            y_test,
            y_pred,
            labels=list(range(len(target_names))),
            target_names=target_names,
            zero_division=0,
        )
    )

    # Persist the fitted Python model and label contract.
    os.makedirs(os.path.dirname(LETTER_MODEL_PATH), exist_ok=True)
    joblib.dump(model, LETTER_MODEL_PATH)
    print(f"  Model -> {LETTER_MODEL_PATH}")

    with open(LETTER_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"  Label map -> {LETTER_LABEL_MAP_PATH}")

    # Record the training configuration and key metrics.
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
        "evaluation_source": evaluation_source,
        "trained_at": datetime.now().isoformat(),
    }
    meta_path = os.path.splitext(LETTER_MODEL_PATH)[0] + "_meta.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  Metadata -> {meta_path}")

    # Export the primary error-analysis figure.
    _save_confusion_matrix(y_test, y_pred, target_names, acc)

    return model, label_map, acc, metadata


def train_full_comparison(
    X: np.ndarray,
    y_str: np.ndarray,
    use_features: bool = True,
    use_augment: bool = True,
    X_external: np.ndarray | None = None,
    y_external_str: np.ndarray | None = None,
) -> tuple:
    """Compare five model families and persist the best held-out result.

    Returns:
        Best model, label map, accuracy, and all comparison results.
    """
    label_map, X_train, X_test, y_train, y_test, evaluation_source = prepare_evaluation_split(
        X,
        y_str,
        X_external,
        y_external_str,
    )
    inv_map = {v: k for k, v in label_map.items()}
    target_names = [inv_map[i] for i in sorted(inv_map.keys())]

    print(f"\n  Classes: {len(label_map)}")
    print(f"  Total samples: {len(y_train) + len(y_test)}")
    print(f"  Feature size: {X.shape[1]}")
    print(f"  Train: {len(y_train)}, Test: {len(y_test)} ({evaluation_source})")

    # Four conventional estimators and one compact neural baseline.
    model_configs = [
        ("rf", "Random Forest"),
        ("xgboost", "XGBoost"),
        ("lgbm_or_svm", "LightGBM" if LGBM_AVAILABLE else "SVM"),
        ("mlp", "MLP"),
        ("conv1d", "1D CNN"),
    ]

    print(f"\n{'=' * 60}")
    print("  MODEL COMPARISON (5 models, 5-fold CV)")
    print(f"{'=' * 60}")

    results = {}
    all_models = {}

    for model_key, model_name in model_configs:
        print(f"\n  {model_name}")
        model = _create_model(model_key)

        t0 = time.time()
        if model_key == "xgboost":
            model.fit(X_train, y_train, verbose=False)
        else:
            model.fit(X_train, y_train)
        train_time = time.time() - t0

        y_pred = model.predict(X_test)
        acc = accuracy_score(y_test, y_pred)

        # Per-sample time of one batched predict call.
        n_test = min(1000, len(X_test))
        t0 = time.time()
        model.predict(X_test[:n_test])
        inference_ms = (time.time() - t0) / n_test * 1000

        # Cross-validation accuracy on the training split.
        print("    Running 5-fold CV...")
        cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring="accuracy", n_jobs=-1)

        # Per-class F1 for comparison and visualization.
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

        print(f"    Accuracy:  {acc:.4f} ({acc * 100:.1f}%)")
        print(f"    CV:        {cv_scores.mean():.4f} +/- {cv_scores.std():.4f}")
        print(f"    Training:  {train_time:.1f}s")
        print(f"    Inference: {inference_ms:.3f}ms/prediction")
        print(f"    Weakest:   {min_f1_class} (F1={min_f1:.3f})")

    # The winner is chosen by held-out accuracy, not by the CV mean.
    best_name = max(results, key=lambda k: results[k]["accuracy"])
    best_model = all_models[best_name]
    best_acc = results[best_name]["accuracy"]
    best_pred = results[best_name]["y_pred"]

    print(f"\n{'=' * 60}")
    print(f"  WINNER: {best_name} (accuracy: {best_acc:.4f})")
    print(f"{'=' * 60}")
    print(
        classification_report(
            y_test,
            best_pred,
            labels=list(range(len(target_names))),
            target_names=target_names,
            zero_division=0,
        )
    )

    # Persist the selected model and its contracts.
    os.makedirs(os.path.dirname(LETTER_MODEL_PATH), exist_ok=True)
    os.makedirs(DOCS_ASSETS_DIR, exist_ok=True)

    joblib.dump(best_model, LETTER_MODEL_PATH)
    print(f"\n  Model -> {LETTER_MODEL_PATH}")

    with open(LETTER_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"  Label map -> {LETTER_LABEL_MAP_PATH}")

    # Store the complete winning-model summary.
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
        "evaluation_source": evaluation_source,
        "trained_at": datetime.now().isoformat(),
    }
    meta_path = os.path.splitext(LETTER_MODEL_PATH)[0] + "_meta.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  Metadata -> {meta_path}")

    # Export comparison and error-analysis figures.
    _save_confusion_matrix(y_test, best_pred, target_names, best_acc)
    _save_model_comparison_chart(results)
    _save_class_f1_chart(results[best_name]["f1_per_class"], target_names, best_name)
    _save_feature_importance(all_models.get("Random Forest", best_model), X.shape[1])
    _save_tsne(X_test, y_test, target_names)
    _save_comparison_csv(results)

    return best_model, label_map, best_acc, results


def _create_model(model_type: str):
    """Construct an estimator from its CLI identifier."""
    if model_type == "rf":
        return RandomForestClassifier(
            n_estimators=300, random_state=42, n_jobs=-1, class_weight="balanced"
        )
    elif model_type == "xgboost":
        return xgb.XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1,
            eval_metric="mlogloss",
        )
    elif model_type == "lgbm_or_svm":
        if LGBM_AVAILABLE:
            return LGBMClassifier(
                n_estimators=300,
                random_state=42,
                verbose=-1,
                n_jobs=-1,
            )
        else:
            return SVC(kernel="rbf", C=10, probability=True, random_state=42)
    elif model_type == "mlp":
        return MLPClassifier(
            hidden_layer_sizes=(256, 128, 64),
            max_iter=500,
            random_state=42,
            early_stopping=True,
        )
    elif model_type == "conv1d":
        return Conv1DClassifier(
            epochs=100,
            lr=0.001,
            batch_size=64,
            patience=10,
        )
    else:
        raise ValueError(f"Unknown model type: {model_type}")


def _model_display_name(model_type: str) -> str:
    """Return the human-readable name of an estimator."""
    names = {
        "rf": "Random Forest",
        "xgboost": "XGBoost",
        "lgbm_or_svm": "LightGBM" if LGBM_AVAILABLE else "SVM",
        "mlp": "MLP",
        "conv1d": "1D CNN",
    }
    return names.get(model_type, model_type)


def _save_confusion_matrix(y_test, y_pred, target_names, accuracy):
    """Save the held-out confusion matrix heatmap."""
    cm = confusion_matrix(y_test, y_pred, labels=list(range(len(target_names))))
    fig, ax = plt.subplots(figsize=(14, 12))
    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=target_names,
        yticklabels=target_names,
        ax=ax,
    )
    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("Actual", fontsize=12)
    ax.set_title(f"Confusion matrix (accuracy {accuracy:.1%})", fontsize=14)
    plt.tight_layout()
    cm_path = os.path.join(LETTER_MODELS_DIR, "static_letter_confusion_matrix.png")
    fig.savefig(cm_path, dpi=150)
    plt.close(fig)
    print(f"  Confusion matrix -> {cm_path}")


def _save_model_comparison_chart(results: dict):
    """Save the accuracy and inference-latency comparison chart."""
    names = list(results.keys())
    accuracies = [results[n]["accuracy"] for n in names]
    inf_times = [results[n]["inference_ms"] for n in names]
    fig, ax1 = plt.subplots(figsize=(10, 6))

    x = np.arange(len(names))
    width = 0.35

    # Accuracy uses the left axis.
    bars1 = ax1.bar(x - width / 2, accuracies, width, label="Accuracy", color="#2196F3", alpha=0.8)
    ax1.set_ylabel("Accuracy", color="#2196F3", fontsize=12)
    ax1.set_ylim(min(accuracies) - 0.02, 1.01)
    ax1.tick_params(axis="y", labelcolor="#2196F3")

    # Label accuracy bars with their exact values.
    for bar, acc in zip(bars1, accuracies):
        ax1.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.002,
            f"{acc:.3f}",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    # Inference latency uses the right axis.
    ax2 = ax1.twinx()
    ax2.bar(x + width / 2, inf_times, width, label="Inference (ms)", color="#FF9800", alpha=0.8)
    ax2.set_ylabel("Inference time (ms)", color="#FF9800", fontsize=12)
    ax2.tick_params(axis="y", labelcolor="#FF9800")

    ax1.set_xlabel("Model", fontsize=12)
    ax1.set_xticks(x)
    ax1.set_xticklabels(names, fontsize=11)
    ax1.set_title("Model comparison: accuracy and inference time", fontsize=14)

    # Merge legends from both axes.
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="lower right")

    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-model-comparison.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Model comparison -> {path}")


def _save_class_f1_chart(f1_scores: list, target_names: list, model_name: str):
    """Save per-class F1 scores for the selected model."""
    fig, ax = plt.subplots(figsize=(12, 6))

    colors = ["#F44336" if f < 0.9 else "#FF9800" if f < 0.95 else "#4CAF50" for f in f1_scores]
    bars = ax.bar(target_names, f1_scores, color=colors, alpha=0.85)

    ax.set_xlabel("Letter", fontsize=12)
    ax.set_ylabel("F1-Score", fontsize=12)
    ax.set_title(f"Per-class F1 score ({model_name})", fontsize=14)
    ax.set_ylim(min(f1_scores) - 0.05, 1.02)
    ax.axhline(y=0.95, color="gray", linestyle="--", alpha=0.5, label="95% threshold")
    ax.legend()

    # Label classes below the reference threshold.
    for bar, f1, name in zip(bars, f1_scores, target_names):
        if f1 < 0.95:
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.005,
                f"{f1:.2f}",
                ha="center",
                va="bottom",
                fontsize=8,
                color="red",
            )

    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-class-f1.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  F1 score chart -> {path}")


def _save_feature_importance(model, n_features: int):
    """Save the top Random Forest feature importances when available."""
    if not hasattr(model, "feature_importances_"):
        print("  Feature importance skipped (the model does not support it)")
        return

    importances = model.feature_importances_

    # Generate names in the same order as the frozen 93D contract.
    feature_names = []
    # 0-62: normalized coordinates.
    for i in range(21):
        for axis in ["x", "y", "z"]:
            feature_names.append(f"lm{i}_{axis}")
    # 63-67: fingertip-to-wrist distances.
    for finger in ["thumb", "index", "middle", "ring", "pinky"]:
        feature_names.append(f"tip_wrist_{finger}")
    # 68-71: adjacent-fingertip distances.
    for pair in ["thumb_index", "index_middle", "middle_ring", "ring_pinky"]:
        feature_names.append(f"adj_{pair}")
    # 72-85: joint angles.
    angle_names = [
        "thumb_CMC_MCP_IP",
        "thumb_MCP_IP_Tip",
        "index_W_MCP_PIP",
        "index_MCP_PIP_DIP",
        "index_PIP_DIP_Tip",
        "middle_W_MCP_PIP",
        "middle_MCP_PIP_DIP",
        "middle_PIP_DIP_Tip",
        "ring_W_MCP_PIP",
        "ring_MCP_PIP_DIP",
        "ring_PIP_DIP_Tip",
        "pinky_W_MCP_PIP",
        "pinky_MCP_PIP_DIP",
        "pinky_PIP_DIP_Tip",
    ]
    feature_names.extend(angle_names)
    # 86-87: bounding-box features.
    feature_names.extend(["bbox_aspect", "bbox_area"])
    # 88-92: finger-extension flags.
    for finger in ["thumb", "index", "middle", "ring", "pinky"]:
        feature_names.append(f"ext_{finger}")

    # Fall back to generic names for nonstandard feature widths.
    if len(feature_names) != n_features:
        feature_names = [f"f{i}" for i in range(n_features)]

    # Keep the figure readable by limiting it to the strongest features.
    top_k = min(20, n_features)
    top_indices = np.argsort(importances)[::-1][:top_k]
    top_names = [feature_names[i] for i in top_indices]
    top_values = importances[top_indices]

    fig, ax = plt.subplots(figsize=(10, 8))
    ax.barh(range(top_k), top_values[::-1], color="#2196F3", alpha=0.85)
    ax.set_yticks(range(top_k))
    ax.set_yticklabels(top_names[::-1], fontsize=9)
    ax.set_xlabel("Importance score", fontsize=12)
    ax.set_title(f"Top {top_k} feature importances (Random Forest)", fontsize=14)
    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-feature-importance.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  Feature importance -> {path}")


def _save_tsne(X_test, y_test, target_names):
    """Save a deterministic 2D t-SNE projection of held-out features."""
    from sklearn.manifold import TSNE

    n_samples = min(2000, len(X_test))
    indices = np.random.RandomState(42).choice(len(X_test), n_samples, replace=False)
    X_sub = X_test[indices]
    y_sub = y_test[indices]

    print(f"  Computing t-SNE ({n_samples} samples)...")
    tsne = TSNE(n_components=2, random_state=42, perplexity=30, max_iter=1000)
    X_2d = tsne.fit_transform(X_sub)

    fig, ax = plt.subplots(figsize=(14, 12))
    ax.scatter(
        X_2d[:, 0],
        X_2d[:, 1],
        c=y_sub,
        cmap="tab20",
        s=8,
        alpha=0.7,
    )

    # Annotate each class near its projected centroid.
    for cls_idx in range(len(target_names)):
        mask = y_sub == cls_idx
        if mask.sum() > 0:
            cx = X_2d[mask, 0].mean()
            cy = X_2d[mask, 1].mean()
            ax.annotate(
                target_names[cls_idx],
                (cx, cy),
                fontsize=9,
                fontweight="bold",
                ha="center",
                bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.7),
            )

    ax.set_title("t-SNE: ASL letters in feature space", fontsize=14)
    ax.set_xlabel("t-SNE 1")
    ax.set_ylabel("t-SNE 2")
    plt.tight_layout()
    path = os.path.join(DOCS_ASSETS_DIR, "static-letter-tsne.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"  t-SNE -> {path}")


def _save_comparison_csv(results: dict):
    """Save the model comparison metrics as CSV."""
    rows = []
    for name, r in results.items():
        rows.append(
            {
                "Model": name,
                "Accuracy": f"{r['accuracy']:.4f}",
                "CV Mean": f"{r['cv_mean']:.4f}",
                "CV Std": f"{r['cv_std']:.4f}",
                "Train Time (s)": f"{r['train_time']:.1f}",
                "Inference (ms)": f"{r['inference_ms']:.3f}",
                "Min F1": f"{r['min_f1']:.3f}",
                "Min F1 Class": r["min_f1_class"],
            }
        )

    df = pd.DataFrame(rows)
    path = os.path.join(LETTER_MODELS_DIR, "letter_model_comparison.csv")
    df.to_csv(path, index=False)
    print(f"  Comparison CSV -> {path}")
    print(f"\n{df.to_string(index=False)}")


def next_step_hint() -> str:
    """The text printed after training, naming the follow-up command."""
    return (
        "\n  Next step (optional): J and Z are motion letters and are not in this model."
        "\n  To collect data with a camera and train them:"
        "\n    python scripts/model_training/train_dynamic_jz_model.py all"
    )


def main():
    parser = argparse.ArgumentParser(
        description="ASL letter model: train with a single command",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/model_training/train_static_letter_model.py                          # Default
  python scripts/model_training/train_static_letter_model.py --max-images 500         # Quick test
  python scripts/model_training/train_static_letter_model.py --full-comparison         # 5 models
  python scripts/model_training/train_static_letter_model.py --no-features             # Feature engineering off
  python scripts/model_training/train_static_letter_model.py --model xgboost           # XGBoost only
        """,
    )
    parser.add_argument(
        "--max-images", type=int, default=0, help="Maximum images per letter (0 = no limit)"
    )
    parser.add_argument(
        "--model",
        choices=["rf", "xgboost", "lgbm_or_svm", "mlp", "conv1d"],
        default="rf",
        help="Model type (default: rf, not used with --full-comparison)",
    )
    parser.add_argument(
        "--full-comparison",
        action="store_true",
        help="Compare the 5 models and write all charts",
    )
    parser.add_argument(
        "--no-features", action="store_true", help="Train without feature engineering (63D)"
    )
    parser.add_argument("--no-augment", action="store_true", help="Skip augmentation")
    parser.add_argument(
        "--dataset", type=str, default=None, help="Dataset folder (found automatically by default)"
    )
    parser.add_argument(
        "--from-csv",
        action="store_true",
        help="Load a prepared CSV (from extract_static_letter_landmarks + merge_static_letter_datasets)",
    )
    parser.add_argument(
        "--train-csv", type=str, default=None, help="Training CSV file (with --from-csv)"
    )
    parser.add_argument(
        "--test-csv", type=str, default=None, help="Test CSV file (with --from-csv, optional)"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  ASL letter model training")
    print("=" * 60)

    use_features = not args.no_features
    use_augment = not args.no_augment
    X_external = None
    y_external_str = None

    # Load a pre-extracted landmark CSV when requested.
    if args.from_csv:
        t0 = time.time()
        train_csv = args.train_csv or os.path.join(PROCESSED_DATA_DIR, "train_landmarks.csv")
        test_csv = args.test_csv

        if not os.path.exists(train_csv):
            print(f"\nERROR: CSV not found: {train_csv}")
            print("  Prepare the dataset first:")
            print(
                '  python scripts/data_preparation/extract_static_letter_landmarks.py --input "data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train" --output "data/processed/asl_alphabet_landmarks.csv"'
            )
            print("  python scripts/data_preparation/merge_static_letter_datasets.py")
            sys.exit(1)

        print("\n  Source:        prepared CSV")
        print(f"  Train CSV:     {train_csv}")
        if test_csv:
            print(f"  Test CSV:      {test_csv}")
        print(f"  Feature eng.:  {'on' if use_features else 'off'}")
        print(f"  Augmentation:  {'off' if args.no_augment else f'{AUGMENTATION_MULTIPLIER}x'}")
        print(
            f"  Model:         {'full comparison (5 models)' if args.full_comparison else args.model.upper()}"
        )

        import pandas as _pd

        train_df = _pd.read_csv(train_csv)
        y_str = train_df["label"].values
        X = train_df.drop(columns=["label"]).values.astype(np.float32)
        print(f"\n  Loaded: {len(X)} samples, {len(set(y_str))} classes, {X.shape[1]}D")

        if test_csv and not os.path.exists(test_csv):
            print(f"\nERROR: Test CSV not found: {test_csv}")
            sys.exit(1)

        if test_csv:
            test_df = _pd.read_csv(test_csv)
            y_external_str = test_df["label"].values
            X_external = test_df.drop(columns=["label"]).values.astype(np.float32)
            print(f"  Test CSV: {len(test_df)} samples loaded ({test_csv})")

        # Augment the training CSV only, before feature engineering. Without
        # --test-csv the split runs on the augmented rows, so copies of one row
        # can land on both sides: that score only compares settings.
        if use_augment:
            print(f"\n{'-' * 60}")
            print("  Augmentation")
            print(f"{'-' * 60}")
            X, y_str = augment_data(X, y_str)
        else:
            print("  Augmentation skipped.")

    else:
        # Otherwise discover an image dataset and extract landmarks.
        if args.dataset:
            ds_name = "given on the command line"
            ds_path = args.dataset
        else:
            ds_name, ds_path, ds_size = find_dataset()

        if not ds_path or not os.path.isdir(ds_path):
            print("\nERROR: Dataset not found.")
            print("  Expected locations:")
            for name, path, _ in DATASET_CANDIDATES:
                exists = "[found]" if os.path.isdir(path) else "[missing]"
                print(f"    {exists} {name}: {path}")
            print("\n  Download the dataset into data/raw/.")
            print("\n  Alternative: use a prepared CSV:")
            print("    python scripts/model_training/train_static_letter_model.py --from-csv")
            sys.exit(1)

        print(f"\n  Dataset:          {ds_name}")
        print(f"  Path:             {ds_path}")
        print(f"  Max images:       {'no limit' if args.max_images == 0 else args.max_images}")
        print(f"  Feature eng.:     {'on' if use_features else 'off'}")
        print(f"  Augmentation:     {'off' if args.no_augment else f'{AUGMENTATION_MULTIPLIER}x'}")
        print(
            f"  Model:            {'full comparison (5 models)' if args.full_comparison else args.model.upper()}"
        )

        print(f"\n{'-' * 60}")
        print("  Step 1/4: Extract keypoints from images")
        print(f"{'-' * 60}")

        t0 = time.time()
        X, y_str, stats = extract_all_keypoints(ds_path, args.max_images)
        t1 = time.time()
        print(f"\n  Time: {t1 - t0:.0f} s")

        if len(X) == 0:
            print("\nERROR: No keypoints could be extracted.")
            sys.exit(1)

        # Augment raw landmarks before feature engineering; the evaluation
        # split then runs on the augmented rows, as in the CSV branch.
        print(f"\n{'-' * 60}")
        print("  Step 2/4: Augmentation")
        print(f"{'-' * 60}")

        if use_augment:
            X, y_str = augment_data(X, y_str)
        else:
            print("  Augmentation skipped.")

    print(f"\n{'-' * 60}")
    print("  Step 3/4: Feature engineering")
    print(f"{'-' * 60}")

    if use_features:
        X = apply_feature_engineering(X)
        if X_external is not None:
            X_external = apply_feature_engineering(X_external)
    else:
        print("  Feature engineering skipped (using the raw 63D coordinates).")

    print(f"\n{'-' * 60}")
    print("  Step 4/4: Model training and evaluation")
    print(f"{'-' * 60}")

    if args.full_comparison:
        model, label_map, acc, results = train_full_comparison(
            X,
            y_str,
            use_features=use_features,
            use_augment=use_augment,
            X_external=X_external,
            y_external_str=y_external_str,
        )
    else:
        model, label_map, acc, metadata = train_single_model(
            X,
            y_str,
            model_type=args.model,
            use_features=use_features,
            use_augment=use_augment,
            X_external=X_external,
            y_external_str=y_external_str,
        )

    t_total = time.time() - t0

    print(f"\n{'=' * 60}")
    print("  Done.")
    print(f"  Accuracy:    {acc:.1%}")
    print(f"  Features:    {X.shape[1]}D ({'feature engineering' if use_features else 'raw'})")
    print(f"  Time:        {t_total / 60:.1f} min")
    print(f"  Model:       {LETTER_MODEL_PATH}")
    print(f"{'=' * 60}")
    print(next_step_hint())


if __name__ == "__main__":
    main()
