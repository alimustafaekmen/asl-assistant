# Data preparation

Scripts that turn downloaded image and video datasets into the landmark tables
the models are trained on. They write only under `data/` (and two charts under
`docs/assets/`); they do not touch the browser models or `asl-web/`.

## Static letters

The letter model reads 63 normalized hand-landmark values per image (21
landmarks × x, y, z); the 93D feature vector is built from those during
training.

| Script | Purpose |
|---|---|
| `extract_static_letter_landmarks.py` | Run MediaPipe Hands over a folder of letter images, one subfolder per label, and write one CSV row for each image in which a hand is found: `label, f0 … f62` |
| `merge_static_letter_datasets.py` | Merge the CSVs under `data/processed/` (or the files given to `--inputs`), drop J and Z, remove duplicates and invalid rows, and save that as `combined_landmarks.csv`. Then undersample every class to the size of the smallest (or to `--max-per-class`; `--no-balance` skips this) and split into `train_landmarks.csv` (85%) and `test_landmarks.csv` (15%), with two class-distribution figures under `docs/assets/` |
| `run_static_letter_extraction.sh` | Run the two steps above for the ASL Alphabet dataset (3000 images per class at most), then print the training command |

```bash
./scripts/data_preparation/run_static_letter_extraction.sh
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison
```

The shell script expects the images at
`data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train` and skips the
extraction with a warning when they are missing. It does not use the second
folder it names in its configuration, `MediaPipe_Processed_Asl`: MediaPipe
detected no hand in it. To combine several sources, run the extraction script
once per dataset and then the merge script.

The published letter model was trained on three sources, and this script
reproduces only the standard ASL Alphabet path. See
[the data manifest](../../data/README.md) for each source, its role in the final
model, and what can and cannot be rebuilt.

## Words (experimental)

| Script | Purpose |
|---|---|
| `download_msasl_videos.py` | Download MS-ASL clips for the words that overlap the 50-word vocabulary; resumable, needs `yt-dlp` and the MS-ASL JSON files in `data/raw/MS-ASL/` |
| `extract_msasl_landmarks.py` | Run MediaPipe Holistic over those clips and write per-clip Parquet files in the layout the word notebook reads |

Neither published word model was trained on MS-ASL; both scripts record an
exploration. The 50-word model came from the Google Isolated Sign Language
Recognition data, through `notebooks/word_50_training.ipynb`.

## Before you run anything

Check each dataset's licence and the script's `--help`: the datasets are not
part of this repository, and some have terms that restrict redistribution.
Generated data stays under `data/`, which Git ignores.
