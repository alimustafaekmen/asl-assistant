# Evaluation and fixture export

Scripts that produce small, reviewable inputs for tests and for the browser's
Model Test panel. They do not train or replace a model, and none of their output
is an accuracy measurement.

| Script | Purpose |
|---|---|
| `export_feature_goldens.py` | Write `tests/web/fixtures/feature-golden.json`: synthetic hands and short word sequences together with the Python 93D and 168D features computed from them |
| `download_kaggle_sample_subset.py` | Download `train.csv` and a handful of landmark Parquet files from the Google Isolated Sign Language Recognition competition, one or more per word of the 50-word vocabulary |
| `export_model_test_word_samples.py` | Rebuild the 168D word input from those Parquet files, run the deployed word model on it, and write `asl-sample-v1` fixtures plus a manifest for the Model Test panel |

## Feature goldens

```bash
python scripts/evaluation/export_feature_goldens.py
```

The goldens are what keeps the Python and JavaScript feature code in step.
`tests/asl_ml/unit/test_feature_golden.py` rebuilds the file and fails if the
committed copy differs from what the Python code computes now;
`tests/web/feature-golden.test.js` runs `asl-web/js/ml/features.js` on the same
inputs and expects the same numbers. The inputs come from closed-form geometry,
not a random generator, so a library upgrade cannot change them. Regenerate the
file after an intended change to the feature contract, and review the diff.

## Word fixtures for the Model Test panel

The download needs the Kaggle command-line client (`pip install kaggle`, which
is not in `requirements.txt`), your API credentials, and a prior acceptance of
the competition rules on Kaggle's website. It selects rows from the
signer-independent test split the word notebook used (a seeded 70/15/15 split by
signer), so a fixture is a recording by a signer the model did not train on.

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

`make model-test-fixtures` runs the export step with the same defaults
(`KAGGLE_DIR` and `SAMPLES_PER_WORD` override them). The download takes
`--max-words` and `--dry-run`; the export takes `--max-words` and `--overwrite`.

The raw files stay under the ignored `data/raw/`. The fixtures are written to
`asl-web/data/model-test-samples/local/`, also ignored, because the competition
rules forbid redistributing the data; delete that folder before you upload
`asl-web/`. [The word fixtures README](../../asl-web/data/model-test-samples/words/README.md)
explains why, and the
[fixture contract](../../docs/models-and-data.md#model-test-fixture-contract)
gives the schema.

The generated fixtures are regression and demonstration samples. They are not
the complete signer-independent test partition and must not be reported as the
notebook's accuracy or macro-F1.
