# ASL Assistant

ASL Assistant is a browser-based project for recognizing American Sign
Language fingerspelling and selected isolated signs. The application performs landmark
extraction and ONNX inference in the browser; it has no application backend and
does not upload camera frames.

[Live demo](https://asl-assistant.netlify.app/#letter) · [Getting started](docs/getting-started.md) · [Türkçe](README.tr.md) · [Documentation](docs/README.md)

## What it includes

| Mode | Purpose |
|---|---|
| Letter translation | Recognizes the project's 24 supported static letter classes and builds text. |
| Learning coach | Lets the user practise a selected letter or word and records local progress. |
| Word practice | Runs a 50-class isolated-sign model and shows top-3 results. This is an experimental feature. |
| Model Test | Runs deterministic JSON fixtures directly through the browser ONNX models. |
| QR Demo | Opens the hosted letter, word, or model-test view on another device. |

The letter experience is the primary product. Word recognition is presented as
a limited research demo because live performance is sensitive to signer,
framing, motion speed, lighting, and landmark quality.

## Quick start

No build step is required:

```bash
cd asl-web
python3 -m http.server 8080
```

Open <http://localhost:8080>. Camera access works on `localhost` or an HTTPS
origin; a plain HTTP LAN address is normally rejected by browsers.

Use **Offline test** for a camera-independent smoke test. The bundled word
fixture should return `give` with approximately `0.0760` confidence. This is a
runtime regression fixture, not an accuracy benchmark.

## Model summary

| Pipeline | Letter model | Word model |
|---|---|---|
| Task | Static handshape classification | Isolated sign sequence classification |
| Model | LightGBM | SignTransformer encoder |
| Classes | 24 | 50 |
| Input | 93 engineered features | 45 × 168 features + padding mask |
| Reported test metric | 99.35% held-out accuracy | 71.92% accuracy; 0.714 macro-F1 |
| Runtime | ONNX Runtime Web | ONNX Runtime Web |

The two results are not directly comparable: they use different tasks,
datasets, split strategies, and feature pipelines. The letter score describes
held-out landmark data and should not be interpreted as guaranteed live-camera
accuracy. Its held-out rows were drawn at random from the merged images, not
from separate signers, so near-identical frames of the same person can sit on
both sides of the split; the figure likely overstates accuracy for a new
signer. The word split is signer-independent.

## Development overview

The first working application was a Python desktop prototype with the static
letter model and a 25-word BiGRU+Attention pipeline. The project later moved to
a distributable static web application and expanded the word experiments to 50
classes. Feature ablations, sequence-length comparisons, and recurrent versus
Transformer model comparisons led to the current 45 × 168 SignTransformer
export.

The desktop code remains available as a legacy prototype, while the browser app
is the maintained product. The letter mode is the primary feature because its
static-pose pipeline is substantially more reliable in live use. The 50-word
mode is retained as an experimental, top-3-assisted result viewer rather than a
fully reliable translator. See the [project journey](docs/project-journey.md)
for the code-backed timeline, unused approaches, results, and major fixes.

## Runtime architecture

```text
Camera or JSON fixture
  -> MediaPipe landmarks
  -> feature engineering
       letter: 21 hand landmarks -> 93D
       word:   321D holistic frame -> 168D x 45
  -> ONNX Runtime Web (WASM)
  -> smoothing, thresholds, top-3, feedback
  -> text and optional speech
```

The web application is plain HTML, CSS, and JavaScript. It loads ONNX Runtime,
MediaPipe Tasks Vision, and the QR helper from CDNs, so first load requires
network access even though inference and camera processing stay on-device.

## Repository layout

```text
asl-web/       Self-contained browser application and deploy artifacts
asl-ml/        Shared Python ML contracts, features, and data helpers
asl-desktop/   Legacy desktop prototype and its runtime configuration
data/          Local dataset workspace; raw/generated data is ignored
models/        Curated letter and word model artifacts
notebooks/     Word-model training records, metrics, and figures
scripts/       Data preparation, training, evaluation, and validation tools
tests/         Python, repository, web-contract, and parity checks
docs/          Maintained usage and technical documentation
```

`asl-web/` does not import the Python packages. Python is used for training,
validation, fixture export, tests, and the desktop prototype.

## Choose a setup

### Web only

The maintained application is static. It does not need the Python ML packages
or a Node package install:

```bash
make web
```

Open <http://localhost:8080>. Use localhost or HTTPS for camera access.

### Recommended Conda environment

The public environment uses Python 3.12, Node 24, and an isolated environment
named `asl-assistant`:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

The name is a public default, not a Makefile requirement. `make setup` can
repair or refresh dependencies inside any active, non-base Conda environment.

### Alternative `venv`

Create a Python 3.12 virtual environment, activate it, install Node 24
separately, and then run the guarded setup command:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
make doctor
make setup
make health
```

On Windows PowerShell, activate with `.\.venv\Scripts\Activate.ps1`. See the
[getting-started guide](docs/getting-started.md) for platform notes and direct
commands.

Common commands:

```bash
make web             # serve asl-web/ on port 8080
make health          # full routine safety gate
make validate        # runtime assets, hashes, ONNX contracts, smoke fixture
make test            # fast Python and repository tests
make js-test         # browser module contracts, via node --test
make git-hygiene     # fail if ignored/local-only files are tracked
```

### Optional: browser type checking

The browser sources carry JSDoc type contracts. They can be checked with
TypeScript in no-emit mode, which reports problems without producing any
JavaScript:

```bash
npm ci               # project-local, development-only
make js-typecheck    # checkJs over asl-web/js, no emit
```

This is the only command that needs a package install. Running the app, serving
it, and `make health` all work without one, and the deployed sources stay the
`.js` files the browser loads directly.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Turkish getting-started guide](docs/getting-started.tr.md)
- [Architecture](docs/architecture.md)
- [Models and data](docs/models-and-data.md)
- [Project journey and research notes](docs/project-journey.md)
- [Dataset sources and publication boundary](data/README.md)

## Known limitations

- J and Z are not supported. No trained or deployed J/Z model is included.
- There is no explicit no-sign/unknown training class; thresholds only provide
  a practical rejection mechanism.
- The word model supports isolated signs, not continuous ASL translation.
- Live word confidence is often much lower than offline test performance.
- A word recording has no time limit or cancel button. It counts only frames
  in which the hand, face, and shoulders are all visible, so if one of them
  stays out of view it waits until the camera is stopped or the mode changes.
- Automated browser checks run in headless desktop Chrome with a simulated
  camera. The app has not yet been tested on iOS Safari or Android Chrome.
- MediaPipe and ONNX browser dependencies are currently CDN-hosted.
- The bundled Model Test fixtures demonstrate deterministic inference; they are
  not the official complete held-out evaluation set.

## Data and attribution

The word model was trained in Kaggle on a 50-class subset of the
[Google Isolated Sign Language Recognition competition](https://www.kaggle.com/competitions/asl-signs)
data. The letter model was trained locally after combining landmark extractions
from three ASL alphabet image sources. Raw datasets are intentionally not
committed. Dataset roles, split sizes, environments, exclusions, and source
links are documented in [Models and data](docs/models-and-data.md#training-data-and-environments).

| Model | Source | Terms |
|---|---|---|
| Letters | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), Akash Nagaraj, 2018, [doi:10.34740/KAGGLE/DSV/29550](https://doi.org/10.34740/KAGGLE/DSV/29550) | GPL-2.0, as labelled by the provider |
| Letters | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset), Ayush Thakur | CC0 1.0 |
| Letters | A local `ASL_SemCom` image subset associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) (1,580 of 54,961 landmark rows) | Not recorded; the images are not redistributed |
| Words | [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) competition data (Kaggle, 2023), provided by the Deaf Professional Arts Network and the Georgia Institute of Technology | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), subject to the competition rules |

Changes made to the data: letter images were reduced to MediaPipe hand
landmarks and then to 93 engineered features; for words, 50 of the 250 signs
were selected and each landmark sequence was resampled to 45 frames of 168
features. The published models contain the learned parameters only, not the
images, recordings, or landmark tables.

The competition rules forbid redistributing its data, so the Model Test word
fixtures exported from it stay local
([details](docs/models-and-data.md#model-test-fixture-contract)); the published
word fixture is synthetic.

The browser loads these runtimes from public CDNs; they are not redistributed
here: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22.0 (MIT),
[MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) 0.10.18
(Apache-2.0) with Google's hand, pose, and face landmarker models, and
[kjua](https://github.com/lrsjng/kjua) 0.9.0 (MIT) for the QR view. The sign
video links in `asl-web/data/asl_video_links.json` point to third-party YouTube
videos, which belong to their creators.

## Licensing

The source is available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Personal, educational, and
research use are allowed; commercial use requires the copyright holder's
permission. The training datasets keep their own terms, recorded in
[Models and data](docs/models-and-data.md).

The trained model files in `asl-web/models/` and `models/` are released under
the same licence and are treated as part of the software; the terms of their
training data, listed above, also apply. This project makes no claim either way
about whether a dataset's licence, such as the GPL-2.0 label on the main letter
source, carries over to weights trained on it. If your use needs certainty,
check the source terms or train your own model with the scripts here. The
`.pkl` and `.pt` files are Python pickles: load them only from a copy you trust.

The displayed reference artwork was created for this project rather than
sourced from a third-party stock library.
