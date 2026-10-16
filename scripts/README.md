# scripts

Command-line tools that sit around the models: preparing data, training,
exporting fixtures, and checking that what the browser loads is what the
sources say. None of them runs inside the web app, and `asl-web/` never imports
them.

```text
scripts/
├── data_preparation/   landmark extraction from images and videos, CSV merge and split
├── model_training/     static-letter training and an experimental J/Z trainer
├── evaluation/         Kaggle subset download, Model Test fixture and feature golden export
├── validation/         runtime asset, provenance, ONNX and project asset checks
└── tooling/            Python environment diagnosis behind `make doctor` and `make setup`
```

Run everything from the repository root. The `validation/` and `tooling/`
scripts are what `make validate`, `make health` and `make doctor` call, so most
people never need to run them directly. `data_preparation/`, `model_training/`
and `evaluation/` need the full dependency set from `requirements.txt` and, for
anything that reads a dataset, files under `data/` that you download yourself.

## Common commands

```bash
make setup      # install the pinned dependencies and the two local packages
make doctor     # report which environment is active and what is missing

python scripts/validation/check_runtime_assets.py
python scripts/validation/verify_project_assets.py

python scripts/model_training/train_static_letter_model.py \
  --from-csv --full-comparison

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

Run `make doctor` before `make setup`. It only reports. `make setup` installs,
and stops first when the active Python is the wrong one (Apple's
CommandLineTools Python, a conda base environment, or an interpreter outside the
activated environment).

## Exit codes

The validation scripts and the parity checks in `tests/validation/` share one
contract, so that a script or a Make target can tell a failed check from one
that could not run:

| Code | Meaning |
|---:|---|
| 0 | every check ran and held |
| 1 | a check ran and failed |
| 2 | bad usage, or a required tool is missing (Node.js, ONNX Runtime), so nothing was verified |

A missing tool is never reported as success. Each workflow README lists the
exceptions to this table.

## Where things are read and written

Data preparation and static-letter training import `asl_ml.config` for the
shared ML contracts (class lists, feature sizes). The experimental J/Z trainer
imports `asl_desktop.config` because it targets the desktop sequence runtime.
Input and output paths are defined inside each script.

Raw and generated datasets live under `data/`, which Git ignores apart from its
README. Replacing a model or a runtime JSON file is a coordinated export change
across several files; see the [models and data contract](../docs/models-and-data.md).

Each workflow has a README with its scope and output boundary:

- [Data preparation](data_preparation/README.md)
- [Model training](model_training/README.md)
- [Evaluation and fixtures](evaluation/README.md)
- [Validation](validation/README.md)
- [Tooling](tooling/README.md)
