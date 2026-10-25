# Model training

| Script | Purpose |
|---|---|
| `train_static_letter_model.py` | Trains and evaluates the 24-letter classifier on the 93-D features |
| `data_split.py` | The train and evaluation split the trainer imports |
| `train_dynamic_jz_model.py` | Experimental: records J and Z sequences and trains a desktop LSTM. No J/Z model ships |

The 50-word web model is trained in `notebooks/word_50_training.ipynb`, not here.

## Letter model

```bash
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison
```

`--from-csv` reads `data/processed/train_landmarks.csv` from
[data preparation](../data_preparation/README.md). The trainer augments the
training rows (noise, rotation, scale), builds the 93 features with
`asl_features.letter`, and fits one model or compares Random Forest, XGBoost,
LightGBM, an MLP and a small 1D CNN. `--no-features` trains on the raw 63
values and `--no-augment` turns augmentation off; `--help` lists the rest.

It writes `letter_model.pkl`, `letter_label_map.json` and
`letter_model_meta.json` straight into `models/letter/`, so a trial run
overwrites the published files (`git restore models/letter` undoes it). It
does not export ONNX: the browser model changes only when a new no-ZipMap ONNX
export replaces it, as the [validation notes](../validation/README.md#changing-a-model)
describe.
