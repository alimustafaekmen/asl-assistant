#!/usr/bin/env python3
"""
============================================================
  Landmark Çıkarma — Görsellerden MediaPipe Keypoint CSV
============================================================

Görsel klasörlerinden MediaPipe ile 21 keypoint (63 özellik) çıkarır
ve normalize ederek CSV dosyasına kaydeder.

Kullanım:
  python scripts/data_preparation/extract_static_letter_landmarks.py \\
    --input "data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train" \\
    --output "data/processed/asl_alphabet_landmarks.csv" \\
    --max-per-class 3000

  python scripts/data_preparation/extract_static_letter_landmarks.py \\
    --input "data/raw/MediaPipe_Processed_Asl" \\
    --output "data/processed/mediapipe_processed_landmarks.csv" \\
    --max-per-class 3000

Çıktı CSV formatı:
  label, f0, f1, f2, ..., f62
  A, 0.0, 0.123, -0.045, ...
"""
import os
import sys
import time
import argparse
import csv
import numpy as np
import cv2

# Proje kökünü ekle
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

import mediapipe as mp
from config.settings import (
    NUM_LANDMARKS, NUM_HANDS, MIN_DETECTION_CONFIDENCE, STATIC_LETTERS,
)
from asl_ml.utils import normalize_landmarks, ensure_dir


def extract_landmarks(
    input_dir: str,
    output_csv: str,
    max_per_class: int = 0,
    letters: list = None,
) -> dict:
    """
    Görsel klasörlerinden landmark çıkarır ve CSV'ye kaydeder.

    Args:
        input_dir:      Harf klasörlerinin bulunduğu kök dizin
        output_csv:     Çıktı CSV dosyası
        max_per_class:  Sınıf başına max görsel (0=sınırsız)
        letters:        İşlenecek harfler (None=STATIC_LETTERS)

    Returns:
        stats: {harf: {'found': n, 'missed': n, 'total_images': n}}
    """
    if letters is None:
        letters = STATIC_LETTERS

    hands = mp.solutions.hands.Hands(
        static_image_mode=True,
        max_num_hands=NUM_HANDS,
        min_detection_confidence=MIN_DETECTION_CONFIDENCE,
    )

    ensure_dir(os.path.dirname(output_csv))

    stats = {}
    overall_start = time.time()
    total_found = 0
    total_missed = 0

    # CSV header
    header = ["label"] + [f"f{i}" for i in range(NUM_LANDMARKS * 3)]

    with open(output_csv, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)

        for letter in letters:
            letter_start = time.time()
            # Büyük/küçük harf klasör arama
            letter_dir = None
            for name_try in [letter.upper(), letter.lower()]:
                candidate = os.path.join(input_dir, name_try)
                if os.path.isdir(candidate):
                    letter_dir = candidate
                    break

            if letter_dir is None:
                print(f"  [{letter}] ✗ Klasör bulunamadı")
                stats[letter] = {"found": 0, "missed": 0, "total_images": 0}
                continue

            # Görselleri listele
            images = sorted([
                f for f in os.listdir(letter_dir)
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))
            ])
            total_images = len(images)

            if max_per_class > 0:
                images = images[:max_per_class]

            found = 0
            missed = 0

            for img_name in images:
                img_path = os.path.join(letter_dir, img_name)
                img = cv2.imread(img_path)
                if img is None:
                    missed += 1
                    continue

                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                results = hands.process(rgb)

                if results.multi_hand_landmarks:
                    lms = []
                    for lm in results.multi_hand_landmarks[0].landmark:
                        lms.extend([lm.x, lm.y, lm.z])
                    raw = np.array(lms, dtype=np.float32)
                    kp = normalize_landmarks(raw)

                    # NaN kontrolü
                    if np.any(np.isnan(kp)):
                        missed += 1
                        continue

                    row = [letter.upper()] + kp.tolist()
                    writer.writerow(row)
                    found += 1
                else:
                    missed += 1

            total_found += found
            total_missed += missed
            stats[letter] = {
                "found": found,
                "missed": missed,
                "total_images": total_images,
            }
            elapsed = time.time() - letter_start
            hit_rate = found / (found + missed) * 100 if (found + missed) > 0 else 0
            print(
                f"  [{letter}] ✓ {found} landmark, "
                f"{missed} el bulunamadı ({hit_rate:.0f}% başarı)  "
                f"[{elapsed:.0f}s]"
            )

    try:
        hands.close()
    except Exception:
        pass

    elapsed = time.time() - overall_start
    total_seen = total_found + total_missed
    print(f"\n  Toplam: {total_found} örnek, {len(letters)} sınıf, {elapsed:.0f}s")
    if total_seen:
        print(f"  Başarı oranı: {total_found}/{total_seen} "
              f"({total_found/total_seen*100:.1f}%)")
    else:
        print("  Başarı oranı: hesaplanamadı (görüntü bulunamadı)")
    print(f"  Kayıt: {output_csv}")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Görsellerden MediaPipe Landmark CSV Çıkarma",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", required=True,
        help="Harf klasörlerinin bulunduğu kök dizin",
    )
    parser.add_argument(
        "--output", required=True,
        help="Çıktı CSV dosyası yolu",
    )
    parser.add_argument(
        "--max-per-class", type=int, default=0,
        help="Sınıf başına max görsel sayısı (0=sınırsız)",
    )
    parser.add_argument(
        "--include-jz", action="store_true",
        help="J ve Z harflerini de dahil et (varsayılan: sadece statik harfler)",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.input):
        print(f"❌ HATA: Girdi klasörü bulunamadı: {args.input}")
        sys.exit(1)

    letters = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") if args.include_jz else STATIC_LETTERS

    print("=" * 60)
    print("  📸 Landmark Çıkarma")
    print("=" * 60)
    print(f"  Girdi:     {args.input}")
    print(f"  Çıktı:     {args.output}")
    print(f"  Max/sınıf: {'sınırsız' if args.max_per_class == 0 else args.max_per_class}")
    print(f"  Harfler:   {len(letters)} ({', '.join(letters)})")
    print()

    stats = extract_landmarks(
        input_dir=args.input,
        output_csv=args.output,
        max_per_class=args.max_per_class,
        letters=letters,
    )

    # Özet tablo
    print(f"\n{'─'*50}")
    print(f"  {'Harf':>5}  {'Bulunan':>8}  {'Kaçan':>6}  {'Başarı':>7}")
    print(f"{'─'*50}")
    for letter, s in sorted(stats.items()):
        total = s["found"] + s["missed"]
        rate = s["found"] / total * 100 if total > 0 else 0
        flag = "⚠" if rate < 80 else "✓"
        print(f"  {flag} {letter:>3}  {s['found']:>8}  {s['missed']:>6}  {rate:>6.1f}%")
    print(f"{'─'*50}")


if __name__ == "__main__":
    main()
