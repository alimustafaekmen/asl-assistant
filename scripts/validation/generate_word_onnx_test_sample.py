"""Generate the deterministic smoke fixture for the web word model.

The script runs the deployed ONNX model on seeded synthetic input and writes
both the input contract and expected output to ``asl-web/data/test_sample.json``.
The browser should reproduce the stored result within the documented tolerance.

Example:
    cd asl-assistant
    python scripts/validation/generate_word_onnx_test_sample.py

Output:
    asl-web/data/test_sample.json

The source result directory is changed only when ``--write-notebooks`` is
explicitly supplied.
"""

import argparse
import json
import os
import sys

import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    print("onnxruntime kurulu değil. Kurulum sonrası tekrar çalıştır:")
    print(f"  {sys.executable} -m pip install onnxruntime")
    sys.exit(1)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Prefer the deploy copy; source artifacts require explicit opt-in.
WEB_WORD_MODEL_PATHS = [
    os.path.join(PROJECT_ROOT, "asl-web", "models", "word_model.onnx"),
]
SOURCE_WORD_MODEL_PATHS = [
    os.path.join(PROJECT_ROOT, "models", "word", "web-50", "word_model.onnx"),
]

# Label-map candidates follow the same deploy/source policy.
WEB_LABELS_PATHS = [
    os.path.join(PROJECT_ROOT, "asl-web", "data", "word_labels.json"),
]
SOURCE_LABELS_PATHS = [
    os.path.join(PROJECT_ROOT, "models", "word", "web-50", "word_labels.json"),
]

# Temperature candidates follow the same deploy/source policy.
WEB_TEMP_PATHS = [
    os.path.join(PROJECT_ROOT, "asl-web", "data", "temperature.json"),
]
SOURCE_TEMP_PATHS = [
    os.path.join(PROJECT_ROOT, "models", "word", "web-50", "temperature.json"),
]


def find_file(paths, name):
    for p in paths:
        if os.path.exists(p):
            print(f"  {name}: {p} ({os.path.getsize(p) / 1024:.1f} KB)")
            return p
    print(f"  HATA: {name} BULUNAMADI! Aranan yollar:")
    for p in paths:
        print(f"    - {p}")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Web ONNX test_sample.json uretici")
    parser.add_argument(
        "--allow-model-source",
        action="store_true",
        help="asl-web kopyasi yoksa models/word/web-50 kaynagini okumaya izin ver.",
    )
    parser.add_argument(
        "--write-notebooks",
        action="store_true",
        help="test_sample.json dosyasini notebooks/word_50_results altina da yaz.",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  test_sample.json Üretici")
    print("=" * 60)
    print()

    # Resolve a complete model contract before loading ONNX Runtime.
    print("Dosyalar aranıyor...")
    model_paths = WEB_WORD_MODEL_PATHS + (
        SOURCE_WORD_MODEL_PATHS if args.allow_model_source else []
    )
    label_paths = WEB_LABELS_PATHS + (SOURCE_LABELS_PATHS if args.allow_model_source else [])
    temp_paths = WEB_TEMP_PATHS + (SOURCE_TEMP_PATHS if args.allow_model_source else [])

    model_path = find_file(model_paths, "word_model.onnx")
    labels_path = find_file(label_paths, "word_labels.json")
    temp_path = find_file(temp_paths, "temperature.json")
    print()

    print("ONNX model yükleniyor...")
    session = ort.InferenceSession(model_path)

    print("  Inputs:")
    for inp in session.get_inputs():
        print(f"    {inp.name}: shape={inp.shape}, dtype={inp.type}")

    print("  Outputs:")
    for out in session.get_outputs():
        print(f"    {out.name}: shape={out.shape}, dtype={out.type}")

    input_names = [i.name for i in session.get_inputs()]
    output_names = [o.name for o in session.get_outputs()]
    print()

    with open(labels_path) as f:
        word_to_idx = json.load(f)
    idx_to_word = {int(v): k for k, v in word_to_idx.items()}
    print(f"Kelime sayısı: {len(word_to_idx)}")

    # Load the calibration temperature used by browser inference.
    with open(temp_path) as f:
        temp_data = json.load(f)
    T = temp_data.get("T") or temp_data.get("temperature") or 1.0
    print(f"Temperature: {T}")
    print()

    # Generate reproducible synthetic values in the model's expected range.
    np.random.seed(42)
    features = np.random.randn(1, 45, 168).astype(np.float32) * 0.1
    # Mark 30 frames as real and leave the final 15 frames as zero padding.
    actual_frames = 30
    features[0, actual_frames:, :] = 0.0
    mask = np.zeros((1, 45), dtype=bool)
    mask[0, :actual_frames] = True

    print("Test input oluşturuldu:")
    print(f"  features shape: {features.shape}")
    print(f"  mask shape: {mask.shape}")
    print(f"  Gerçek frame: {actual_frames}/45")
    print()

    print("ONNX inference çalıştırılıyor...")
    feeds = {input_names[0]: features, input_names[1]: mask}
    results = session.run(output_names, feeds)
    logits = results[0][0]  # (50,)

    # Apply the same temperature scaling and softmax as the browser.
    calibrated = logits / T
    exp_scores = np.exp(calibrated - calibrated.max())
    probs = exp_scores / exp_scores.sum()

    # Store top-three results for a human-readable smoke check.
    top3_idx = np.argsort(probs)[-3:][::-1]
    print("\nPython ONNX sonucu (top-3):")
    for rank, idx in enumerate(top3_idx, 1):
        word = idx_to_word.get(idx, f"idx_{idx}")
        print(f"  {rank}. {word}: {probs[idx] * 100:.2f}%")

    expected_word = idx_to_word[top3_idx[0]]
    print(f"\nBeklenen kelime: {expected_word}")
    print()

    test_sample = {
        "features": features[0].flatten().tolist(),  # 45 * 168 = 7560 values, frame-major
        "mask": mask[0].tolist(),  # 45 booleans, true for a real frame
        "expected_word": expected_word,
        "expected_confidence": float(probs[top3_idx[0]]),
        "expected_top3": [
            {"label": idx_to_word[idx], "confidence": float(probs[idx])} for idx in top3_idx
        ],
        "expected_logits": logits.tolist(),  # 50 values, for a numeric comparison
        "temperature": T,
        "actual_frames": actual_frames,
        "seed": 42,
        "note": "Bu dosya Python ONNX Runtime ile üretildi. "
        "Web ONNX çıktısı ile karşılaştırılmalı. "
        "Max fark < 1e-4 olmalı.",
    }

    # Write only the deploy fixture unless source output is explicitly requested.
    web_data_dir = os.path.join(PROJECT_ROOT, "asl-web", "data")
    written_path = None
    if os.path.exists(web_data_dir):
        web_path = os.path.join(web_data_dir, "test_sample.json")
        with open(web_path, "w") as f:
            json.dump(test_sample, f, indent=2)
        written_path = web_path
        print(f"Kaydedildi: {web_path}")
        print(f"  Boyut: {os.path.getsize(web_path) / 1024:.1f} KB")
    else:
        print(f"  UYARI: {web_data_dir} bulunamadı, kaydedilemedi")

    if args.write_notebooks:
        results_dir = os.path.join(PROJECT_ROOT, "notebooks", "word_50_results")
        os.makedirs(results_dir, exist_ok=True)
        results_path = os.path.join(results_dir, "test_sample.json")
        with open(results_path, "w") as f:
            json.dump(test_sample, f, indent=2)
        print(f"Notebooks kopyası yazıldı: {results_path}")
        if written_path is None:
            written_path = results_path

    if written_path is None:
        print("  HATA: Yazılacak hedef bulunamadı.")
        sys.exit(1)

    # Reload the saved fixture and independently reproduce its result.
    print()
    print("=" * 60)
    print("  DOĞRULAMA")
    print("=" * 60)
    print()

    with open(written_path) as f:
        loaded = json.load(f)

    features_back = np.array(loaded["features"], dtype=np.float32).reshape(1, 45, 168)
    mask_back = np.array(loaded["mask"], dtype=bool).reshape(1, 45)

    feeds2 = {input_names[0]: features_back, input_names[1]: mask_back}
    results2 = session.run(output_names, feeds2)
    logits2 = results2[0][0]

    max_diff = np.max(np.abs(logits - logits2))
    print(f"JSON save/load sonrası max logit farkı: {max_diff:.2e}")
    print(f"  {'BAŞARILI' if max_diff < 1e-6 else 'HATA: FARK ÇOK BÜYÜK!'}")

    print()
    print("─" * 60)
    print("Web tarafında doğrulama:")
    print("  1. localhost:8080 aç")
    print("  2. Kamerasız dene ekranında Kelime modeli > Tümünü çalıştır")
    print("  3. Beklenen kelime ile ONNX sonucunu karşılaştır")
    print(f"  4. Beklenen: {expected_word} ({probs[top3_idx[0]] * 100:.1f}%)")
    print("─" * 60)


if __name__ == "__main__":
    main()
