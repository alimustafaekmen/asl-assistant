# 50-word experiment results

<sub>Location: [`asl-assistant`](../../README.md) / [`notebooks`](../README.md) / `word_50_results`</sub>

<sub>Related: [`models/word/`](../../models/word/README.md) · [`docs/models-and-data.md`](../../docs/models-and-data.md)</sub>

Everything the final 50-word run wrote besides the model files: metrics, reports,
figures and the small JSON files the web app reads. The code that produced them
is `../word_50_training.ipynb`; the same notebook with its outputs kept is
`../word_50_training_results.ipynb`.

The final model scores 71.92% accuracy and 0.714 macro-F1 on 3,918 samples from 4
test signers who appear in no other partition.

| File | Contents |
|---|---|
| `all_experiment_results.json` | The feature, sequence-length and architecture comparisons, the final run and the split metadata |
| `classification_report.txt` | Precision, recall and F1 for each of the 50 words |
| `per_word_stats.json`, `confusion_pairs.json`, `curriculum.json` | Accuracy, F1 and difficulty per word, the most confused word pairs, and a learning order; copies are deployed in `asl-web/data/` |
| `test_sample.json` | A synthetic input for checking that the ONNX model runs. It is not an accuracy benchmark |
| `figures/` | The plots from the final run (below) |
| `manifest.json`, `README_EXPORT.txt` | Description of the Kaggle export bundle, with its original flat file names. `README_EXPORT.txt` is in Turkish |

## Figures

The file names are Turkish, as in the notebook.

| Figure | Shows |
|---|---|
| `01_kelime_dagilimi.png` | How many samples each of the 50 words has |
| `02_sekans_uzunluk.png` | The distribution of recording lengths in frames |
| `03_feature_ablasyonu.png` | Validation and test F1 for the six feature sets |
| `03_sekans_karsilastirma.png` | Fixed 30 frames, 45 frames with mask, and the motion variant |
| `04_model_karsilastirma.png` | Model F1, parameter count, training curves and inference speed |
| `05_full_training_egrileri.png` | Loss and validation metrics of the final training run |
| `06_kelime_bazli_f1.png` | F1 per word: which words are easy or hard |
| `07_confusion_matrix.png` | Which words are mistaken for which |
| `08_tum_deneyler_ozet.png` | The whole chain of experiments on one chart |
| `09_confusion_top_pairs.png` | The most confused word pairs as a list |

## The export bundle and the repository names

The model files from the Kaggle bundle are in `../../models/word/web-50/`. There
`final_model.pt` is `word_model.pt` and `word_to_idx.json` is `word_labels.json`;
`manifest.json` lists the bundle's names.

`manifest.json` reports `num_files: 21` but its `files` array has 20 entries. That
is intended: the count includes the manifest itself, and a file cannot contain its
own hash. `make validate` finds each listed file under its repository name, or
in `figures/` for a plot, before it checks sizes and SHA-256 values.

Do not compare these results with the 25-word desktop model's score. The
vocabulary, features, sequence length and evaluation split are all different.
