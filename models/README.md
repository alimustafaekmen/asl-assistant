# Model Artifacts

This directory is the repository's curated model registry. Training code lives
under `scripts/model_training/` and `notebooks/`; deployable browser copies
live under `asl-web/models/`.

```text
models/
├── letter/                         24-class static-letter model
│   ├── letter_label_map.json
│   ├── letter_model.pkl
│   ├── letter_model_meta.json
│   └── onnx_exports/
│       └── letter_model_static_24_web_no_zipmap.onnx
└── word/
    ├── web-50/                     current 50-class web model
    └── desktop-25/                 historical desktop runtime model
```

The browser does not load files directly from this directory. Its ONNX files
and JSON contracts are copied to `asl-web/`, then checked against these source
artifacts by SHA-256.

The two word models are intentionally separate. `web-50` is the current
SignTransformer pipeline; `desktop-25` is the earlier BiGRU + Attention model
retained so the desktop prototype remains runnable. Their inputs, class counts,
and model formats are incompatible.

Generated model files remain ignored by default. `.gitignore` contains narrow
exceptions for the documented artifacts needed to run the desktop prototype,
deploy the browser copies, or validate Python/ONNX parity. An unlisted model
file is not automatically a publishable source artifact.

See [Word models](word/README.md) and
[Models and data](../docs/models-and-data.md).
