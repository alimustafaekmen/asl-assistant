# 50-Word Experiment Results

This directory contains evaluation and analysis outputs from the clean training
source `../word_50_training.ipynb`. The complete executed notebook is preserved
separately as `../word_50_training_results.ipynb`.

- `all_experiment_results.json` records feature, sequence-length, architecture,
  and final-training comparisons.
- `classification_report.txt` contains the final per-class evaluation.
- `per_word_stats.json`, `confusion_pairs.json`, and `curriculum.json` support
  analysis and selected web data views.
- `test_sample.json` is a deterministic ONNX smoke fixture, not an accuracy
  benchmark.
- `figures/` contains the exported plots from the final run.
- `manifest.json` and `README_EXPORT.txt` describe the Kaggle export bundle and
  therefore retain its flat artifact filenames. The README's notebook name was
  normalized to the current repository filename.

The model files from that bundle are organized separately under
`../../models/word/web-50/`. In the repository, `final_model.pt` is named
`word_model.pt`, and `word_to_idx.json` is named `word_labels.json`.

`manifest.json` reports 21 package files while its `files` array has 20
entries. This is intentional: the count includes the manifest itself, while
the array contains the other files and cannot safely include a hash of itself.
The repository validation test resolves the renamed model/label files and the
`figures/` subdirectory before checking sizes and SHA-256 values.

Do not compare these 50-class results directly with the earlier 25-class
desktop score: the class set, feature representation, sequence contract, and
evaluation run are different.
