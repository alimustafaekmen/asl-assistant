# Models

The source copy of every published model. The browser never reads this folder:
it loads copies in `asl-web/models/` and `asl-web/data/`, and the runtime file
check in `make check` compares each copy with its source by SHA-256.

```text
models/
├── letter/        24-letter LightGBM model (see letter/README.md)
└── word/
    ├── web-50/    50-word SignTransformer, used by the web app
    └── desktop-25/ 25-word BiGRU, used by the desktop prototype
```

The two word models take different inputs and cannot stand in for each other.
See [letter](letter/README.md) and [word](word/README.md).

## Licence

The model files are released under the repository's
[PolyForm Noncommercial License 1.0.0](../LICENSE). The terms of their training
data also apply; the sources are listed in the
[README](../README.md#data-and-attribution). The `.pkl` and `.pt` files are
Python pickles, which can run code when loaded: load them only from a copy you
trust.
