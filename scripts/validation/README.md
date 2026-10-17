# Validation

<sub>Location: [`asl-assistant`](../../README.md) / [`scripts`](../README.md) / `validation`</sub>

<sub>Related: [`tests/`](../../tests/README.md) · [`docs/getting-started.md` › Static deployment](../../docs/getting-started.md#static-deployment) · [`docs/models-and-data.md`](../../docs/models-and-data.md)</sub>

These scripts check that what the browser loads is what the project says it is:
the right files exist, the JSON has the right shape, each deployed model is
byte-identical to its source, and the ONNX graphs accept and return what the
JavaScript expects.

| Script | Purpose |
|---|---|
| `check_runtime_assets.py` | The deploy check: required files and JSON schemas, Model Test fixtures, source-to-deploy SHA-256 hashes, the gzipped letter model, the notebook export manifest, ONNX input and output shapes, and one deterministic inference. With `--deploy`, it also lists every file an upload of `asl-web/` would carry |
| `verify_project_assets.py` | A wider audit: the web runtime files, the provenance chain, the source models, and a report on local datasets |
| `contracts.py` | The canonical artifact paths, provenance pairs and upload allowlist that both checks import; not run directly |
| `generate_word_onnx_test_sample.py` | Regenerate the synthetic word smoke fixture `asl-web/data/test_sample.json` from the deployed ONNX model |

## Running

Through Make, from the repository root:

```bash
make validate        # JS syntax, then check_runtime_assets.py
make validate-full   # validate, then verify_project_assets.py with its dataset report
make deploy-check    # JS syntax, then check_runtime_assets.py --deploy; run before every upload
```

Or directly:

```bash
python scripts/validation/check_runtime_assets.py            # --verbose for detail
python scripts/validation/check_runtime_assets.py --deploy
python scripts/validation/check_runtime_assets.py --no-onnx  # skip the ONNX step on purpose
python scripts/validation/verify_project_assets.py --no-datasets
```

None of these scripts installs a missing package or reaches the network. They
report what is missing and leave your environment as it was.

## Exit codes

`check_runtime_assets.py` exits 0 when every check ran and held, 1 when a
contract failed, and 2 for bad usage or when ONNX Runtime cannot be imported.
Exit 2 means the models were not verified, and the output says so instead of
reporting a pass; `--no-onnx` leaves the step out deliberately. When a check
fails and another could not run, the exit code is 1. `--root` points the script
at another checkout, which is how the tests in `tests/scripts/` break a copy
and read the exit code.

`verify_project_assets.py` takes `--root` too, and exits 1 when a required web
file is missing or invalid, a deploy file differs from its source, or a source
is missing. Its local dataset report is information only and never changes the
exit code. `--no-datasets` leaves the report out, which is what `make health`
does, because in a checkout that has the datasets it reads a very large number
of files.

## Before an upload

An upload of `asl-web/` takes the folder as it is on disk, ignored files
included. `make deploy-check` lists every file in it and fails on:

- the ignored `asl-web/data/model-test-samples/local/` fixtures, which are
  derived from data that may not be redistributed;
- any file Git ignores inside `asl-web/`;
- hidden files (`make clean` removes `.DS_Store`);
- anything outside `DEPLOY_ALLOWED_ENDINGS` in `contracts.py`. Add a new kind of
  shipped file to that list, not to the check.

The full deploy steps are in
[Getting started](../../docs/getting-started.md#static-deployment).

## Changing a model

After replacing `asl-web/models/letter_model.onnx`, regenerate the compressed
copy the browser downloads:

```bash
gzip -9 -n -c asl-web/models/letter_model.onnx > asl-web/models/letter_model.onnx.gz
```

`check_runtime_assets.py` fails until the two match.

`generate_word_onnx_test_sample.py` updates the web fixture by default.
Writing the copy under `notebooks/word_50_results/` needs the explicit
`--write-notebooks` option and counts as a model-export change.
`--allow-model-source` lets it read the model from `models/word/web-50/` when
the deployed copy is missing. The full update procedure is in
[Models and data](../../docs/models-and-data.md#safe-update-procedure).
