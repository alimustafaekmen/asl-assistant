# Project Journey and Research Notes

ASL Assistant began as a desktop course project and evolved into a browser
application with reproducible model contracts. This document records what was
tried, what changed, what failed, and what can be useful to others building
small-vocabulary sign-recognition systems.

It is an engineering case study, not a claim of a new state-of-the-art model.
The useful contribution is the documented path from experiments to a browser
runtime: task separation, feature parity, artifact provenance, deterministic
fixtures, and honest treatment of live reliability.

## Research context

Sign-language recognition spans different tasks that should not be collapsed
into one accuracy number:

- fingerspelling or static handshape recognition;
- isolated sign recognition, where one recording contains one sign; and
- continuous recognition or translation, where segmentation, grammar, and
  linguistic context also matter.

This project covers the first two tasks only. Its word model predicts one of 50
isolated signs and does not translate ASL sentences.

The project's word research used only the
[Google Isolated Sign Language Recognition competition](https://www.kaggle.com/competitions/asl-signs)
data. The final model was trained in Kaggle on a selected 50-class subset with
a signer-independent split. Its reported results apply only to that subset,
feature pipeline, and split.

## Phase 1: desktop prototype

The first working product used Python, OpenCV, MediaPipe, CustomTkinter,
LightGBM/scikit-learn, and PyTorch. It combined:

- a 24-class static-letter model with a 93D hand feature vector; and
- a 25-class word model with 30 frames of 321D holistic landmarks and a
  bidirectional GRU with attention pooling.

The static-letter images came from three alphabet sources, were converted to
landmarks, merged, and trained locally. The exact sources, retained sample
counts, and exclusions are recorded in [Models and data](models-and-data.md#training-data-and-environments).

This phase established two lessons early. First, static handshape and temporal
sign recognition are different problems and need separate models. Second, a
high offline score does not guarantee stable webcam behavior when landmark
quality, framing, handedness, and signer style change.

The desktop application remains as a historical prototype. Its 25-word model
is preserved under `models/word/desktop-25/`; it is not the source of the
current web word model.

## Phase 2: word-model experiments

The final word experiments ran in a Kaggle-hosted notebook against the Google
Isolated Sign Language Recognition data. The notebook chose 50 sufficiently
represented classes and separated signers across training, validation, and
test partitions before computing features.

MS-ASL download and preprocessing utilities were explored as a possible data
extension, but MS-ASL was not used to train the published 25- or 50-class word
models. Keeping that distinction explicit prevents an experimental data path
from being mistaken for model provenance.

The preserved notebooks and exported results show this progression:

1. a 15-word recurrent baseline;
2. a 25-word hand-landmark BiGRU;
3. a 25-word holistic 321D BiGRU;
4. attention pooling with focal loss, mixup, and stronger augmentation;
5. feature-set and sequence-length ablations;
6. 50-word recurrent and Transformer comparisons; and
7. a separate raw-video experiment that did not produce the deployed model.

### Feature ablation

| Representation | Dimension | Recorded test macro-F1 |
|---|---:|---:|
| Raw landmarks | 321D | 0.581 |
| Pairwise + dominant hand | 444D | 0.671 |
| Hand shape | 72D | 0.613 |
| Shape + motion | 132D | 0.621 |
| Compact | 168D | 0.699 |
| Full engineered set | 519D | 0.639 |

The largest feature vector was not the best. The 168D representation retained
dominant-hand geometry, shape, hand-to-body relations, and motion while
avoiding part of the noise and deployment cost of the 519D set. This was a
practical reminder that more engineered variables can increase redundancy and
overfitting rather than information.

### Sequence strategy

| Strategy | Recorded test macro-F1 |
|---|---:|
| Fixed 30 frames | 0.699 |
| 45 frames with padding mask | 0.700 |
| Motion-focused variant | 0.694 |

The numerical difference was small. The 45-frame masked representation was
chosen because it expresses variable valid length explicitly and matches the
final ONNX contract.

### Model comparison

| Model | Parameters | Recorded test macro-F1 |
|---|---:|---:|
| SmallGRU | 104,627 | 0.682 |
| BiGRU | 602,739 | 0.700 |
| ConvGRU | 338,259 | 0.702 |
| SignTransformer | 446,195 | 0.719 |
| Two-model ensemble | 1,048,934 | 0.733 |

The ensemble scored slightly higher but doubled the footprint and complicated
browser deployment. The single SignTransformer was selected as the better
performance/complexity tradeoff. The final export records 71.92% accuracy,
0.714 macro-F1, and 0.803 best validation F1 on its signer-independent setup.

## Phase 3: browser application

The product moved from a local desktop GUI to `asl-web/`, a static
HTML/CSS/JavaScript application. MediaPipe extracts landmarks, and ONNX Runtime
Web performs inference in the browser. Python remains in training, validation,
and fixture-export workflows but is not part of the deployed request path.

This direction matches the intended strengths of
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/): client-side
inference can reduce server dependency and keep inference inputs on the device.
The tradeoffs are model-download size, browser compatibility, device limits,
and careful reproduction of preprocessing in JavaScript.

Landmark input was selected instead of a large raw-pixel video model. The
[MediaPipe framework](https://arxiv.org/abs/1906.08172) was designed for
cross-platform perception pipelines, and
[MediaPipe Hands](https://arxiv.org/abs/2006.10214) provides an on-device palm
detector plus hand-landmark model. Landmarks make the web model smaller and the
features inspectable, but MediaPipe errors become part of total system error.

## Why letter mode became the primary feature

The letter metadata reports 99.35% accuracy on a held-out landmark set for 24
static classes. The browser reproduces the ordered 93D feature pipeline and
uses a probability-tensor ONNX export.

That score should not be read as universal live accuracy. Still, the task is
fundamentally narrower than word recognition: one hand pose is classified
without temporal alignment, padding, face/pose visibility, sequence-level
dominant-hand selection, or motion history. In real use, letter mode proved the
more dependable and understandable product surface.

Word mode remains useful as an experiment and limitation-aware result viewer.
The UI shows top-3 alternatives, confusion hints, and requires explicit user
acceptance. It is not presented as a reliable translator.

## Problems that changed the design

### Feature parity across Python and JavaScript

The most dangerous integration bugs were not shape errors. A `(1, 45, 168)`
tensor can still be wrong if the feature order, normalization, hand choice, or
motion state differs from training. Python-to-JavaScript parity fixtures were
therefore added for both pipelines. The useful rule is simple: write the parity
test before changing runtime preprocessing.

### Dominant hand must be a sequence decision

The notebook chooses the hand with better visibility across the complete
recording. An early browser path could choose independently per frame, causing
the hand source and motion values to switch. The final path buffers normalized
321D frames and constructs the 168D sequence only after recording finishes.

### Missing shoulders need the same fallback

The notebook falls back to nonzero min-max normalization when shoulders are not
usable. Returning an unnormalized frame in JavaScript created a quiet domain
shift. Matching the fallback removed this known parity gap.

### Mask semantics are easy to invert twice

The browser input uses `true` for real frames and `false` for padding. The ONNX
graph performs its own attention-mask inversion. Reversing the values again in
JavaScript would produce a valid tensor with invalid attention behavior.

### ONNX output structure matters

The first LightGBM export used ZipMap, producing a sequence of maps that ONNX
Runtime Web could not read reliably. The active export disables ZipMap and
returns a plain `(N, 24)` probability tensor. This was a deployment-contract
problem, not a model-accuracy problem.

### Recording state must be fully reset

Frame buffers, normalized frames, motion history, mask state, animation-frame
handles, and user messages all cross recording boundaries. Partial resets made
later predictions depend on earlier attempts. The final lifecycle resets state
on start, finish, retry, mode change, and camera stop.

### Calibration does not solve ambiguity

Temperature scaling changed the recorded word ECE only marginally. It did not
turn a low-margin live prediction into a trustworthy result. The product
response was to expose alternatives and require user confirmation rather than
hide uncertainty behind a threshold.

## Approaches not used in the final runtime

| Approach | Reason |
|---|---|
| 15-word and early 25-word recurrent models | Superseded by later experiments. The final 25-word V4 checkpoint remains only for the desktop prototype. |
| 507D experimental Python pipeline | Feature and label contracts do not match the deployed 168D model. |
| Two-model ensemble | Better experiment score but larger and more complex for the web target. |
| Raw-video classifier | Did not produce the active artifact or a browser integration. |
| J/Z recognition | Not implemented; no trained or deployed J/Z model is included. Configuration and an experimental training utility remain reserved for possible future work. |
| React and standalone mockups | Design experiments; the maintained app uses plain HTML, CSS, and JavaScript. |
| ZipMap letter ONNX | Browser output compatibility was unreliable. |

Keeping unsuccessful paths documented is useful when the reason is evidence,
not nostalgia. The historical implementations themselves are not required in
the public runtime.

## Transferable lessons

1. **Define the task before comparing metrics.** Static letters, isolated
   signs, and continuous translation are different research problems.
2. **Split by signer when generalization matters.** Random sample splits can
   reward signer-specific cues.
3. **Treat preprocessing as part of the model.** Feature order, normalization,
   handedness, padding, and motion state belong to the inference contract.
4. **Measure deployment constraints during model selection.** The highest
   offline score may not justify twice the model size or runtime complexity.
5. **Keep fixtures separate from evaluation.** A deterministic sample proves
   serialization and inference repeatability, not generalization.
6. **Report domain shift honestly.** Landmark quality, camera setup, signing
   speed, and user variation can dominate live behavior.
7. **Design uncertainty into the product.** Top-3 display and explicit
   acceptance are safer than automatic output for a weak live classifier.

## What this project contributes

The project does not introduce a new sign-recognition architecture or dataset.
Its reusable contribution is a compact reference implementation and a set of
engineering findings:

- two task-specific browser pipelines under one interface;
- explicit Python/JavaScript feature-parity checks;
- source-to-deploy artifact provenance and ONNX contract validation;
- versioned feature fixtures for deterministic browser inference;
- documented failure cases in handedness, missing landmarks, masks, ZipMap,
  and recording state; and
- product language that distinguishes a strong static-letter path from an
  experimental isolated-word path.

These practices are relevant to other landmark-based, client-side perception
projects even when their language, vocabulary, or model differs.

## Limitations and responsible interpretation

- The project recognizes a small, predefined vocabulary and does not model ASL
  grammar or continuous signing.
- J and Z are not supported, and no trained or deployed model for them is
  included. The current letter task contains 24 static classes only.
- Neither model has a learned `unknown/no-sign` class.
- Letter and word metrics come from different datasets and cannot be compared
  as a head-to-head model result.
- Live word behavior is not reliable enough for accessibility-critical use.
- Dataset and sign variants can reflect collection choices; evaluation on one
  variant does not establish linguistic coverage.
- The system should be described as a learning and engineering prototype, not
  as a replacement for interpreters or a general communication aid.

## Reproducing the evidence

The current claims can be traced to:

- `models/letter/letter_model_meta.json`;
- `notebooks/word_50_training.ipynb`;
- `notebooks/word_50_training_results.ipynb`;
- `notebooks/word_25_desktop_training.ipynb`;
- `models/word/README.md`;
- `notebooks/word_50_results/all_experiment_results.json`;
- `notebooks/word_50_results/classification_report.txt`;
- `notebooks/word_50_results/manifest.json`;
- `tests/validation/`; and
- `scripts/validation/check_runtime_assets.py` and
  `scripts/validation/verify_project_assets.py`.

Run `make health` for repository-level validation. A real browser/camera check
is still required for live behavior.

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
