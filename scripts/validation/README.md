# Validation Scripts

| Script | Purpose |
|---|---|
| `check_runtime_assets.py` | Validate deploy files, JSON/fixture schemas, source/deploy hashes, the notebook export manifest, ONNX I/O, and deterministic inference; with `--deploy`, also every file an upload of `asl-web/` would carry |
| `verify_project_assets.py` | Report broader web, provenance, source-model, and local dataset readiness |
| `generate_word_onnx_test_sample.py` | Regenerate the deterministic word fixture from the ONNX path |

Run the standard checks from repository root:

```bash
# Run from any configured Python environment.
make validate
make validate-full
make deploy-check   # before every upload
```

`check_runtime_assets.py` exits 0 when every check ran and held, 1 when a
contract failed, and 2 for bad usage or when ONNX Runtime cannot be imported
(`--no-onnx` leaves that step out on purpose). A failure outranks a step that
could not run. `--root` points it at another checkout; the tests in
`tests/scripts/` use that to break a copy and read the exit code.

`verify_project_assets.py` takes `--root` too, and exits 1 when a required web
file is missing or invalid, a deploy file drifted from its source, or a source
is missing; every source is tracked, so a missing one was lost. Its local
dataset report is information only and never changes the exit code;
`--no-datasets` leaves it out, which is what `make health` does, because in a
checkout with the datasets it stats about 200,000 files.

`make deploy-check` exists because the site is uploaded as the `asl-web/`
folder on disk. It fails on the ignored `data/model-test-samples/local/`
fixtures, on any file Git ignores there, on hidden files (`make clean` removes
`.DS_Store`), and on anything outside `DEPLOY_ALLOWED_ENDINGS` in
`contracts.py`. Add a new kind of shipped file to that list, not to the check.

The scripts do not install missing packages automatically. This avoids hidden
network or environment changes on a demo machine. `generate_word_onnx_test_sample.py`
updates the web fixture by default; writing notebook provenance requires its
explicit option and should be treated as a model-export change.

After replacing `asl-web/models/letter_model.onnx`, regenerate the copy the browser downloads with `gzip -9 -n -c asl-web/models/letter_model.onnx > asl-web/models/letter_model.onnx.gz`; `check_runtime_assets.py` fails until the two match.
