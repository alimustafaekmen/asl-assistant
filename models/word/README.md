# Word models

Two word-recognition models live here. They come from different stages of the
project, take different inputs, and cannot be swapped.

| | `web-50/` | `desktop-25/` |
|---|---|---|
| Used by | the web app (`asl-web/`) | the desktop prototype (`asl-desktop/`) |
| Vocabulary | 50 words | 25 words |
| Architecture | SignTransformer encoder, 446,195 parameters | BiGRU with attention pooling |
| Input | 45 frames × 168 features, plus a padding mask | 30 frames × 321 landmark values |
| Format | ONNX (and the PyTorch checkpoint) | PyTorch checkpoint |
| Recorded result | 71.92% accuracy, 0.714 macro-F1, 4 unseen test signers | about 86.7% accuracy on its own 25-word split |

The two results are not comparable: the vocabularies, features and evaluation
splits are different.

## `web-50/`

| File | Purpose |
|---|---|
| `word_model.onnx` | The model the browser runs |
| `word_model.pt` | PyTorch checkpoint from the same training run |
| `word_labels.json` | Word to output index, 50 entries |
| `temperature.json` | Calibration temperature `T`; the app divides the logits by it before the softmax |

Source: `notebooks/word_50_training.ipynb`, with the executed run in
`notebooks/word_50_training_results.ipynb`. Reports, figures, per-word statistics,
confusion pairs, the curriculum and the smoke sample are in
`notebooks/word_50_results/`.

The deployed copies:

```text
models/word/web-50/word_model.onnx  -> asl-web/models/word_model.onnx
models/word/web-50/word_labels.json -> asl-web/data/word_labels.json
models/word/web-50/temperature.json -> asl-web/data/temperature.json
```

The Kaggle export called the checkpoint `final_model.pt` and the label file
`word_to_idx.json`. They were renamed `word_model.pt` and `word_labels.json` when
they were added here. `notebooks/word_50_results/manifest.json` keeps the
original names and ties them to these files by hash.

The model returns logits. The word mask uses `true` for a real frame and `false`
for padding, and the graph inverts it internally, so callers must not invert it
first. The full input layout is in
[Models and data](../../docs/models-and-data.md#web-50-class-contract).

## `desktop-25/`

| File | Purpose |
|---|---|
| `word_model.pt` | 25-class BiGRU with attention pooling |
| `word_model_meta.json` | Architecture, features and recorded accuracy |
| `word_labels.json` | Word to output index, 25 entries |

Source: `notebooks/word_25_desktop_training.ipynb`. Only `asl-desktop` loads this
model. Earlier intermediate notebooks and exports from the same line of
experiments are not published.

Run `make notebook-check` to confirm that the notebooks and model files are in
place, and `make health` for the full set of checks on the deployed copies.
