# Evaluation and Fixture Export

These scripts create small, reviewable browser fixtures from local Google
Isolated Sign Language Recognition data. They do not train or replace a model.

| Script | Purpose |
|---|---|
| `download_kaggle_sample_subset.py` | Download `train.csv` and selected parquet sequences for the configured 50-word domain |
| `export_model_test_word_samples.py` | Reproduce the 168D feature pipeline and write `asl-sample-v1` fixtures plus the browser manifest |

The download step requires Kaggle credentials and prior acceptance of the
competition rules. Raw CSV/parquet files stay under ignored `data/raw/`.

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

Generated feature fixtures are regression and demonstration samples. They are
not the complete signer-independent test partition and must not be reported as
the notebook's official accuracy or macro-F1 evaluation.
