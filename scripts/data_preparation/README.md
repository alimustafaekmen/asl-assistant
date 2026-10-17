# Data preparation

<sub>Location: [`asl-assistant`](../../README.md) / [`scripts`](../README.md) / `data_preparation`</sub>

<sub>Related: [`data/`](../../data/README.md) · [`scripts/model_training/`](../model_training/README.md) · [`docs/models-and-data.md`](../../docs/models-and-data.md)</sub>

Scripts that turn downloaded image and video datasets into the landmark tables
the models are trained on. They write only under `data/` (and two charts under
`docs/assets/`); they do not touch the browser models or `asl-web/`.

## Static letters

The letter model reads 63 normalized hand-landmark values per image (21
landmarks × x, y, z), normalized with `asl_features.landmarks.normalize_landmarks`.
Training builds the 93D feature vector from them.

| Script | Purpose |
|---|---|
| `extract_static_letter_landmarks.py` | Run MediaPipe Hands over a folder of letter images, one subfolder per label, and write one CSV row for each image in which a hand is found: `label, f0 … f62` |
| `merge_static_letter_datasets.py` | Merge the CSVs under `data/processed/` (or the files given to `--inputs`), drop J and Z, remove duplicates and invalid rows, and save the result as `combined_landmarks.csv`. Then undersample every class to the size of the smallest (or to `--max-per-class`; `--no-balance` skips this) and split into `train_landmarks.csv` (85%) and `test_landmarks.csv` (15%), with two class-distribution figures under `docs/assets/` |
| `run_static_letter_extraction.sh` | Run the two steps above for the ASL Alphabet dataset (at most 3000 images per class), then print the training command |

```bash
./scripts/data_preparation/run_static_letter_extraction.sh
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison
```

The shell script expects the images at
`data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train` and skips the
extraction with a warning when they are missing. It also names
`data/raw/MediaPipe_Processed_Asl` but does not use it, because MediaPipe finds
no hand in those images. To combine several sources, run the extraction script
once per dataset and then the merge script.

The published letter model was trained on three sources; this script
reproduces only the ASL Alphabet part. [The data manifest](../../data/README.md)
lists each source, its role in the final model, and what can be rebuilt.

## Words (experimental)

| Script | Purpose |
|---|---|
| `download_msasl_videos.py` | Download MS-ASL clips for the words that overlap the 50-word vocabulary; resumable, needs `yt-dlp` and the MS-ASL JSON files in `data/raw/MS-ASL/` |
| `extract_msasl_landmarks.py` | Run MediaPipe Holistic over those clips and write per-clip Parquet files in the layout the word notebook reads |

Neither published word model uses MS-ASL; these two scripts are exploratory.
The 50-word model is trained on the Google Isolated Sign Language Recognition
data, in `notebooks/word_50_training.ipynb`.

## Before you run anything

Check each dataset's licence and the script's `--help`. The datasets are not
part of this repository, and some have terms that restrict redistribution.
Generated data stays under `data/`, where Git ignores it.
