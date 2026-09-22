#!/usr/bin/env python3
"""Audit local datasets, model sources, and deployable web artifacts.

The command reports data availability and class coverage, validates the web
runtime's required files, and checks source-to-deploy SHA-256 provenance.

Example (activate a compatible Python environment first):
  python scripts/validation/verify_project_assets.py
"""

import hashlib
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASL_ML_SRC = os.path.join(PROJECT_ROOT, "asl-ml", "src")
if ASL_ML_SRC not in sys.path:
    sys.path.insert(0, ASL_ML_SRC)

from asl_ml.config import DYNAMIC_LETTERS, STATIC_LETTERS

RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")
WEB_DIR = os.path.join(PROJECT_ROOT, "asl-web")
WEB_DATA_DIR = os.path.join(WEB_DIR, "data")
WEB_MODELS_DIR = os.path.join(WEB_DIR, "models")
NOTEBOOKS_RESULTS = os.path.join(PROJECT_ROOT, "notebooks", "word_50_results")
LETTER_MODEL_DIR = os.path.join(PROJECT_ROOT, "models", "letter")
WORD_MODEL_DIR = os.path.join(PROJECT_ROOT, "models", "word", "web-50")

# Source-to-deploy pairs documented in ``docs/models-and-data.md``.
PROVENANCE_PAIRS = [
    # (label, deploy path, source path)
    (
        "word_model.onnx",
        os.path.join(WEB_MODELS_DIR, "word_model.onnx"),
        os.path.join(WORD_MODEL_DIR, "word_model.onnx"),
    ),
    (
        "letter_model.onnx",
        os.path.join(WEB_MODELS_DIR, "letter_model.onnx"),
        os.path.join(LETTER_MODEL_DIR, "onnx_exports", "letter_model_static_24_web_no_zipmap.onnx"),
    ),
    (
        "word_labels.json",
        os.path.join(WEB_DATA_DIR, "word_labels.json"),
        os.path.join(WORD_MODEL_DIR, "word_labels.json"),
    ),
    (
        "letter_labels.json",
        os.path.join(WEB_DATA_DIR, "letter_labels.json"),
        os.path.join(LETTER_MODEL_DIR, "letter_label_map.json"),
    ),
    (
        "temperature.json",
        os.path.join(WEB_DATA_DIR, "temperature.json"),
        os.path.join(WORD_MODEL_DIR, "temperature.json"),
    ),
    (
        "per_word_stats.json",
        os.path.join(WEB_DATA_DIR, "per_word_stats.json"),
        os.path.join(NOTEBOOKS_RESULTS, "per_word_stats.json"),
    ),
    (
        "confusion_pairs.json",
        os.path.join(WEB_DATA_DIR, "confusion_pairs.json"),
        os.path.join(NOTEBOOKS_RESULTS, "confusion_pairs.json"),
    ),
    (
        "curriculum.json",
        os.path.join(WEB_DATA_DIR, "curriculum.json"),
        os.path.join(NOTEBOOKS_RESULTS, "curriculum.json"),
    ),
    (
        "test_sample.json",
        os.path.join(WEB_DATA_DIR, "test_sample.json"),
        os.path.join(NOTEBOOKS_RESULTS, "test_sample.json"),
    ),
]


def _sha256(path: str) -> str | None:
    """Return a file's SHA-256 digest, or ``None`` when it is missing."""
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def check_provenance_hash_chain() -> bool:
    """Check SHA-256 equality between deploy artifacts and documented sources."""
    print(f"\n{'─' * 60}")
    print("  PROVENANCE HASH CHAIN (asl-web ↔ kaynak)")
    print(f"{'─' * 60}")

    ok = True
    for label, web_path, source_path in PROVENANCE_PAIRS:
        web_hash = _sha256(web_path)
        src_hash = _sha256(source_path)

        if web_hash is None:
            print(f"     ✗ {label:24} web dosyasi YOK: {web_path}")
            ok = False
            continue
        if src_hash is None:
            print(f"     ⚠ {label:24} kaynak dosya yok (geliştirme ortami eksik): {source_path}")
            # The deploy file can still be inspected, but provenance is incomplete.
            continue
        if web_hash == src_hash:
            print(f"     ✓ {label:24} {web_hash[:12]}... (web == kaynak)")
        else:
            print(f"     ✗ {label:24} DRIFT — yeniden export gerekiyor!")
            print(f"         web:    {web_hash}")
            print(f"         kaynak: {src_hash}")
            ok = False

    print(f"\n  Hash chain durumu: {'TUM ESLESIYOR' if ok else 'DRIFT — duzeltme gerekli'}")
    return ok


def _file_size(path: str) -> str:
    size = os.path.getsize(path)
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / 1024:.1f} KB"


def _check_file(label: str, path: str, required: bool = True) -> bool:
    mark = "✓" if os.path.exists(path) else ("✗" if required else "○")
    if os.path.exists(path):
        print(f"     {mark} {label:24} {_file_size(path):>9}  {path}")
        return True
    suffix = "BULUNAMADI" if required else "opsiyonel yok"
    print(f"     {mark} {label:24} {suffix}")
    return not required


def _load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _check_dense_label_map(label: str, path: str, expected_count: int) -> bool:
    try:
        data = _load_json(path)
        values = sorted(int(v) for v in data.values())
        expected = list(range(expected_count))
        ok = len(data) == expected_count and values == expected
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(f"     ✗ {label:24} okunamadı: {exc}")
        return False

    if ok:
        print(f"     ✓ {label:24} {expected_count} sınıf, indeksler 0..{expected_count - 1}")
    else:
        print(f"     ✗ {label:24} beklenen {expected_count} yoğun indeks, gelen={len(data)}")
    return ok


def check_web_runtime() -> bool:
    """Validate files required by the statically hosted web application."""
    print(f"\n{'─' * 60}")
    print("  AKTİF WEB RUNTIME (GitHub Pages deploy)")
    print(f"{'─' * 60}")

    required_files = [
        ("index.html", os.path.join(WEB_DIR, "index.html")),
        ("style.css", os.path.join(WEB_DIR, "css", "style.css")),
        ("letter_model.onnx", os.path.join(WEB_MODELS_DIR, "letter_model.onnx")),
        ("word_model.onnx", os.path.join(WEB_MODELS_DIR, "word_model.onnx")),
        ("letters.png", os.path.join(WEB_DIR, "assets", "signs", "letters.png")),
        ("kelime.png", os.path.join(WEB_DIR, "assets", "signs", "kelime.png")),
        ("word-1.png", os.path.join(WEB_DIR, "assets", "signs", "word-1.png")),
        ("word-2.png", os.path.join(WEB_DIR, "assets", "signs", "word-2.png")),
        ("word-3.png", os.path.join(WEB_DIR, "assets", "signs", "word-3.png")),
        ("word-4.png", os.path.join(WEB_DIR, "assets", "signs", "word-4.png")),
        ("word-5.png", os.path.join(WEB_DIR, "assets", "signs", "word-5.png")),
        ("app.js", os.path.join(WEB_DIR, "js", "core", "app.js")),
        ("camera.js", os.path.join(WEB_DIR, "js", "media", "camera.js")),
        ("landmarks.js", os.path.join(WEB_DIR, "js", "ml", "landmarks.js")),
        ("features.js", os.path.join(WEB_DIR, "js", "ml", "features.js")),
        ("letter-model.js", os.path.join(WEB_DIR, "js", "ml", "letter-model.js")),
        ("word-model.js", os.path.join(WEB_DIR, "js", "ml", "word-model.js")),
        ("gating.js", os.path.join(WEB_DIR, "js", "ml", "gating.js")),
        ("benchmark.js", os.path.join(WEB_DIR, "js", "services", "benchmark.js")),
    ]

    ok = True
    for label, path in required_files:
        ok = _check_file(label, path) and ok

    data_files = [
        ("temperature.json", "temperature.json"),
        ("curriculum.json", "curriculum.json"),
        ("per_word_stats.json", "per_word_stats.json"),
        ("confusion_pairs.json", "confusion_pairs.json"),
        ("test_sample.json", "test_sample.json"),
    ]
    for label, filename in data_files:
        path = os.path.join(WEB_DATA_DIR, filename)
        ok = _check_file(label, path) and ok
        if os.path.exists(path):
            try:
                _load_json(path)
            except json.JSONDecodeError as exc:
                print(f"       ✗ JSON parse hatası: {exc}")
                ok = False

    ok = (
        _check_dense_label_map(
            "letter_labels.json",
            os.path.join(WEB_DATA_DIR, "letter_labels.json"),
            24,
        )
        and ok
    )
    ok = (
        _check_dense_label_map(
            "word_labels.json",
            os.path.join(WEB_DATA_DIR, "word_labels.json"),
            50,
        )
        and ok
    )

    sample_path = os.path.join(WEB_DATA_DIR, "test_sample.json")
    if os.path.exists(sample_path):
        try:
            sample = _load_json(sample_path)
            features_len = len(sample.get("features", []))
            mask_len = len(sample.get("mask", []))
            real_frames = sum(1 for value in sample.get("mask", []) if value)
            sample_ok = features_len == 45 * 168 and mask_len == 45
            print(
                f"     {'✓' if sample_ok else '✗'} test_sample şekli       "
                f"features={features_len}, mask={mask_len}, gerçek={real_frames}/45"
            )
            ok = sample_ok and ok
        except (OSError, TypeError, json.JSONDecodeError) as exc:
            print(f"     ✗ test_sample okunamadı: {exc}")
            ok = False

    print(f"\n  Web runtime durumu: {'HAZIR' if ok else 'EKSİK/HATALI'}")
    return ok


def count_images(directory: str) -> int:
    """Count supported image files directly below a directory."""
    if not os.path.isdir(directory):
        return 0
    return sum(
        1 for f in os.listdir(directory) if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))
    )


def check_dataset(name: str, path: str, letter_subdir: bool = True):
    """Inspect a static-letter image dataset and report class coverage."""
    print(f"\n  📂 {name}")

    if not os.path.isdir(path):
        print(f"     ✗ BULUNAMADI: {path}")
        return False

    total_size = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))

    size_mb = total_size / (1024 * 1024)
    print(f"     Yol:    {path}")
    print(f"     Boyut:  {size_mb:.0f} MB")

    if letter_subdir:
        # Resolve case-insensitive class directories.
        letters_found = []
        letters_missing = []
        min_count = float("inf")
        max_count = 0

        # Only inspect the 24 classes used by the published letter model.
        # Raw providers may also contain J/Z folders, but those folders are not
        # evidence of a trained or deployed J/Z classifier.
        for letter in STATIC_LETTERS:
            letter_dir = None
            for try_name in [letter.upper(), letter.lower()]:
                candidate = os.path.join(path, try_name)
                if os.path.isdir(candidate):
                    letter_dir = candidate
                    break

            if letter_dir:
                count = count_images(letter_dir)
                letters_found.append((letter, count))
                min_count = min(min_count, count)
                max_count = max(max_count, count)
            else:
                letters_missing.append(letter)

        if letters_found:
            print(f"     Statik model siniflari: {len(letters_found)}/24 bulundu (J/Z haric)")
            print(f"     Görsel:  {min_count}–{max_count} / harf")

            if letters_missing:
                print(f"     Eksik:   {', '.join(letters_missing)}")

            # Show per-class counts when detailed inspection is useful.
            print(f"\n     {'Harf':>6} {'Sayı':>6}  {'Durum'}")
            print(f"     {'─' * 25}")
            for letter, count in letters_found:
                status = "✓" if count >= 30 else "⚠ az"
                bar_len = min(count // 100, 20)
                bar = "█" * bar_len
                print(f"     {letter:>6} {count:>6}  {status} {bar}")

        return len(letters_found) > 0

    return True


def check_dynamic_data():
    """Inspect optional local J/Z recordings used by the desktop experiment."""
    dynamic_dir = os.path.join(RAW_DIR, "dynamic")

    print("\n  📂 Dinamik Veriler (J/Z, opsiyonel legacy)")

    if not os.path.isdir(dynamic_dir):
        print("     ○ Henüz veri toplanmadı — aktif web runtime için zorunlu değil")
        print("     → python scripts/model_training/train_dynamic_jz_model.py collect")
        return False

    for sign in DYNAMIC_LETTERS:
        sign_dir = os.path.join(dynamic_dir, sign)
        if os.path.isdir(sign_dir):
            npy_files = [f for f in os.listdir(sign_dir) if f.endswith(".npy")]
            print(f"     [{sign}] {len(npy_files)} sekans")
        else:
            print(f"     [{sign}] ○ Veri yok")

    return True


def check_models():
    """Public Python model source/provenance records."""
    print("\n  📂 Python model kaynaklari")

    model_files = [
        ("Harf modeli", os.path.join(PROJECT_ROOT, "models", "letter", "letter_model.pkl")),
        ("Harf label map", os.path.join(PROJECT_ROOT, "models", "letter", "letter_label_map.json")),
        (
            "J/Z modeli (ops.)",
            os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_model.pt"),
        ),
        (
            "J/Z label map (ops.)",
            os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_label_map.json"),
        ),
    ]

    for name, path in model_files:
        if os.path.exists(path):
            size_kb = os.path.getsize(path) / 1024
            print(f"     ✓ {name:20} ({size_kb:.0f} KB)")
        else:
            print(f"     ○ {name:20} — aktif web runtime için zorunlu değil")


def main():
    print("=" * 60)
    print("  📊 ASL Assistant — Dataset Kontrol Raporu")
    print("=" * 60)

    web_ok = check_web_runtime()
    hash_ok = check_provenance_hash_chain()
    web_ok = web_ok and hash_ok

    # Static-letter sources plus one explicitly excluded exploration source.
    datasets = [
        (
            "ASL Alphabet (final model source)",
            os.path.join(RAW_DIR, "ASL Alphabet", "asl_alphabet_train", "asl_alphabet_train"),
        ),
        (
            "American Sign Language (final model source)",
            os.path.join(RAW_DIR, "American Sign Language Dataset"),
        ),
        ("ASL_SemCom Train (final model source)", os.path.join(RAW_DIR, "ASL_SemCom", "Train")),
        (
            "MediaPipe Processed ASL (explored, excluded)",
            os.path.join(RAW_DIR, "MediaPipe_Processed_Asl"),
        ),
    ]

    print(f"\n{'─' * 60}")
    print("  STATIK HARF VERİ KAYNAKLARI (aktif model: 24 sinif, J/Z haric)")
    print(f"{'─' * 60}")

    for name, path in datasets:
        check_dataset(name, path)

    # Isolated-word source. Training ran in Kaggle; only a small fixture
    # subset may exist locally.
    print(f"\n{'─' * 60}")
    print("  KELİME VERİ KAYNAĞI")
    print(f"{'─' * 60}")
    print("\n  📂 Google Isolated Sign Language Recognition competition")
    print("     25 ve 50 kelimelik modellerin tek kelime egitim kaynagidir.")
    print("     Egitim Kaggle notebook ortaminda yapildi; tam parquet verisi repoda yoktur.")
    sample_subset = os.path.join(RAW_DIR, "asl-signs-sample-subset")
    if os.path.isdir(sample_subset):
        print(f"     ✓ Lokal kucuk fixture subset'i: {sample_subset}")
    else:
        print("     ○ Lokal fixture subset'i yok (runtime icin zorunlu degil)")

    # Optional dynamic-letter recordings.
    print(f"\n{'─' * 60}")
    print("  DİNAMİK VERİLER (J/Z)")
    print(f"{'─' * 60}")
    check_dynamic_data()

    # Published and optional model artifacts.
    print(f"\n{'─' * 60}")
    print("  EĞİTİLMİŞ MODELLER")
    print(f"{'─' * 60}")
    check_models()

    # Final readiness summary.
    print(f"\n{'═' * 60}")
    print("  📋 SONRAKİ ADIMLAR")
    print(f"{'═' * 60}")

    letter_model = os.path.join(PROJECT_ROOT, "models", "letter", "letter_model.pkl")
    jz_model = os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_model.pt")

    if not os.path.exists(letter_model):
        print("\n  1️⃣  Harf modeli eğitin:")
        print("     python scripts/model_training/train_static_letter_model.py")
        print(
            "     python scripts/model_training/train_static_letter_model.py --max-images 500  # hızlı test"
        )

    if not os.path.exists(jz_model):
        print("\n  2️⃣  Opsiyonel legacy J/Z modeli için:")
        print("     python scripts/model_training/train_dynamic_jz_model.py collect")
        print("     python scripts/model_training/train_dynamic_jz_model.py train")

    if web_ok:
        print("\n  3️⃣  Aktif web demosunu çalıştırın:")
        print("     cd asl-web")
        print("     python3 -m http.server 8080")
        print("     # Tarayıcı: http://localhost:8080")

    if all(os.path.exists(p) for p in [letter_model]):
        print("\n  4️⃣  Legacy Python masaüstü uygulama:")
        print("     python3 asl-desktop/main.py")

    print()


if __name__ == "__main__":
    main()
