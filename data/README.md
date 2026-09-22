# Local Data Workspace

`data/` is a machine-local workspace for dataset downloads, generated
landmarks, and evaluation subsets. The deployed browser application does not
read this directory. Its reviewed runtime data is stored separately in
`asl-web/data/`.

Only this README belongs in the public repository. `raw/`, `processed/`, and
`reference/` are ignored because their contents may be large, generated,
licensed separately, or machine-specific.

## Directory roles

```text
data/
├── raw/         downloaded images, metadata, videos, and parquet subsets
├── processed/   generated landmark CSVs and intermediate feature data
└── reference/   local reference mappings used during development
```

The directories are created when needed; a fresh clone does not require empty
placeholders.

## Data used by the published models

### Static-letter model

The 24-class letter model was trained locally from MediaPipe hand landmarks
extracted from three image collections:

| Source | Final-model role | Retained landmark rows |
|---|---|---:|
| [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) | Main alphabet image source | 52,419 |
| [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset) | Additional capture variation | 962 |
| Local `ASL_SemCom` collection associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | Additional alphabet images | 1,580 |

The merged table contains 54,961 rows and only the static classes A–Y excluding
J and Z. It was split into 46,716 training rows and 8,245 held-out rows before
training augmentation. These are successfully extracted landmark counts, not
the providers' original image counts.

The exact local raw-data layout and the `ASL_SemCom` redistribution terms are
not sufficiently preserved to publish or promise one-command reconstruction of
the final merged CSV. The model, metadata, label map, training script, and
feature contract are published so the recorded artifact remains inspectable.

### Word models

Both the 25-class desktop model and the final 50-class web model use the
[Google Isolated Sign Language Recognition competition](https://www.kaggle.com/competitions/asl-signs)
landmark data. The 50-class run selected a subset of signs and used a
signer-independent train/validation/test split in Kaggle.

Raw competition parquet files are not needed by either deployed application.
They are needed only to rerun training or export new Model Test fixtures.

## Explored but not used for the active models

| Local source | Status |
|---|---|
| [MediaPipe Processed ASL Dataset](https://www.kaggle.com/datasets/vignonantoine/mediapipe-processed-asl-dataset) | Evaluated for the letter pipeline, but the preserved extraction run produced no usable hand detections; excluded from the final merge |
| [MS-ASL](https://www.microsoft.com/en-us/research/project/ms-asl/) | Download and landmark-extraction utilities exist as an experimental word-data path; it did not produce either published word model |
| `asl-signs-sample-subset/` | Small local Kaggle subset used only to export deterministic browser fixtures, not to train the final model |

Do not present these exploratory sources as final-model training data.

## Reproduction entry points

```bash
# Letter image -> landmark CSV
python scripts/data_preparation/extract_static_letter_landmarks.py \
  --input /path/to/letter-folders \
  --output data/processed/source_landmarks.csv

# Merge prepared letter CSV files and create a split
python scripts/data_preparation/merge_static_letter_datasets.py \
  --inputs data/processed/source_a_landmarks.csv \
           data/processed/source_b_landmarks.csv

# Download a small Google competition subset for browser fixtures
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

The final 50-class training workflow is
`notebooks/word_50_training.ipynb`. Dataset roles, split details, feature
contracts, limitations, and licensing notes are maintained in
[Models and data](../docs/models-and-data.md).

## Publication boundary

Do not commit raw images, videos, participant-level parquet files, generated
CSVs, Kaggle credentials, download logs, or archives. Publish only:

- source links and dataset roles in documentation;
- small reviewed runtime JSON under `asl-web/data/`;
- deterministic feature fixtures that contain no raw camera frames; and
- curated model/provenance artifacts explicitly allowed by `.gitignore`.

Always review the current upstream terms before downloading, using, or
redistributing a dataset. An upstream dataset license does not automatically
license this repository's code or every derived artifact.
