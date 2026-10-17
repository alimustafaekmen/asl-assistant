# Static letter model

<sub>Location: [`asl-assistant`](../../README.md) / [`models`](../README.md) / `letter`</sub>

<sub>Related: [`docs/models-and-data.md`](../../docs/models-and-data.md) · [`scripts/model_training/`](../../scripts/model_training/README.md)</sub>

A LightGBM classifier that reads a 93-value hand feature vector and predicts one
of 24 static letters. J and Z need motion and are not in the model, the label map
or any deployed file.

| | |
|---|---|
| Classifier | LightGBM, 300 estimators, seed 42 |
| Input | `float32 (1, 93)` |
| Output | probabilities over 24 letters, indices `0..23` in `letter_label_map.json` |
| Held-out accuracy | 0.9935 on 8,245 rows (set aside before augmentation) |
| Training script | `scripts/model_training/train_static_letter_model.py` (metadata dated 2026-03-13) |

The held-out rows are a random split, not unseen signers, so 0.9935 says little
about how the model does with a new person and camera. The caveats are spelled
out in [Models and data](../../docs/models-and-data.md#evaluation-caveat).

## Files

| File | Role |
|---|---|
| `letter_model_meta.json` | Training settings and the recorded results |
| `letter_label_map.json` | Letter to output index |
| `letter_model.pkl` | Python model used by the desktop prototype and the ONNX parity check |
| `onnx_exports/letter_model_static_24_web_no_zipmap.onnx` | ONNX source of the browser model |

The browser loads `asl-web/models/letter_model.onnx` (a byte-for-byte copy of the
ONNX file here, plus a gzip version it downloads first) and
`asl-web/data/letter_labels.json`. The pickle is tied to the scikit-learn
version it was written with, and the browser never loads it. Like any pickle it
can run code when loaded, so open it only from a copy you trust. `make validate`
checks the copies against their sources and the ONNX inputs and outputs.

The ONNX file must have ZipMap disabled so it returns a plain probability tensor.
ONNX Runtime Web cannot reliably read the sequence-of-maps output that a ZipMap
export produces, so an export with ZipMap must not be deployed.

## Where the details are

How the data was collected and split, how the 93 features are built and in what
order, the augmentation, the model comparison and the browser parity checks are
in [Models and data](../../docs/models-and-data.md#training-data-and-environments)
and its [letter training flow](../../docs/models-and-data.md#letter-training-flow).
