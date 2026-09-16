# asl-ml

> **Shared Python ML/data utilities** for the ASL Assistant project.
>
> The browser runtime (`asl-web/`) does NOT depend on this package — it ships
> its own JavaScript implementation and reads contracts from `docs/current/`.

This package consolidates Python helpers that are used across multiple
project layers:

- **Letter feature engineering** (93D LightGBM input pipeline)
- **Landmark normalization** (wrist origin + middle MCP scale)
- **Label-map I/O helpers** (JSON load/save/invert)
- **Filesystem helpers** (`ensure_dir`)

## Consumers

| Layer | Uses asl-ml? | Where |
|---|---|---|
| `asl-desktop/` (legacy desktop prototype) | ✅ | `from asl_ml.utils import normalize_landmarks` etc. |
| `scripts/data_preparation/` | ✅ | landmark extraction |
| `scripts/model_training/` | ✅ | letter model training |
| `scripts/validation/` | ✅ (indirect) | offline test sample generation |
| `tests/asl_ml/` | ✅ | unit tests for FE + utils |
| `asl-web/` (browser runtime) | ❌ | JS implementation in `asl-web/js/ml/` |

## Layout

```
asl-ml/
├── src/
│   └── asl_ml/
│       ├── features/
│       │   ├── __init__.py
│       │   └── letter_features.py     # 93D extract_features (LightGBM)
│       └── utils/
│           ├── __init__.py            # public API re-exports
│           ├── landmarks.py           # normalize_landmarks
│           ├── labels.py              # load/save/invert_label_map
│           └── io.py                  # ensure_dir
├── README.md
└── pyproject.toml
```

## Install (editable)

```bash
pip install -e asl-ml
```

After install:

```python
from asl_ml.utils import normalize_landmarks, load_label_map, ensure_dir
from asl_ml.features.letter_features import extract_features
```

## Contract

The 93D feature breakdown and landmark normalization rules are documented
in `docs/current/model-contract.md`. **Do not change** the feature order,
normalization formula, or output dtype without updating both this package
and the JavaScript implementation in `asl-web/js/ml/features.js`.

Numerical parity is verified by `scripts/validation/check_runtime_assets.py`
(offline ONNX test produces `give @ %7.6` with Δconf ≈ 0).

## Testing

```bash
pip install -e asl-ml[dev]
pytest tests/asl_ml/
```
