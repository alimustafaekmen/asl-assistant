# Models and Data

This document is the contract between training, exported artifacts, validation,
and browser inference. A tensor can have the correct shape while its features or
labels are in the wrong order, so shapes alone prove nothing. It records what
each model was trained on, how its input is built, where each deployed file
comes from, and how far the reported numbers can be trusted.

The figures below come from `models/letter/letter_model_meta.json`,
`notebooks/word_50_results/all_experiment_results.json` and
`asl-web/data/model-card.json`. Where this text and those files disagree, the
files are right.

## Scope and reported results

| Pipeline | Letter model | Word model |
|---|---|---|
| Task | 24 static ASL letters | 50 isolated ASL signs |
| Model | LightGBM | SignTransformer encoder |
| Input | 93 engineered features | 45 × 168 features plus mask |
| Recorded test result | 99.35% held-out landmark accuracy | 71.92% accuracy; 0.714 macro-F1 |
| Primary runtime | ONNX Runtime Web | ONNX Runtime Web |

These results are not directly comparable. They use different tasks, datasets,
splits, and feature pipelines. The letter result is not a guarantee of webcam
accuracy, and the word result describes isolated signs rather than continuous
ASL translation.

## Training data and environments

The two models were trained independently. They do not share a dataset, split,
or training environment.

### Static-letter model

The final 24-class letter model was trained on a local machine. Three image
sources were converted to MediaPipe hand landmarks and then merged:

| Source | Role in the final model | Usable landmark rows |
|---|---|---:|
| [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) | Main image source | 52,419 |
| [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset) | Additional signer and capture variation | 962 |
| Local `ASL_SemCom` subset, associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | Additional alphabet images | 1,580 |

The merged landmark table contained 54,961 samples. The preparation pipeline
split it into 46,716 training rows and a separate 8,245-row held-out set (a 15%
test ratio). Each image was reduced to 63 normalized hand coordinates; training
then derived the 93D feature vector described below. J and Z were excluded
throughout, so neither the data nor the trained model contains them.

The held-out split is stratified by label and drawn at random over landmark
rows (`split_train_test` in `scripts/data_preparation/merge_static_letter_datasets.py`).
It is not grouped by signer or by source image sequence, and duplicate removal
drops only exact duplicates. The main source photographs each letter as long
runs of near-identical frames, so close neighbours of a held-out row can be in
the training set. The 99.35% figure therefore measures recognition of
already-seen hands and capture conditions, and probably overstates accuracy for
a signer the model has never seen. Unlike the word model below, this split is
not signer-independent.

A check on 2026-10-17 measured how large that gap is. The published ONNX
model scores 68.9% on the 122 rows of `semcom_test`, which neither split
contains. Retraining with the same settings while holding out one whole
source gives 79.6% (American SL held out), 39.9% (SemCom) and 64.8% (ASL
Alphabet). The weakest letters for unseen hands are the closed fists that
differ only by the thumb (M, N, T, S, E, A) and the near pairs R/U/V/H, G/K,
X/D and O/C. Wrong answers are usually confident, so the 0.6 display threshold
does not filter them. More signers in the training data, grouped by signer in
the split, is the fix; the threshold is not.

The [MediaPipe Processed ASL dataset](https://www.kaggle.com/datasets/vignonantoine/mediapipe-processed-asl-dataset)
was downloaded and evaluated, but it was not part of the final merged training
table. The preserved extraction runner records that the image-to-landmark path
detected no usable hands for that source. The final model metadata likewise
lists only the three sources above.

The row counts describe successfully extracted landmarks, not the original
number of images published by each provider. Raw images and generated CSV files
are local-only and are not distributed in this repository.

Kaggle's dataset metadata, checked on 2026-10-15, labels ASL Alphabet as GPL 2
and asks that it be cited as *ASL Alphabet*, Akash Nagaraj, 2018,
doi:10.34740/KAGGLE/DSV/29550; it labels the American Sign Language Dataset by
Ayush Thakur as CC0. The ASL-Fingerspelling repository licenses its code under
MPL-2.0 and states no terms for its images. The `ASL_SemCom` source terms are
therefore not recorded precisely enough to authorize redistribution, so its raw
images remain local.

### Isolated-word model

The 50-word model was trained in a Kaggle notebook environment using only the
[Google Isolated Sign Language Recognition competition dataset](https://www.kaggle.com/competitions/asl-signs).
The source dataset contains MediaPipe Holistic landmarks for roughly 100,000
isolated-sign recordings, 250 labels, and 21 signers. The notebook selected 50
classes that each have at least 300 recordings and are useful in everyday
communication.

The split is signer-independent: a person appears in exactly one partition.
The exported experiment record (`all_experiment_results.json`) contains:

| Partition | Signers | Samples |
|---|---:|---:|
| Training | 14 | 12,723 |
| Validation | 3 | 2,658 |
| Test | 4 | 3,918 |

Training and export ran in the Kaggle-hosted notebook. The executed record
(`notebooks/word_50_training_results.ipynb`) reports two Tesla T4 devices
(14.6 GB each) and marks `cuda:0` as the active device; training used a single
GPU. The notebooks, the result JSON, the PyTorch checkpoint and the ONNX export
are the evidence for the recorded experiment.

The competition's acknowledgements state that the dataset, provided by the
Deaf Professional Arts Network and the Georgia Institute of Technology, is
licensed under CC BY 4.0. Its rules, checked on 2026-10-15, add two terms that
prevail where they conflict with that licence. Section 7.A allows use of the
data for any purpose, commercial or non-commercial, which covers training and
publishing these models. Section 7.B forbids publishing or redistributing the
data to anyone not participating in the competition. This repository therefore
publishes the trained models and aggregate results, but no landmark data and
no fixture exported from it.

### Explored data that is not a final-model source

Two further data paths were tried and did not feed a published model:

- MediaPipe Processed ASL was evaluated for letter extraction, but the
  preserved run produced no usable hand detections and the dataset was excluded
  from the final 54,961-row merge.
- The MS-ASL download and landmark-extraction scripts under
  `scripts/data_preparation/` were written as a possible word-data extension.
  Neither published word model was trained with MS-ASL. MS-ASL is distributed
  under the Computational Use of Data Agreement, so it must not be described as
  unrestricted open data.

A small subset of the Google competition data, fetched with
`scripts/evaluation/download_kaggle_sample_subset.py` into `data/raw/`, is used
only to export Model Test fixtures. It is not an additional training partition.

## Letter model contract

| Field | Value |
|---|---|
| Classes | 24 static letters; J and Z are not included |
| Web artifact | `asl-web/models/letter_model.onnx` |
| Source artifact | `models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx` |
| Python artifact | `models/letter/letter_model.pkl` |
| Training source | `scripts/model_training/train_static_letter_model.py` |
| Input | `float32 (1, 93)` |
| Outputs | `label: int64 (N)` and `probabilities: float32 (N, 24)` |

### Letter training flow

The final artifact record and the retained code describe this pipeline:

```text
labelled alphabet images
  -> MediaPipe Hands: one detected hand, 21 landmarks × xyz
  -> wrist/hand-size normalization: 63 values
  -> merge, duplicate removal, anomaly filtering
  -> stratified source split: 46,716 train + 8,245 held-out rows
  -> training rows only: original + five augmented variants
  -> 93D feature engineering
  -> model comparison
  -> LightGBM classifier
  -> Python pickle and label map
  -> no-ZipMap ONNX artifact for the browser
```

The extraction script (`scripts/data_preparation/extract_static_letter_landmarks.py`)
runs MediaPipe Hands in static-image mode, keeps the first detected hand, and
reads its 21 `(x, y, z)` landmarks. Images with no detected hand do not produce
a training row. Only the 24 labels in `STATIC_LETTERS`
(`asl-ml/src/asl_ml/config.py`) are retained.

The merge script removes exact duplicates, non-finite values, and rows with a
feature more than ten standard deviations from the merged mean. Unless
`--no-balance` is given it then undersamples every class to the smallest one,
but the preserved final CSV files are not class-balanced: their class counts
differ. Describe the data as a stratified split, not as a balanced dataset.

### Landmark normalization

Each detected hand starts as 63 MediaPipe coordinates. Normalization performs
two operations:

1. subtract landmark `0` (the wrist) from every point, moving the wrist to the
   origin;
2. divide every coordinate by the distance from the wrist to landmark `9`
   (the middle-finger MCP joint).

This reduces sensitivity to the hand's position in the frame and its apparent
size. If the reference distance is at most `1e-6`, the function returns a zero
vector instead of dividing by an unstable value.

### Landmark augmentation

Augmentation is applied to normalized 63D training landmarks before feature
engineering. For every original row, the code retains the original and creates
five synthetic variants. Each variant receives, in order:

| Operation | Code-backed setting | Intended variation |
|---|---:|---|
| Gaussian noise | standard deviation `0.02` | Landmark jitter |
| XY rotation | uniform from `-45°` to `+45°` | In-plane hand rotation |
| XYZ scale | uniform from `0.8` to `1.2` | Apparent hand-size variation |

The preserved 46,716-row training CSV therefore becomes 280,296 rows before
the model-comparison split: one original plus five augmented rows per source
sample. Horizontal mirroring is not part of training augmentation. The script
also does not set a NumPy seed before generating noise, angles, and scales, so
rerunning augmentation is not byte-for-byte deterministic.

### Letter feature engineering

Feature engineering combines the normalized coordinates with explicit hand
geometry. The order is a frozen model contract:

The training landmarks come from square photographs, so one unit of x is as
long as one unit of y. A camera frame is rarely square, and MediaPipe divides
x by the frame's width and y by its height. The browser therefore multiplies
x and z by the frame's width over its height before the features
(`computeLetterFeatures(frame, aspect)` in `asl-web/js/ml/features.js`).
Without that step a 1280 by 720 camera took held-out accuracy from 98.4% to
88.6% on real MediaPipe output. The desktop app does not apply it yet; its
640 by 480 frame costs much less (4:3 measured 98.1% against 99.3% square).

```text
[0..62]   63  normalized 21 hand landmarks
[63..67]   5  fingertip-to-wrist distances
[68..71]   4  adjacent fingertip distances
[72..85]  14  finger joint angles
[86..87]   2  bounding-box aspect ratio and area
[88..92]   5  finger-extended flags
```

The derived groups are calculated as follows:

- fingertip distances use landmarks `4, 8, 12, 16, 20` relative to the wrist;
- adjacent distances cover thumb-index through ring-pinky fingertip pairs;
- 14 joint angles are measured in radians from three-point joint triplets;
- the bounding box contributes XY aspect ratio and normalized area;
- each binary extended flag checks whether the fingertip is farther from the
  wrist than that finger's MCP joint.

Degenerate joint angles return zero, cosine values are clipped before
`arccos`, and the final vector replaces NaN or infinite values with zero. Unit
tests verify the 93-value shape, ordering, finite output, angle range,
non-negative distances, binary flags, and deterministic feature extraction.

### Model comparison and recorded results

The current training script can compare Random Forest, XGBoost, LightGBM (or
SVM when LightGBM is unavailable), MLP, and a small 1D CNN. It reports accuracy,
five-fold cross-validation accuracy, per-class F1, training time, and inference
time. The preserved final metadata records the three classical candidates used
for the final decision:

| Model | Recorded accuracy |
|---|---:|
| Random Forest | 0.985 |
| XGBoost | 0.992 |
| LightGBM | 0.994 |

The selected pickle is a 24-class LightGBM model with 300 estimators and random
seed `42`. The training script sets only those two values; the learning rate
(`0.1`), the 31 leaves and the unlimited tree depth are LightGBM's defaults,
and the loaded pickle reports the same parameters. It accepts 93 features and
returns class probabilities. Labels are sorted alphabetically and stored as
dense indices `0..23` in `letter_label_map.json`.

The artifact metadata also records this ablation:

| Configuration | Recorded accuracy |
|---|---:|
| 93D features + augmentation | 0.994 |
| 93D features without augmentation | 0.988 |
| Raw 63D landmarks + augmentation | 0.332 |

Within this experiment, engineered hand geometry contributed much more than
augmentation alone. These values describe the preserved run; they are not a
claim that the same gains will hold for every camera or signer.

### Evaluation caveat

The metadata distinguishes an internal augmented split (`0.9944`) from the
separate 8,245-row held-out result (`0.9935`). The internal split is created
after augmentation, so transformed variants of one source row can fall on both
sides of that split. It is useful for model comparison but is not a completely
independent generalization test.

The held-out figure is the stronger recorded result because those rows were
separated before training augmentation. However, the current script only loads
an optional test CSV and does not execute the held-out evaluation. The score is
preserved in `letter_model_meta.json`, but the exact evaluation step is a known
reproducibility gap and should not be presented as fully regenerated by the
current command.

### Browser parity and export boundary

The Python feature implementation is
`asl_ml.features.letter_features`; the browser port is
`asl-web/js/ml/features.js`. `tests/validation/check_letter_feature_parity.py`
feeds deterministic hands to both implementations and requires a maximum
absolute difference below `1e-4`. `make parity` runs it together with the word
equivalent and needs Node.

Before normalization the browser also mirrors a detected left hand (`x` becomes
`1 - x`, because MediaPipe reports `x` in `[0, 1]`) so it matches the right-hand
training convention, and smooths the landmarks with an exponential moving
average (weight `0.6` on the current frame, `LETTER_LANDMARK_SMOOTHING_ALPHA` in
`asl-web/js/core/config.js`). These are live-runtime stability steps, not
training augmentation. The desktop prototype does not mirror left hands.

The active ONNX export disables ZipMap and exposes a plain probability tensor.
An earlier ZipMap export must not be deployed, because ONNX Runtime Web cannot
reliably read its sequence-of-maps probability output. The browser keeps a
label-only fallback for such exports; its confidence reflects how stable the
label has been over recent frames, not a LightGBM probability.

The training script writes the pickle, label map, metadata and evaluation
figures, but it does not contain the pickle-to-ONNX conversion. The repository
keeps the active ONNX file, checks it by SHA-256 against its deployed copy, and
`tests/validation/check_letter_model_parity.py` compares its top-1 label with
the pickle's on three synthetic hands. The exact export command is a known gap
in reproducibility.

## Word models

Two word models are preserved for different runtimes. The desktop prototype
uses the earlier 25-class BiGRU + Attention checkpoint in
`models/word/desktop-25/`. It expects 30 frames of 321 holistic landmark values
and is documented by `notebooks/word_25_desktop_training.ipynb`. Its metadata
(`word_model_meta.json`) records an accuracy of about 86.7% for that
experiment's 25 words and split, which is not comparable to the 50-word result.

The browser uses the later 50-class SignTransformer below. It expects a
45-frame compact 168D representation plus a padding mask. The two checkpoints,
label maps, and feature contracts are incompatible; neither is a fallback for
the other.

### Web 50-class contract

| Field | Value |
|---|---|
| Task | 50-class isolated-sign classification |
| Model | Encoder-only SignTransformer, 446,195 parameters |
| Web artifact | `asl-web/models/word_model.onnx` |
| Source artifact | `models/word/web-50/word_model.onnx` |
| Training source | `notebooks/word_50_training.ipynb` |
| Executed record | `notebooks/word_50_training_results.ipynb` |
| Feature input | `float32 (1, 45, 168)` |
| Mask input | `bool (1, 45)` |
| Output | logits, `float32 (1, 50)` |
| Temperature | `asl-web/data/temperature.json` |

Mask semantics are fixed:

```text
True  = real frame
False = padding
```

The ONNX graph performs the attention-mask inversion internally. JavaScript
must not reverse these values.

### Notebook export names and repository names

The Kaggle notebook writes a flat export bundle. The repository uses clearer
runtime-oriented names and separates models from evaluation reports:

| Kaggle export name | Curated repository path | Deployed copy |
|---|---|---|
| `word_model.onnx` | `models/word/web-50/word_model.onnx` | `asl-web/models/word_model.onnx` |
| `final_model.pt` | `models/word/web-50/word_model.pt` | Not loaded by the browser |
| `word_to_idx.json` | `models/word/web-50/word_labels.json` | `asl-web/data/word_labels.json` |
| `temperature.json` | `models/word/web-50/temperature.json` | `asl-web/data/temperature.json` |
| reports and figures | `notebooks/word_50_results/` | Selected JSON only |

`manifest.json` retains the flat Kaggle export names so its hashes can be
checked against the corresponding curated files. Its `num_files` value also
counts `manifest.json` itself; the `files` array cannot contain a hash of the
manifest without becoming self-referential, so it contains the other files.

### Landmark frame order

```text
[0..62]     63  right hand: 21 × xyz
[63..125]   63  left hand: 21 × xyz
[126..245] 120  selected face points: 40 × xyz
[246..320]  75  selected pose points: 25 × xyz
```

Frames are shoulder-normalized. When shoulder coordinates are unavailable,
the browser applies the notebook-compatible nonzero min-max fallback.

### Compact feature order

```text
[0..62]     63  dominant-hand landmarks
[63..92]    30  hand-shape features
[93..104]   12  hand-to-face/body distances
[105..167]  63  frame-to-frame dominant-hand motion
```

Dominant hand selection occurs once across the complete sequence. A selected
left hand is mirrored to the training convention, and motion for the first
frame is zero. Final inference must build features from the normalized sequence
buffer, not from independently selected per-frame hands.

Post-processing is:

```text
logits / temperature -> stable softmax -> top-3 labels
```

Word predictions require explicit user acceptance and are never automatically
appended to the transcript.

## Word model interpretation

The signer-independent notebook split produced:

| Metric | Value |
|---|---:|
| Test accuracy | 0.7192 |
| Test macro-F1 | 0.7140 |
| Best validation F1 | 0.803 |
| Temperature | 0.9854 |

Per-class F1 varies substantially:

| Band | Classes | Examples |
|---|---:|---|
| F1 ≥ 0.85 | 9 | water, sad, uncle, cow, brown |
| 0.70 ≤ F1 < 0.85 | 22 | dad, sick, finish, home, food |
| 0.50 ≤ F1 < 0.70 | 16 | happy, hear, listen, sleep, book |
| F1 < 0.50 | 3 | all, give, open |

Common exported confusion pairs include `listen/hear`, `can/yes`,
`open/book`, `sleep/sleepy`, and `who/bird`. The UI may explain a close pair,
but the hint does not alter the classifier result.

Temperature scaling did not improve the recorded expected calibration error
(ECE): it went from `0.0235` before to `0.0252` after, with `T = 0.9854`, which
is close to no scaling at all. Do not describe it as a calibration gain.
Confidence is a model score, not a probability that an arbitrary live sign is
correct.

The model is intended for an educational and engineering demonstration with
one isolated sign per recording. It is not suitable for continuous translation,
sentence understanding, accessibility-critical communication, identity
inference, or high-stakes decisions.

## Runtime data files

| File | Purpose | Contract |
|---|---|---|
| `letter_labels.json` | Letter output map | 24 dense indices; J and Z are not supported |
| `word_labels.json` | Word output map | 50 dense indices in export order |
| `temperature.json` | Word calibration | Numeric `T` plus evaluation metadata |
| `per_word_stats.json` | Per-class summary | 50 accuracy/F1/difficulty records |
| `confusion_pairs.json` | Word ambiguity data | Ordered word pairs and counts |
| `curriculum.json` | Word learning order | 50 word records |
| `letter_curriculum.json` | Curated letter guidance | `letter-curriculum-v1` |
| `letter_confusion.json` | Curated look-alike groups | `letter-confusion-v1` |
| `word_reference.json` | Card position and Turkish gloss of each word | `word-reference-v1`: page, rectangle (fractions of the page) and gloss for the 50 words; glosses unreviewed |
| `model-card.json` | Figures the Project page states | `model-card-v1`: accuracy, classes, sizes and licence, each equal to its recorded source |
| `asl_video_links.json` | Optional tutorial links | Alphabet link and word map |
| `test_sample.json` | Legacy word smoke fixture | 7560 features and 45 mask values |
| `letter_test_sample.json` | Letter fixture | `asl-sample-v1`, 93 features |
| `model-test-samples/manifest.json` | Fixture index | `asl-model-test-manifest-v1` |

Label maps use `{label: integer_index}` objects. Indices must be unique, dense,
and start at zero. Sorting or rebuilding a map independently from its model can
silently change every output meaning.

Letter curriculum and confusion files are hand-curated teaching references.
They are not model outputs and are not currently part of runtime gating.

## Model Test fixture contract

One fixture contains one task:

```json
{
  "schema_version": "asl-sample-v1",
  "task": "letter",
  "sample_id": "letter-a",
  "features": [0.0],
  "expected_label": "A"
}
```

A real letter array has 93 finite numbers. A word fixture uses the same schema
with task `word`, 7560 finite feature values (`45 × 168`), and 45 boolean mask
values. The manifest must reference every bundled fixture exactly once.

The published manifest lists the 24 letter fixtures and one synthetic word
fixture. Each letter fixture is the 93-feature vector of one row of the local
8,245-row held-out split (`data/processed/test_landmarks.csv`), and its
`source_row_index` names that row. Matched against the per-source landmark
extracts, 23 of the 24 rows come from ASL Alphabet (labelled GPL-2.0 by its
provider) and the K fixture, `letters/letter-k.json`, comes from the local
`ASL_SemCom` subset, whose terms are not recorded (see the letter data section
above). None comes from the competition data. `letter_test_sample.json` is a
copy of the A fixture.

Word fixtures exported from the competition recordings fall under section 7.B
of its rules, so `scripts/evaluation/export_model_test_word_samples.py` writes
them to the ignored `asl-web/data/model-test-samples/local/` folder with a
manifest of its own. The Model Test panel lists them when that folder exists,
and the runtime asset check validates them there; in a clone the folder is
absent. The site is uploaded as the `asl-web/` folder as it is on disk, so
`make deploy-check` fails while the folder is present.

The `test_sample.json` smoke file predates the published schema. It holds 30
real frames followed by 15 zero-padded ones, but the 30 frames are synthetic,
not a recording: `scripts/validation/generate_word_onnx_test_sample.py` draws
them from NumPy's seeded generator (seed 42, standard normal values scaled by
0.1) and records what the deployed model predicts for them, `give` at about
`0.0760` confidence. The browser still accepts this file and validates
task-specific dimensions and values rather than rejecting a file only because
it lacks a schema string.

Bundled fixtures are deterministic regression samples. Metrics computed over
them are not the official notebook test result unless the complete held-out
protocol is reproduced.

## Artifact provenance

Word exports:

```text
models/word/web-50/word_model.onnx     -> asl-web/models/word_model.onnx
models/word/web-50/word_labels.json    -> asl-web/data/word_labels.json
models/word/web-50/temperature.json    -> asl-web/data/temperature.json
notebooks/word_50_results/per_word_stats.json  -> asl-web/data/per_word_stats.json
notebooks/word_50_results/confusion_pairs.json -> asl-web/data/confusion_pairs.json
notebooks/word_50_results/curriculum.json      -> asl-web/data/curriculum.json
notebooks/word_50_results/test_sample.json     -> asl-web/data/test_sample.json
```

Letter exports:

```text
models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx
  -> asl-web/models/letter_model.onnx
models/letter/letter_label_map.json
  -> asl-web/data/letter_labels.json
```

Validation compares these pairs with SHA-256 and checks ONNX I/O. Exact hashes
are not copied into documentation because the mapping, not a stale hash string,
is the durable contract.

The letter model is also deployed gzip-compressed, as
`asl-web/models/letter_model.onnx.gz`, because the host serves `.onnx` files
uncompressed. The browser downloads that copy and keeps the raw file as its
fallback. The copy has no source of its own: validation fails unless it
decompresses to exactly the bytes of `asl-web/models/letter_model.onnx`, and the
[validation notes](../scripts/validation/README.md) give the command that
regenerates it.

## Data publication boundary

Raw images, videos, parquet files, generated CSVs, downloaded Kaggle subsets,
and private reference data stay outside the public repository. Only small,
reviewed runtime JSON and deterministic feature fixtures belong in
`asl-web/data/`. Dataset access and redistribution terms remain those of the
original providers.

The public source/role manifest is `data/README.md`. It distinguishes data used
for training from sources that were only explored or used for fixture export.

## Safe update procedure

1. Produce the new source artifact from its training script or notebook.
2. Move the model, labels, calibration, and evaluation exports as one version.
3. Regenerate affected deterministic fixtures.
4. Update the fixture manifest when paths change.
5. Run `make health` and inspect every provenance result.
6. Test offline fixture inference and the relevant camera mode in a browser.
7. Update this document and `CHANGELOG.md` when metrics or behavior change.

## Reproducibility records

- Letter metadata: `models/letter/letter_model_meta.json`
- Letter training script: `scripts/model_training/train_static_letter_model.py`
- Final word notebook: `notebooks/word_50_training.ipynb`
- Executed final-word record: `notebooks/word_50_training_results.ipynb`
- Desktop word notebook: `notebooks/word_25_desktop_training.ipynb`
- Word artifact registry: `models/word/`
- Word experiments: `notebooks/word_50_results/all_experiment_results.json`
- Word report: `notebooks/word_50_results/classification_report.txt`
- Word export metadata: `notebooks/word_50_results/manifest.json`
- Feature and model parity: `tests/validation/` (run with `make parity`)
- Deploy-artifact and provenance checks: `scripts/validation/` (`make validate`)
- Repository and fixture contracts: `tests/project/`

## Related documents

- [Architecture](architecture.md)
- [Project journey](project-journey.md)
- [Getting started](getting-started.md)
