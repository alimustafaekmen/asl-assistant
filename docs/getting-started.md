# Getting started

The product is the static web app in `asl-web/`. Run every command from the
repository root.

## Run the app

```bash
make web            # http://localhost:8080; another port: make web PORT=8081
```

`make web` uses Python's built-in `http.server`, so nothing needs installing;
any static file server works. Open the page over `http://localhost`, not as a
`file://` page: the app fetches its models and data. The camera works only on
`localhost` or HTTPS, so on a phone use <https://asl-assistant.pages.dev/>. The
first visit needs a network connection, because ONNX Runtime and MediaPipe come
from public CDNs.

The page opens in English or Turkish after the browser's language. Without a
camera, **Watch the demo** on the letter screen plays a recorded hand through
the letter model. Model Test, at `#test`, runs the bundled samples; the one
word sample is synthetic and should read `give` at 7.6%, which checks the
pipeline, not accuracy.

## Set up for development

You need Python 3.12 and Node 24.

**Conda.** `environment.yml` installs Python, Node, the OpenMP runtime LightGBM
needs on macOS, the pinned packages and the two local packages:

```bash
conda env create -f environment.yml
conda activate asl-assistant
```

**venv.** Create and activate a Python 3.12 environment, then run `make setup`.
On macOS, LightGBM may also need `brew install libomp`.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
make setup
```

`make setup` installs `requirements.txt` and the local packages
`asl-features` and `asl-desktop` in editable mode. It refuses to install into
Conda's `base` environment, Apple's Command Line Tools Python, or an interpreter
outside the active environment; `make setup PYTHON=/path/to/python` picks the
interpreter. Then install TypeScript for the type check, once:

```bash
npm ci
```

## Make targets

| Target | What it does |
|---|---|
| `make help` | List the targets |
| `make setup` | Install the pinned dependencies and the local packages into the active environment |
| `make web` | Serve `asl-web/` at <http://localhost:8080> |
| `make format` | Format the Python sources with Ruff |
| `make test` | The Python and JavaScript tests and the Python/JavaScript parity checks |
| `make check` | Lint, format check, JavaScript syntax and type check, the runtime file check, then `make test`; run it before a commit |
| `make browser-check` | Checks in headless Chrome; `OFFLINE=1` skips the ones that load the CDNs, `UI_LANG=en` opens every page in English |

### Without make

Windows PowerShell and cmd have no `make`. Use WSL, or the commands directly:

| Instead of | Run |
|---|---|
| `make setup` | `python -m pip install -r requirements.txt`, then `python -m pip install --no-deps -e ./asl-features -e ./asl-desktop` |
| `make web` | `python -m http.server 8080 --directory asl-web` |
| `make format` | `python -m ruff format asl-desktop asl-features scripts tests` |
| `make test` | `python -m pytest tests/`, `npm test` and the three `tests/validation/check_*_parity.py` scripts |
| `make browser-check` | `npm run browser-check` |

The parts of `make check`: `python -m ruff check asl-desktop asl-features scripts tests`,
`python -m ruff format --check asl-desktop asl-features scripts tests`,
`npm run typecheck`, `python scripts/validation/check_runtime_assets.py`, and the
tests above.

## Desktop prototype

```bash
python asl-desktop/main.py
```

It needs a camera and a desktop session, and loads the models in
`models/letter/` and `models/word/desktop-25/`. See [asl-desktop](../asl-desktop/README.md).

## Training and data

The datasets are not in the repository. `data/` is a local workspace that Git
ignores, because its contents are large, generated or under other licences;
the scripts create its folders when they first write to them. The web app does
not read it, and the models hold learned parameters only.

```text
data/
├── raw/         downloaded images, videos and parquet subsets
├── processed/   generated landmark CSVs
└── reference/   local reference mappings
```

What trained the published models:

| Model | Source | Rows or recordings used | Terms |
|---|---|---:|---|
| Letters | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) | 52,419 | GPL-2.0, as labelled |
| Letters | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset) | 962 | CC0 |
| Letters | `ASL_SemCom` images associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | 1,580 | Not recorded |
| Words | [Google Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) | 19,299 for the 50-word model | CC BY 4.0, subject to the competition rules |

The letter rows are landmarks extracted successfully, merged into 54,961 rows
and split into 46,716 for training and 8,245 held out. The raw-data layout and
the `ASL_SemCom` terms are not recorded well enough to publish the images or to
promise a one-command rebuild. Explored but not used: MediaPipe Processed ASL
(no usable hands found), MS-ASL (download scripts only), and a small
competition subset in `data/raw/asl-signs-sample-subset/`, used only for Model
Test samples. Attribution is in the [README](../README.md#data-and-attribution).

Never commit raw images, videos, participant-level parquet files, generated
CSVs, Kaggle credentials or archives. Small reviewed JSON under `asl-web/data/`,
deterministic fixtures with no camera frames, and the model files `.gitignore`
allows are fine. Check each dataset's terms before you download, use or share
it.

[Data preparation](../scripts/README.md#data-preparation) and
[model training](../scripts/README.md#model-training) cover the letter
pipeline. The 50-word model is trained in `notebooks/word_50_training.ipynb`.

Real word samples for Model Test come from competition data that may not be
redistributed. [Fixtures and demo poses](../scripts/README.md#fixtures-and-demo-poses)
explains how to export them into the ignored `asl-web/data/model-test-samples/local/` folder.

## Hosting a copy

`asl-web/` is a static folder with no build step; any static host can serve
it. Before an upload:

1. Run `make check`, and `make browser-check` if Chrome is installed.
2. With `make web`, check by hand: the demo, Model Test, camera start and stop,
   adding a letter, a word recording.
3. Run `python scripts/validation/check_runtime_assets.py --deploy`. It fails
   on files the site must not ship: competition-derived samples, files Git
   ignores, hidden files and unknown file types.

Hosts that read `asl-web/_headers` (Cloudflare Pages, Netlify) send its
security headers, and `asl-web/404.html` answers unknown paths with a 404. The
camera needs HTTPS or `localhost`.

## Troubleshooting

- **No model loads.** Models load on first need: a camera or demo start, a word
  recording, a Model Test run. Check the Network panel for
  `models/letter_model.onnx.gz` and `models/word_model.onnx`, and that the CDNs
  are reachable.
- **The camera does not start.** Use `localhost` or HTTPS, close other apps
  that hold the camera, and check the browser and system permissions.
- **`make` is missing on macOS.** `xcode-select --install`; if it asks about
  the Xcode licence, run `sudo xcodebuild -license accept`.
- **Python cannot import `asl_features`.** Activate the right environment and
  run `make setup`.
- **pytest stops while collecting.** A package from `requirements.txt` is
  missing; `make setup` installs it.
- **TypeScript is missing.** Run `npm ci` once.
