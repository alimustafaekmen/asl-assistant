# Notebooks

The training record of the word models. The comments and figure names inside
are mostly in Turkish.

| Path | Purpose |
|---|---|
| `word_50_training.ipynb` | The 50-word workflow behind the web model, without outputs |
| `word_50_training_results.ipynb` | The same workflow with its Kaggle outputs: metrics, logs, tables, figures |
| `word_25_desktop_training.ipynb` | The 25-word BiGRU behind the desktop prototype's model |
| `word_50_results/` | Everything the final 50-word run wrote besides the model files |

The 50-word workflow ran on Kaggle on one T4 GPU, with the
[Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
data and a split by signer. The final model scores 71.92% accuracy and 0.714
macro-F1 on 3,918 recordings from 4 test signers who appear in no other part of
the split. Its feature functions define the 45 × 168 word input;
`asl-features/src/asl_features/word.py` is a copy, and a test fails if the two
disagree. The exported models are in `models/word/web-50/`.

A new training run changes the model, so the model files, their deployed
copies, the metrics and the samples have to be updated together.

## 50-word results

| File in `word_50_results/` | Contents |
|---|---|
| `all_experiment_results.json` | The feature, sequence and architecture comparisons, the final run and the split |
| `classification_report.txt` | Precision, recall and F1 for each word |
| `per_word_stats.json`, `confusion_pairs.json`, `curriculum.json` | Per-word scores, the most confused pairs and a learning order; deployed to `asl-web/data/` |
| `test_sample.json` | A synthetic input that checks the ONNX model runs |
| `manifest.json`, `README_EXPORT.txt` | The Kaggle export bundle under its original names (the text file is in Turkish). Here `final_model.pt` is `models/word/web-50/word_model.pt` and `word_to_idx.json` is `word_labels.json` |
| `figures/` | The plots below |

| Figure | Shows |
|---|---|
| `01_kelime_dagilimi.png` | Recordings per word |
| `02_sekans_uzunluk.png` | Recording lengths in frames |
| `03_feature_ablasyonu.png` | The six feature sets |
| `03_sekans_karsilastirma.png` | Fixed 30 frames, 45 frames with a mask, highest-motion frames |
| `04_model_karsilastirma.png` | The architectures: F1, size, training curves, speed |
| `05_full_training_egrileri.png` | Loss and validation metrics of the final run |
| `06_kelime_bazli_f1.png` | F1 per word |
| `07_confusion_matrix.png` | Which words are mistaken for which |
| `08_tum_deneyler_ozet.png` | All experiments on one chart |
| `09_confusion_top_pairs.png` | The most confused pairs |
