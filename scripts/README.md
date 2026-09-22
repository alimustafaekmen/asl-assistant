# scripts

Canonical command-line tools are grouped by workflow:

```text
scripts/
├── data_preparation/   dataset download, landmark extraction, CSV/parquet preparation
├── model_training/     static-letter training and a reserved J/Z experiment tool
├── evaluation/         small Kaggle subset download and browser-fixture export
└── validation/         runtime, provenance, ONNX, and project asset checks
```

## Common commands

```bash
# Run from any configured Python environment.
python scripts/validation/check_runtime_assets.py
python scripts/validation/verify_project_assets.py

python scripts/model_training/train_static_letter_model.py \
  --from-csv --full-comparison

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

Install project packages before running training or data preparation:

```bash
make setup
```

Data preparation and static-letter training use `asl_ml.config` for shared ML
contracts. The reserved J/Z trainer uses `asl_desktop.config` because it
targets the desktop sequence runtime. Repository input/output paths are kept
local to each script. `asl-web/` never imports these Python modules.

Raw/generated datasets stay under root `data/` and are ignored. Replacing a
model or runtime JSON is a coordinated export change; see the
[models and data contract](../docs/models-and-data.md).

See each workflow README for its scope and output boundary:

- [Data preparation](data_preparation/README.md)
- [Model training](model_training/README.md)
- [Evaluation and fixtures](evaluation/README.md)
- [Validation](validation/README.md)
