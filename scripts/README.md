# Scripts

Command-line tools around the models. None of them runs in the web app. Run
them from the repository root, in the environment from
[getting started](../docs/getting-started.md).

| Folder | What it holds |
|---|---|
| [`data_preparation/`](data_preparation/README.md) | Landmark extraction from images and videos, the letter CSV merge and split |
| [`model_training/`](model_training/README.md) | The letter model trainer and an experimental J/Z trainer |
| [`evaluation/`](evaluation/README.md) | Feature goldens, Model Test word samples and the demo's hand poses |
| [`validation/`](validation/README.md) | Checks that the deployed files match their sources and the ONNX models their contracts |
| [`tooling/`](tooling/README.md) | The environment check and the guard behind `make setup` |

Datasets are not in the repository. Scripts that read one expect it under
`data/raw/` and write generated tables to `data/processed/`; Git ignores both.

The validators, the parity checks in `tests/validation/` and the browser checks
share one exit-code rule: 0 when every check held, 1 when one failed, and 2
when nothing could be checked (bad usage or a missing tool such as Node or ONNX
Runtime). A missing tool is never reported as a pass.
