# Word fixtures

`word-give-smoke.json` is synthetic: 30 frames of seeded random values, padded
to 45 with a mask. It shows that the word model runs end to end in the browser,
and its expected result, `give` at about 7.6%, is a pipeline check, not an
accuracy figure. The letter fixtures in `../letters/` are real held-out rows.

There are no real word samples here because the word model's training data,
the [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs)
competition data, may not be redistributed (section 7.B of the competition
rules). To make some locally, accept the rules on Kaggle, download the data or
a subset, and run:

```bash
python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

The samples go to `../local/`, which Git ignores; Model Test lists them when the
folder exists. `check_runtime_assets.py --deploy` fails while that folder is
present, so move it out before uploading `asl-web/`.
