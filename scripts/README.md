# scripts

Komut satiri (CLI) araclari ve otomasyonlar. Tum kanonik scriptler alt
klasorlerin altindadir:

```text
scripts/
├── data_preparation/  # veri indirme, landmark cikarma, dataset hazirlama
├── model_training/    # legacy Python harf ve J/Z model egitimi
└── validation/        # asset/runtime saglik kontrolu, hash chain, offline test
```

Eski kok-seviye uyumluluk wrapper'lari (`scripts/check_datasets.py`,
`scripts/extract_landmarks.py`, vb.) **2026-04-26 itibariyla**
`legacy/script-wrappers/`'a tasinmistir. Bkz: `legacy/script-wrappers/README.md`

## Ana komutlar

### Validation (deploy oncesi)

```bash
python scripts/validation/check_runtime_assets.py     # hizli smoke test
python scripts/validation/verify_project_assets.py    # kapsamli (dataset dahil)
python scripts/validation/generate_word_onnx_test_sample.py  # test_sample.json yenile
```

### Model training (yeniden egitim)

```bash
python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison
python scripts/model_training/train_dynamic_jz_model.py collect  # (eski J/Z deneyi)
```

### Data preparation

```bash
python scripts/data_preparation/extract_static_letter_landmarks.py --input "..." --output "..."
python scripts/data_preparation/merge_static_letter_datasets.py
bash scripts/data_preparation/run_static_letter_extraction.sh
```

## Bagimliliklar

Scriptler asagidaki paketleri import eder:

- `from asl_ml.utils import normalize_landmarks, ensure_dir` (data prep + letter training)
- `from asl_ml.features.letter_features import extract_features` (letter training)
- `from asl_desktop.models.sequence_classifier import SignLanguageLSTM` (J/Z training, eski)
- `from config.settings import ...` (path + sabit, kok config)

Kurulum:

```bash
pip install -r requirements-dev.txt   # numpy, onnx, onnxruntime, pytest
pip install -e asl-ml                  # shared ML helpers
pip install -e asl-desktop             # legacy desktop (J/Z train icin)
```

## Notlar

- `notebooks/` final egitim kaydi olarak korunur (DOKUNMA).
- `notebooks/results/` final word model export kaynagi (DOKUNMA).
- `generate_word_onnx_test_sample.py` varsayilan olarak sadece
  `asl-web/data/test_sample.json` dosyasini gunceller; `notebooks/results/`
  kopyasi icin bilincli olarak `--write-notebooks` flag'i gerekir.
- Yeniden eğitim icin daha onceki `training/` paketi
  `legacy/word-training-experiments/` altina tasindi (production source DEGIL).
