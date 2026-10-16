# Tests

The suite has four layers, each answering a different question: do the Python
units hold, do the scripts and make targets fail when they should, does the
browser code behave under Node, and does the page work in a real browser. Most
of it runs in seconds without a camera, a GPU or the network.

```text
tests/
├── asl_ml/unit/             93D letter features, landmark utilities, the feature golden
├── asl_desktop/unit/        desktop configuration, smoothing and the classifier adapter
├── asl_desktop/integration/ holistic extraction, word buffering, the real letter model
├── project/                 repository hygiene, deploy headers, data contracts, browser wiring
├── scripts/                 validators, parity and make targets, run against broken copies
├── validation/              Python/JavaScript parity commands (scripts, not collected by pytest)
├── web/                     browser code on Node's test runner (node:test, node:vm)
└── browser/                 checks in headless Chrome; see its own README
```

## Daily commands

Run these from the repository root, in an environment that has the project
packages (`make doctor` reports what is missing).

| Command | Runs |
|---|---|
| `make quick` | lint, format check and every web test; under a second |
| `make test` | the fast Python suite: `asl_ml`, `asl_desktop/unit`, `project`, `scripts` |
| `make test-web FILE=tests/web/word-consent.test.js NAME=once` | one web test file, only the tests whose names match |
| `make watch-web FILE=...` | the same with `node --test --watch`, rerunning on every save |
| `make test-py FILE=tests/scripts/test_gzip_copies.py K=truncated` | one pytest file with `-k` |
| `npm test` | every web test, by the same two patterns as `make js-test` |

Without `FILE`, `NAME` or `K`, the single-test targets run what `make js-test`
and `make test` run. `make test` is the same as

```bash
python -m pytest -rs tests/asl_ml tests/asl_desktop/unit tests/project tests/scripts
```

with the two source packages on `PYTHONPATH`. `-rs` prints the reason for every
skip. Two skips are expected in a clone: the tests that need the local
competition-derived word fixtures (see
[the word fixtures](../asl-web/data/model-test-samples/words/README.md)). A skip
that names a file the repository tracks means that file is missing.

## What each gate runs

| Command | Runs | Does not run |
|---|---|---|
| `make health` | lint, format check, JS syntax, web tests, git hygiene, the runtime asset check, the project asset audit without the dataset report, the notebook, model and result presence check, word and letter feature parity, the fast pytest suite | the type check (it needs `npm ci`), the desktop integration tests, letter model parity, the browser checks |
| `make check` | `make health`, then `make js-typecheck`; the gate before a commit | the desktop integration tests, the browser checks |
| `make browser-check` | the headless-Chrome checks (`OFFLINE=1` skips the one that needs the CDNs) | everything else; it needs Chrome and exits 2 without it |
| `make test-full` | every Python test, the desktop integration tests included | anything outside pytest: the web tests, validators, parity and the type check |
| `make validate` | JS syntax and the runtime asset check | the project audit |
| `make validate-full` | `make validate` and the project asset audit with its dataset report | pytest |
| `make deploy-check` | JS syntax and the runtime asset check with the upload inventory; run it before every upload | pytest |
| `make parity` | word and letter feature parity | letter model parity |

`make health` needs no `npm install`, so it works in a fresh clone once the
Python environment exists. `tests/scripts/test_make_targets.py` runs these
targets with recording stand-ins for Python, Node, Git and the TypeScript
checker. It checks the steps each target runs and that one failing step fails
the target.

## Python layers

- **`asl_ml/unit`** pins the 93D letter feature vector and the landmark
  normalisation the model was trained on. `test_feature_golden.py` rebuilds
  `tests/web/fixtures/feature-golden.json` and fails if the committed copy
  differs from what the Python code computes now.
- **`asl_desktop/unit`** covers the desktop prototype's configuration, the
  smoothers and the classifier adapter, using a tiny fake model.
- **`asl_desktop/integration`** exercises holistic landmark extraction and the
  word buffer with MediaPipe-shaped stand-ins, so it needs no camera or
  graphics context. `test_letter_classifier.py` loads the real model and skips
  when its dependencies or artifact are unavailable, because LightGBM can need
  a platform OpenMP runtime. A skip does not validate the integration it
  skipped.
- **`project`** holds the repository-level contracts: ignored and local-only
  files are not tracked, Markdown links and notebook references resolve, the
  quality gates cover the test sources, deploy headers and the Content Security
  Policy are intact, label maps, temperature, the smoke fixture and the Model
  Test manifest satisfy their schemas, word reference pages match the labels,
  and the page markup still matches what the scripts look up
  (`test_web_ui_contracts.py`).
- **`scripts`** runs the real validators, parity commands and make targets
  against disposable copies of the checkout with one thing broken, and reads
  the exit code. A validator that has only seen a healthy tree has not been
  shown to detect anything.

Fixtures are fixed values, not unseeded random numbers, and model adapters use
small deterministic fakes instead of loading large or platform-specific
artifacts.

Some older tests in `tests/project/test_web_ui_contracts.py` still read
JavaScript or CSS source text. They are being replaced one at a time by tests
that run the code, and retired only once the replacement is shown to catch the
same faults. New tests do not follow them: run the code or parse the document.

Large model and image existence, source-to-deploy hashes, ONNX loading, every
Model Test fixture file and the notebook export manifest are checked by
`make validate`, not duplicated in the fast pytest suite. That keeps `make test`
useful in a source-only checkout, while `make health` combines both layers.

## Web tests

`tests/web/*.test.js` load the real scripts from `asl-web/js/` into a Node `vm`
context, in the order `index.html` lists them, with a small DOM, a fake camera
and a fake ONNX Runtime (`tests/web/helpers/`). They check behaviour such as
the word mask polarity and frame order sent to the model, that a word is never
appended to the transcript without the user accepting it, and that stopping the
camera releases every track. The context has no layout, no cascade and no real
media, which is why the browser layer exists.

The page-wiring contracts are spread over two places:

- `tests/project/test_web_ui_contracts.py` scans `index.html` and the script
  sources. Every id and `data-ui` hook a script looks up exists, ids are
  unique, `data-mode`, `data-go-mode`, `data-qr-target`, `data-coach-flow`,
  `data-model-test-task`, `data-quality` and `data-step` values stay inside the
  JSDoc union that governs each, `for`, `aria-labelledby`, `aria-describedby`
  and `aria-controls` point at existing ids, no inline `on*` handler hides
  behaviour, and no script finds an element by a presentation class.
- `tests/web/dom-registry.test.js`, `event-binding.test.js` and
  `render-idempotency.test.js` run the code. A missing required element fails
  while the scripts load and names itself; an optional one resolves to `null`
  and leaves its feature inert; `bindEvents()` called twice leaves one listener
  of each; every list renderer rebuilds its rows instead of appending a second
  set.

They deliberately do not pin class order, whitespace, card counts, exact copy
or a rendered snapshot. The point is to let markup and CSS change while keeping
the behaviour attached to them.

## Parity checks

```bash
make parity                                          # the two feature checks
python tests/validation/check_letter_feature_parity.py
python tests/validation/check_letter_model_parity.py
python tests/validation/check_word_feature_parity.py
```

The feature checks run `asl-web/js/ml/features.js` under Node and compare it
with the Python code the models were trained with; the word check currently
reports `PASS=6, KNOWN_GAP=0, FAIL=0`. Letter model parity compares the pickle
with the deployed ONNX model on three fixed hands. All three predict `W`, so it
shows that the two formats agree, not that the model is accurate, and it stays
out of `make parity`.

Each command exits 0 when every comparison held, 1 on a mismatch (browser code
that does not load counts as one), and 2 when a required tool is missing, Node
for the feature checks or joblib and ONNX Runtime for model parity, so nothing
was compared. The two feature checks take `--features-js PATH` to compare
another copy of `features.js`.

## Browser checks

Headless Chrome covers what Node cannot: the cascade layer order, `[hidden]`
and the mode-only rules, the dark theme, reduced motion, horizontal overflow
from 320 px up, and, with the fake camera, that a stop leaves no live track.
[`tests/browser/`](browser/README.md) describes the runner and every check.

```bash
make browser-check              # needs Chrome or Chromium
make browser-check OFFLINE=1    # skips the one check that loads MediaPipe and ONNX Runtime from CDNs
```

The browser checks stay out of `make health` so that gate needs nothing beyond
the Python environment. Run them before a deploy and after any change to
`index.html` or the CSS.

A real camera, real hands and the permission prompts of phone browsers still
need a person. After browser changes, run `make check` and `make browser-check`,
then try camera start and stop, letter acceptance, word recording and the
deep links by hand, as [Getting started](../docs/getting-started.md#static-deployment)
lists for a deploy.
