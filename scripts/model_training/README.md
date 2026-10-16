# Model training

| Script | Purpose |
|---|---|
| `train_static_letter_model.py` | Train and evaluate the 24-class letter classifier on the 93D feature vector |
| `data_split.py` | The train/evaluation split the trainer uses; imported, not run |
| `train_dynamic_jz_model.py` | Experimental: record J and Z sequences and train a desktop LSTM. No trained J/Z model ships and nothing deploys one |

The 50-word web model is not trained here. Its source is the notebook
`notebooks/word_50_training.ipynb`; see [`models/word/`](../../models/word/README.md).

## Letter model

The trainer takes normalized hand landmarks, optionally augments them, builds
the 93D features from `asl_ml`, splits the data, and fits one model or compares
five families: Random Forest, XGBoost, LightGBM (an SVM stands in when LightGBM
is missing), an MLP and a small 1D CNN. The published model is the LightGBM
one.

```bash
# From the landmark CSVs written by scripts/data_preparation
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison

# Quick trial from an image folder, 500 images per letter, one model
python scripts/model_training/train_static_letter_model.py --max-images 500 --model xgboost
```

`--from-csv` reads `data/processed/train_landmarks.csv`, or the file given to
`--train-csv`. Evaluation uses a stratified 15% split of it unless `--test-csv`
supplies an external test set, which is then kept out of training. Without
`--from-csv` the trainer extracts landmarks from an image folder (`--dataset`,
or a location it searches for). `--no-features` trains on the raw 63 values and
`--no-augment` turns augmentation off. Run the script with `--help` for the
full list.

### What it writes

The script saves straight into `models/letter/`:
`letter_model.pkl`, `letter_label_map.json` and `letter_model_meta.json`.
These are the tracked, published files, so a training run overwrites them;
`git restore models/letter` undoes a trial run. A full comparison also writes
`letter_model_comparison.csv` there and several figures under `docs/assets/`.

The script does not export ONNX; the pickle-to-ONNX conversion is not part of
this repository, as [Models and data](../../docs/models-and-data.md#browser-parity-and-export-boundary)
explains. A newly trained model therefore changes nothing in the browser. It
should replace the deployed ONNX only after the labels, feature contract,
fixtures, hashes and tests have been checked together: follow the
[safe update procedure](../../docs/models-and-data.md#safe-update-procedure).

## J and Z

J and Z involve motion, so the static classifier excludes them. The experimental
trainer takes `collect`, `train` or `all`, records camera sequences under
`data/raw/dynamic/` and writes a desktop checkpoint to
`models/letter/dynamic_jz/`. It exists for people who want to experiment with
their own recordings.
