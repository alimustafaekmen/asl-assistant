# Getting Started

The browser application is the maintained product. It is a static site with no
application backend, and ordinary web use does not require the Python ML
environment. Python and Node are needed for repository validation, development
tools, and the legacy desktop prototype.

[Türkçe rehber](getting-started.tr.md)

## Web-only use

From the repository root:

```bash
make web
```

Equivalent command:

```bash
cd asl-web
python3 -m http.server 8080
```

Open <http://localhost:8080>. Use `make web PORT=8081` if the default port is
busy. Any simple static HTTP server is suitable; the Python ML dependencies are
not involved.

Do not open `index.html` through `file://`, because model and JSON requests will
be blocked. Camera access requires `localhost` or HTTPS. The first load also
needs network access for the CDN-hosted ONNX Runtime, MediaPipe, QR helper, and
MediaPipe task assets.

Use **Offline test** for a camera-independent runtime check. The bundled word
fixture should produce `give` at approximately `0.0760` confidence. It checks
the serialized inference path and is not an accuracy benchmark.

## Recommended Conda setup

The committed environment definition creates an isolated environment with
Python 3.12, Node 24, the macOS LightGBM OpenMP runtime, pinned project
requirements, and both local packages:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

`asl-assistant` is the public default name in `environment.yml`; Make does not
depend on that name. An existing non-base Conda environment can instead be
activated and prepared with `make setup`.

## Alternative `venv` setup

Install Python 3.12 and Node 24, then run:

```bash
python3.12 -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .\.venv\Scripts\Activate.ps1  # Windows PowerShell
make doctor
make setup
make health
```

`make setup` installs the pinned development requirements, then installs both
local packages as editable packages without re-resolving their dependencies.
The equivalent direct commands are:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-ml
python -m pip install --no-deps -e ./asl-desktop
```

On macOS, LightGBM requires an OpenMP runtime. The Conda definition includes
`llvm-openmp`; a `venv` user must provide the platform runtime separately if
LightGBM cannot load.

## Environment safety

`make doctor` is read-only. It reports the selected interpreter, environment,
platform, and required imports. `make setup` refuses to modify:

- the shared Conda/Miniforge `base` environment;
- Apple CommandLineTools Python;
- an interpreter outside the active Conda environment or `venv`.

There is no base-environment override. If Make selects the wrong interpreter,
pass the active environment's Python explicitly:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Common commands

| Command | Purpose |
|---|---|
| `make help` | List supported targets. |
| `make doctor` | Inspect the active Python environment without changing it. |
| `make setup` | Install pinned dependencies and editable local packages. |
| `make web` | Serve `asl-web/` locally. |
| `make js-check` | Check every JavaScript file; Node 24 is required. |
| `make health` | Run lint, formatting, JavaScript, assets, parity, and fast tests. |
| `make validate` | Check JavaScript plus runtime assets, ONNX I/O, hashes, and the offline fixture. |
| `make validate-full` | Add broader source-artifact and local dataset reporting. |
| `make test` | Run fast unit and repository contract tests. |
| `make test-full` | Run the complete Python test suite, including integrations. |
| `make model-test-fixtures` | Export browser fixtures from a downloaded Kaggle subset. |
| `make desktop` | Start the legacy desktop prototype. |
| `make clean` | Remove caches without deleting data, models, notebooks, or environments. |

Node is a required validation dependency. `make js-check`, `make validate`, and
`make health` fail clearly instead of silently skipping JavaScript or parity
checks when Node is missing.

## Direct validation

```bash
python scripts/validation/check_runtime_assets.py
python scripts/validation/verify_project_assets.py
python tests/validation/check_word_feature_parity.py
python tests/validation/check_letter_feature_parity.py
python -m pytest tests/
```

Expected word parity summary:

```text
PASS=6, KNOWN_GAP=0, FAIL=0
```

Automated checks do not replace a real browser and camera test.

## Desktop prototype

The CustomTkinter application is a historical prototype, not a backend for the
web application. It requires a GUI session, camera permission, MediaPipe,
PyTorch, LightGBM, and the published desktop artifacts.

```bash
make setup
make desktop
```

Its word model is the older 25-class, 30×321 BiGRU+Attention pipeline. It must
not be confused with the web application's 50-class, 45×168 SignTransformer.
See the [desktop README](../asl-desktop/README.md) for details.

## Export Model Test fixtures

Raw Kaggle data stays outside the repository. After accepting the competition
rules and configuring Kaggle credentials:

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

Review generated samples before publishing them. Fixture outputs verify browser
inference but do not reproduce the complete held-out evaluation protocol.

## Static deployment

`asl-web/` is the deploy directory and has no build command. Public hosting must
serve it over HTTPS for camera access. This repository intentionally does not
add a CI/CD workflow or Docker setup at this stage; either can be introduced
later when it solves a concrete deployment need.

Before deployment, run `make health`, then manually verify model readiness, the
offline fixture, camera start/stop, letter acceptance, word recording, and the
`#letter`, `#word`, and `#test` deep links.

## Troubleshooting

### Models do not load

Run `make validate`, then inspect the browser Network and Console panels. Both
files under `asl-web/models/` must return HTTP 200, and the CDN assets must be
reachable.

### Camera permission is denied

Use `localhost` or HTTPS, close applications holding the camera, and review the
browser and operating-system camera permissions.

### Python cannot import `asl_ml` or `asl_desktop`

Activate the intended environment, run `make doctor`, then `make setup`.
Confirm that `python` and `python -m pip` resolve to the same environment.

### LightGBM does not load on macOS

Use the Conda environment definition, or install an OpenMP runtime into the
active isolated environment. Do not install project packages into Conda base.

## Related documents

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web-specific notes](../asl-web/README.md)
