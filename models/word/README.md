# Word Models

This directory contains two distinct word-recognition artifacts. They document
the project's transition from a 25-word desktop prototype to a 50-word browser
experiment; they must not be substituted for one another.

## `web-50/`

Current browser model source artifacts:

| File | Purpose |
|---|---|
| `word_model.onnx` | 50-class SignTransformer used by the web application |
| `word_model.pt` | PyTorch checkpoint produced by the final training run |
| `word_labels.json` | Ordered 50-class label mapping |
| `temperature.json` | Logit calibration temperature |

Training sources: `notebooks/word_50_training.ipynb` and its executed companion
`notebooks/word_50_training_results.ipynb`.

Deployment mappings:

```text
models/word/web-50/word_model.onnx  -> asl-web/models/word_model.onnx
models/word/web-50/word_labels.json -> asl-web/data/word_labels.json
models/word/web-50/temperature.json -> asl-web/data/temperature.json
```

The flat Kaggle export named the PyTorch and label files `final_model.pt` and
`word_to_idx.json`. Their repository names were normalized to `word_model.pt`
and `word_labels.json` when they were promoted into the curated model registry.
The export manifest deliberately retains the original names and maps them to
these files by hash.

Evaluation reports, figures, per-class statistics, curriculum data, confusion
pairs, and the deterministic smoke sample remain under
`notebooks/word_50_results/`.

## `desktop-25/`

Runtime artifacts for the historical desktop word mode:

| File | Purpose |
|---|---|
| `word_model.pt` | 25-class BiGRU + Attention checkpoint |
| `word_model_meta.json` | Architecture, feature, and recorded metric metadata |
| `word_labels.json` | Ordered 25-class label mapping |

Training source: `notebooks/word_25_desktop_training.ipynb`.

This model expects 30 frames with 321 values per frame. It is loaded only by
`asl-desktop`; the web application never uses it. The recorded test accuracy
in its metadata is approximately 86.7%, but this result belongs to the older
25-class experiment and is not comparable to the final 50-class web result.

Earlier intermediate notebooks and exports remain local under ignored
`legacy/`. Only the V4 notebook and the three files required by the desktop
runtime were promoted into the public repository.

Run `make notebook-check` to verify the expected notebook and artifact layout,
then `make health` to validate deployed copies and model contracts.
