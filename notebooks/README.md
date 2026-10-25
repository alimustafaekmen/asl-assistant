# Notebooks

The training record of the word models. The comments and figure names inside
are mostly in Turkish.

| Path | Purpose |
|---|---|
| `word_50_training.ipynb` | The 50-word workflow behind the web model, without outputs |
| `word_50_training_results.ipynb` | The same workflow with its Kaggle outputs: metrics, logs, tables, figures |
| `word_25_desktop_training.ipynb` | The 25-word BiGRU behind the desktop prototype's model |
| [`word_50_results/`](word_50_results/README.md) | Metrics, figures, reports and the JSON files the web app reads |

The 50-word workflow ran on Kaggle on one T4 GPU, with the
[Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
data and a split by signer. Its feature functions define the 45 × 168 word
input; `asl-features/src/asl_features/word.py` is a copy, and a test fails if
the two disagree. The exported models are in `models/word/web-50/`.

A new training run changes the model, so the model files, their deployed
copies, the metrics and the fixtures have to be updated together.
