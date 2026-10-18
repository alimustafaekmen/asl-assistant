# Project Journey

<sub>Location: [`asl-assistant`](../README.md) / [`docs`](README.md) / `project-journey.md`</sub>

<sub>Related: [`TECHNICAL_REPORT.md`](../TECHNICAL_REPORT.md) · [`docs/models-and-data.md`](models-and-data.md) · [`docs/architecture.md`](architecture.md)</sub>

ASL Assistant started as a Python desktop app and became a browser app whose
models and features are checked against their sources. The project introduces
no new sign-recognition architecture or dataset; what it found is about
engineering. For anyone building a similar system, the most useful parts are
[what went wrong](#what-went-wrong-and-what-changed) and the
[lessons](#lessons-for-similar-projects) that follow it.

## The path at a glance

| When | What happened | Where it is recorded |
|---|---|---|
| March 2026 | The 24-letter model was trained (13 March), and the desktop prototype got its 25-word model (28 March) | `trained_at` in `models/letter/letter_model_meta.json` and `models/word/desktop-25/word_model_meta.json` |
| April 2026 | The 50-word model was trained and exported on Kaggle (25 April) | `created_at_unix` in `notebooks/word_50_results/manifest.json` |
| September and October 2026 | The browser code was split into modules, the tests were rebuilt around behaviour, and the interface was rebuilt screen by screen | the [technical report](../TECHNICAL_REPORT.md#12-change-history) |

## What the project tries to do

Sign-language recognition covers several tasks, and one accuracy number cannot
describe them all:

- fingerspelling, or recognising a static handshape such as a letter;
- isolated sign recognition, where one recording holds one sign;
- continuous recognition or translation, where segmentation, grammar and
  context also matter.

This project covers the first two only. Its word model picks one of 50 isolated
signs. It does not translate ASL sentences.

Both models read **landmarks**: the x, y and z positions of points that
MediaPipe finds on the hands, face and body. They never see the camera image
itself.

## Starting on the desktop

The first working version was a Python app built with OpenCV, MediaPipe,
CustomTkinter, LightGBM/scikit-learn and PyTorch. It had two models:

- a 24-class static-letter model that reads a 93-value hand feature vector
  (93D); and
- a 25-class word model that reads 30 frames of 321 values each, the holistic
  landmarks of both hands, the face and the body pose. It is a bidirectional
  GRU (a recurrent network that reads the sequence in both directions) with
  attention pooling.

The letter images came from three alphabet sources. They were converted to
landmarks, merged and trained locally. [Models and data](models-and-data.md#training-data-and-environments)
lists the sources, the rows kept and what was excluded. The same letter model
runs in both apps: the desktop app loads it directly, and the browser loads an
ONNX export of it.

Two lessons came early:

1. Static handshapes and signs that move are different problems, and they need
   separate models.
2. A high offline score does not promise steady behaviour on a webcam, where
   landmark quality, framing, handedness and signing style all change.

The desktop app is kept working as a prototype (see
[asl-desktop](../asl-desktop/README.md)). Its 25-word model is preserved under
`models/word/desktop-25/` and is not the source of the web word model.

## Finding a word model

The final word experiments ran in a Kaggle notebook on the data of the
[Google Isolated Sign Language Recognition competition](https://www.kaggle.com/competitions/asl-signs).
The notebook chose 50 classes with enough recordings and then split the data
**by signer**: each person appears in only one of training, validation and
test, so the test measures people the model has never seen. The split was made
before any features were computed. The results below apply only to that
50-class subset, that feature pipeline and that split.

Scripts to download and preprocess MS-ASL were also written, as a possible
source of more word data. MS-ASL was not used to train either published word
model, the 25-word or the 50-word one.

The experiments went through seven stages:

1. a 15-word recurrent baseline;
2. a 25-word BiGRU on hand landmarks;
3. a 25-word BiGRU on all 321 holistic values;
4. attention pooling with focal loss, mixup and stronger augmentation;
5. ablations of the feature set and the sequence length;
6. 50-word comparisons of recurrent and Transformer models; and
7. a separate raw-video classifier, which did not produce the deployed model.

Only the later stages are in the repository: the final 25-word desktop notebook
and the 50-word notebooks with their results
([notebooks/README.md](../notebooks/README.md)). The earlier iterations and the
video experiment were left out, because the final workflow carries what they
found.

The three tables below come from
`notebooks/word_50_results/all_experiment_results.json`. Each is an
**ablation**: the same training run with one choice changed, to see what that
choice is worth. The score is the test **macro-F1**, the F1 score averaged over
the 50 words with equal weight, so a rare word counts as much as a common one.

### Which features

| Representation | Dimension | Recorded test macro-F1 |
|---|---:|---:|
| Raw landmarks | 321D | 0.581 |
| Pairwise + dominant hand | 444D | 0.671 |
| Hand shape | 72D | 0.613 |
| Shape + motion | 132D | 0.621 |
| Compact | 168D | 0.699 |
| Full engineered set | 519D | 0.639 |

The largest feature vector was not the best. The 168D set keeps the dominant
hand's geometry, hand shape, hand-to-body distances and motion, and avoids part
of the noise and download cost of the 519D set. More engineered values can add
redundancy and overfitting instead of information.

### How long a sequence

| Strategy | Recorded test macro-F1 |
|---|---:|
| Fixed 30 frames | 0.699 |
| 45 frames with padding mask | 0.700 |
| Motion-focused variant | 0.694 |

The differences are small. The 45-frame version was chosen because its
**padding mask**, one true or false per frame saying which frames are real,
states the valid length explicitly, and it matches the final ONNX contract.

### Which model

| Model | Parameters | Recorded test macro-F1 |
|---|---:|---:|
| SmallGRU | 104,627 | 0.682 |
| BiGRU | 602,739 | 0.700 |
| ConvGRU | 338,259 | 0.702 |
| SignTransformer | 446,195 | 0.719 |
| Two-model ensemble | 1,048,934 | 0.733 |

The two-model ensemble scored highest, but it has more than twice the
parameters and would have meant shipping two models to the browser. The single
SignTransformer was the better trade between accuracy and complexity.

### The comparison run and the shipped run

The comparison table and the deployed model come from different runs. The
SignTransformer scored 0.719 macro-F1 in the comparison. The final
full-training run, the one that was exported, records 71.92% accuracy,
0.714 macro-F1 and 0.803 best validation F1 on the same signer-independent
split (4 test signers, 3,918 samples). The rest of the repository uses these
final figures.

## Moving to the browser

The product then moved from the desktop GUI to `asl-web/`, a static HTML, CSS
and JavaScript app with no build step. MediaPipe finds the landmarks, and
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) runs the models
inside the page. (ONNX is a portable file format for trained models.) Python
stays in training, validation and fixture export, and is not part of anything
a visitor loads.

Running the models in the browser means there is no inference server, and no
camera frame leaves the device. The costs are the model download, browser
compatibility, device limits, and having to reproduce the Python preprocessing
exactly in JavaScript.

The models take landmarks rather than video frames. The
[MediaPipe framework](https://arxiv.org/abs/1906.08172) was designed for
cross-platform perception pipelines, and
[MediaPipe Hands](https://arxiv.org/abs/2006.10214) provides an on-device palm
detector plus a hand-landmark model. Landmarks keep the models small and the
features easy to inspect, but any MediaPipe error becomes part of the system's
error.

The download cost shaped the app too. When every model loaded with the page,
each visitor downloaded 14.4 MiB (15.0 MB) of models. A model now downloads on
first use, and the 13.2 MB letter model is served gzipped at about 2.2 MB.

The web app has six screens: letter, word, coach, Model Test (bundled samples
run without a camera), QR and a project page. Model Test was first the
visitor's way to try the app without a camera, but a table of fixture results
explained little to a visitor. It is now a developer tool, and a visitor
without a camera watches a recorded hand spell FLY on the letter screen,
through the same pipeline as the camera. The
[root README](../README.md#what-it-does) describes each screen and the demo.

## Why letters became the main mode

The letter metadata reports 99.35% accuracy on a held-out set of landmark rows
over 24 static classes. The browser reproduces the ordered 93D feature pipeline
and uses an ONNX export that returns a plain probability tensor.

That score is not live accuracy. The held-out rows were drawn at random from
the same image collections as the training rows, not from new signers. On 122
rows that neither split contains (`semcom_test`), the published model scores
68.9%, and retraining with one whole source held out gives between 39.9% and
79.6%. The [evaluation caveat](models-and-data.md#evaluation-caveat) in Models
and data has the details and the letters that suffer most.

Even so, the letter task is much narrower than word recognition. It classifies
one hand pose, with no timing, padding, face or pose visibility, hand choice
across a sequence, or motion history. In use, letter mode proved the more
dependable feature and the easier one to understand.

Word mode stays as an experiment that shows its limits. It lists the three most
likely words, warns about known look-alike pairs, and adds nothing to the text
until the user accepts a word. It is not presented as a reliable translator.

## What went wrong, and what changed

The most dangerous bugs on the way were not shape errors. A `(1, 45, 168)`
tensor has the right shape and can still be wrong if the feature order,
normalization, hand choice or motion state differs from training. The model
then runs and quietly predicts nonsense. Each problem below changed the design.

### Python and JavaScript computed different features

Training computes features in Python and the browser computes them again in
JavaScript, so the two can drift apart without any error. Parity checks were
added for both pipelines: the same landmarks go through both versions, and the
features must agree within 1e-4. The rule that came out of it: write the
parity test before changing runtime preprocessing. `make parity` runs the
checks.

### The dominant hand switched between frames

The notebook picks the hand that is better visible across the whole recording.
An early browser path chose a hand for each frame on its own, so the hand
source and the motion values could switch halfway through. The final path
buffers normalized 321D frames and builds the 168D sequence only after the
recording ends.

### Missing shoulders changed the input

Word frames are normalized around the shoulders. When the shoulders are not
usable, the notebook falls back to min-max normalization over the nonzero
values. The JavaScript at first returned the frame unnormalized instead, a
quiet shift away from what the model was trained on. Matching the fallback
closed that gap.

### The mask was easy to invert twice

The browser sends `true` for a real frame and `false` for padding. The ONNX
graph inverts the mask itself for its attention step. Inverting it again in
JavaScript would give a valid tensor with wrong attention, and nothing would
crash.

### The first letter export could not be read

The first LightGBM export used ZipMap, an ONNX step that returns the class
probabilities as a list of label-to-probability maps. ONNX Runtime Web could
not read that output reliably. The deployed export turns ZipMap off and
returns a plain `(N, 24)` probability tensor.

### One recording leaked into the next

Frame buffers, normalized frames, motion history, mask state, animation-frame
handles and user messages all cross the boundary between recordings. Partial
resets made a prediction depend on earlier attempts. The final lifecycle resets
this state on start, finish, retry, mode change and camera stop.

### A wide camera frame distorted the hand

The letter training landmarks come from square photographs. A camera frame is
rarely square, and MediaPipe scales x by the frame's width and y by its height,
so the same hand gives different numbers. On real MediaPipe output, a 1280 by
720 frame took held-out accuracy from 98.4% to 88.6%. The browser and the
desktop app both multiply x and z by the frame's width over its height before
computing the features (see
[Models and data](models-and-data.md#camera-aspect-step)).

### Calibration did not make weak predictions trustworthy

**Temperature scaling** divides the model's raw scores by one constant before
they become probabilities, to make the confidence more honest. It did not
improve the word model's expected calibration error (ECE, the gap between
confidence and actual accuracy): 0.0235 before, 0.0252 after. No recalibration
turns a low-margin live prediction into a trustworthy one.

The product answer was to show the alternatives and ask the user to confirm. A
single low minimum confidence (`WORD_ACCEPT_THRESHOLD` in
`asl-web/js/core/config.js`, set to 0.15) only filters out results that are
close to noise.

### Passing tests did not mean guarded behaviour

Some early tests checked the source text instead of what the code did. They
broke on harmless edits and still missed real faults. The tests were rebuilt
around behaviour, and each new guard is shown to fail on a deliberately planted
fault before it is trusted.
[Section 9.2 of the technical report](../TECHNICAL_REPORT.md#92-tests-shown-to-fail)
lists examples.

## Approaches that did not make it

| Approach | Reason |
|---|---|
| 15-word and early 25-word recurrent models | Replaced by later experiments. The last 25-word checkpoint remains for the desktop prototype only. |
| An experimental 507-value Python word feature pipeline | Its feature and label contracts do not match the deployed 168-value model. |
| Raw-video classifier | Did not produce the deployed model or a browser integration. |
| J and Z recognition | Not implemented; no trained or deployed J or Z model is included. Configuration and an experimental training script remain for possible future work. |
| React and standalone page mockups | Design experiments; the app uses plain HTML, CSS and JavaScript. |

The ensemble and the ZipMap export, described above, did not make it either.

## Lessons for similar projects

1. **Define the task before comparing metrics.** Static letters, isolated
   signs and continuous translation are different research problems.
2. **Split by signer when generalization matters.** A random split of samples
   can reward cues that belong to one signer.
3. **Treat preprocessing as part of the model.** Feature order, normalization,
   handedness, padding and motion state belong to the inference contract.
4. **Measure deployment constraints while choosing a model.** The highest
   offline score may not justify twice the model size or runtime complexity.
5. **Keep fixtures separate from evaluation.** A fixed sample proves that
   serialization and inference repeat exactly, not that the model generalizes.
6. **Report domain shift honestly.** Landmark quality, camera setup, signing
   speed and differences between users can dominate live behaviour.
7. **Design uncertainty into the product.** Showing the top three and asking
   for acceptance is safer than automatic output from a weak live classifier.

## Current limits

- The project recognizes a small, fixed vocabulary. It does not model ASL
  grammar or continuous signing.
- The letter task has 24 static classes; J and Z are not supported. Neither
  model has an `unknown/no-sign` class.
- Letter accuracy for hands the model has not seen is far below 99.35%: 68.9%
  on rows outside both splits.
- Letter and word metrics come from different datasets and cannot be compared
  as a head-to-head result.
- Live word behaviour is not reliable enough for accessibility-critical use.
- The app has not been tested on a real phone. Automated checks run in headless
  desktop Chrome with a simulated camera; iOS Safari, Android Chrome and real
  hands are untested.
- Datasets and sign variants reflect how the data was collected. Evaluation on
  one variant does not establish linguistic coverage.
- The system is a learning and engineering prototype. It is not a replacement
  for interpreters or a general communication aid.

## Checking the evidence

Each claim above can be traced to a file in the repository:

| Claim | Where to check |
|---|---|
| Letter model: 24 classes, 93 features, 99.35% held-out accuracy | `models/letter/letter_model_meta.json` |
| Word experiments: feature, sequence and model comparisons | `notebooks/word_50_results/all_experiment_results.json` |
| Final word run: 71.92% accuracy, 0.714 macro-F1, ECE, export hashes | `notebooks/word_50_results/all_experiment_results.json`, `notebooks/word_50_results/manifest.json`, `notebooks/word_50_results/classification_report.txt` |
| How the 50-word model was trained | `notebooks/word_50_training.ipynb`, and `notebooks/word_50_training_results.ipynb` with its outputs kept |
| The desktop 25-word model | `notebooks/word_25_desktop_training.ipynb`, `models/word/README.md` |
| Python and JavaScript features agree | `tests/validation/` |
| Deployed files match their sources; ONNX inputs and outputs | `scripts/validation/check_runtime_assets.py`, `scripts/validation/verify_project_assets.py` |

Run `make health` for the repository checks, feature parity included. They do
not replace a test with a real camera, real hands and a real browser, which
live behaviour still needs.

## References

- [Google Isolated Sign Language Recognition competition](https://www.kaggle.com/competitions/asl-signs).
- Lugaresi et al. (2019), [MediaPipe: A Framework for Building Perception
  Pipelines](https://arxiv.org/abs/1906.08172).
- Zhang et al. (2020), [MediaPipe Hands: On-device Real-time Hand
  Tracking](https://arxiv.org/abs/2006.10214).
- [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/).

## Related documents

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Getting started](getting-started.md)
- [Technical report](../TECHNICAL_REPORT.md)
