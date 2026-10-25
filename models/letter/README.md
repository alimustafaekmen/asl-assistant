# Letter model

A LightGBM classifier (300 trees, seed 42) that reads the 93 letter features and
predicts one of 24 static letters. J and Z need motion and are not included.

| File | Role |
|---|---|
| `letter_model_meta.json` | Training settings and the recorded results |
| `letter_label_map.json` | Letter to output index, `0..23`; deployed as `asl-web/data/letter_labels.json` |
| `letter_model.pkl` | The Python model, used by the desktop prototype and the parity check |

The ONNX export lives only in `asl-web/models/letter_model.onnx`. It takes
`float32 (1, 93)` and returns a label and 24 probabilities. It is exported
without ZipMap, because ONNX Runtime Web cannot reliably read ZipMap's
list-of-maps output. The browser downloads a gzipped copy,
`letter_model.onnx.gz`, first.

The recorded result is 0.9935 on 8,245 held-out rows, but those rows are a
random split of the same photo runs as the training rows; on rows from an
unseen source the model scores 68.9%. The
[technical report](../../TECHNICAL_REPORT.md#letter-model) has the details.
The pickle needs the scikit-learn version pinned in `requirements.txt`.
