# Data preparation

These scripts turn downloaded datasets into landmark tables. They write under
`data/`, plus two class-distribution charts under `docs/assets/`.

## Letters

| Script | Purpose |
|---|---|
| `extract_static_letter_landmarks.py` | Runs MediaPipe Hands over a folder of letter images (one subfolder per letter) and writes `label, f0 … f62`: the 63 normalised landmark values of each image where a hand is found |
| `merge_static_letter_datasets.py` | Merges the CSVs, drops J and Z, duplicates and invalid rows, and writes an 85/15 split as `train_landmarks.csv` and `test_landmarks.csv` |
| `run_static_letter_extraction.sh` | Runs both steps for the ASL Alphabet images, then prints the training command |

```bash
./scripts/data_preparation/run_static_letter_extraction.sh
```

It expects the images in `data/raw/ASL Alphabet/asl_alphabet_train/asl_alphabet_train`.
By default the merge undersamples every class to the smallest; the published
model's tables were not balanced, so pass `--no-balance` to reproduce them. The
published model used three sources (see [training and data](../../docs/getting-started.md#training-and-data)); this
script covers the ASL Alphabet part.

## Words (experimental)

`download_msasl_videos.py` and `extract_msasl_landmarks.py` download MS-ASL
clips (with `yt-dlp`) and extract MediaPipe Holistic landmarks from them. No
published word model uses MS-ASL; the 50-word model is trained on the Google
Isolated Sign Language Recognition data in `notebooks/word_50_training.ipynb`.

Check each dataset's terms before you download or use it.
