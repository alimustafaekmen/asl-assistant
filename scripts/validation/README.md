# Validation Scripts

| Script | Purpose |
|---|---|
| `check_runtime_assets.py` | Validate deploy files, JSON/fixture schemas, source/deploy hashes, the notebook export manifest, ONNX I/O, and deterministic inference |
| `verify_project_assets.py` | Report broader web, provenance, source-model, and local dataset readiness |
| `generate_word_onnx_test_sample.py` | Regenerate the deterministic word fixture from the ONNX path |

Run the standard checks from repository root:

```bash
# Run from any configured Python environment.
make validate
make validate-full
```

The scripts do not install missing packages automatically. This avoids hidden
network or environment changes on a demo machine. `generate_word_onnx_test_sample.py`
updates the web fixture by default; writing notebook provenance requires its
explicit option and should be treated as a model-export change.
