# Word fixtures

This folder holds a single fixture, `word-give-smoke.json`. It is synthetic:
its feature values are generated, not taken from a recording, and it exists to
show that the word model runs end to end. Its expected result is `give` at
about 7.6% confidence, so it is a pipeline check, not an accuracy sample.

## Why there are no real word samples

The word model was trained on the
[Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition data. Section 7.B of the competition rules forbids publishing or
redistributing that data to anyone who is not taking part in the competition,
and the rules prevail over the data's CC BY 4.0 licence. A word fixture
exported from it is the feature sequence of one real recording, so this
repository does not publish any.

## Creating them locally

1. Accept the competition rules on Kaggle and download the data.
2. Export the fixtures:

   ```bash
   python scripts/evaluation/export_model_test_word_samples.py \
     --kaggle-dir /path/to/asl-signs \
     --samples-per-word 1
   ```

   The script writes them to `../local/` with a manifest of their own. That
   folder is ignored by Git, and the Model Test panel lists its fixtures when
   it exists.
3. Remove `../local/` before deploying `asl-web/`. A drag-and-drop deploy
   uploads the whole folder, which would publish the fixtures. `make validate`
   warns while the folder is there.

See the
[Model Test fixture contract](../../../../docs/models-and-data.md#model-test-fixture-contract)
for the fixture schema.
