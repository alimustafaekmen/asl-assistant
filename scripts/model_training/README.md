# Model Training Scripts

| Script | Purpose |
|---|---|
| `train_static_letter_model.py` | Train/evaluate the 24-class 93D letter pipeline and export model records |
| `train_dynamic_jz_model.py` | Reserved experimental utility; no trained J/Z artifact is included or deployed |

The final 50-word web model is not trained here; its source workflow is
`notebooks/word_50_training.ipynb`.

Static-letter outputs belong under `models/letter/`. A newly trained artifact
must not replace the deployed ONNX until labels, feature contract, deterministic
fixture, hashes, tests, and browser behavior have been validated together.
