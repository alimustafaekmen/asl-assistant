#!/usr/bin/env python3
"""
============================================================
  Dataset Kontrol Aracı / Project asset & dataset check
============================================================

Tüm veri setlerini ve deploy asset'lerini analiz eder; eğitime/deploya
hazır olup olmadıklarını ve asl-web provenance hash chain'inin tuttuğunu
raporlar.
(EN) Analyzes datasets and deploy assets and reports whether they are ready
for training/deploy, including the asl-web provenance hash-chain check.

Kullanım / usage:
  # önce proje Python ortamınızı aktive edin (bkz. README) / activate your env
  python scripts/validation/verify_project_assets.py
============================================================
"""
import hashlib
import os
import sys
import json

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from config.settings import STATIC_LETTERS, DYNAMIC_LETTERS

RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")
WEB_DIR = os.path.join(PROJECT_ROOT, "asl-web")
WEB_DATA_DIR = os.path.join(WEB_DIR, "data")
WEB_MODELS_DIR = os.path.join(WEB_DIR, "models")
NOTEBOOKS_RESULTS = os.path.join(PROJECT_ROOT, "notebooks", "results")
LETTER_MODEL_DIR = os.path.join(PROJECT_ROOT, "models", "letter")

# ─── Provenance hash chain — asl-web/ ile kaynak dosyalar arasi uyusma ───
# Bkz. docs/current/data-contract.md
PROVENANCE_PAIRS = [
    # (label, web_path, source_path)
    (
        "word_model.onnx",
        os.path.join(WEB_MODELS_DIR, "word_model.onnx"),
        os.path.join(NOTEBOOKS_RESULTS, "word_model.onnx"),
    ),
    (
        "letter_model.onnx",
        os.path.join(WEB_MODELS_DIR, "letter_model.onnx"),
        os.path.join(LETTER_MODEL_DIR, "onnx_exports", "letter_model_static_24_web_no_zipmap.onnx"),
    ),
    (
        "word_labels.json",
        os.path.join(WEB_DATA_DIR, "word_labels.json"),
        os.path.join(NOTEBOOKS_RESULTS, "word_to_idx.json"),
    ),
    (
        "letter_labels.json",
        os.path.join(WEB_DATA_DIR, "letter_labels.json"),
        os.path.join(LETTER_MODEL_DIR, "letter_label_map.json"),
    ),
    (
        "temperature.json",
        os.path.join(WEB_DATA_DIR, "temperature.json"),
        os.path.join(NOTEBOOKS_RESULTS, "temperature.json"),
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
    """SHA-256 hash dondurur; dosya yoksa None."""
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def check_provenance_hash_chain() -> bool:
    """asl-web/ runtime dosyalari ile kaynak (notebooks/results/, models/letter/)
    arasi SHA-256 hash uyusmasi kontrolu. Drift olursa runtime kaynaktan ayrilmis demek;
    yeniden export gerekir.

    Bkz: docs/current/data-contract.md (provenance hash chain tablosu)
    """
    print(f"\n{'─'*60}")
    print("  PROVENANCE HASH CHAIN (asl-web ↔ kaynak)")
    print(f"{'─'*60}")

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
            # Web dosyasi var ama kaynak yok → repo eksik (legacy/old_notebooks/ olabilir)
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
    """GitHub Pages hedefi olan asl-web runtime dosyalarını doğrular."""
    print(f"\n{'─'*60}")
    print("  AKTİF WEB RUNTIME (GitHub Pages deploy)")
    print(f"{'─'*60}")

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

    ok = _check_dense_label_map(
        "letter_labels.json",
        os.path.join(WEB_DATA_DIR, "letter_labels.json"),
        24,
    ) and ok
    ok = _check_dense_label_map(
        "word_labels.json",
        os.path.join(WEB_DATA_DIR, "word_labels.json"),
        50,
    ) and ok

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
    """Bir klasördeki görsel dosyalarını sayar."""
    if not os.path.isdir(directory):
        return 0
    return sum(
        1 for f in os.listdir(directory)
        if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))
    )


def check_dataset(name: str, path: str, letter_subdir: bool = True):
    """Bir dataset'i kontrol eder ve rapor verir."""
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
        # Harf klasörlerini kontrol et
        letters_found = []
        letters_missing = []
        min_count = float('inf')
        max_count = 0
        
        for letter in STATIC_LETTERS + DYNAMIC_LETTERS:
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
            print(f"     Harfler: {len(letters_found)}/26 bulundu")
            print(f"     Görsel:  {min_count}–{max_count} / harf")
            
            if letters_missing:
                print(f"     Eksik:   {', '.join(letters_missing)}")
            
            # Detaylı tablo
            print(f"\n     {'Harf':>6} {'Sayı':>6}  {'Durum'}")
            print(f"     {'─'*25}")
            for letter, count in letters_found:
                status = "✓" if count >= 30 else "⚠ az"
                bar_len = min(count // 100, 20)
                bar = "█" * bar_len
                print(f"     {letter:>6} {count:>6}  {status} {bar}")
        
        return len(letters_found) > 0
    
    return True


def check_dynamic_data():
    """data/raw/dynamic/ klasöründeki opsiyonel legacy J/Z verilerini kontrol eder."""
    dynamic_dir = os.path.join(RAW_DIR, "dynamic")
    
    print(f"\n  📂 Dinamik Veriler (J/Z, opsiyonel legacy)")
    
    if not os.path.isdir(dynamic_dir):
        print(f"     ○ Henüz veri toplanmadı — aktif web runtime için zorunlu değil")
        print(f"     → python scripts/model_training/train_dynamic_jz_model.py collect")
        return False
    
    for sign in DYNAMIC_LETTERS:
        sign_dir = os.path.join(dynamic_dir, sign)
        if os.path.isdir(sign_dir):
            npy_files = [f for f in os.listdir(sign_dir) if f.endswith('.npy')]
            print(f"     [{sign}] {len(npy_files)} sekans")
        else:
            print(f"     [{sign}] ○ Veri yok")
    
    return True


def check_models():
    """Legacy Python masaustu modellerini kontrol eder."""
    print(f"\n  📂 Legacy Python modelleri")
    
    model_files = [
        ("Harf modeli",   os.path.join(PROJECT_ROOT, "models", "letter", "letter_model.pkl")),
        ("Harf label map",os.path.join(PROJECT_ROOT, "models", "letter", "letter_label_map.json")),
        ("J/Z modeli (ops.)",    os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_model.pt")),
        ("J/Z label map (ops.)", os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_label_map.json")),
        ("25 kelime legacy", os.path.join(PROJECT_ROOT, "legacy", "old_notebooks", "04_word_25_holistic_v4", "outputs", "word_25_v4_holistic321_bigru_attention.pt")),
        ("25 kelime label",  os.path.join(PROJECT_ROOT, "legacy", "old_notebooks", "04_word_25_holistic_v4", "outputs", "word_25_v4_label_map.json")),
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
    
    # 1. Statik datasets
    datasets = [
        ("MediaPipe Processed ASL", os.path.join(RAW_DIR, "MediaPipe_Processed_Asl")),
        ("ASL Alphabet (Kaggle)",   os.path.join(RAW_DIR, "ASL Alphabet", "asl_alphabet_train", "asl_alphabet_train")),
        ("American Sign Language",  os.path.join(RAW_DIR, "American Sign Language Dataset")),
    ]
    
    print(f"\n{'─'*60}")
    print("  STATIK HARF DATASETLERİ (A-Z görselleri)")
    print(f"{'─'*60}")
    
    for name, path in datasets:
        check_dataset(name, path)
    
    # 2. WLASL (video)
    print(f"\n{'─'*60}")
    print("  VİDEO DATASET (Kelime)")
    print(f"{'─'*60}")
    
    wlasl_path = os.path.join(RAW_DIR, "WLASL")
    if os.path.isdir(wlasl_path):
        videos_dir = os.path.join(wlasl_path, "videos")
        video_count = len(os.listdir(videos_dir)) if os.path.isdir(videos_dir) else 0
        print(f"\n  📂 WLASL")
        print(f"     Video sayısı: {video_count}")
        print(f"     ⚠ Not: Kelime modeli için Kaggle Google ASL Signs önerilir")
    
    # 3. Dinamik veriler
    print(f"\n{'─'*60}")
    print("  DİNAMİK VERİLER (J/Z)")
    print(f"{'─'*60}")
    check_dynamic_data()
    
    # 4. Modeller
    print(f"\n{'─'*60}")
    print("  EĞİTİLMİŞ MODELLER")
    print(f"{'─'*60}")
    check_models()
    
    # 5. Özet ve sonraki adımlar
    print(f"\n{'═'*60}")
    print("  📋 SONRAKİ ADIMLAR")
    print(f"{'═'*60}")
    
    letter_model = os.path.join(PROJECT_ROOT, "models", "letter", "letter_model.pkl")
    jz_model = os.path.join(PROJECT_ROOT, "models", "letter", "dynamic_jz", "jz_model.pt")
    word_model = os.path.join(PROJECT_ROOT, "legacy", "old_notebooks", "04_word_25_holistic_v4", "outputs", "word_25_v4_holistic321_bigru_attention.pt")
    
    if not os.path.exists(letter_model):
        print("\n  1️⃣  Harf modeli eğitin:")
        print("     python scripts/model_training/train_static_letter_model.py")
        print("     python scripts/model_training/train_static_letter_model.py --max-images 500  # hızlı test")
    
    if not os.path.exists(jz_model):
        print("\n  2️⃣  Opsiyonel legacy J/Z modeli için:")
        print("     python scripts/model_training/train_dynamic_jz_model.py collect")
        print("     python scripts/model_training/train_dynamic_jz_model.py train")
    
    if not os.path.exists(word_model):
        print("\n  3️⃣  Legacy masaüstü 25 kelime modeli yok:")
        print("     → Bu aktif web demosunu engellemez; web modeli asl-web/models/ altındadır.")
    
    if web_ok:
        print("\n  4️⃣  Aktif web demosunu çalıştırın:")
        print("     cd asl-web")
        print("     python3 -m http.server 8080")
        print("     # Tarayıcı: http://localhost:8080")

    if all(os.path.exists(p) for p in [letter_model]):
        print("\n  5️⃣  Legacy Python masaüstü uygulama:")
        print("     python3 asl-desktop/main.py")
    
    print()


if __name__ == "__main__":
    main()
