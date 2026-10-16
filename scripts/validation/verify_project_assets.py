#!/usr/bin/env python3
"""Audit local datasets, model sources, and deployable web artifacts.

The command reports data availability and class coverage, validates the web
runtime's required files, and checks source-to-deploy SHA-256 provenance.

Example (activate a compatible Python environment first):
  python scripts/validation/verify_project_assets.py
  python scripts/validation/verify_project_assets.py --no-datasets
  python scripts/validation/verify_project_assets.py --root path/to/checkout

The dataset report is informational and never changes the exit status;
``--no-datasets`` leaves it out, which is what ``make health`` does.

Exit status:
  0  the web runtime files and the provenance chain are complete
  1  a required web file is missing or invalid, or a deploy file drifted
  2  bad usage
"""

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASL_ML_SRC = os.path.join(PROJECT_ROOT, "asl-ml", "src")
if ASL_ML_SRC not in sys.path:
    sys.path.insert(0, ASL_ML_SRC)
if PROJECT_ROOT not in sys.path:  # Allow running this file directly.
    sys.path.insert(0, PROJECT_ROOT)

from asl_ml.config import DYNAMIC_LETTERS, STATIC_LETTERS  # noqa: E402

from scripts.validation.check_runtime_assets import compare_provenance  # noqa: E402
from scripts.validation.contracts import (  # noqa: E402
    RAW_DIR,
    WEB_DATA_DIR,
    WEB_DIR,
    WEB_JS_DIR,
    WEB_MODELS_DIR,
    provenance_pairs,
    rebased,
)


def check_provenance_hash_chain(root: Path) -> bool:
    """Check SHA-256 equality between deploy artifacts and documented sources."""
    print(f"\n{'─' * 60}")
    print("  PROVENANCE HASH CHAIN (asl-web ↔ kaynak)")
    print(f"{'─' * 60}")

    ok = True
    # Source-to-deploy pairs documented in ``docs/models-and-data.md``.
    for check in compare_provenance(provenance_pairs(root)):
        label = check.name
        if check.status == "missing_deploy":
            print(f"     ✗ {label:24} web dosyasi YOK: {check.deploy}")
        elif check.status == "missing_source":
            print(f"     ✗ {label:24} kaynak dosya yok: {check.source}")
        elif check.status == "match":
            print(f"     ✓ {label:24} {check.deploy_hash[:12]}... (web == kaynak)")
            continue
        else:
            print(f"     ✗ {label:24} DRIFT — yeniden export gerekiyor!")
            print(f"         web:    {check.deploy_hash}")
            print(f"         kaynak: {check.source_hash}")
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


def check_web_runtime(root: Path) -> bool:
    """Validate files required by the statically hosted web application."""
    web_dir = str(rebased(WEB_DIR, root))
    web_models_dir = str(rebased(WEB_MODELS_DIR, root))
    web_data_dir = str(rebased(WEB_DATA_DIR, root))
    web_js_dir = rebased(WEB_JS_DIR, root)
    print(f"\n{'─' * 60}")
    print("  AKTİF WEB RUNTIME (Netlify deploy)")
    print(f"{'─' * 60}")

    required_files = [
        ("index.html", os.path.join(web_dir, "index.html")),
        ("style.css", os.path.join(web_dir, "css", "style.css")),
        ("letter_model.onnx", os.path.join(web_models_dir, "letter_model.onnx")),
        ("word_model.onnx", os.path.join(web_models_dir, "word_model.onnx")),
        ("letters.png", os.path.join(web_dir, "assets", "signs", "letters.png")),
        ("word-25.png", os.path.join(web_dir, "assets", "signs", "word-25.png")),
        ("word-50-1.png", os.path.join(web_dir, "assets", "signs", "word-50-1.png")),
        ("word-50-2.png", os.path.join(web_dir, "assets", "signs", "word-50-2.png")),
        ("word-50-3.png", os.path.join(web_dir, "assets", "signs", "word-50-3.png")),
        ("word-50-4.png", os.path.join(web_dir, "assets", "signs", "word-50-4.png")),
        ("word-50-5.png", os.path.join(web_dir, "assets", "signs", "word-50-5.png")),
    ]

    ok = True
    for label, path in required_files:
        ok = _check_file(label, path) and ok

    # Listing eight of the browser modules by hand meant the list went stale
    # every time the layout changed, and said nothing about the rest. Check
    # what the directory holds instead.
    modules = sorted(web_js_dir.rglob("*.js"))
    if not modules:
        print("  ✗ asl-web/js: JavaScript modulu bulunamadi")
        ok = False
    for module in modules:
        ok = _check_file(str(module.relative_to(web_dir)), str(module)) and ok

    data_files = [
        ("temperature.json", "temperature.json"),
        ("curriculum.json", "curriculum.json"),
        ("per_word_stats.json", "per_word_stats.json"),
        ("confusion_pairs.json", "confusion_pairs.json"),
        ("test_sample.json", "test_sample.json"),
    ]
    for label, filename in data_files:
        path = os.path.join(web_data_dir, filename)
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
            os.path.join(web_data_dir, "letter_labels.json"),
            24,
        )
        and ok
    )
    ok = (
        _check_dense_label_map(
            "word_labels.json",
            os.path.join(web_data_dir, "word_labels.json"),
            50,
        )
        and ok
    )

    sample_path = os.path.join(web_data_dir, "test_sample.json")
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


def check_dynamic_data(raw_dir: str):
    """Inspect optional local J/Z recordings used by the desktop experiment."""
    dynamic_dir = os.path.join(raw_dir, "dynamic")

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


def check_models(root: str):
    """Public Python model source/provenance records."""
    print("\n  📂 Python model kaynaklari")

    model_files = [
        ("Harf modeli", os.path.join(root, "models", "letter", "letter_model.pkl")),
        ("Harf label map", os.path.join(root, "models", "letter", "letter_label_map.json")),
        (
            "J/Z modeli (ops.)",
            os.path.join(root, "models", "letter", "dynamic_jz", "jz_model.pt"),
        ),
        (
            "J/Z label map (ops.)",
            os.path.join(root, "models", "letter", "dynamic_jz", "jz_label_map.json"),
        ),
    ]

    for name, path in model_files:
        if os.path.exists(path):
            size_kb = os.path.getsize(path) / 1024
            print(f"     ✓ {name:20} ({size_kb:.0f} KB)")
        else:
            print(f"     ○ {name:20} — aktif web runtime için zorunlu değil")


def report_local_data(raw_dir: str) -> None:
    """Describe the local datasets under data/raw/.

    This is information for whoever trains the models: nothing in it reaches
    the exit code, and in a checkout with the datasets it stats every one of
    their files, about 200,000, which is most of this command's run time.
    """
    # Static-letter sources plus one explicitly excluded exploration source.
    datasets = [
        (
            "ASL Alphabet (final model source)",
            os.path.join(raw_dir, "ASL Alphabet", "asl_alphabet_train", "asl_alphabet_train"),
        ),
        (
            "American Sign Language (final model source)",
            os.path.join(raw_dir, "American Sign Language Dataset"),
        ),
        ("ASL_SemCom Train (final model source)", os.path.join(raw_dir, "ASL_SemCom", "Train")),
        (
            "MediaPipe Processed ASL (explored, excluded)",
            os.path.join(raw_dir, "MediaPipe_Processed_Asl"),
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
    sample_subset = os.path.join(raw_dir, "asl-signs-sample-subset")
    if os.path.isdir(sample_subset):
        print(f"     ✓ Lokal kucuk fixture subset'i: {sample_subset}")
    else:
        print("     ○ Lokal fixture subset'i yok (runtime icin zorunlu degil)")

    # Optional dynamic-letter recordings.
    print(f"\n{'─' * 60}")
    print("  DİNAMİK VERİLER (J/Z)")
    print(f"{'─' * 60}")
    check_dynamic_data(raw_dir)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Proje asset ve dataset raporu")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(PROJECT_ROOT),
        help="Kontrol edilecek checkout koku (varsayilan: bu depo)",
    )
    parser.add_argument(
        "--no-datasets",
        action="store_true",
        help="data/raw altindaki yerel veri raporunu atla (sonuc kodunu etkilemez)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root_path = args.root.resolve()
    root = str(root_path)
    raw_dir = str(rebased(RAW_DIR, root_path))

    print("=" * 60)
    print("  📊 ASL Assistant — Dataset Kontrol Raporu")
    print("=" * 60)

    web_ok = check_web_runtime(root_path)
    hash_ok = check_provenance_hash_chain(root_path)
    web_ok = web_ok and hash_ok

    if args.no_datasets:
        print(f"\n{'─' * 60}")
        print("  YEREL VERİ RAPORU atlandi (--no-datasets)")
        print(f"{'─' * 60}")
    else:
        report_local_data(raw_dir)

    # Published and optional model artifacts.
    print(f"\n{'─' * 60}")
    print("  EĞİTİLMİŞ MODELLER")
    print(f"{'─' * 60}")
    check_models(root)

    # Final readiness summary.
    print(f"\n{'═' * 60}")
    print("  📋 SONRAKİ ADIMLAR")
    print(f"{'═' * 60}")

    letter_model = os.path.join(root, "models", "letter", "letter_model.pkl")
    jz_model = os.path.join(root, "models", "letter", "dynamic_jz", "jz_model.pt")

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
    return 0 if web_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
