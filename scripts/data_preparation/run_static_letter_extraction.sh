#!/bin/bash
# ============================================================
#  ASL Dataset Tam Çıkarma Script'i
# ============================================================
#  Bu script her harfi ayrı ayrı çıkarır ve sonra birleştirir.
#  Toplam süre: ~15-20 dakika (M4 Pro)
#
#  Kullanım:
#    chmod +x scripts/data_preparation/run_static_letter_extraction.sh
#    ./scripts/data_preparation/run_static_letter_extraction.sh
# ============================================================

set -e

PYTHON="${PYTHON:-python}"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

ASL_DIR="data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train"
MP_DIR="data/raw/MediaPipe_Processed_Asl"
OUT_DIR="data/processed"
MAX_PER_CLASS=3000

echo "============================================================"
echo "  📸 Tam Dataset Çıkarma Pipeline'ı"
echo "============================================================"
echo "  Proje:     $PROJECT_DIR"
echo "  Max/sınıf: $MAX_PER_CLASS"
echo ""

# 1. ASL Alphabet dataset
if [ -d "$ASL_DIR" ]; then
    echo "── ASL Alphabet ──"
    $PYTHON scripts/data_preparation/extract_static_letter_landmarks.py \
        --input "$ASL_DIR" \
        --output "$OUT_DIR/asl_alphabet_landmarks.csv" \
        --max-per-class $MAX_PER_CLASS
    echo ""
else
    echo "⚠ ASL Alphabet bulunamadı: $ASL_DIR"
fi

# 2. Birleştirme (MediaPipe_Processed_Asl atlandı — 0% landmark algılama)
echo "── Birleştirme + Dengeleme ──"
$PYTHON scripts/data_preparation/merge_static_letter_datasets.py

echo ""
echo "============================================================"
echo "  ✅ TAMAMLANDI! Sonraki adım:"
echo "    python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison"
echo "============================================================"
