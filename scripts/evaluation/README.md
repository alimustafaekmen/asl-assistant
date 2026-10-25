# Evaluation and fixture export

These scripts produce small inputs for the tests, the Model Test screen and the
camera-free demo. None of their output is an accuracy measurement.

| Script | Purpose |
|---|---|
| `export_feature_goldens.py` | Writes `tests/web/fixtures/feature-golden.json`: synthetic hands and word sequences with the Python 93-D and 168-D features, which the JavaScript tests must reproduce |
| `download_kaggle_sample_subset.py` | Downloads a few recordings per word from the Google Isolated Sign Language Recognition competition, from the test signers of the word split |
| `export_model_test_word_samples.py` | Turns those recordings into Model Test fixtures |
| `export_demo_letters.py` | Writes `asl-web/data/demo-letters.json`, the demo's hand poses |

## Feature goldens

```bash
python scripts/evaluation/export_feature_goldens.py
```

The inputs are built from closed-form geometry, with no random generator.
Regenerate the file after an intended change to the features and review the diff.

## Model Test word samples

The competition rules forbid redistributing the data, so these samples stay
local. The download needs the Kaggle command-line tool (`pip install kaggle`),
your API credentials and the rules accepted on Kaggle.

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset --samples-per-word 1
python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset --samples-per-word 1
```

The samples go to the ignored `asl-web/data/model-test-samples/local/` folder.
`check_runtime_assets.py --deploy` fails while that folder exists, so move it
out before uploading `asl-web/`.

## Demo hand poses

```bash
python scripts/evaluation/export_demo_letters.py --task hand_landmarker.task
```

`--task` is the browser's hand model, from
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
The script runs it in video mode on the American Sign Language Dataset in
`data/raw/` and keeps, per letter, the pose the deployed letter model reads most
surely. Those photographs are in the model's training split, so the 1.0 it
reports is not an accuracy figure. Run it again after a letter model change;
`tests/scripts/test_demo_letters.py` fails when the model stops reading a pose.
