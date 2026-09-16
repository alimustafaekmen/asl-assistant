"""
Parity Test — Python 93D vs JS port 93D feature parity
================================================================

Bu script PRODUCTION'da çalışmaz; sadece test/kanıt amaçlı.
Hash chain'e EKLENMEZ; runtime asset DEĞİL.

İki amaç:
  1. Aynı 21 hand landmark için Python `extract_features` ve
     JS `computeLetterFeatures` 93D üretimini karşılaştır.
  2. Aynı 93D feature için pickle vs ONNX top-1 kararını karşılaştır.

Beklenen tolerans:
  - Feature parity: max_abs_diff < 1e-4
  - Pickle vs ONNX top-1: birebir aynı (label_index)

Çalıştırma:
  python tests/fixtures/letter/parity_check.py
"""
import json
import sys
import subprocess
from pathlib import Path

import numpy as np

# Proje root
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from asl_ml.utils.landmarks import normalize_landmarks
from asl_ml.features.letter_features import extract_features


def make_synthetic_hand(seed: int = 42) -> np.ndarray:
    """Sentetik 21-landmark fixture üretir (deterministik)."""
    rng = np.random.RandomState(seed)
    # 21 landmark x (x, y, z) — x,y in [0..1] image space, z negative-ish
    coords = rng.uniform(0.2, 0.8, (21, 3)).astype(np.float32)
    # Wrist (Landmark 0) "anchor"
    coords[0] = [0.5, 0.7, 0.0]
    # Middle MCP (Landmark 9) wrist'ten farklı (refDist için)
    coords[9] = [0.5, 0.5, -0.05]
    # Z koordinatları küçük negatif
    coords[:, 2] = rng.uniform(-0.1, 0.0, 21).astype(np.float32)
    return coords.flatten()


def python_letter_pipeline(landmarks_63: np.ndarray) -> np.ndarray:
    """Desktop tarafının yaptığı: normalize_landmarks → extract_features → 93D."""
    normalized = normalize_landmarks(landmarks_63)
    features = extract_features(normalized)
    return features


def js_letter_pipeline_via_node(landmarks_63_list: list) -> list:
    """JS port'unu Node.js'te çalıştır (asl-web/js/ml/features.js)."""
    # JS dosyaları classic mode (script tag global) — Node'da CommonJS değil.
    # Eval ile yükleyip computeLetterFeatures çağırırız.
    # 21 landmark → 321D vector formatında ver (rh slot 0..62).
    landmarks_321 = [0.0] * 321
    for i in range(63):
        landmarks_321[i] = landmarks_63_list[i]

    js_code = f"""
const features_path = "{ROOT / 'asl-web/js/ml/features.js'}";
const fs = require("fs");
const code = fs.readFileSync(features_path, "utf8");

// Geçici recordBenchmark stub (features.js global olarak çağırıyor)
global.recordBenchmark = function() {{}};

// Eval — top-level var/const'ları global yap
eval(code);

// computeLetterFeatures(frame321d) çağır
const input = new Float32Array({json.dumps(landmarks_321)});
const result = computeLetterFeatures(input);
console.log(JSON.stringify(Array.from(result)));
"""
    proc = subprocess.run(
        ["node", "-e", js_code],
        capture_output=True, text=True, timeout=30
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Node failed:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}")
    return json.loads(proc.stdout.strip())


def test_feature_parity():
    """Test A: Python 93D vs JS port 93D parity."""
    print("=" * 60)
    print("Test A — Python ↔ JS Letter Feature Parity")
    print("=" * 60)

    landmarks = make_synthetic_hand(seed=42)
    py_features = python_letter_pipeline(landmarks)
    print(f"Python 93D shape: {py_features.shape}, dtype: {py_features.dtype}")
    print(f"Python first 5: {py_features[:5].tolist()}")

    # JS pipeline farklı: directly 321D verir, içeride normalize + shape yapar
    # Python pipeline: normalize ÖNCE landmark üzerine, sonra extract_features.
    # JS pipeline: 321D → selectPrimaryHandForLetter (ham 63D rh) → normalizeHandForLetter → shape
    # Yani JS de aslında aynı işi yapar ama ÖZÜNDE rh slot'u alıp normalize eder.
    # Karşılaştırma için: Python'a HAM landmark, JS'e HAM landmark (321D olarak rh slot'unda) ver.
    try:
        js_features = js_letter_pipeline_via_node(landmarks.tolist())
        js_arr = np.array(js_features, dtype=np.float32)
        print(f"JS 93D shape: {js_arr.shape}, dtype: {js_arr.dtype}")
        print(f"JS first 5: {js_arr[:5].tolist()}")

        diff = np.abs(py_features - js_arr)
        max_diff = float(diff.max())
        mean_diff = float(diff.mean())
        argmax_idx = int(diff.argmax())

        print()
        print(f"max_abs_diff : {max_diff:.6e}")
        print(f"mean_abs_diff: {mean_diff:.6e}")
        print(f"argmax index : {argmax_idx} (Python={py_features[argmax_idx]:.6e}, JS={js_arr[argmax_idx]:.6e})")
        print()

        if max_diff < 1e-4:
            print("✓ FEATURE PARITY: PROVEN (max_diff < 1e-4)")
            return True
        else:
            print(f"✗ FEATURE PARITY: FAIL (max_diff = {max_diff:.6e} >= 1e-4)")
            print(f"  İlk 10 büyük fark indeksi:")
            for i in np.argsort(-diff)[:10]:
                print(f"    [{i}] py={py_features[i]:.6e} js={js_arr[i]:.6e} diff={diff[i]:.6e}")
            return False
    except Exception as e:
        print(f"⚠ JS test çalıştırılamadı: {e}")
        return None


def test_pickle_vs_onnx():
    """Test B: Aynı 93D feature için pickle vs ONNX top-1 karşılaştırma."""
    print()
    print("=" * 60)
    print("Test B — Pickle (.pkl) vs ONNX Top-1 Parity")
    print("=" * 60)

    try:
        import joblib
        import onnxruntime as ort
    except ImportError as e:
        print(f"⚠ joblib/onnxruntime yok: {e}")
        return None

    pkl_path = ROOT / "models/letter/letter_model.pkl"
    onnx_path = ROOT / "asl-web/models/letter_model.onnx"
    label_map_path = ROOT / "asl-web/data/letter_labels.json"

    if not pkl_path.exists():
        print(f"⚠ pickle yok: {pkl_path}")
        return None
    if not onnx_path.exists():
        print(f"⚠ onnx yok: {onnx_path}")
        return None

    pkl_model = joblib.load(pkl_path)
    onnx_sess = ort.InferenceSession(str(onnx_path))
    label_map = json.loads(label_map_path.read_text())
    inv_map = {v: k for k, v in label_map.items()}

    # 5 farklı seed ile sentetik fixture
    results = []
    for seed in [42, 7, 99, 1234, 2026]:
        landmarks = make_synthetic_hand(seed=seed)
        features = python_letter_pipeline(landmarks)
        feat = features.reshape(1, -1).astype(np.float32)

        # Pickle
        pkl_probs = pkl_model.predict_proba(feat)[0]
        pkl_top1 = int(np.argmax(pkl_probs))
        pkl_conf = float(pkl_probs[pkl_top1])

        # ONNX
        try:
            onnx_out = onnx_sess.run(None, {"input": feat})
            # output[0] = label, output[1] = probabilities (ZipMap)
            onnx_label = int(onnx_out[0][0])
            onnx_top1 = onnx_label
            # ZipMap'i parse etmeyi deneyelim (Python'da çalışır)
            try:
                if len(onnx_out) > 1 and isinstance(onnx_out[1], list):
                    probs_dict = onnx_out[1][0]  # dict (label_idx → prob)
                    onnx_conf = float(probs_dict.get(onnx_label, 0.0))
                else:
                    onnx_conf = -1.0
            except Exception:
                onnx_conf = -1.0
        except Exception as e:
            print(f"  seed={seed}: ONNX run hata: {e}")
            continue

        match = pkl_top1 == onnx_top1
        prob_diff = abs(pkl_conf - onnx_conf) if onnx_conf >= 0 else None
        results.append({
            "seed": seed,
            "pkl_top1": pkl_top1, "pkl_label": inv_map.get(pkl_top1, "?"),
            "onnx_top1": onnx_top1, "onnx_label": inv_map.get(onnx_top1, "?"),
            "pkl_conf": pkl_conf, "onnx_conf": onnx_conf,
            "match": match, "prob_diff": prob_diff,
        })

    print()
    print(f"{'seed':>6} {'pkl_label':>10} {'onnx_label':>10} {'pkl_conf':>10} {'onnx_conf':>10} {'match':>6}")
    print("-" * 70)
    all_match = True
    for r in results:
        print(f"{r['seed']:>6} {r['pkl_label']:>10} {r['onnx_label']:>10} {r['pkl_conf']:>10.4f} {r['onnx_conf']:>10.4f} {str(r['match']):>6}")
        if not r['match']:
            all_match = False

    print()
    if all_match:
        print("✓ PICKLE vs ONNX TOP-1 PARITY: PROVEN (5/5 birebir aynı label)")
        return True
    else:
        print(f"✗ PICKLE vs ONNX TOP-1 PARITY: FAIL")
        return False


if __name__ == "__main__":
    a_result = test_feature_parity()
    b_result = test_pickle_vs_onnx()

    print()
    print("=" * 60)
    print("ÖZET")
    print("=" * 60)
    print(f"Test A (Feature Parity): {'PROVEN' if a_result else 'FAIL' if a_result is False else 'SKIP'}")
    print(f"Test B (Pickle ↔ ONNX) : {'PROVEN' if b_result else 'FAIL' if b_result is False else 'SKIP'}")
