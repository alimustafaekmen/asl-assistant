# Data Preparation Scripts

| Script | Purpose |
|---|---|
| `extract_static_letter_landmarks.py` | Convert letter images to 21-hand-landmark CSV rows |
| `merge_static_letter_datasets.py` | Merge, balance, and split static-letter CSV datasets |
| `run_static_letter_extraction.sh` | Orchestrate static extraction and merge steps |
| `download_msasl_videos.py` | Experimental MS-ASL downloader for words overlapping the 50-class domain |
| `extract_msasl_landmarks.py` | Experimental MediaPipe Holistic extraction for downloaded MS-ASL clips |

These tools write local raw/processed data and do not deploy browser models.
Review dataset licenses and command arguments before running them. Generated
data belongs under root `data/` and remains outside Git.

The MS-ASL scripts did not produce either published word model. The static
orchestration script reproduces the standard ASL Alphabet extraction path but
does not by itself reconstruct every local source used by the recorded final
letter model. See [the data manifest](../../data/README.md) for the verified
source roles and reproducibility boundary.
