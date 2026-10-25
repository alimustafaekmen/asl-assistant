# Validation

These scripts check that what the browser loads is what the project says it
is: the files exist, the JSON has the right shape, each deployed model is
byte-identical to its source, and the ONNX models take and return what the
JavaScript expects.

| Script | Purpose |
|---|---|
| `check_runtime_assets.py` | Files and JSON schemas, Model Test fixtures, source-to-deploy SHA-256 hashes, the gzipped letter model, the notebook export manifest, ONNX inputs and outputs. `--deploy` also lists every file in `asl-web/` and fails on anything the site must not ship |
| `verify_project_assets.py` | A wider audit of the provenance chain and the source models, with a report on local datasets |
| `contracts.py` | The artifact paths, source-to-deploy pairs and upload allowlist both checks use |
| `generate_word_onnx_test_sample.py` | Regenerates the synthetic word fixture `asl-web/data/test_sample.json` from the deployed model |

```bash
python scripts/validation/check_runtime_assets.py            # part of make check
python scripts/validation/check_runtime_assets.py --deploy   # before an upload
python scripts/validation/verify_project_assets.py --no-datasets
```

Both take `--root` to check another checkout. `check_runtime_assets.py` exits 2
when ONNX Runtime cannot be imported, so the models were not verified;
`--no-onnx` skips that step on purpose.

## Changing a model

Each deployed file is a copy of a source: `models/word/web-50/` and
`notebooks/word_50_results/` for the word model and its data, `models/letter/`
for the letter model. Replace the source and the copy together, and after a new
letter model regenerate the compressed copy the browser downloads:

```bash
gzip -9 -n -c asl-web/models/letter_model.onnx > asl-web/models/letter_model.onnx.gz
```

Then regenerate the fixtures and the demo poses (`scripts/evaluation/`), update
`asl-web/data/model-card.json` if a figure changed, and run `make check`.
