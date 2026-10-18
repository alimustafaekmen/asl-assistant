# scripts

<sub>Location: [`asl-assistant`](../README.md) / `scripts`</sub>

<sub>Related: [`data/`](../data/README.md) · [`docs/models-and-data.md`](../docs/models-and-data.md) · [`tests/`](../tests/README.md) · [`docs/getting-started.md`](../docs/getting-started.md)</sub>

Command-line tools around the models: preparing data, training, exporting
fixtures, and checking that what the browser loads matches its sources. None of
them runs inside the web app, and `asl-web/` never imports them.

```text
scripts/
├── data_preparation/   landmark extraction from images and videos, CSV merge and split
├── model_training/     static-letter training and an experimental J/Z trainer
├── evaluation/         Kaggle subset download, Model Test fixture, demo pose and feature golden export
├── validation/         runtime asset, provenance, ONNX and project asset checks
└── tooling/            Python environment diagnosis behind `make doctor` and `make setup`
```

Run everything from the repository root. `make validate`, `make health` and
`make doctor` call the `validation/` and `tooling/` scripts, so most people
never run those directly. `data_preparation/`, `model_training/` and
`evaluation/` need the full dependency set from `requirements.txt` and, for
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

`make doctor` only reports; `make setup` installs, and refuses to install into
the wrong environment. [Tooling](tooling/README.md) explains both.

## Exit codes

The validation scripts, the parity checks in `tests/validation/` and the
browser checks share one contract, so that a script or a Make target can tell a
failed check from one that could not run:

| Code | Meaning |
|---:|---|
| 0 | every check ran and held |
| 1 | a check ran and failed |
| 2 | bad usage, or a required tool is missing (Node.js, ONNX Runtime), so nothing was verified |

A missing tool is never reported as success. The exceptions:

- `doctor.py` exits 0 when a package is missing, because that is a setup step
  still to take, and 1 only when a package is installed but cannot be imported.
- `setup_guard.py` exits 2 when it refuses to install.
- The local dataset report of `verify_project_assets.py` never changes its
  exit code.

## Where things are read and written

Data preparation and static-letter training import `asl_features` for the
shared ML contracts (class lists, landmark normalization, the 93D letter
features). The experimental J/Z trainer also imports `asl_desktop.config`,
because it targets the desktop sequence runtime. Each script defines its own
input and output paths.

Raw and generated datasets live under `data/raw/` and `data/processed/`, which
Git ignores. Replacing a model or a runtime JSON file changes several files
together; see the [models and data contract](../docs/models-and-data.md).

Each folder has its own README:

- [Data preparation](data_preparation/README.md)
- [Model training](model_training/README.md)
- [Evaluation and fixtures](evaluation/README.md)
- [Validation](validation/README.md)
- [Tooling](tooling/README.md)
