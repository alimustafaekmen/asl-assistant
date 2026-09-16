#!/usr/bin/env python3
"""
============================================================
  Dataset Birleştirme, Dengeleme ve Bölme
============================================================

Birden fazla landmark CSV'yi birleştirir, J/Z'yi filtreler,
sınıfları dengeler ve train/test split yapar.

Kullanım:
  # Varsayılan: data/processed/ altındaki tüm CSV'leri birleştir
  python scripts/data_preparation/merge_static_letter_datasets.py

  # Belirli CSV'leri birleştir
  python scripts/data_preparation/merge_static_letter_datasets.py \\
    --inputs data/processed/asl_alphabet_landmarks.csv \\
             data/processed/mediapipe_processed_landmarks.csv

  # Sınıf başına max örnek belirle (undersampling)
  python scripts/data_preparation/merge_static_letter_datasets.py --max-per-class 2000

Çıktılar:
  data/processed/combined_landmarks.csv    — Birleştirilmiş ham
  data/processed/train_landmarks.csv       — Eğitim (%85, dengeli)
  data/processed/test_landmarks.csv        — Test (%15, dengeli)
  docs/assets/static-letter-class-distribution.png — Sınıf dağılım grafiği
"""
import os
import sys
import argparse
import numpy as np
import pandas as pd

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from config.settings import PROCESSED_DATA_DIR, STATIC_LETTERS
from asl_ml.utils import ensure_dir

DOCS_ASSETS_DIR = os.path.join(PROJECT_ROOT, "docs", "assets")


def load_and_merge(csv_paths: list) -> pd.DataFrame:
    """CSV dosyalarını yükler ve birleştirir."""
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
    """J ve Z harflerini filtreler (statik model için)."""
    before = len(df)
    static = [l.upper() for l in STATIC_LETTERS]
    df = df[df["label"].isin(static)].copy()
    removed = before - len(df)
    if removed > 0:
        print(f"  J/Z filtrelendi: {removed} örnek çıkarıldı")
    print(f"  Statik: {len(df)} örnek, {df['label'].nunique()} sınıf")
    return df


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """Feature sütunlarına göre duplikatları kaldırır."""
    feature_cols = [c for c in df.columns if c != "label"]
    before = len(df)
    df = df.drop_duplicates(subset=feature_cols, keep="first")
    removed = before - len(df)
    if removed > 0:
        print(f"  Duplikat temizlendi: {removed} örnek çıkarıldı")
    return df


def remove_anomalies(df: pd.DataFrame) -> pd.DataFrame:
    """NaN, inf ve aşırı değerleri temizler."""
    feature_cols = [c for c in df.columns if c != "label"]
    before = len(df)

    # Sayısal dönüşüm (CSV'den gelen object dtype'ları düzelt)
    for col in feature_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # NaN ve inf kontrolü
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna(subset=feature_cols)

    # Aşırı değer kontrolü (±10 sigma, çok geniş)
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
    """Sınıfları dengeler (undersampling)."""
    counts = df["label"].value_counts()
    min_count = counts.min()
    max_count = counts.max()

    print(f"\n  Dengeleme öncesi:")
    print(f"    Min: {counts.idxmin()} = {min_count}")
    print(f"    Max: {counts.idxmax()} = {max_count}")
    print(f"    Oran: {max_count/min_count:.1f}x dengesizlik")

    if max_per_class > 0:
        target = min(min_count, max_per_class)
    else:
        target = min_count

    # groupby.apply 'label' sütununu düşürebilir, güvenli yöntem:
    sampled = []
    for label, group in df.groupby("label"):
        n = min(len(group), target)
        sampled.append(group.sample(n, random_state=42))
    balanced = pd.concat(sampled, ignore_index=True)

    print(f"\n  Dengeleme sonrası:")
    print(f"    Sınıf başına: {target} örnek")
    print(f"    Toplam: {len(balanced)} örnek")
    return balanced


def split_train_test(
    df: pd.DataFrame, test_ratio: float = 0.15
) -> tuple:
    """Stratified train/test bölme (küçük datasetler için güvenli)."""
    from sklearn.model_selection import train_test_split as sklearn_split

    feature_cols = [c for c in df.columns if c != "label"]
    X = df[feature_cols].values.astype(np.float32)
    y = np.array(df["label"].tolist(), dtype=str)  # Arrow dtype uyumluluğu

    n_classes = df["label"].nunique()
    min_class_count = df["label"].value_counts().min()
    n_total = len(df)

    # Stratified split: test seti en az n_classes örnekle olmalı
    # ve her sınıfta en az 1 train + 1 test lazım → min_class_count >= 2
    min_test_size = max(n_classes, int(n_total * test_ratio))

    if min_class_count >= 2 and min_test_size <= n_total - n_classes:
        # Güvenli: stratified split yapılabilir
        actual_ratio = max(test_ratio, n_classes / n_total + 0.01)
        if actual_ratio != test_ratio:
            print(f"  ⚠ Test oranı {test_ratio:.2f} → {actual_ratio:.2f} ayarlandı (min {n_classes} test)")
        X_train, X_test, y_train, y_test = sklearn_split(
            X, y, test_size=actual_ratio, random_state=42, stratify=y,
        )
    else:
        # Çok küçük dataset: stratify olmadan böl
        print(f"  ⚠ Dataset çok küçük ({min_class_count}/sınıf), stratify kapalı")
        actual_ratio = min(test_ratio, 0.3)
        X_train, X_test, y_train, y_test = sklearn_split(
            X, y, test_size=actual_ratio, random_state=42,
        )

    train_df = pd.DataFrame(X_train, columns=feature_cols)
    train_df.insert(0, "label", y_train)

    test_df = pd.DataFrame(X_test, columns=feature_cols)
    test_df.insert(0, "label", y_test)

    print(f"\n  Train: {len(train_df)} örnek")
    print(f"  Test:  {len(test_df)} örnek")
    return train_df, test_df


def save_class_distribution(df: pd.DataFrame, title: str, output_path: str):
    """Sınıf dağılım bar chart kaydeder."""
    ensure_dir(os.path.dirname(output_path))

    counts = df["label"].value_counts().sort_index()

    fig, ax = plt.subplots(figsize=(14, 6))
    colors = ["#4CAF50" if c >= counts.median() else "#FF9800" for c in counts.values]
    ax.bar(counts.index, counts.values, color=colors, alpha=0.85)
    ax.set_xlabel("Harf", fontsize=12)
    ax.set_ylabel("Örnek Sayısı", fontsize=12)
    ax.set_title(title, fontsize=14)

    # Değerleri bar üzerine yaz
    for i, (lbl, cnt) in enumerate(zip(counts.index, counts.values)):
        ax.text(i, cnt + max(counts) * 0.01, str(cnt),
                ha="center", va="bottom", fontsize=8)

    ax.axhline(y=counts.median(), color="gray", linestyle="--", alpha=0.5,
               label=f"Medyan: {int(counts.median())}")
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
        "--inputs", nargs="+", default=None,
        help="Birleştirilecek CSV dosyaları (varsayılan: data/processed/ altındaki tüm CSV'ler)",
    )
    parser.add_argument(
        "--max-per-class", type=int, default=0,
        help="Sınıf başına max örnek (0=min sınıfa göre dengele)",
    )
    parser.add_argument(
        "--test-ratio", type=float, default=0.15,
        help="Test seti oranı (varsayılan: 0.15)",
    )
    parser.add_argument(
        "--include-jz", action="store_true",
        help="J/Z harflerini dahil et (varsayılan: filtrele)",
    )
    parser.add_argument(
        "--no-balance", action="store_true",
        help="Dengeleme yapma (sınıf ağırlığı modelde ayarlanır)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  🔀 Dataset Birleştirme ve Hazırlama")
    print("=" * 60)

    # CSV dosyalarını bul
    if args.inputs:
        csv_paths = args.inputs
    else:
        _EXCLUDED = {"combined_landmarks.csv", "train_landmarks.csv", "test_landmarks.csv"}
        csv_paths = sorted([
            os.path.join(PROCESSED_DATA_DIR, f)
            for f in os.listdir(PROCESSED_DATA_DIR)
            if f.endswith("_landmarks.csv") and f not in _EXCLUDED
        ])
        if not csv_paths:
            print("❌ HATA: data/processed/ altında *_landmarks.csv bulunamadı!")
            print("  Önce çıkarma yapın:")
            print('  python scripts/data_preparation/extract_static_letter_landmarks.py --input "data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train" --output "data/processed/asl_alphabet_landmarks.csv"')
            sys.exit(1)

    # 1. Yükleme ve birleştirme
    print(f"\n── Adım 1: CSV Yükleme ──")
    df = load_and_merge(csv_paths)

    # 2. J/Z filtreleme
    print(f"\n── Adım 2: J/Z Filtreleme ──")
    if not args.include_jz:
        df = filter_static(df)
    else:
        print("  J/Z dahil edildi.")

    # 3. Duplikat temizleme
    print(f"\n── Adım 3: Temizlik ──")
    df = remove_duplicates(df)
    df = remove_anomalies(df)

    # 4. Birleştirilmiş CSV kaydet
    combined_path = os.path.join(PROCESSED_DATA_DIR, "combined_landmarks.csv")
    df.to_csv(combined_path, index=False)
    print(f"\n  Birleştirilmiş → {combined_path}")

    # 5. Dengeleme
    print(f"\n── Adım 4: Dengeleme ──")
    if not args.no_balance:
        df = balance_classes(df, args.max_per_class)
    else:
        print("  Dengeleme atlandı.")

    # 6. Train/Test split
    print(f"\n── Adım 5: Train/Test Bölme ──")
    train_df, test_df = split_train_test(df, args.test_ratio)

    # Kaydet
    train_path = os.path.join(PROCESSED_DATA_DIR, "train_landmarks.csv")
    test_path = os.path.join(PROCESSED_DATA_DIR, "test_landmarks.csv")
    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path, index=False)
    print(f"  Train → {train_path}")
    print(f"  Test  → {test_path}")

    # 7. Dağılım görseli
    print(f"\n── Adım 6: Görselleştirme ──")
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

    # 8. Özet
    print(f"\n{'═'*60}")
    print(f"  ✅ TAMAMLANDI!")
    print(f"  Sınıf sayısı:   {train_df['label'].nunique()}")
    print(f"  Train:          {len(train_df)} örnek")
    print(f"  Test:           {len(test_df)} örnek")
    print(f"  Sınıf başına:   ~{len(train_df) // train_df['label'].nunique()}")
    print(f"{'═'*60}")
    print(f"\n  Sonraki adım:")
    print(f"    python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison")


if __name__ == "__main__":
    main()
