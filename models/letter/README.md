# Static Letter Model

The static-letter pipeline is trained by
`scripts/model_training/train_static_letter_model.py` and recognizes 24 static
classes from a 93D feature vector. J and Z are not included in the trained
model, label map, or deployed artifacts.

The final model was trained locally from a merged landmark table derived from
ASL Alphabet, American Sign Language Dataset, and the local `ASL_SemCom`
subset. See [Models and data](../../docs/models-and-data.md#training-data-and-environments)
for source links, retained sample counts, and exclusions.

The normalization, augmentation, 93D feature layout, model comparison,
evaluation caveats, and browser parity checks are documented in the
[letter training flow](../../docs/models-and-data.md#letter-training-flow).

| File | Role |
|---|---|
| `letter_model_meta.json` | Training parameters and reported evaluation results |
| `letter_label_map.json` | Model output label order |
| `letter_model.pkl` | Published Python source artifact used by the desktop prototype and ONNX parity checks |
| `onnx_exports/letter_model_static_24_web_no_zipmap.onnx` | Active browser-source ONNX |
| `onnx_exports/letter_model_static_24_web_duplicate.onnx` | Historical ZipMap export; ignored and not deployed |

The pickle is version-sensitive and is not loaded by the browser. The deployed
copies are `asl-web/models/letter_model.onnx` and
`asl-web/data/letter_labels.json`. Use `make validate` to confirm their
provenance and ONNX I/O contract.
