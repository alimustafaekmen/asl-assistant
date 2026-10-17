# Model artifacts

<sub>Location: [`asl-assistant`](../README.md) / `models`</sub>

<sub>Related: [`models/letter/`](letter/README.md) · [`models/word/`](word/README.md) · [`docs/models-and-data.md`](../docs/models-and-data.md) · [`scripts/validation/`](../scripts/validation/README.md)</sub>

The source copy of every published model. Training code lives in
`scripts/model_training/` and `notebooks/`; the copies the browser loads live in
`asl-web/models/` and `asl-web/data/`.

```text
models/
├── letter/                         24-class static-letter model (LightGBM)
│   ├── letter_label_map.json
│   ├── letter_model.pkl
│   ├── letter_model_meta.json
│   └── onnx_exports/
│       └── letter_model_static_24_web_no_zipmap.onnx
└── word/
    ├── web-50/                     50-class SignTransformer used by the web app
    └── desktop-25/                 25-class BiGRU used by the desktop prototype
```

The browser never reads this directory. Its ONNX files and JSON contracts are
copies, and `make validate` compares each copy with the file here by SHA-256 and
checks the ONNX inputs and outputs. The mapping is listed in
[Models and data](../docs/models-and-data.md#artifact-provenance).

`web-50` is the word model the web app runs and `desktop-25` the one the
desktop prototype loads. Their inputs, class counts and file formats are
incompatible, and neither can stand in for the other.

`.gitignore` ignores model files here unless it lists them as exceptions. The
exceptions are what is needed to run the desktop prototype, deploy the browser
copies and check Python against ONNX.

## Licence

The model files are released under the repository's
[PolyForm Noncommercial License 1.0.0](../LICENSE) and are treated as part of
the software. The terms of their training data also apply; the sources and their
licences are listed in the root README's
[data and attribution](../README.md#data-and-attribution) section.

The `.pkl` and `.pt` files are Python pickles, which can run arbitrary code when
loaded. Load them only from a copy you trust.

See [Letter model](letter/README.md), [Word models](word/README.md) and
[Models and data](../docs/models-and-data.md).
