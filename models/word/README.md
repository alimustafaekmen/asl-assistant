# Word models

| | `web-50/` | `desktop-25/` |
|---|---|---|
| Used by | the web app | the desktop prototype |
| Vocabulary | 50 words | 25 words |
| Model | SignTransformer encoder, 446,195 parameters | BiGRU with attention pooling |
| Input | 45 frames × 168 features and a padding mask | 30 frames × 321 landmark values |
| Recorded result | 71.92% accuracy, 0.714 macro-F1 on 4 unseen signers | about 86.7% on its own random split |
| Source | `notebooks/word_50_training.ipynb` | `notebooks/word_25_desktop_training.ipynb` |

The two results are not comparable: the vocabularies, features and splits all
differ.

## `web-50/`

| File | Deployed as |
|---|---|
| `word_model.onnx` | `asl-web/models/word_model.onnx` |
| `word_labels.json` | `asl-web/data/word_labels.json` |
| `temperature.json` | `asl-web/data/temperature.json`; the app divides the logits by `T` before the softmax |
| `word_model.pt` | not deployed: the PyTorch checkpoint of the same run |

The model returns 50 logits. The mask is `true` for a real frame and `false` for
padding, and the graph inverts it itself, so callers must not invert it.
`notebooks/word_50_results/manifest.json` lists these files under the Kaggle
export's names (`final_model.pt`, `word_to_idx.json`) with their hashes.

## `desktop-25/`

`word_model.pt`, `word_model_meta.json` and `word_labels.json`, loaded only by
`asl-desktop`.
