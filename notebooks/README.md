# Notebooks

The training record for the word models. The browser never loads a notebook;
these are here so you can see how the word models were built and read the
results without retraining. The comments, explanations and figure names inside
the notebooks are mostly in Turkish.

| Path | Purpose |
|---|---|
| `word_50_training.ipynb` | The clean, rerunnable source of the 50-word workflow behind the web model |
| `word_50_training_results.ipynb` | The same workflow with its Kaggle outputs kept: metrics, logs, tables and figures |
| `word_25_desktop_training.ipynb` | The earlier 25-word BiGRU workflow behind the desktop prototype's model |
| `word_50_results/` | Metrics, figures, reports and analysis JSON from the 50-word run ([README](word_50_results/README.md)) |

The 50-word workflow ran on Kaggle, where two Tesla T4 GPUs were visible and
training used `cuda:0` only. It uses the
[Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition data with a signer-independent split. The clean and executed
notebooks are separate so you can rerun the code without hauling large outputs
along, or read the recorded run without retraining. The exported models are in
`models/word/web-50/`.

The desktop notebook is the one that produced the model `asl-desktop` still
loads. The earlier 15- and 25-word iterations, a standalone ablation notebook,
an earlier GRU and Transformer comparison and an unrelated video-classification
experiment are not published; the final workflow carries their useful findings.

`word_50_results/figures/` holds the plots from the final run. The JSON and text
files there record the experiment decisions and class-level results, and some of
them are the runtime data deployed to `asl-web/data/`:

```text
models/word/web-50/word_model.onnx  -> asl-web/models/word_model.onnx
models/word/web-50/word_labels.json -> asl-web/data/word_labels.json
models/word/web-50/temperature.json -> asl-web/data/temperature.json
notebooks/word_50_results/per_word_stats.json  -> asl-web/data/per_word_stats.json
notebooks/word_50_results/confusion_pairs.json -> asl-web/data/confusion_pairs.json
notebooks/word_50_results/curriculum.json      -> asl-web/data/curriculum.json
notebooks/word_50_results/test_sample.json     -> asl-web/data/test_sample.json
```

The notebook's flat export names the checkpoint `final_model.pt` and the label
file `word_to_idx.json`. In the repository they are `models/word/web-50/word_model.pt`
and `models/word/web-50/word_labels.json`. `word_50_results/manifest.json` keeps
the original names and hashes, so it is not a list of missing files.

Do not rerun a notebook just to refresh its timestamps or outputs. A new training
and export run changes the model: the model files, deployed copies, metrics,
fixtures, documentation and provenance checks all have to be updated together
(see [Models and data](../docs/models-and-data.md#safe-update-procedure)).

```bash
make notebook-check   # the notebooks, models and result files are in place
make health           # the full set of repository checks
```

More context: [Models and data](../docs/models-and-data.md) and the
[project journey](../docs/project-journey.md).
