# Data

<sub>Location: [`asl-assistant`](../README.md) / `data`</sub>

<sub>Related: [`docs/models-and-data.md`](../docs/models-and-data.md) · [`scripts/data_preparation/`](../scripts/data_preparation/README.md) · [`scripts/model_training/`](../scripts/model_training/README.md) · [`notebooks/`](../notebooks/README.md)</sub>

This is where datasets are downloaded and where generated landmark tables are
written. Nothing in it ships with the repository: the web app does not read this
directory (its runtime data is in `asl-web/data/`), and the trained models
contain learned parameters only, not the data.

Only this README is tracked. `raw/`, `processed/` and `reference/` are ignored
because their contents are large, generated, under separate licences, or specific
to one machine. They are created when a script first needs them.

```text
data/
├── raw/         downloaded images, metadata, videos and parquet subsets
├── processed/   generated landmark CSVs and intermediate feature tables
└── reference/   local reference mappings used during development
```

## What trained the published models

### Letter model

The 24-class letter model was trained locally on MediaPipe hand landmarks
extracted from three image collections:

| Source | Role | Landmark rows kept | Terms |
|---|---|---:|---|
| [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) | Main alphabet image source | 52,419 | GPL-2.0, as labelled by Kaggle |
| [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset) | Extra capture variation | 962 | CC0 |
| Local `ASL_SemCom` collection, associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | Extra alphabet images | 1,580 | Not recorded |

The merged table has 54,961 rows covering the 24 static letters (A to Y without
J and Z). It was split into 46,716 training rows and 8,245 held-out rows before
training augmentation. The row counts are successfully extracted landmarks, not
the providers' image counts.

The exact local raw-data layout and the `ASL_SemCom` terms are not recorded well
enough to publish the images or to promise that one command rebuilds the final
table. The model, its metadata, the label map, the training script and the
feature definition are published, so the recorded artifact can still be
inspected and checked.

### Word models

The 25-word desktop model and the 50-word web model both use landmark data from
the [Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition (CC BY 4.0, subject to the competition rules). The 50-word run
selected a subset of the signs and used a signer-independent train, validation
and test split inside Kaggle.

Neither deployed app needs the competition files. You need them only to retrain
or to export new Model Test fixtures. Section 7.B of the competition rules
forbids redistributing the data, so fixtures exported from it are written to the
ignored `asl-web/data/model-test-samples/local/` folder and are never committed.

The full licence and attribution text, including the changes made to each
dataset, is in the root README's
[Data and attribution](../README.md#data-and-attribution) section. Dataset roles,
splits and caveats are in [Models and data](../docs/models-and-data.md).

## Explored, but not used for the published models

| Source | What happened |
|---|---|
| [MediaPipe Processed ASL](https://www.kaggle.com/datasets/vignonantoine/mediapipe-processed-asl-dataset) | Tried for the letter pipeline; the recorded run found no usable hands, so it is not in the final merge |
| [MS-ASL](https://www.microsoft.com/en-us/research/project/ms-asl/) | Download and extraction scripts exist as an experimental word-data path; neither published word model used it |
| `raw/asl-signs-sample-subset/` | A small slice of the competition data, used only to export Model Test fixtures |

Do not describe these as training data for the published models.

## Commands

```bash
# Letter images -> landmark CSV (one folder per letter)
python scripts/data_preparation/extract_static_letter_landmarks.py \
  --input /path/to/letter-folders \
  --output data/processed/source_landmarks.csv

# Merge the CSV files and write train and test splits
python scripts/data_preparation/merge_static_letter_datasets.py \
  --inputs data/processed/source_a_landmarks.csv \
           data/processed/source_b_landmarks.csv

# A small slice of the competition data, for Model Test fixtures
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

By default the merge step undersamples every class to the size of the smallest
one. The final tables behind the published letter model are not balanced, so
add `--no-balance` to keep all rows. The 50-word model is trained in
`notebooks/word_50_training.ipynb`; see [notebooks/README.md](../notebooks/README.md).
The Kaggle download needs your own credentials and an accepted copy of the
competition rules.

## What may be committed

Never commit raw images, videos, participant-level parquet files, generated CSVs,
Kaggle credentials, download logs or archives. What belongs in the repository:

- source links and dataset roles, in documentation;
- small, reviewed runtime JSON under `asl-web/data/`;
- deterministic feature fixtures that contain no camera frames; and
- the model and provenance files that `.gitignore` explicitly allows.

Check a dataset's current terms before you download, use or redistribute it. A
dataset's licence does not automatically apply to this repository's code, and
this repository's licence does not apply to the data.
