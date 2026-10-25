# Data

The local workspace for datasets and generated tables. Only this README is
tracked: `raw/`, `processed/` and `reference/` are ignored, because their
contents are large, generated or under other licences. The web app does not
read this folder, and the models hold learned parameters only.

```text
data/
├── raw/         downloaded images, videos and parquet subsets
├── processed/   generated landmark CSVs
└── reference/   local reference mappings
```

## What trained the published models

| Model | Source | Rows or recordings used | Terms |
|---|---|---:|---|
| Letters | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) | 52,419 | GPL-2.0, as labelled |
| Letters | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset) | 962 | CC0 |
| Letters | `ASL_SemCom` images associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | 1,580 | Not recorded |
| Words | [Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) | 19,299 for the 50-word model | CC BY 4.0, subject to the competition rules |

The letter rows are landmarks extracted successfully, merged into 54,961 rows
and split into 46,716 for training and 8,245 held out. The raw-data layout and
the `ASL_SemCom` terms are not recorded well enough to publish the images or to
promise a one-command rebuild. The competition rules forbid redistributing the
word data (section 7.B), so samples exported from it stay in the ignored
`asl-web/data/model-test-samples/local/` folder.

Explored but not used: MediaPipe Processed ASL (no usable hands found), MS-ASL
(download scripts only), and a small competition subset in
`raw/asl-signs-sample-subset/`, used only for Model Test samples.

The scripts that read this folder are in
[data preparation](../scripts/data_preparation/README.md) and
[evaluation](../scripts/evaluation/README.md); attribution is in the
[README](../README.md#data-and-attribution).

## What may be committed

Never raw images, videos, participant-level parquet files, generated CSVs,
Kaggle credentials or archives. Small reviewed JSON under `asl-web/data/`,
deterministic fixtures with no camera frames, and the model files `.gitignore`
allows are fine. Check each dataset's terms before you download, use or share it.
