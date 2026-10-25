# 50-word results

Everything the final 50-word run wrote besides the model files. The final model
scores 71.92% accuracy and 0.714 macro-F1 on 3,918 recordings from 4 test
signers who appear in no other partition.

| File | Contents |
|---|---|
| `all_experiment_results.json` | The feature, sequence and architecture comparisons, the final run and the split |
| `classification_report.txt` | Precision, recall and F1 for each word |
| `per_word_stats.json`, `confusion_pairs.json`, `curriculum.json` | Per-word scores, the most confused pairs and a learning order; deployed to `asl-web/data/` |
| `test_sample.json` | A synthetic input that checks the ONNX model runs; not a benchmark |
| `manifest.json`, `README_EXPORT.txt` | The Kaggle export bundle under its original names (the text file is Turkish) |
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

`manifest.json` says `num_files: 21` but lists 20: the count includes the
manifest itself, which cannot hold its own hash. In the repository
`final_model.pt` is `models/word/web-50/word_model.pt` and `word_to_idx.json` is
`word_labels.json`.
