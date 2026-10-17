# Word fixtures

<sub>Location: [`asl-assistant`](../../../../README.md) / [`asl-web`](../../../README.md) / [`data`](../../) / [`model-test-samples`](../) / `words`</sub>

<sub>Related: [`docs/models-and-data.md` › Model Test fixture contract](../../../../docs/models-and-data.md#model-test-fixture-contract) · [`scripts/evaluation/`](../../../../scripts/evaluation/README.md) · [`docs/getting-started.md` › Static deployment](../../../../docs/getting-started.md#static-deployment)</sub>

This folder holds one fixture, `word-give-smoke.json`, and it is synthetic. Its
30 frames (padded to 45 with a mask) are drawn from a seeded random generator
rather than recorded, and the file exists to show that the word model runs end
to end in the browser. Its expected result is `give` at about 7.6% confidence,
so it is a pipeline check, not an accuracy sample. The letter fixtures are
real held-out rows and live in `../letters/`.

## Why there are no real word samples

The word model was trained on the
[Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition data. Section 7.B of the competition rules forbids publishing or
redistributing that data to anyone who is not taking part in the competition,
and the rules prevail over the data's CC BY 4.0 licence. A word fixture
exported from it is the feature sequence of one real recording, so this
repository does not publish any.

## Creating them locally

1. Accept the competition rules on Kaggle and get the data: either the full
   download, or a small subset from
   `scripts/evaluation/download_kaggle_sample_subset.py`. The directory must
   contain `train.csv` and the Parquet files it lists.
2. Export the fixtures:

   ```bash
   python scripts/evaluation/export_model_test_word_samples.py \
     --kaggle-dir /path/to/asl-signs \
     --samples-per-word 1
   ```

   `make model-test-fixtures` does the same for `data/raw/asl-signs-sample-subset`.
   The script writes the fixtures to `../local/` with a manifest of their own.
   Git ignores that folder, and the Model Test panel lists what it finds there
   when the folder exists.
3. Remove `../local/` before deploying `asl-web/`. A drag-and-drop deploy
   uploads the whole folder, which would publish the fixtures. `make validate`
   warns while the folder is there, and `make deploy-check` fails.

See the
[Model Test fixture contract](../../../../docs/models-and-data.md#model-test-fixture-contract)
for the fixture schema.
