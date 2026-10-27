# Models

The source copy of every published model. The browser loads copies of these
files from `asl-web/models/` and `asl-web/data/`, and the runtime file check in
`make check` compares each copy with its source by SHA-256.

```text
models/
├── letter/          24-letter LightGBM model
└── word/
    ├── web-50/      50-word SignTransformer, used by the web app
    └── desktop-25/  25-word BiGRU, used by the desktop prototype
```

The `.pkl` and `.pt` files are Python pickles, which can run code when they
are loaded, so load them only from a copy you trust. The letter pickle needs the
scikit-learn version pinned in `requirements.txt`.

## Letter model

A LightGBM classifier (300 trees, seed 42) that reads the 93 letter features and
predicts one of 24 static letters. J and Z need motion, so they are not
included.

| File | Role |
|---|---|
| `letter/letter_model_meta.json` | Training settings and the recorded results |
| `letter/letter_label_map.json` | Letter to output index, `0..23`; deployed as `asl-web/data/letter_labels.json` |
| `letter/letter_model.pkl` | The Python model, used by the desktop prototype and the parity check |

The ONNX export is only in `asl-web/models/letter_model.onnx`. It takes
`float32 (1, 93)` and returns a label and 24 probabilities. I exported it
without ZipMap, because ONNX Runtime Web cannot reliably read ZipMap's
list-of-maps output. The browser downloads the gzipped copy,
`letter_model.onnx.gz`, first.

The recorded score is 99.35% on 8,245 held-out rows, but those rows are a
random split of the same photo runs as the training rows. On the separate
`ASL_SemCom` test set the model scores 68.9%. The
[technical report](../docs/technical-report.md#letter-model) has the details.

## Word models

| | `word/web-50/` | `word/desktop-25/` |
|---|---|---|
| Used by | the web app | the desktop prototype |
| Vocabulary | 50 words | 25 words |
| Model | SignTransformer encoder, 446,195 parameters | BiGRU with attention pooling |
| Input | 45 frames × 168 features and a padding mask | 30 frames × 321 landmark values |
| Recorded result | 71.92% accuracy, 0.714 macro-F1 on 4 signers never seen in training | about 86.7% on its own random split |
| Source | `notebooks/word_50_training.ipynb` | `notebooks/word_25_desktop_training.ipynb` |

The two models take different inputs and cannot replace each other. Their
results cannot be compared either, because the vocabularies, features and
splits all differ.

The `web-50/` files:

| File | Deployed as |
|---|---|
| `word_model.onnx` | `asl-web/models/word_model.onnx` |
| `word_labels.json` | `asl-web/data/word_labels.json` |
| `temperature.json` | `asl-web/data/temperature.json`; the app divides the logits by `T` before the softmax |
| `word_model.pt` | not deployed: the PyTorch checkpoint of the same run |

The model returns 50 logits. The mask is `true` for a real frame and `false` for
padding. The ONNX graph inverts it itself, so the app passes it as it is.
`notebooks/word_50_results/manifest.json` lists these files under the Kaggle
export's names (`final_model.pt`, `word_to_idx.json`) with their hashes.

`desktop-25/` holds `word_model.pt`, `word_model_meta.json` and
`word_labels.json`, which only `asl-desktop` loads.
