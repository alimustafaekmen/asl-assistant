#!/bin/bash
# Extract hand landmarks from the ASL Alphabet images, then merge, clean,
# balance and split them for the letter model. Takes about 15-20 minutes on an
# Apple M4 Pro.
#
# The merge balances the classes by default. The published model was trained
# on unbalanced tables: run the merge again with --no-balance to reproduce them.
#
# Usage:
#   ./scripts/data_preparation/run_static_letter_extraction.sh
#   PYTHON=/path/to/python ./scripts/data_preparation/run_static_letter_extraction.sh

set -e

PYTHON="${PYTHON:-python}"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

ASL_DIR="data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train"
OUT_DIR="data/processed"
MAX_PER_CLASS=3000

echo "============================================================"
echo "  Letter dataset extraction pipeline"
echo "============================================================"
echo "  Project:   $PROJECT_DIR"
echo "  Max/class: $MAX_PER_CLASS"
echo ""

# 1. ASL Alphabet dataset
if [ -d "$ASL_DIR" ]; then
    echo "ASL Alphabet"
    $PYTHON scripts/data_preparation/extract_static_letter_landmarks.py \
        --input "$ASL_DIR" \
        --output "$OUT_DIR/asl_alphabet_landmarks.csv" \
        --max-per-class $MAX_PER_CLASS
    echo ""
else
    echo "WARNING: ASL Alphabet not found: $ASL_DIR"
fi

# 2. Merge and balance. MediaPipe_Processed_Asl is not extracted: MediaPipe
#    finds a hand in none of its images.
echo "Merge and balance"
$PYTHON scripts/data_preparation/merge_static_letter_datasets.py

echo ""
echo "============================================================"
echo "  Done. Next step:"
echo "    python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison"
echo "============================================================"
