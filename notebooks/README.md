# Training Notebooks and Results

This directory keeps the notebook records needed to understand the word-model
evolution. It is a training and research layer; the browser does not load
notebooks at runtime.

| Path | Purpose |
|---|---|
| `word_50_training.ipynb` | Clean, rerunnable source for the final 50-class workflow |
| `word_50_training_results.ipynb` | Executed companion preserving Kaggle metrics, logs, tables, and figures |
| `word_25_desktop_training.ipynb` | Earlier 25-class BiGRU + Attention workflow used by the desktop prototype |
| `word_50_results/` | Final 50-class metrics, figures, reports, analysis JSON, and smoke fixture |

The final workflow was run on Kaggle with two Tesla T4 devices visible and
`cuda:0` used by the single-model training flow. It used the Google Isolated
Sign Language Recognition competition dataset. The clean and executed notebooks are
kept separately so readers can rerun the code without carrying large outputs or
inspect the recorded run without retraining. Exported model artifacts are
organized under `models/word/web-50/`.

The desktop notebook was kept from the earlier experiments because it produced
the model still consumed by `asl-desktop`. Earlier 15-word and 25-word iterations, the
standalone ablation notebook, the superseded GRU/Transformer comparison, and an
unrelated video-classification experiment remain excluded: their useful
findings are already represented by the final workflow or project history.

`word_50_results/figures/` contains the plots from the final 50-class run. The
remaining JSON and text files preserve experiment decisions, class-level
evaluation, and the runtime support data deployed to `asl-web/data/`.

Key mappings:

```text
models/word/web-50/word_model.onnx  -> asl-web/models/word_model.onnx
models/word/web-50/word_labels.json -> asl-web/data/word_labels.json
models/word/web-50/temperature.json -> asl-web/data/temperature.json
notebooks/word_50_results/per_word_stats.json  -> asl-web/data/per_word_stats.json
notebooks/word_50_results/confusion_pairs.json -> asl-web/data/confusion_pairs.json
notebooks/word_50_results/curriculum.json      -> asl-web/data/curriculum.json
notebooks/word_50_results/test_sample.json     -> asl-web/data/test_sample.json
```

The notebook's flat export uses `final_model.pt` and `word_to_idx.json`.
Within the curated registry those files are named
`models/word/web-50/word_model.pt` and
`models/word/web-50/word_labels.json`. `manifest.json` keeps the original export
names and hashes; it is not a second set of missing model files.

Do not rerun a notebook merely to refresh timestamps or cell output. A new
training/export run is a model change and must update model artifacts, deployed
copies, metrics, fixtures, documentation, and provenance validation together.

Validation:

```bash
make notebook-check
make health
```

See [Models and data](../docs/models-and-data.md) and the
[project journey](../docs/project-journey.md).
