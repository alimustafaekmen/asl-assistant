# config — Shared Python project configuration

Bu klasor `config/settings.py` icinde **paylasilan Python project konfigurasyonunu**
tutar. `asl-web/` browser runtime BU KONFIGI KULLANMAZ — web kendi
`asl-web/js/core/app.js` icindeki `CONFIG` nesnesini kullanir.

> **Bu shared Python config'tir; web runtime'in parcasi degildir.**
> `asl-web/` bu config'e bagimli degildir.
> `PROJECT_ROOT`-based path semantigi kok seviyesinde tanimlandigi icin
> `config/` **kokte kalir** (asl-desktop/ veya asl-ml/ altina tasinmaz).

## Tuketiciler

| Layer | Hangi sabit/path? | Dosya |
|---|---|---|
| `asl-desktop/` (legacy desktop) | DEVICE, NUM_HANDS, CAMERA_*, MODEL_PATH'ler, TTS_*, KNN_* vb. | `from config.settings import ...` |
| `scripts/data_preparation/` | `RAW_DATA_DIR`, `PROCESSED_DATA_DIR`, `STATIC_LETTERS` | extract + merge |
| `scripts/model_training/` | `LETTER_MODEL_PATH`, `MODELS_DIR`, threshold sabitleri | letter + J/Z train |
| `scripts/validation/` | `STATIC_LETTERS`, `DYNAMIC_LETTERS`, dataset path'ler | verify_project_assets |
| `tests/asl_desktop/` | `LETTER_MODEL_PATH`, `SEQUENCE_LENGTH`, `CONFIDENCE_THRESHOLD` | unit + integration |
| `asl-ml/` | (yok) | shared package, runtime path semantigi tasimaz |
| `asl-web/` (browser) | (yok) | kendi `CONFIG` JS nesnesini kullanir |

## Path konvansiyonu

`config/settings.py` icindeki `PROJECT_ROOT`:

```python
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
```

→ kok dizini (`asl-assistant/`). Bu nedenle config'i alt klasorde
tasimak `PROJECT_ROOT` semantigini bozar; tum `DATA_DIR`,
`MODELS_DIR`, `LEGACY_NOTEBOOKS_DIR` vb. path'ler kayar.

## Model yolu kurali

| Model | Path |
|---|---|
| Harf Python kaynak (pkl + meta) | `models/letter/` |
| Harf source ONNX (web kaynagi) | `models/letter/onnx_exports/` |
| J/Z Python (eski deney) | `models/letter/dynamic_jz/` (varsa) |
| Eski 25 kelime Python | `legacy/old_notebooks/04_word_25_holistic_v4/outputs/` |
| Final word ONNX (notebook ciktisi) | `notebooks/results/word_model.onnx` |
| **Final web ONNX modelleri** | **`asl-web/models/`** |

Provenance hash chain: `docs/current/data-contract.md`
