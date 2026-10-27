# Scripts

Command-line tools for the data, the models and the checks. The web app does
not use any of them. Run them from the repository root, in the environment from
[getting started](../docs/getting-started.md). The datasets are not in the
repository: scripts that read one expect it under `data/raw/` and write tables
to `data/processed/`, and Git ignores both folders.

The validators, the parity checks in `tests/validation/` and the browser checks
exit with 0 when every check passed, 1 when one failed and 2 when they could not
run, for example with bad arguments or without Node or ONNX Runtime.

## Data preparation

`data_preparation/` turns downloaded datasets into landmark tables. It writes
under `data/`, plus two class-distribution charts under `docs/assets/`.

| Script | What it does |
|---|---|
| `extract_static_letter_landmarks.py` | Runs MediaPipe Hands over a folder of letter images (one subfolder per letter) and writes `label, f0 … f62`, the 63 normalised landmark values of each image where it finds a hand |
| `merge_static_letter_datasets.py` | Merges the CSVs, drops J and Z, duplicates and invalid rows, and writes an 85/15 split as `train_landmarks.csv` and `test_landmarks.csv` |
| `run_static_letter_extraction.sh` | Runs both steps for the ASL Alphabet images, then prints the training command |
| `download_msasl_videos.py`, `extract_msasl_landmarks.py` | Experimental: download MS-ASL clips with `yt-dlp` and extract MediaPipe Holistic landmarks. No published model uses MS-ASL |

```bash
./scripts/data_preparation/run_static_letter_extraction.sh
```

It expects the images in `data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train`.
By default the merge undersamples every class to the smallest one. I trained
the published model on unbalanced tables, so pass `--no-balance` to reproduce
them. The published model used three sources (see the
[technical report](../docs/technical-report.md#2-data)), and this script covers
the ASL Alphabet part. Check each dataset's terms before you download or use it.

## Model training

| Script | What it does |
|---|---|
| `train_static_letter_model.py` | Trains and evaluates the 24-letter classifier on the 93-D features |
| `data_split.py` | The train and evaluation split the trainer imports |
| `train_dynamic_jz_model.py` | Experimental: records J and Z sequences and trains a desktop LSTM. No J/Z model is published |

```bash
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison
```

`--from-csv` reads `data/processed/train_landmarks.csv`. The trainer augments
the training rows (noise, rotation, scale), builds the 93 features with
`asl_features.letter`, and fits one model or compares Random Forest, XGBoost,
LightGBM, an MLP and a small 1D CNN. `--no-features` trains on the 63
normalised landmark values and `--no-augment` turns augmentation off; `--help`
lists the other options.

It writes `letter_model.pkl`, `letter_label_map.json` and
`letter_model_meta.json` straight into `models/letter/`, so a trial run
overwrites the published files (`git restore models/letter` undoes it). It does
not export ONNX; [changing a model](#changing-a-model) lists what to update. The
50-word web model is trained in `notebooks/word_50_training.ipynb`.

## Fixtures and demo poses

`evaluation/` makes small inputs for the tests, the Model Test screen and the
camera-free demo.

| Script | What it does |
|---|---|
| `export_feature_goldens.py` | Writes `tests/web/fixtures/feature-golden.json`: synthetic hands and word sequences with the Python 93-D and 168-D features, which the JavaScript tests must reproduce |
| `download_kaggle_sample_subset.py` | Downloads a few recordings per word from the Google Isolated Sign Language Recognition competition, from the test signers of a seeded 70/15/15 signer split (not the notebook's test signers; see the script) |
| `export_model_test_word_samples.py` | Turns those recordings into Model Test samples |
| `export_demo_letters.py` | Writes `asl-web/data/demo-letters.json`, the demo's hand poses |

The feature goldens are built from fixed geometry, with no random numbers.
Regenerate them after a planned change to the features and review the diff:

```bash
python scripts/evaluation/export_feature_goldens.py
```

The 24 letter samples in `asl-web/data/model-test-samples/letters/` are real
held-out rows. The word sample, `words/word-give-smoke.json`, is synthetic: 30
frames of seeded random values, padded to 45 with a mask. It only checks that
the word model runs in the browser, and it should read `give` at about 7.6%. The
competition rules (section 7.B) forbid redistributing the word data, so real
word samples stay on your machine. To make some, install the Kaggle command-line
tool (`pip install kaggle`), add your API credentials, accept the rules on
Kaggle and run:

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset --samples-per-word 1
python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset --samples-per-word 1
```

The samples go to `asl-web/data/model-test-samples/local/`, which Git ignores,
and Model Test lists them when the folder exists. Move the folder out before
you upload the site; the deploy file check in
[hosting a copy](../docs/getting-started.md#hosting-a-copy) fails while it is
there.

The demo poses come from the browser's hand model:

```bash
python scripts/evaluation/export_demo_letters.py --task hand_landmarker.task
```

`--task` is the file at
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
The script runs it in video mode on the American Sign Language Dataset in
`data/raw/` and keeps, for each letter, the pose the deployed letter model reads
with the highest confidence. These photos are in the training split, so the
model reads them at 1.0. Run the script again after a letter model change;
`tests/scripts/test_demo_letters.py` fails when the model stops reading a pose.

## Validation

`validation/` checks what the browser loads: the files exist, the JSON has the
right shape, each deployed model is byte-identical to its source, and the ONNX
models have the inputs and outputs the JavaScript expects.

| Script | What it does |
|---|---|
| `check_runtime_assets.py` | Files and JSON schemas, Model Test samples, source-to-deploy SHA-256 hashes, the gzipped letter model, the notebook export manifest, ONNX inputs and outputs. `--deploy` also lists every file in `asl-web/` and fails on anything the site should not ship |
| `verify_project_assets.py` | A wider check of where each model came from and of the source models, with a report on local datasets |
| `contracts.py` | The file paths, source-to-deploy pairs and upload allowlist that both checks use |
| `generate_word_onnx_test_sample.py` | Regenerates the synthetic word input `asl-web/data/test_sample.json` from the deployed model |

```bash
python scripts/validation/check_runtime_assets.py            # part of make check
python scripts/validation/check_runtime_assets.py --deploy   # before an upload
python scripts/validation/verify_project_assets.py --no-datasets
```

Both take `--root` to check another checkout. Without ONNX Runtime,
`check_runtime_assets.py` exits with 2; `--no-onnx` skips that step.

### Changing a model

Each deployed file is a copy of a source: `models/word/web-50/` and
`notebooks/word_50_results/` for the word model and its data, `models/letter/`
for the letter model. Replace the source and the copy together. After a new
letter model, export it to ONNX without ZipMap and regenerate the compressed
copy the browser downloads:

```bash
gzip -9 -n -c asl-web/models/letter_model.onnx > asl-web/models/letter_model.onnx.gz
```

Then regenerate the samples and the demo poses (see above), update
`asl-web/data/model-card.json` if a figure changed, and run `make check`.

## Tooling

| Script | What it does |
|---|---|
| `environment.py` | Finds the active Python environment and decides what setup may do; the other two import it |
| `doctor.py` | Reports the active environment and whether the needed packages import; installs nothing |
| `setup_guard.py` | Stops `make setup` before it installs into the wrong environment |

```bash
python scripts/tooling/doctor.py
```

`make setup` runs `setup_guard.py` first; [getting started](../docs/getting-started.md#set-up-for-development)
lists the environments it refuses.
