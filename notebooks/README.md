# Notebooks

<sub>Location: [`asl-assistant`](../README.md) / `notebooks`</sub>

<sub>Related: [`notebooks/word_50_results/`](word_50_results/README.md) · [`models/word/`](../models/word/README.md) · [`docs/models-and-data.md`](../docs/models-and-data.md) · [`docs/project-journey.md`](../docs/project-journey.md)</sub>

The training record for the word models. The browser never loads a notebook;
these are here so you can see how the word models were built and read the
results without retraining. The comments, explanations and figure names inside
the notebooks are mostly in Turkish.

| Path | Purpose |
|---|---|
| `word_50_training.ipynb` | The clean, rerunnable source of the 50-word workflow behind the web model |
| `word_50_training_results.ipynb` | The same workflow with its Kaggle outputs kept: metrics, logs, tables and figures |
| `word_25_desktop_training.ipynb` | The 25-word BiGRU workflow behind the desktop prototype's model |
| `word_50_results/` | Metrics, figures, reports and analysis JSON from the 50-word run ([README](word_50_results/README.md)) |

The 50-word workflow ran on Kaggle, where two Tesla T4 GPUs were visible and
training used `cuda:0` only. It uses the
[Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition data with a signer-independent split. The clean and executed
notebooks are separate so you can rerun the code without carrying large outputs
along, or read the recorded run without retraining. The exported models are in
`models/word/web-50/`. The notebook's feature functions are the definition of
the 45 × 168 word input; `asl-features/src/asl_features/word.py` holds a copy,
and a test fails if the two disagree.

The desktop notebook produced the model that `asl-desktop` loads. Earlier
iterations (15 and 25 words, a standalone ablation, a GRU and Transformer
comparison) are not published; the final workflow carries over their findings.

`word_50_results/` also holds runtime data that is copied to `asl-web/data/`;
the full source-to-copy list is in
[Models and data](../docs/models-and-data.md#artifact-provenance).

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
