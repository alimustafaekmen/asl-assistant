# Getting Started

<sub>Location: [`asl-assistant`](../README.md) / [`docs`](README.md) / `getting-started.md`</sub>

<sub>Related: [`asl-web/`](../asl-web/README.md) · [`docs/architecture.md`](architecture.md) · [`tests/`](../tests/README.md) · [Türkçe](getting-started.tr.md)</sub>

The product is the browser app in `asl-web/`: a static site with no backend
and no build step. The desktop app in `asl-desktop/` is an earlier prototype
that is kept working.

## Which path do you need?

| You want to | Follow | What you install |
|---|---|---|
| Try the app in your own browser | [Path 1: open the web app](#path-1-open-the-web-app) | Nothing. Python 3 or any static file server is enough. |
| Change the web app and run its checks | [Path 2: work on the web code](#path-2-work-on-the-web-code) | The Python environment, Node 24, and `npm ci` once |
| Run the desktop prototype, train a model or prepare data | [Path 3: desktop app, training and data](#path-3-desktop-app-training-and-data) | The Python environment |

Paths 2 and 3 share one Python environment. You set it up once, with `make
setup` or the Conda file, as [Set up the Python
environment](#set-up-the-python-environment) describes. Everything else is
specific to a path:

| Requirement | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| A browser with an internet connection | Yes | Yes | No |
| Python 3.12 environment (`make setup` or the Conda file) | No | Yes | Yes |
| Node 24 | No | Yes | Only for `make health` and `make parity` |
| `npm ci`, once | No | For the type check | No |
| Chrome or Chromium | No | For `make browser-check` | No |
| A camera | For the camera modes | For the camera modes | For the desktop app |
| A desktop session (a screen) | No | No | For the desktop app |
| Datasets you download yourself | No | No | For training and data preparation |

Run every command from the repository root. The commands use `make`, which
macOS and Linux provide. Windows PowerShell and cmd do not; [Without
Make](#without-make) gives the plain commands.

## Path 1: open the web app

`make web` serves `asl-web/` with `http.server` from Python's standard library,
so any Python 3 will do and no package needs installing.

1. Clone the repository, or download and unpack it, and open a terminal in its
   root folder.
2. Start the server:

   ```bash
   make web
   ```

   If port 8080 is busy, run `make web PORT=8081`. Without Make, any static
   file server works, for example:

   ```bash
   python3 -m http.server 8080 --directory asl-web
   ```

3. Open <http://localhost:8080>. The app starts on the letter screen. Its
   interface is in Turkish, so the steps below give each label as the app
   shows it.
4. Press **Kamerayı aç** (turn on the camera), allow the camera, then show a
   letter to it.
5. To see the app read letters without a camera, press **Örneği izleyin**
   (watch the example). A recorded hand spells FLY; add each letter with Space
   or **Ekle** (add) when the result shows it. The model reads these poses at
   100% because their photographs are in its training data, so
   the demo shows how the app works, not how accurate it is.
6. To check the models on stored inputs, open Model Test: go to `#test`, or
   follow **modeli örnek dosyalarla test edin (Model Test)** at the foot of
   the **Nasıl çalışır** (how it works) page. Press **Tümünü çalıştır** (run
   all). This runs the letter model on its 24 fixtures (stored test inputs)
   and counts how many come out right.
7. To check the word model, open **Başka model, başka örnek ya da kendi
   dosyanız** (another model, another sample or your own file) on the same
   screen, choose **Kelime modeli** (word model) and press **Tümünü
   çalıştır** again. The one bundled word fixture should come out as `give`
   with a confidence of 0.0760 (shown as %7,6), marked **Çalışma kontrolü**
   (pipeline check). The fixture is made-up input, so the run checks that the
   model, its labels, the mask and the browser inference agree; it says
   nothing about accuracy.

Stop the server with Ctrl+C.

Things to know:

- Do not open `index.html` as a `file://` page. The page fetches its models and
  JSON files, and the browser blocks those requests there.
- The camera works only on `localhost` or HTTPS. A phone cannot reach your
  computer's `localhost`; on a phone, use the hosted demo at
  <https://asl-assistant.netlify.app/> or serve the folder over HTTPS.
- The first load needs an internet connection. ONNX Runtime, the QR library and
  MediaPipe, with its hand, pose and face models, come from public CDNs. The
  app's own models in `asl-web/models/` download only when something needs
  them, such as starting the camera or the demo.

## Set up the Python environment

The project has a single Python dependency set, pinned in `requirements.txt`:

| Purpose | Packages |
|---|---|
| Data | numpy, pandas, pyarrow |
| Landmarks and images | opencv, pillow, mediapipe (with jax) |
| Letter models | scikit-learn, xgboost, lightgbm, joblib |
| Word models | torch, torchvision |
| Desktop app and speech | customtkinter, pyttsx3 |
| Figures | matplotlib, pyparsing, seaborn |
| Model checks | onnx, onnxruntime |
| Tests | pytest |

`requirements-dev.txt` is `requirements.txt` plus Ruff, the Python linter and
formatter. There is no separate requirements file for the web or the desktop
part. The web checks run Python tests and validators that import the desktop
and ML packages, so web work needs the same environment.

Use Python 3.12: the two local packages accept no other version. The
environment can have any name. Choose Conda or venv.

### Conda

`environment.yml` creates an environment with Python 3.12, Node 24 and
`llvm-openmp`, the OpenMP runtime that LightGBM needs on macOS. It then installs
`requirements-dev.txt` and the two local packages with pip, the same installs
that `make setup` runs, so you do not need to run `make setup` afterwards.

1. Create the environment:

   ```bash
   conda env create -f environment.yml
   ```

   It is named `asl-assistant`. Add `-n your-name` to choose another name.
2. Activate it:

   ```bash
   conda activate asl-assistant
   ```

3. Check it with `make doctor`. The report should list the project packages as
   installed.

An existing Conda environment other than `base` works too, if it has Python
3.12: activate it and run `make setup`.

### venv

1. Install Python 3.12, and Node 24 if you follow path 2.
2. Create and activate an environment in the repository root:

   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate       # macOS and Linux
   # py -3.12 -m venv .venv        # Windows: create
   # .\.venv\Scripts\Activate.ps1  # Windows PowerShell: activate
   ```

3. Run `make doctor`. Before setup it reports the project packages as missing;
   that is expected.
4. Run `make setup`.
5. Run `make doctor` again. It should now list the packages as installed.

On macOS LightGBM needs an OpenMP runtime. The Conda file includes one. In a
venv, install one yourself if LightGBM fails to load, for example with
Homebrew: `brew install libomp`.

### What `make setup` installs

`make setup` installs `requirements-dev.txt`, then registers the repository's
two Python packages, `asl-features` and `asl-desktop`, with your environment,
so `import asl_features` and `import asl_desktop` work from any folder. The
desktop app relies on this; the scripts and tests find the packages on their
own. `-e` (editable) links the environment to these folders instead of copying
them, so a change to the code takes effect without installing again.
`--no-deps` skips their dependencies, which the first command has already
installed at pinned versions. The equivalent commands:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-features
python -m pip install --no-deps -e ./asl-desktop
```

### Environment safety

`make doctor` only reads. It reports the interpreter, the active environment,
the platform and whether the imports the project needs work. It exits 0 when it
could describe the environment, even if something is missing, and 1 when a
package is installed but cannot be imported.

`make setup` refuses to install into:

- the shared Conda or Miniforge `base` environment;
- Apple's CommandLineTools Python;
- an interpreter outside the Conda environment or venv that is active.

There is no override for the `base` check. If Make picks the wrong
interpreter, pass the right one:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Path 2: work on the web code

The app is a set of plain `<script>` files under `asl-web/js/`. The browser
loads them as they are: there is no bundler and nothing to build. The checks
need more than the app does.

1. [Set up the Python environment](#set-up-the-python-environment).
2. Check that Node 24 is on your PATH with `node --version`. The Conda
   environment includes it; otherwise install the version that
   `.node-version` names.
3. Install the type checker once:

   ```bash
   npm ci
   ```

   This installs TypeScript, pinned in `package-lock.json`, into
   `node_modules/`. Only `make js-typecheck` and `make check` use it; the app
   and `make health` do not.
4. Run `make health` to confirm that everything passes before you change
   anything.
5. While you edit, use the short loops:

   ```bash
   make quick                                             # lint, format check, every web test
   make test-web FILE=tests/web/word-consent.test.js NAME=once
   make watch-web FILE=tests/web/word-consent.test.js     # reruns on every save
   ```

6. Look at the result in the browser with `make web`.
7. Before a commit, run `make check`: `make health` plus the type check.
8. After a change to `index.html` or the CSS, also run `make browser-check`. It
   needs Chrome or Chromium; if yours is not in a standard place, point to it:
   `CHROME=/path/to/chrome make browser-check`.

[Tests](../tests/README.md) explains what each layer of the suite covers, and
the [web application notes](../asl-web/README.md) describe the code.

## Path 3: desktop app, training and data

1. [Set up the Python environment](#set-up-the-python-environment), including
   the two local packages: the desktop app imports `asl_features` as an
   installed package.
2. Start the desktop app:

   ```bash
   make desktop
   ```

   It needs camera permission and a desktop session with a screen. It loads the
   tracked models in `models/letter/` and `models/word/desktop-25/`. Its word
   model is the older 25-class BiGRU with attention over 30 × 321 frames; do
   not confuse it with the web app's 50-class, 45 × 168 SignTransformer. The
   [desktop README](../asl-desktop/README.md) has the details.
3. Run the Python tests. `make test` runs the fast ones; `make test-full` runs
   every Python test, including the desktop integration tests, which need
   MediaPipe and a model file.
4. To train a model or prepare data, download the datasets yourself. None is in
   the repository, and some have terms that forbid redistributing them. Put
   them under `data/raw/`; Git ignores `data/raw/` and `data/processed/`.
   - The letter model: `./scripts/data_preparation/run_static_letter_extraction.sh`
     turns the ASL Alphabet images into landmark tables, then
     `python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison`
     trains and compares the models. The trainer overwrites the tracked files
     in `models/letter/` (`git restore models/letter` undoes a trial run). It
     does not export ONNX, so the browser app does not change.
   - The 50-word web model is trained in `notebooks/word_50_training.ipynb`,
     not by a script.
   - Two download steps need a tool that `requirements.txt` does not include:
     the Kaggle command-line tool for the Kaggle subset below, and `yt-dlp`
     for the experimental MS-ASL download.

   [Data preparation](../scripts/data_preparation/README.md), [model
   training](../scripts/model_training/README.md), the [data
   manifest](../data/README.md) and [Models and data](models-and-data.md)
   describe the inputs, the outputs and what can be rebuilt.

### Export Model Test fixtures

The Model Test screen ships with one made-up word fixture. Real word samples
come from the Kaggle Google Isolated Sign Language Recognition competition
data, whose rules forbid redistributing it, so neither the data nor the
fixtures exported from it are in the repository. To add them to your own copy:

1. Accept the competition rules on Kaggle, in the browser.
2. Install the Kaggle command-line tool (`pip install kaggle`) and set up its
   credentials in `~/.kaggle/kaggle.json`.
3. Download a small subset, one sample per word:

   ```bash
   python scripts/evaluation/download_kaggle_sample_subset.py \
     --output data/raw/asl-signs-sample-subset \
     --samples-per-word 1
   ```

4. Export the fixtures:

   ```bash
   make model-test-fixtures
   ```

   This runs `scripts/evaluation/export_model_test_word_samples.py` on
   `data/raw/asl-signs-sample-subset`. `KAGGLE_DIR=...` and
   `SAMPLES_PER_WORD=...` change the folder and the count.

The export writes to `asl-web/data/model-test-samples/local/`, which Git
ignores, and the Model Test screen lists those samples when the folder exists.
They check the browser inference path; they do not reproduce the held-out
evaluation. Remove the folder before you upload `asl-web/` anywhere, as
[Static deployment](#static-deployment) describes.

## Commands

`make help` lists the same targets in the same order. The last column says
what must be in place besides `make`; "Python env" means the environment from
[Set up the Python environment](#set-up-the-python-environment). Add
`PYTHON=/path/to/python` to any target to use another interpreter.

| Command | What it does | Needs |
|---|---|---|
| `make help` | List the targets. | Nothing |
| `make doctor` | Describe the active Python environment and the imports the project needs, without changing anything. | Any Python |
| `make setup` | Install `requirements-dev.txt` and the two local packages into the active environment. | An activated Python 3.12 environment, not `base` |
| `make web` | Serve `asl-web/` at <http://localhost:8080>; `PORT=8081` changes the port. | Python 3 |
| `make health` | The gate after an edit; [Tests](../tests/README.md#what-each-gate-runs) lists its steps. | Python env, Node |
| `make quick` | Lint, format check and every web test: the fastest loop. | Python env, Node |
| `make test` | The fast Python tests: `tests/asl_features`, `tests/asl_desktop/unit`, `tests/project`, `tests/scripts`. | Python env |
| `make test-full` | Every Python test, the desktop integration tests included. It does not run the web tests, the validators or parity. | Python env |
| `make test-py FILE=... K=...` | One pytest file, optionally filtered with `-k`. Without `FILE`, the tests of `make test`. | Python env |
| `make js-test` | Every web test (`tests/web/**/*.test.js` and `.test.mjs`) with `node --test`. | Node |
| `make test-web FILE=... NAME=...` | One web test file, optionally only the tests whose names match. | Node |
| `make watch-web FILE=...` | The same, rerun on every save. | Node |
| `make format` | Format the Python sources with Ruff. | Python env |
| `make desktop` | Start the desktop prototype. | Python env, a camera, a screen |
| `make lint` | Ruff: syntax, names and import order in `asl-desktop`, `asl-features`, `scripts` and `tests`. | Python env |
| `make format-check` | Check the Python formatting without changing it. | Python env |
| `make js-check` | Syntax-check every JavaScript file under `asl-web/js`. | Node |
| `make js-typecheck` | Check the JSDoc types with TypeScript, without emitting files. | Node, `npm ci` |
| `make parity` | Word and letter feature parity between the Python code and the browser code. | Python env, Node |
| `make validate` | JavaScript syntax, then the runtime asset check: files, JSON schemas, fixtures, source-to-deploy hashes, ONNX inputs and outputs, and the offline word fixture. | Python env, Node |
| `make validate-full` | `make validate` plus the project asset audit with its local dataset report. Missing datasets are reported, not failed. | Python env, Node |
| `make notebook-check` | Check that the word-model notebooks, models and result files are present. | Nothing |
| `make git-hygiene` | Fail if a tracked file matches `.gitignore`. | Git |
| `make check` | The gate before a commit: `make health` plus `make js-typecheck`. | Python env, Node, `npm ci` |
| `make browser-check` | Checks in a real headless Chrome that the Node tests cannot make: cascade layers, hidden elements, mode-only controls, reduced motion, the dark theme, horizontal overflow, camera release and the camera-free demo. `OFFLINE=1` skips the two checks that load the CDN libraries. | Node, Chrome or Chromium |
| `make deploy-check` | The step before every upload: JavaScript syntax, the runtime asset check and a list of every file in `asl-web/`. Fails on any file the site does not ship. | Python env, Node |
| `make model-test-fixtures` | Optional: export Model Test word fixtures from a downloaded Kaggle subset. Without the subset it prints the download command and stops. | Python env, the Kaggle subset |
| `make clean` | Remove caches (`__pycache__`, `.pytest_cache`, `*.egg-info`, `*.pyc`) and `.DS_Store` files. Data, models, notebooks and environments are kept. | Nothing |

### Exit codes

The validators, the parity checks and the browser checks share one rule: they
exit 0 when every check held, 1 when one failed, and 2 when they could not
check at all, because of bad usage or a missing tool. Exit 2 means, for
example, that Node is missing for parity, that ONNX Runtime cannot be imported
for `check_runtime_assets.py`, or that no Chrome was found for `make
browser-check`. `--no-onnx` leaves the model step of `check_runtime_assets.py`
out on purpose. The [scripts README](../scripts/README.md#exit-codes) lists the
exceptions.

### Without Make

Windows PowerShell and cmd have no `make`. Use WSL, or run the commands behind
the targets directly:

| Instead of | Run |
|---|---|
| `make setup` | the three commands in [What `make setup` installs](#what-make-setup-installs) |
| `make web` | `python -m http.server 8080 --directory asl-web` |
| `make lint` | `python -m ruff check asl-desktop asl-features scripts tests` |
| `make format-check` | `python -m ruff format --check asl-desktop asl-features scripts tests` |
| `make js-test` | `npm test` |
| `make js-typecheck` | `npm run typecheck` |
| `make browser-check` | `npm run browser-check`, or `node tests/browser/run.mjs --offline` for `OFFLINE=1` |
| `make parity` | `python tests/validation/check_word_feature_parity.py`, then `python tests/validation/check_letter_feature_parity.py` |
| `make validate` | `python scripts/validation/check_runtime_assets.py` |
| `make deploy-check` | `python scripts/validation/check_runtime_assets.py --deploy` |
| `make validate-full` | the `make validate` command, then `python scripts/validation/verify_project_assets.py` |
| `make test` | `python -m pytest -rs tests/asl_features tests/asl_desktop/unit tests/project tests/scripts` |
| `make test-full` | `python -m pytest -rs tests/` |
| `make desktop` | `python asl-desktop/main.py` |

`make validate` and `make deploy-check` also run `node --check` on every file
under `asl-web/js`, which the plain commands leave out.

The word parity check should end with:

```text
Summary: PASS=6, KNOWN_GAP=0, FAIL=0
```

None of these checks replaces a test with a real browser, a camera and a
person signing.

## Static deployment

`asl-web/` is the deploy folder, and it has no build step. Any static host
works, but it must serve the site over HTTPS so that phones can use the camera.
The repository has no CI workflow or Docker setup, because a static file server
is all the app needs.

The demo at <https://asl-assistant.netlify.app/> is deployed by hand, by
dragging the folder onto Netlify's deploy page. An upload takes the folder
exactly as it is on disk, ignored files included, so the steps clean it first:

1. Run `make check`, and `make browser-check` if Chrome is installed.
2. Serve the app with `make web` and check by hand: model readiness, the
   camera-free demo, the offline fixtures on `#test`, camera start and stop,
   adding a letter, a word recording, and the `#letter`, `#word` and `#test`
   deep links (the QR screen links to the first two).
3. If `asl-web/data/model-test-samples/local/` exists, move it out of
   `asl-web/` or delete it; `make model-test-fixtures` can export it again. It
   holds the competition-derived fixtures, which must not be published. `make
   validate` only warns about this folder, so local testing with it keeps
   working, but `make deploy-check` fails.
4. Run `make clean` to remove `.DS_Store` files and caches.
5. Run `make deploy-check` and fix what it reports. It lists every file under
   `asl-web/` and fails on:
   - the `asl-web/data/model-test-samples/local/` folder;
   - files that Git ignores;
   - hidden files such as `.DS_Store` or `.env`;
   - anything outside the allowlist in `scripts/validation/contracts.py`.
6. Drag this repository's own `asl-web/` folder onto the site's deploy page in
   Netlify. Do not drag a copy of it, which may be out of date.
7. Check that the live site serves these exact files. Comparing `<script>` tags
   is not enough: the `?v=` suffixes rarely change, so a stale deploy can list
   the same tags. Compare the content:

   ```bash
   for f in index.html js/core/app.js css/style.css css/components.css; do
     curl -s "https://asl-assistant.netlify.app/$f" | shasum -a 256
     shasum -a 256 "asl-web/$f"
   done
   ```

   Each pair of hashes must match.

Response headers come from `asl-web/_headers`, which Netlify reads from the
uploaded folder. The root `netlify.toml` is not part of a drag-and-drop upload;
it only selects the publish folder for Git-linked or command-line deploys.

## Troubleshooting

### Models do not load

No model is requested when the page opens, so the browser's Network panel shows
none until something needs one: starting the camera or the demo, a word
recording, or a Model Test run. Letter mode and the demo load the letter
model, and word mode the word model. The Learning Coach loads the letter model, and the word model only when
it is switched to words.

Run `make validate`, trigger one of those, then read the browser's Network and
Console panels. The letter model arrives as `models/letter_model.onnx.gz` and
the word model as `models/word_model.onnx`. Each must return HTTP 200, and the
CDN files must be reachable. A request for `models/letter_model.onnx` means the
compressed copy could not be used; the Console says why, and the app falls back
to that uncompressed file, which must return 200 too.

### The camera does not start

Check that the page comes from `localhost` or HTTPS, close other applications
that hold the camera, and check the camera permissions in the browser and in
the operating system.

### `make` is missing or refuses to run

On Windows, use WSL or the commands in [Without Make](#without-make). On macOS,
`xcode-select --install` installs the Command Line Tools, which include `make`.
If `make` stops with a message about the Xcode licence, accept it once with
`sudo xcodebuild -license accept`.

### `make setup` refuses to install

The message names the reason and the fix. Activate an isolated environment
that is not `base`, or pass the right interpreter with `PYTHON=...`, as
[Environment safety](#environment-safety) shows.

### Python cannot import `asl_features` or `asl_desktop`

Activate the environment you meant to use, run `make doctor`, then `make
setup`. `python` and `python -m pip` must resolve to the same environment.

### `make health` stops while pytest collects tests

An import error during collection means a package from `requirements.txt` is
missing in the active environment, and then no test runs at all. `make setup`
installs all of them.

### Node or TypeScript is missing

Without Node, `make js-check`, `make validate` and `make health` stop with an
error instead of skipping the JavaScript checks. Install Node 24 or activate
the Conda environment, which includes it. If `make js-typecheck` says
TypeScript is not installed, run `npm ci` once.

## Related documents

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web application notes](../asl-web/README.md)
- [Desktop app](../asl-desktop/README.md)
- [Tests](../tests/README.md)
- [Scripts](../scripts/README.md)
