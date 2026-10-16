# Getting Started

The browser application in `asl-web/` is the maintained product. It is a static
site with no backend, so running it needs only a file server. Python and Node
are needed for the checks, the development tools and the legacy desktop
prototype.

[Türkçe rehber](getting-started.tr.md)

## Run the web application

From the repository root:

```bash
make web
```

This serves `asl-web/` on <http://localhost:8080>. Use `make web PORT=8081` if
the port is busy. Without Make, any static file server works:

```bash
cd asl-web
python3 -m http.server 8080
```

Three things to know:

- Do not open `index.html` as a `file://` URL. The page fetches models and JSON
  files, and the browser blocks those requests.
- The camera needs `localhost` or HTTPS. To try the app on a phone, use the
  hosted demo or serve it over HTTPS; the phone cannot reach your computer's
  `localhost`.
- The first load needs a network connection: ONNX Runtime, the QR library and
  MediaPipe (code and landmark models) come from public CDNs. The models in
  `asl-web/models/` are fetched only when something needs them.

To check the runtime without a camera, open **Kamerasız dene** (`#test`),
choose **Kelime modeli** and press **Tümünü çalıştır**. The bundled word
fixture should come out as `give` with a confidence of about `0.0760`. That
confirms that the word model, labels, temperature, mask and browser inference
path agree. It is a regression check, not an accuracy measurement, and the
screen marks it so. The letter model runs its 24 fixtures the same way.

## Set up Python and Node

The checks, the validators and the desktop prototype need Python 3.12 and
Node 24. Pick one of the two setups below. The repository does not depend on
the name of your environment.

### Conda

`environment.yml` creates an isolated environment with Python 3.12, Node 24,
the OpenMP runtime LightGBM needs on macOS, the pinned requirements and both
local packages:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

`asl-assistant` is only the default name in `environment.yml`. You can also
activate an existing environment that is not `base` and run `make setup` in it.

### venv

Install Python 3.12 and Node 24, then:

```bash
python3.12 -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .\.venv\Scripts\Activate.ps1  # Windows PowerShell
make doctor
make setup
make health
```

`make setup` installs `requirements-dev.txt`, then installs `asl-ml` and
`asl-desktop` as editable packages without resolving their dependencies again.
The equivalent commands:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-ml
python -m pip install --no-deps -e ./asl-desktop
```

On macOS LightGBM needs an OpenMP runtime. The Conda definition includes
`llvm-openmp`; with `venv`, install it yourself if LightGBM fails to load.

### Environment safety

`make doctor` only reads: it reports the interpreter, the active environment,
the platform and the imports the project needs. `make setup` refuses to install
into:

- the shared Conda or Miniforge `base` environment;
- Apple's CommandLineTools Python;
- an interpreter that is not the active Conda environment or `venv`.

There is no override for the `base` check. If Make picks the wrong
interpreter, pass the right one:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Commands

| Command | Purpose |
|---|---|
| `make help` | List the targets. |
| `make doctor` | Inspect the active Python environment without changing it. |
| `make setup` | Install the pinned dependencies and the editable local packages. |
| `make web` | Serve `asl-web/` locally. |
| `make lint` | Ruff: Python syntax, names and import order. |
| `make format` / `make format-check` | Format the Python sources, or only check the formatting. |
| `make js-check` | Syntax-check every JavaScript file under `asl-web/js`. |
| `make js-test` | Run every web test (`tests/web/**/*.test.js` and `.test.mjs`) with `node --test`. |
| `make js-typecheck` | Check the JSDoc types with TypeScript, without emitting files. Needs `npm ci` once. |
| `make quick` | Lint, format check and web tests: the fastest loop, a few seconds. |
| `make test-web FILE=... NAME=...` | One web test file, optionally only the tests whose names match. |
| `make watch-web FILE=...` | Rerun web tests on every save. |
| `make test-py FILE=... K=...` | One pytest file, optionally filtered with `-k`. |
| `make health` | The gate after an edit: lint, formatting, JavaScript syntax and tests, Git hygiene, runtime assets, the project asset audit, the presence of the notebooks, models and result files, feature parity, and the fast Python tests. Needs no npm install. |
| `make check` | The gate before a commit: `make health` plus `make js-typecheck`. |
| `make browser-check` | Checks in a real headless Chrome that the Node tests cannot make: cascade layers, hidden elements, dark theme, horizontal overflow, camera release. `OFFLINE=1` skips the one check that loads the CDN libraries. Needs Chrome; exits 2 without it. |
| `make parity` | Word and letter feature parity between the Python code and the browser code. |
| `make validate` | Syntax-check the JavaScript, then check runtime assets: files, JSON schemas, fixtures, source-to-deploy hashes, ONNX inputs and outputs, and the offline word fixture. |
| `make validate-full` | `make validate` plus the project asset audit with its local dataset report. |
| `make deploy-check` | The step before every upload: `make validate` plus a list of every file in `asl-web/`; fails on anything the site does not ship. |
| `make git-hygiene` | Fail if a tracked file matches `.gitignore`. |
| `make notebook-check` | Check that the word-model notebooks, models, and result files are present. |
| `make test` | The fast Python tests: unit and repository contract tests. |
| `make test-full` | Every Python test, including the desktop integrations. It does not run the JavaScript tests, the validators or parity. |
| `make model-test-fixtures` | Optional: export Model Test fixtures from a downloaded Kaggle subset; stops with the download command when the subset is missing. |
| `make desktop` | Start the legacy desktop prototype. |
| `make clean` | Remove caches and `.DS_Store` files; data, models, notebooks and environments are kept. |

Node is a required validation dependency. `make js-check`, `make validate` and
`make health` stop with an error when it is missing instead of skipping the
JavaScript checks, and the parity commands exit 2.

`check_runtime_assets.py`, behind `make validate`, exits 0 when every contract
held, 1 when one failed, and 2 when it could not check: bad usage, or ONNX
Runtime cannot be imported. `--no-onnx` leaves the model step out on purpose.

### Without Make

`make` is not installed by default on Windows PowerShell or cmd. The checks
behind it are plain commands:

```bash
python scripts/validation/check_runtime_assets.py
python scripts/validation/verify_project_assets.py
python tests/validation/check_word_feature_parity.py
python tests/validation/check_letter_feature_parity.py
python -m pytest tests/
npm test                       # the web tests; needs Node only
```

The word parity check should end with:

```text
Summary: PASS=6, KNOWN_GAP=0, FAIL=0
```

These checks do not replace a test with a real browser, camera and signer.

## Desktop prototype

The CustomTkinter application is a historical prototype. It is not a backend
for the web application. It needs a graphical session, camera permission,
MediaPipe, PyTorch, LightGBM and the published desktop model files:

```bash
make setup
make desktop
```

Its word model is the older 25-class BiGRU with attention over 30 × 321
frames. Do not confuse it with the web application's 50-class, 45 × 168
SignTransformer. The [desktop README](../asl-desktop/README.md) has details.

## Export Model Test fixtures

The Model Test word samples come from the Kaggle Google Isolated Sign Language
Recognition competition data, whose rules forbid redistributing it. The raw
data therefore stays out of the repository, and so do the fixtures you export
from it. After accepting the competition rules and configuring Kaggle
credentials:

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

The export writes to `asl-web/data/model-test-samples/local/`, which Git
ignores. The Model Test screen lists those samples when the folder exists.
Remove the folder before you upload `asl-web/` anywhere; `make deploy-check`
fails while it is there. The samples check the browser inference path. They do
not reproduce the held-out evaluation.

## Static deployment

`asl-web/` is the deploy directory and has no build step. The host must serve
it over HTTPS so that phones can use the camera. The repository has no CI
workflow or Docker setup, because the web application needs only a static file
server.

The demo at <https://asl-assistant.netlify.app/> is deployed by hand, by
dragging a folder onto the Netlify deploy page:

1. Run `make check`, and `make browser-check` if Chrome is installed. Then
   verify by hand: model readiness, the offline fixture, camera start and stop,
   adding a letter, a word recording, and the `#letter`, `#word` and `#test`
   deep links.
2. Run `make deploy-check` and fix what it reports. An upload takes the folder
   as it is on disk, ignored files included, so the check lists every file
   under `asl-web/` and fails on any that the site does not ship:
   - the `asl-web/data/model-test-samples/local/` folder of competition-derived
     fixtures (move it out of `asl-web/`);
   - files that Git ignores;
   - hidden files such as `.DS_Store` (`make clean` removes those) or `.env`;
   - anything outside the allowlist in `scripts/validation/contracts.py`.

   `make validate` only warns about the `local/` folder, so local testing with
   it keeps working.
3. Drag this repository's own `asl-web/` folder onto the deploy page, not a
   copy of it, which may be out of date.
4. Check that the live site serves these exact files. Comparing `<script>` tags
   is not enough, because the `?v=` suffixes rarely change and a stale deploy
   can list the same tags. Compare content:

   ```bash
   for f in index.html js/core/app.js css/style.css css/components.css; do
     curl -s "https://asl-assistant.netlify.app/$f" | shasum -a 256
     shasum -a 256 "asl-web/$f"
   done
   ```

   Each pair of hashes must match.

Response headers come from `asl-web/_headers`, which Netlify reads from the
uploaded folder. The root `netlify.toml` is not part of a drag-and-drop upload;
it only selects the publish directory for Git-linked or CLI deploys.

## Troubleshooting

### Models do not load

No model is requested when the page opens, so the Network panel shows none
until something needs one: starting the camera, a word recording, or a Model
Test run. Letter mode loads the letter model, word mode the
word model, and the Learning Coach the letter model, adding the word model
only when it is switched to words.

Run `make validate`, trigger one of those, then read the browser's Network and
Console panels. The letter model arrives as `models/letter_model.onnx.gz` and
the word model as `models/word_model.onnx`. Each must return HTTP 200, and the
CDN files must be reachable. A request for `models/letter_model.onnx` means the
compressed copy could not be used; the Console says why, and the app falls back
to that uncompressed file, which must return 200 too.

### The camera permission is denied

Use `localhost` or HTTPS, close other applications that hold the camera, and
check the browser's and the operating system's camera permissions.

### Python cannot import `asl_ml` or `asl_desktop`

Activate the environment you meant to use, run `make doctor`, then `make
setup`. `python` and `python -m pip` must resolve to the same environment. If
`make health` stops while pytest collects tests with an import error, a package
from `requirements.txt` is missing in the active environment; `make setup`
installs all of them.

### LightGBM does not load on macOS

Use the Conda environment definition, or install an OpenMP runtime into the
active isolated environment. Do not install the project into Conda `base`.

## Related documents

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web application notes](../asl-web/README.md)
