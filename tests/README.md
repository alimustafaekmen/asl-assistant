# Tests

```text
tests/
├── asl_features/   letter and word features, landmark normalisation, the feature goldens
├── asl_desktop/    the desktop prototype: unit tests, and integration tests that need MediaPipe
├── project/        deploy headers, data file contracts, page wiring
├── scripts/        validators and make targets, run against broken copies of the tree
├── validation/     Python against JavaScript feature parity (commands, not pytest)
├── web/            the browser scripts on Node's test runner (node:test, node:vm)
└── browser/        checks in headless Chrome (see browser/README.md)
```

`make test` runs the tests and the parity checks, and `make check` runs them
after the lint, format, type and runtime file checks. `make browser-check` runs the Chrome suite. Most of
it runs in seconds, with no camera, GPU or network.

## How they are written

- **Behaviour, not source text.** The web tests load the real scripts from
  `asl-web/js/` into a Node `vm` context, in the order `index.html` lists them,
  against a document built from the real `index.html`.
- **Fakes only at the edges.** The network, the clock, storage, the camera,
  MediaPipe and ONNX Runtime are faked (`tests/web/helpers/`); no internal
  module is mocked.
- **Shown to fail.** The rules that matter most (a word is never added without
  the user's accept, the word mask is not inverted, frames reach the model in
  order, leaving a camera screen releases the camera) each have a test that was
  run against a deliberately broken copy and seen to fail.
- **Validators are tested on broken trees.** `tests/scripts/` copies the
  checkout, breaks one thing and reads the exit code.

A single file runs on its own with
`node --test tests/web/word-consent.test.js` or
`python -m pytest tests/scripts/test_gzip_copies.py`.

## Parity

```bash
python tests/validation/check_letter_feature_parity.py
python tests/validation/check_word_feature_parity.py
python tests/validation/check_letter_model_parity.py
```

The feature checks run `asl-web/js/ml/features.js` under Node and compare it
with the Python code the models were trained with, within 1e-4. The model check
compares the letter pickle with the deployed ONNX model on three fixed hands;
it shows that the formats agree, not that the model is accurate. Each exits 0
when everything matched, 1 on a mismatch and 2 when a tool is missing.

No automated test uses a real camera, real hands or a phone browser.
