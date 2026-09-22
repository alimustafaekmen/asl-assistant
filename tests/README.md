# Tests

The test suite separates fast deterministic checks from optional desktop
integrations.

```text
tests/
├── asl_ml/unit/             93D feature and utility units
├── asl_desktop/unit/        pure smoothing logic
├── asl_desktop/integration/ MediaPipe/model/camera-dependent checks
├── project/                 Git hygiene, lightweight schemas, and browser wiring
├── validation/              Python/JavaScript feature and model parity tools
└── fixtures/                parity support fixtures
```

## Fast suite

```bash
# Run from any configured Python environment.
make test
```

Equivalent command:

```bash
python -m pytest tests/asl_ml tests/asl_desktop/unit tests/project
```

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

Large model/image existence, source-to-deploy hashes, ONNX loading, every
Model Test fixture file, and the complete notebook export manifest are checked
by `make validate`, not duplicated in the fast pytest suite. This keeps
`make test` useful in a source-only checkout while `make health` still combines
both layers before deployment.

## Parity diagnostics

```bash
python tests/validation/check_letter_feature_parity.py
python tests/validation/check_letter_model_parity.py
python tests/validation/check_word_feature_parity.py
```

The JavaScript parity checks require Node. Word feature parity is expected to
report `PASS=6, KNOWN_GAP=0, FAIL=0`.

## Full suite

```bash
make test-full
```

Desktop integration tests may skip when MediaPipe, model dependencies, or a
camera are unavailable. A skip does not validate the missing integration; it
only allows the portable suite to continue.

The holistic extraction tests use deterministic MediaPipe-shaped results and
do not require a camera or graphics context. The optional real-model smoke test
is kept separate because LightGBM may require a platform OpenMP runtime.

## Browser boundary

Static tests catch many browser-wiring errors, but they do not
drive a real camera or validate browser permissions. After browser changes, run
`make health`, serve the app, and complete the manual checklist in
[Architecture](../docs/architecture.md).
