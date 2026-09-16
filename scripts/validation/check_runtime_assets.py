#!/usr/bin/env python3
"""
============================================================
  asl-web/ Runtime Asset Smoke Test
============================================================

Web runtime'inin (`asl-web/`) deploy oncesi hizli sağlik kontrolu.
GitHub Pages'e push'tan once veya CI'da kosturulmasi onerilir.

(EN) Fast pre-deploy smoke test for the web runtime (asl-web/): checks that
critical files exist, JSON parses, web assets still match their source hashes
(drift check), and — if onnxruntime is installed — that the ONNX I/O contract
holds. Exit 0 = safe to deploy, 1 = fix before deploying.

Yaptiklari:
  1. asl-web/ icindeki kritik dosyalarin mevcudiyeti + boyutu
  2. asl-web/data/*.json parse edilebilir + sema dogrulamasi
  3. asl-web/{models,data} ↔ source (notebooks/results, models/letter)
     hash chain karsilastirmasi (drift kontrolu)
  4. ONNX dosyalari icin opsiyonel I/O sozlesmesi dogrulamasi
     (onnx/onnxruntime kuruluysa)

Bu script `verify_project_assets.py`'in WEB-FOCUSED altkumesidir; dataset
indirme/landmark cikarma adimlarini ATLAR. Hizli demo-oncesi kontrol icin.

Kullanim:
  python scripts/validation/check_runtime_assets.py
  python scripts/validation/check_runtime_assets.py --verbose
  python scripts/validation/check_runtime_assets.py --check-onnx   # onnx kurulu olsun

Cikis kodu:
  0  Tum kontroller gecti (deploy guvenli)
  1  En az bir kritik kontrol fail (deploy ETME, once duzelt)

Bkz:
  docs/current/data-contract.md  (provenance hash chain tablosu)
  docs/current/model-contract.md  (ONNX I/O sozlesmesi)
============================================================
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Iterable

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WEB_DIR = os.path.join(PROJECT_ROOT, "asl-web")
WEB_DATA_DIR = os.path.join(WEB_DIR, "data")
WEB_MODELS_DIR = os.path.join(WEB_DIR, "models")
NOTEBOOKS_RESULTS = os.path.join(PROJECT_ROOT, "notebooks", "results")
LETTER_MODEL_DIR = os.path.join(PROJECT_ROOT, "models", "letter")

# Web runtime asset minimum boyut (KB) — yanlislikla bos dosya commit edilirse fark eder
MIN_SIZES_KB = {
    "asl-web/models/word_model.onnx": 1500,
    "asl-web/models/letter_model.onnx": 10000,
    "asl-web/data/word_labels.json": 0.5,
    "asl-web/data/letter_labels.json": 0.2,
    "asl-web/data/temperature.json": 0.1,
    "asl-web/data/per_word_stats.json": 1,
    "asl-web/data/confusion_pairs.json": 0.5,
    "asl-web/data/curriculum.json": 1,
    "asl-web/data/test_sample.json": 100,
    "asl-web/index.html": 5,
    "asl-web/css/style.css": 5,
    "asl-web/js/core/app.js": 20,
    "asl-web/js/media/camera.js": 10,
    "asl-web/js/ml/landmarks.js": 2,
    "asl-web/js/ml/features.js": 5,
    "asl-web/js/ml/letter-model.js": 4,
    "asl-web/js/ml/word-model.js": 3,
    "asl-web/js/ml/gating.js": 2,
    "asl-web/js/services/benchmark.js": 0.5,
    "asl-web/assets/signs/letters.png": 10,
    "asl-web/assets/signs/kelime.png": 100,
    "asl-web/assets/signs/word-1.png": 100,
    "asl-web/assets/signs/word-2.png": 100,
    "asl-web/assets/signs/word-3.png": 100,
    "asl-web/assets/signs/word-4.png": 100,
    "asl-web/assets/signs/word-5.png": 100,
}

# Source → web hash chain (drift olursa runtime kaynaktan ayrilmis)
PROVENANCE_PAIRS = [
    ("word_model.onnx",
     os.path.join(WEB_MODELS_DIR, "word_model.onnx"),
     os.path.join(NOTEBOOKS_RESULTS, "word_model.onnx")),
    ("letter_model.onnx",
     os.path.join(WEB_MODELS_DIR, "letter_model.onnx"),
     os.path.join(LETTER_MODEL_DIR, "onnx_exports", "letter_model_static_24_web_no_zipmap.onnx")),
    ("word_labels.json",
     os.path.join(WEB_DATA_DIR, "word_labels.json"),
     os.path.join(NOTEBOOKS_RESULTS, "word_to_idx.json")),
    ("letter_labels.json",
     os.path.join(WEB_DATA_DIR, "letter_labels.json"),
     os.path.join(LETTER_MODEL_DIR, "letter_label_map.json")),
    ("temperature.json",
     os.path.join(WEB_DATA_DIR, "temperature.json"),
     os.path.join(NOTEBOOKS_RESULTS, "temperature.json")),
    ("per_word_stats.json",
     os.path.join(WEB_DATA_DIR, "per_word_stats.json"),
     os.path.join(NOTEBOOKS_RESULTS, "per_word_stats.json")),
    ("confusion_pairs.json",
     os.path.join(WEB_DATA_DIR, "confusion_pairs.json"),
     os.path.join(NOTEBOOKS_RESULTS, "confusion_pairs.json")),
    ("curriculum.json",
     os.path.join(WEB_DATA_DIR, "curriculum.json"),
     os.path.join(NOTEBOOKS_RESULTS, "curriculum.json")),
    ("test_sample.json",
     os.path.join(WEB_DATA_DIR, "test_sample.json"),
     os.path.join(NOTEBOOKS_RESULTS, "test_sample.json")),
]


def _sha256(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_kb(path: str) -> float:
    return os.path.getsize(path) / 1024.0


def _ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def _fail(msg: str) -> None:
    print(f"  \033[31m✗\033[0m {msg}")


def _warn(msg: str) -> None:
    print(f"  \033[33m⚠\033[0m {msg}")


def check_file_existence_and_size() -> bool:
    """Web runtime'inin tum kritik dosyalari mevcut mu + minimum boyutta mi?"""
    print("\n[1/4] Dosya mevcudiyet + minimum boyut kontrolu")
    ok = True
    for rel_path, min_kb in MIN_SIZES_KB.items():
        abs_path = os.path.join(PROJECT_ROOT, rel_path)
        if not os.path.exists(abs_path):
            _fail(f"{rel_path}: BULUNAMADI")
            ok = False
            continue
        actual_kb = _file_kb(abs_path)
        if actual_kb < min_kb:
            _fail(f"{rel_path}: COK KUCUK ({actual_kb:.1f} KB < {min_kb} KB)")
            ok = False
        else:
            _ok(f"{rel_path}: {actual_kb:.1f} KB")
    return ok


def check_json_schemas() -> bool:
    """asl-web/data/*.json dosyalari parse edilebilir + sema kurali esliyor mu?"""
    print("\n[2/4] JSON sema kontrolu")
    ok = True

    schemas = {
        "word_labels.json": {"expect_count": 50, "type": "labels"},
        "letter_labels.json": {"expect_count": 24, "type": "labels"},
        "temperature.json": {"type": "temperature"},
        "test_sample.json": {"type": "test_sample"},
        "per_word_stats.json": {"type": "stats"},
        "confusion_pairs.json": {"type": "pairs"},
    }

    for filename, schema in schemas.items():
        path = os.path.join(WEB_DATA_DIR, filename)
        if not os.path.exists(path):
            _fail(f"{filename}: yok")
            ok = False
            continue
        try:
            data = json.load(open(path, encoding="utf-8"))
        except json.JSONDecodeError as exc:
            _fail(f"{filename}: parse hatasi {exc}")
            ok = False
            continue

        kind = schema.get("type")
        if kind == "labels":
            expect = schema["expect_count"]
            indices = sorted(int(v) for v in data.values())
            if len(data) != expect or indices != list(range(expect)):
                _fail(f"{filename}: dense {expect} eleman bekleniyor; len={len(data)}, indices={indices[:5]}...")
                ok = False
            else:
                _ok(f"{filename}: dense {expect} sinif (0..{expect - 1})")
        elif kind == "temperature":
            t = data.get("T") or data.get("temperature")
            if not isinstance(t, (int, float)) or not 0 < t < 5:
                _fail(f"temperature.json: T degeri makul degil ({t})")
                ok = False
            else:
                _ok(f"temperature.json: T={t}")
        elif kind == "test_sample":
            features = data.get("features", [])
            mask = data.get("mask", [])
            expected_word = data.get("expected_word")
            if len(features) != 45 * 168:
                _fail(f"test_sample.json: features uzunlugu 7560 olmali, {len(features)}")
                ok = False
            elif len(mask) != 45:
                _fail(f"test_sample.json: mask uzunlugu 45 olmali, {len(mask)}")
                ok = False
            elif not expected_word:
                _fail("test_sample.json: expected_word eksik")
                ok = False
            else:
                real_frames = sum(1 for v in mask if v)
                _ok(f"test_sample.json: features={len(features)}, mask={len(mask)} (gercek={real_frames}/45), expected={expected_word}")
        elif kind == "stats":
            if not isinstance(data, dict) or len(data) < 1:
                _fail(f"per_word_stats.json: bos veya yanlis tip")
                ok = False
            else:
                sample_key = next(iter(data))
                fields = data[sample_key]
                missing = [k for k in ("f1", "difficulty") if k not in fields]
                if missing:
                    _fail(f"per_word_stats.json: '{sample_key}' kayitinda eksik alan: {missing}")
                    ok = False
                else:
                    _ok(f"per_word_stats.json: {len(data)} kelime stat (ornek '{sample_key}': f1={fields['f1']}, difficulty={fields['difficulty']})")
        elif kind == "pairs":
            if not isinstance(data, list) or len(data) < 1:
                _fail("confusion_pairs.json: bos veya yanlis tip")
                ok = False
            else:
                sample = data[0]
                if not all(k in sample for k in ("word_a", "word_b")):
                    _fail(f"confusion_pairs.json: ilk eleman 'word_a'/'word_b' icermiyor: {sample}")
                    ok = False
                else:
                    _ok(f"confusion_pairs.json: {len(data)} cift (ornek: {sample['word_a']} ↔ {sample['word_b']})")

    return ok


def check_provenance() -> bool:
    """asl-web ↔ source hash chain dogrulamasi."""
    print("\n[3/4] Provenance hash chain (asl-web ↔ kaynak)")
    ok = True
    for label, web_path, source_path in PROVENANCE_PAIRS:
        web_hash = _sha256(web_path)
        src_hash = _sha256(source_path)
        if web_hash is None:
            _fail(f"{label}: web dosyasi yok")
            ok = False
            continue
        if src_hash is None:
            _warn(f"{label}: kaynak dosya yok ({source_path}) — gelistirme ortami eksik, web run OK")
            continue
        if web_hash == src_hash:
            _ok(f"{label}: {web_hash[:16]}... (web == kaynak)")
        else:
            _fail(f"{label}: DRIFT")
            print(f"      web   : {web_hash}")
            print(f"      kaynak: {src_hash}")
            print(f"      → cp {source_path} {web_path}")
            ok = False
    return ok


def check_onnx_contracts(verbose: bool = False) -> bool:
    """ONNX I/O sozlesmesi dogrulamasi (onnx/onnxruntime kuruluysa)."""
    print("\n[4/4] ONNX I/O sozlesmesi")
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        _warn("onnxruntime kurulu degil — atlandi (pip install -r requirements-dev.txt)")
        return True

    ok = True

    # WORD model
    word_path = os.path.join(WEB_MODELS_DIR, "word_model.onnx")
    if not os.path.exists(word_path):
        _fail(f"word_model.onnx yok")
        return False
    sess = ort.InferenceSession(word_path)
    in_names = [i.name for i in sess.get_inputs()]
    out_names = [o.name for o in sess.get_outputs()]
    in_shapes = [i.shape for i in sess.get_inputs()]
    out_shapes = [o.shape for o in sess.get_outputs()]

    word_ok = (
        len(in_names) == 2
        and in_shapes[0][1:] == [45, 168]
        and in_shapes[1][1:] == [45]
        and len(out_names) == 1
        and out_shapes[0][1:] == [50]
    )
    if word_ok:
        _ok(f"word_model: input={in_names}, output={out_names}, shapes OK")
    else:
        _fail(f"word_model SHAPE MISMATCH: inputs={list(zip(in_names, in_shapes))}, outputs={list(zip(out_names, out_shapes))}")
        print(f"      Beklenen: input(1,45,168) + mask(1,45) → output(1,50)")
        ok = False

    # LETTER model
    letter_path = os.path.join(WEB_MODELS_DIR, "letter_model.onnx")
    if not os.path.exists(letter_path):
        _fail("letter_model.onnx yok")
        return False
    sess2 = ort.InferenceSession(letter_path)
    in_names2 = [i.name for i in sess2.get_inputs()]
    outputs2 = sess2.get_outputs()
    out_names2 = [o.name for o in outputs2]
    out_shapes2 = [o.shape for o in outputs2]
    out_types2 = [o.type for o in outputs2]
    in_shapes2 = [i.shape for i in sess2.get_inputs()]

    letter_ok = (
        len(in_names2) == 1
        and in_shapes2[0][1:] == [93]
        and out_names2 == ["label", "probabilities"]
        and out_types2 == ["tensor(int64)", "tensor(float)"]
        and out_shapes2[1][1:] == [24]
    )
    if letter_ok:
        _ok(f"letter_model: input={in_names2}, output={out_names2}, probabilities=tensor(float)[N,24]")
    else:
        _fail(f"letter_model SHAPE MISMATCH: inputs={list(zip(in_names2, in_shapes2))}, outputs={list(zip(out_names2, out_shapes2, out_types2))}")
        print("      Beklenen: input(N,93) → label tensor(int64)[N] + probabilities tensor(float)[N,24]")
        ok = False

    # OPSIYONEL: test_sample.json ile inference + ground truth
    sample_path = os.path.join(WEB_DATA_DIR, "test_sample.json")
    if os.path.exists(sample_path):
        try:
            import numpy as np  # type: ignore
            sample = json.load(open(sample_path, encoding="utf-8"))
            features = np.array(sample["features"], dtype=np.float32).reshape(1, 45, 168)
            mask = np.array([sample["mask"]], dtype=bool)
            T = sample.get("temperature", 1.0)

            logits = sess.run(out_names, {in_names[0]: features, in_names[1]: mask})[0][0]
            calib = logits / T
            ex = np.exp(calib - calib.max())
            probs = ex / ex.sum()
            top1 = int(np.argmax(probs))

            with open(os.path.join(WEB_DATA_DIR, "word_labels.json"), encoding="utf-8") as f:
                i2w = {int(v): k for k, v in json.load(f).items()}

            predicted = i2w.get(top1)
            expected = sample.get("expected_word")
            conf_diff = abs(probs[top1] - sample.get("expected_confidence", 0))

            if predicted == expected and conf_diff < 1e-3:
                _ok(f"offline test: {predicted} @ {probs[top1]:.4f} (Δconf={conf_diff:.2e}) — ground truth {expected}")
            else:
                _fail(f"offline test FAIL: predicted={predicted} ({probs[top1]:.4f}), expected={expected} (Δconf={conf_diff:.2e})")
                ok = False
        except (ImportError, KeyError, ValueError) as exc:
            _warn(f"offline test atlandi: {exc}")

    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="asl-web/ runtime sağlik kontrolu")
    parser.add_argument("--verbose", "-v", action="store_true", help="Daha detayli cikti")
    parser.add_argument("--check-onnx", action="store_true",
                        help="onnxruntime ile ONNX inference + ground truth dogrulamasi (varsayilan: aktif)")
    parser.add_argument("--no-onnx", action="store_true",
                        help="ONNX kontrolunu atla (sadece dosya/json/hash)")
    args = parser.parse_args()

    print("=" * 60)
    print("  asl-web/ Runtime Asset Smoke Test")
    print("=" * 60)

    file_ok = check_file_existence_and_size()
    json_ok = check_json_schemas()
    hash_ok = check_provenance()
    onnx_ok = True if args.no_onnx else check_onnx_contracts(args.verbose)

    print("\n" + "=" * 60)
    overall = file_ok and json_ok and hash_ok and onnx_ok
    if overall:
        print("  SONUC: \033[32m✓ DEPLOY GUVENLI\033[0m")
    else:
        print("  SONUC: \033[31m✗ DUZELTME GEREKLI\033[0m")
    print("=" * 60 + "\n")

    if not overall:
        print("Sonraki adimlar:")
        if not file_ok:
            print("  - Eksik/kucuk dosyalar: source dosyadan yeniden kopyala")
        if not json_ok:
            print("  - JSON sema hatasi: docs/current/data-contract.md kontrol et")
        if not hash_ok:
            print("  - Hash drift: notebook/script yeniden calistirilmis olabilir, source'tan kopyala")
        if not onnx_ok:
            print("  - ONNX shape mismatch: model yeniden export edilmis ama web kopyasi eski")
        print()

    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
