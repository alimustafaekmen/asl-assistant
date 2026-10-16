#!/usr/bin/env python3
"""
Merge, clean, balance, and split static-letter landmark datasets.

The published classifier contains 24 static letters, so J and Z rows are
removed even if a source dataset provides them.

Examples:
  # Merge every CSV under data/processed/.
  python scripts/data_preparation/merge_static_letter_datasets.py

  # Merge selected CSV files.
  python scripts/data_preparation/merge_static_letter_datasets.py \\
    --inputs data/processed/asl_alphabet_landmarks.csv \\
             data/processed/mediapipe_processed_landmarks.csv

  # Limit each class through deterministic undersampling.
  python scripts/data_preparation/merge_static_letter_datasets.py --max-per-class 2000

Outputs:
  data/processed/combined_landmarks.csv
  data/processed/train_landmarks.csv
  data/processed/test_landmarks.csv
  docs/assets/static-letter-class-distribution.png
  docs/assets/static-letter-class-distribution-train.png

The two charts are regenerated on every run and are not tracked, so a clone has
no docs/assets/ copy of them until this script has run.
"""

import argparse
import os
import sys

import numpy as np
import pandas as pd

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASL_ML_SRC = os.path.join(PROJECT_ROOT, "asl-ml", "src")
if ASL_ML_SRC not in sys.path:
    sys.path.insert(0, ASL_ML_SRC)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from asl_ml.config import STATIC_LETTERS
from asl_ml.utils import ensure_dir

PROCESSED_DATA_DIR = os.path.join(PROJECT_ROOT, "data", "processed")
DOCS_ASSETS_DIR = os.path.join(PROJECT_ROOT, "docs", "assets")


def load_and_merge(csv_paths: list) -> pd.DataFrame:
    """Load valid landmark CSV files and concatenate their rows."""
    dfs = []
    for path in csv_paths:
        if not os.path.exists(path):
            print(f"  ⚠ Atlandı (yok): {path}")
            continue
        df = pd.read_csv(path)
        if len(df) == 0 or "label" not in df.columns:
            print(f"  ⚠ Atlandı (boş veya geçersiz): {os.path.basename(path)}")
            continue
        n = len(df)
        classes = df["label"].nunique()
        print(f"  ✓ {os.path.basename(path)}: {n} örnek, {classes} sınıf")
        dfs.append(df)

    if not dfs:
        print("❌ HATA: Hiç CSV yüklenemedi!")
        sys.exit(1)

    combined = pd.concat(dfs, ignore_index=True)
    print(f"\n  Birleştirilmiş: {len(combined)} örnek, {combined['label'].nunique()} sınıf")
    return combined


def filter_static(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only the 24 classes supported by the static-letter model."""
    before = len(df)
    static = [letter.upper() for letter in STATIC_LETTERS]
    df = df[df["label"].isin(static)].copy()
    removed = before - len(df)
    if removed > 0:
        print(f"  J/Z filtrelendi: {removed} örnek çıkarıldı")
    print(f"  Statik: {len(df)} örnek, {df['label'].nunique()} sınıf")
    return df


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """Remove duplicate rows based on feature values."""
    feature_cols = [c for c in df.columns if c != "label"]
    before = len(df)
    df = df.drop_duplicates(subset=feature_cols, keep="first")
    removed = before - len(df)
    if removed > 0:
        print(f"  Duplikat temizlendi: {removed} örnek çıkarıldı")
    return df


def remove_anomalies(df: pd.DataFrame) -> pd.DataFrame:
    """Remove nonnumeric, non-finite, and extreme feature rows."""
    feature_cols = [c for c in df.columns if c != "label"]
    before = len(df)

    # Normalize CSV-inferred object columns to numeric values.
    for col in feature_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Remove missing and infinite values.
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna(subset=feature_cols)

    # Use a deliberately broad ±10 standard-deviation outlier boundary.
    X = df[feature_cols].values.astype(np.float64)
    means = X.mean(axis=0)
    stds = X.std(axis=0) + 1e-8
    z_scores = np.abs((X - means) / stds)
    mask = (z_scores < 10).all(axis=1)
    df = df[mask].reset_index(drop=True)

    removed = before - len(df)
    if removed > 0:
        print(f"  Anomali temizlendi: {removed} örnek çıkarıldı")
    return df


def balance_classes(df: pd.DataFrame, max_per_class: int = 0) -> pd.DataFrame:
    """Balance classes through deterministic undersampling."""
    counts = df["label"].value_counts()
    min_count = counts.min()
    max_count = counts.max()

    print("\n  Dengeleme öncesi:")
    print(f"    Min: {counts.idxmin()} = {min_count}")
    print(f"    Max: {counts.idxmax()} = {max_count}")
    print(f"    Oran: {max_count / min_count:.1f}x dengesizlik")

    if max_per_class > 0:
        target = min(min_count, max_per_class)
    else:
        target = min_count

    # Sample groups explicitly so pandas never drops the label column.
    sampled = []
    for label, group in df.groupby("label"):
        n = min(len(group), target)
        sampled.append(group.sample(n, random_state=42))
    balanced = pd.concat(sampled, ignore_index=True)

    print("\n  Dengeleme sonrası:")
    print(f"    Sınıf başına: {target} örnek")
    print(f"    Toplam: {len(balanced)} örnek")
    return balanced


def split_train_test(df: pd.DataFrame, test_ratio: float = 0.15) -> tuple:
    """Create a stratified split when class counts make it valid."""
    from sklearn.model_selection import train_test_split as sklearn_split

    feature_cols = [c for c in df.columns if c != "label"]
    X = df[feature_cols].values.astype(np.float32)
    y = np.array(df["label"].tolist(), dtype=str)  # Avoid Arrow string dtype issues.

    n_classes = df["label"].nunique()
    min_class_count = df["label"].value_counts().min()
    n_total = len(df)

    # Stratification requires at least one train and test row per class.
    min_test_size = max(n_classes, int(n_total * test_ratio))

    if min_class_count >= 2 and min_test_size <= n_total - n_classes:
        # Increase the test ratio if needed to represent every class.
        actual_ratio = max(test_ratio, n_classes / n_total + 0.01)
        if actual_ratio != test_ratio:
            print(
                f"  ⚠ Test oranı {test_ratio:.2f} → {actual_ratio:.2f} ayarlandı (min {n_classes} test)"
            )
        X_train, X_test, y_train, y_test = sklearn_split(
            X,
            y,
            test_size=actual_ratio,
            random_state=42,
            stratify=y,
        )
    else:
        # Tiny datasets cannot satisfy stratification constraints.
        print(f"  ⚠ Dataset çok küçük ({min_class_count}/sınıf), stratify kapalı")
        actual_ratio = min(test_ratio, 0.3)
        X_train, X_test, y_train, y_test = sklearn_split(
            X,
            y,
            test_size=actual_ratio,
            random_state=42,
        )

    train_df = pd.DataFrame(X_train, columns=feature_cols)
    train_df.insert(0, "label", y_train)

    test_df = pd.DataFrame(X_test, columns=feature_cols)
    test_df.insert(0, "label", y_test)

    print(f"\n  Train: {len(train_df)} örnek")
    print(f"  Test:  {len(test_df)} örnek")
    return train_df, test_df


def save_class_distribution(df: pd.DataFrame, title: str, output_path: str):
    """Save a class-distribution bar chart."""
    ensure_dir(os.path.dirname(output_path))

    counts = df["label"].value_counts().sort_index()

    fig, ax = plt.subplots(figsize=(14, 6))
    colors = ["#4CAF50" if c >= counts.median() else "#FF9800" for c in counts.values]
    ax.bar(counts.index, counts.values, color=colors, alpha=0.85)
    ax.set_xlabel("Harf", fontsize=12)
    ax.set_ylabel("Örnek Sayısı", fontsize=12)
    ax.set_title(title, fontsize=14)

    # Label every bar for use in static documentation.
    for i, (lbl, cnt) in enumerate(zip(counts.index, counts.values)):
        ax.text(i, cnt + max(counts) * 0.01, str(cnt), ha="center", va="bottom", fontsize=8)

    ax.axhline(
        y=counts.median(),
        color="gray",
        linestyle="--",
        alpha=0.5,
        label=f"Medyan: {int(counts.median())}",
    )
    ax.legend()
    plt.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
    print(f"  Grafik → {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Dataset Birleştirme, Dengeleme ve Bölme",
    )
    parser.add_argument(
        "--inputs",
        nargs="+",
        default=None,
        help="Birleştirilecek CSV dosyaları (varsayılan: data/processed/ altındaki tüm CSV'ler)",
    )
    parser.add_argument(
        "--max-per-class",
        type=int,
        default=0,
        help="Sınıf başına max örnek (0=min sınıfa göre dengele)",
    )
    parser.add_argument(
        "--test-ratio",
        type=float,
        default=0.15,
        help="Test seti oranı (varsayılan: 0.15)",
    )
    parser.add_argument(
        "--include-jz",
        action="store_true",
        help="J/Z harflerini dahil et (varsayılan: filtrele)",
    )
    parser.add_argument(
        "--no-balance",
        action="store_true",
        help="Dengeleme yapma (sınıf ağırlığı modelde ayarlanır)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  🔀 Dataset Birleştirme ve Hazırlama")
    print("=" * 60)

    # Resolve explicit inputs or discover raw landmark CSV files.
    if args.inputs:
        csv_paths = args.inputs
    else:
        _EXCLUDED = {"combined_landmarks.csv", "train_landmarks.csv", "test_landmarks.csv"}
        csv_paths = sorted(
            [
                os.path.join(PROCESSED_DATA_DIR, f)
                for f in os.listdir(PROCESSED_DATA_DIR)
                if f.endswith("_landmarks.csv") and f not in _EXCLUDED
            ]
        )
        if not csv_paths:
            print("❌ HATA: data/processed/ altında *_landmarks.csv bulunamadı!")
            print("  Önce çıkarma yapın:")
            print(
                '  python scripts/data_preparation/extract_static_letter_landmarks.py --input "data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train" --output "data/processed/asl_alphabet_landmarks.csv"'
            )
            sys.exit(1)

    # Load and merge source datasets.
    print("\n── Adım 1: CSV Yükleme ──")
    df = load_and_merge(csv_paths)

    # Apply the published 24-letter class contract by default.
    print("\n── Adım 2: J/Z Filtreleme ──")
    if not args.include_jz:
        df = filter_static(df)
    else:
        print("  J/Z dahil edildi.")

    # Remove duplicates and invalid feature rows.
    print("\n── Adım 3: Temizlik ──")
    df = remove_duplicates(df)
    df = remove_anomalies(df)

    # Preserve the cleaned, pre-balanced merged dataset.
    combined_path = os.path.join(PROCESSED_DATA_DIR, "combined_landmarks.csv")
    df.to_csv(combined_path, index=False)
    print(f"\n  Birleştirilmiş → {combined_path}")

    # Balance the working dataset unless explicitly disabled.
    print("\n── Adım 4: Dengeleme ──")
    if not args.no_balance:
        df = balance_classes(df, args.max_per_class)
    else:
        print("  Dengeleme atlandı.")

    # Split the model-ready rows.
    print("\n── Adım 5: Train/Test Bölme ──")
    train_df, test_df = split_train_test(df, args.test_ratio)

    # Persist both split files with the same schema.
    train_path = os.path.join(PROCESSED_DATA_DIR, "train_landmarks.csv")
    test_path = os.path.join(PROCESSED_DATA_DIR, "test_landmarks.csv")
    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path, index=False)
    print(f"  Train → {train_path}")
    print(f"  Test  → {test_path}")

    # Export documentation charts.
    print("\n── Adım 6: Görselleştirme ──")
    save_class_distribution(
        train_df,
        f"Eğitim Seti Sınıf Dağılımı ({len(train_df)} örnek)",
        os.path.join(DOCS_ASSETS_DIR, "static-letter-class-distribution-train.png"),
    )
    save_class_distribution(
        df,
        f"Birleştirilmiş Dataset Sınıf Dağılımı ({len(df)} örnek)",
        os.path.join(DOCS_ASSETS_DIR, "static-letter-class-distribution.png"),
    )

    # Print a concise completion summary.
    print(f"\n{'═' * 60}")
    print("  ✅ TAMAMLANDI!")
    print(f"  Sınıf sayısı:   {train_df['label'].nunique()}")
    print(f"  Train:          {len(train_df)} örnek")
    print(f"  Test:           {len(test_df)} örnek")
    print(f"  Sınıf başına:   ~{len(train_df) // train_df['label'].nunique()}")
    print(f"{'═' * 60}")
    print("\n  Sonraki adım:")
    print(
        "    python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison"
    )


if __name__ == "__main__":
    main()
