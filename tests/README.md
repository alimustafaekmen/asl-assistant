# Tests

The test suite separates fast deterministic checks from optional desktop
integrations.

```text
tests/
├── asl_ml/unit/             93D feature and utility units
├── asl_desktop/unit/        pure smoothing logic
├── asl_desktop/integration/ MediaPipe/model/camera-dependent checks
├── project/                 Git hygiene, lightweight schemas, deploy headers, and browser wiring
├── scripts/                 validators, parity, doctor and make targets, run on broken inputs
├── validation/              Python/JavaScript feature and model parity commands
└── web/                     browser unit tests on Node's test runner
```

## Fast suite

```bash
# Run from any configured Python environment.
make test
```

Equivalent command, with the two source packages on `PYTHONPATH`:

```bash
python -m pytest -rs tests/asl_ml tests/asl_desktop/unit tests/project tests/scripts
```

`-rs` prints the reason for every skip. Two skips are expected in a clone:
the tests that need the local competition-derived word fixtures. A skip that
names a file the repository tracks means that file is missing.

Project tests verify, among other things:

- ignored/local-only files are not tracked;
- published notebook names and documentation references resolve;
- shared ML, desktop, and browser configuration stay in their owning layers;
- classic browser script order and DOM bindings remain valid;
- label maps, temperature, the smoke fixture, and Model Test manifest satisfy
  their lightweight contracts;
- manual word acceptance, sequence-level features, reference assets, and QR
  deep links stay wired.

The portable tests follow three rules:

- numeric inputs are fixed fixtures rather than unseeded random values;
- model adapters use small deterministic fakes instead of loading large or
  platform-specific artifacts;
- repository/UI checks assert public contracts and parsed HTML structure, not
  line numbers, formatting, or an exact list of every future document.

Some older tests in `tests/project/test_web_ui_contracts.py` still read
JavaScript or CSS source text. They are being replaced one at a time by tests
that run the code, and retired only once the replacement is shown to catch the
same faults. New tests do not follow them: run the code or parse the document
instead.

Large model/image existence, source-to-deploy hashes, ONNX loading, every
Model Test fixture file, and the complete notebook export manifest are checked
by `make validate`, not duplicated in the fast pytest suite. This keeps
`make test` useful in a source-only checkout while `make health` still combines
both layers before deployment.

## The inner loop

| Command | Runs |
|---|---|
| `make quick` | lint, format check and every web test; under a second |
| `make test-web FILE=tests/web/word-consent.test.js NAME=once` | one web test file, only the tests whose names match |
| `make watch-web FILE=...` | the same with `node --test --watch`, rerunning on every save |
| `make test-py FILE=tests/scripts/test_gzip_copies.py K=truncated` | one pytest file with `-k` |
| `npm test` | every web test, by the same two patterns as `make js-test` |

Without `FILE`, `NAME` or `K` they run what `make js-test` and `make test` run.

## What each gate runs

| Command | Runs | Does not run |
|---|---|---|
| `make health` | lint, format check, JS syntax, web tests, git hygiene, the runtime asset check, the project asset audit without the dataset report, the notebook and script presence checks, word and letter feature parity, the fast pytest suite | the type check (it needs `npm ci`), the desktop integration tests, letter model parity |
| `make check` | `make health`, then `make js-typecheck`; the gate before a commit | the desktop integration tests |
| `make test-full` | every Python test, the desktop integration tests included | anything outside pytest: the web tests, validators, parity and the type check |
| `make validate` | JS syntax and the runtime asset check | the project audit |
| `make validate-full` | `make validate` and the project asset audit with its dataset report | pytest |
| `make deploy-check` | JS syntax and the runtime asset check with the upload inventory | pytest |
| `make parity` | word and letter feature parity | letter model parity |

`tests/scripts/test_make_targets.py` runs these targets with recording
stand-ins for Python, Node, Git and the TypeScript checker: it checks the steps
each target runs, and that one failing step fails the target.

## Parity diagnostics

```bash
make parity                                          # the two feature checks
python tests/validation/check_letter_feature_parity.py
python tests/validation/check_letter_model_parity.py
python tests/validation/check_word_feature_parity.py
```

The JavaScript parity checks require Node. Word feature parity is expected to
report `PASS=6, KNOWN_GAP=0, FAIL=0`. Each command exits 0 when every
comparison held, 1 on a mismatch (browser code that does not load counts as
one), and 2 when a required tool is missing, Node for the feature checks or
ONNX Runtime for model parity, so nothing was compared. The feature checks
take `--features-js PATH` to compare another copy of `features.js`.

## Full suite

```bash
make test-full
```

This is every Python test and nothing else; `make check` is the gate that
also runs the web tests, the validators, parity and the type check.

Desktop integration tests may skip when MediaPipe, model dependencies, or a
camera are unavailable. A skip does not validate the missing integration; it
only allows the portable suite to continue.

The holistic extraction tests use deterministic MediaPipe-shaped results and
do not require a camera or graphics context. The optional real-model smoke test
is kept separate because LightGBM may require a platform OpenMP runtime.

## What the UI contract tests protect

The browser tests exist so the markup and the CSS can be reworked without the
behaviour quietly coming loose. They protect:

- **element lookups**: every id and `data-ui` hook a script resolves is present
  in `index.html`, appears once where the code expects one, and the element
  types the registry requires match the real tags;
- **behaviour attributes**: `data-mode`, `data-go-mode`, `data-qr-target`,
  `data-coach-flow`, `data-model-test-task`, `data-quality` and `data-step`
  values stay inside the JSDoc union that governs each;
- **the hook boundary**: no script finds an element by a presentation class, so
  renaming a class cannot detach behaviour;
- **references**: `for`, `aria-labelledby`, `aria-describedby` and
  `aria-controls` point at ids that exist, and no inline `on*` handler hides
  behaviour where tests cannot reach it;
- **idempotency**: `bindEvents()` called twice leaves one listener of each, and
  every list renderer rebuilds its rows instead of appending a second set;
- **the registry's failure paths**: a missing required element fails while the
  scripts load and names itself; an optional one resolves to null and leaves
  its feature inert.

They deliberately do **not** pin class order, whitespace, card counts, exact
copy, or a rendered snapshot. Freezing the design is not the point; keeping the
behaviour attached to it is.

## Browser boundary

Static tests catch many browser-wiring errors, but they do not
drive a real camera or validate browser permissions. Layout, focus, canvas
geometry and media behaviour are outside the Node context by design: it stubs
the DOM rather than laying it out.

`make browser-check` covers part of that gap in headless Chrome
([`tests/browser/`](browser/README.md)): the cascade layer order, `[hidden]`
and the mode-only rules, the dark theme, reduced motion, horizontal overflow
from 320 px up, and, with the fake camera, that a stop leaves no live track.
`make browser-check OFFLINE=1` skips the one check that loads MediaPipe and
ONNX Runtime from their CDNs. It needs Chrome, so it is not part of
`make health`; without Chrome it exits 2.

A real camera, real hands and the permission prompts of phone browsers still
need a person: after browser changes, run `make check` and
`make browser-check`, then complete the manual checklist in
[Architecture](../docs/architecture.md).
