# asl-desktop

> ⚠ **Legacy desktop prototype.** The active product is `asl-web/` (browser
> runtime). This package is kept for reference / experimentation.

A CustomTkinter-based desktop application that uses MediaPipe Hands +
Holistic, scikit-learn LightGBM letter classifier, and PyTorch sequence
classifier. Predates the browser runtime.

## Layout

```
asl-desktop/
├── src/
│   └── asl_desktop/
│       ├── app/
│       │   └── asl_app.py            # ASLApp main controller
│       ├── camera/
│       │   └── camera_widget.py
│       ├── detection/
│       │   ├── hand_detector.py      # MediaPipe Hands wrapper
│       │   └── holistic_detector.py  # MediaPipe Holistic wrapper
│       ├── models/
│       │   ├── letter_classifier.py  # LightGBM (.pkl) + ONNX
│       │   └── sequence_classifier.py # PyTorch sequence (.pt)
│       ├── services/
│       │   ├── personalization.py    # KNN user profile
│       │   └── tts_engine.py         # pyttsx3 TTS
│       ├── ui/
│       │   ├── translation_view.py   # Çeviri modu
│       │   └── learning_coach_view.py # Öğrenme koçu
│       └── utils/
│           ├── landmark_smoother.py
│           ├── motion_tracker.py
│           └── smoother.py
├── main.py                           # Entry point
├── README.md
└── pyproject.toml
```

## Dependencies

- **`asl-ml`** (sibling package): shared landmark normalization +
  letter features + label I/O
- **`config/`** (root-level shared config): paths, thresholds,
  device detection, dataset constants
- Python ML stack: numpy, opencv-python, mediapipe, scikit-learn,
  lightgbm, torch, customtkinter, pyttsx3

## Install (editable)

```bash
pip install -r requirements-dev.txt    # numpy, onnx, onnxruntime, pytest, ...
pip install -e ./asl-ml                # shared ML/data helpers
pip install -e ./asl-desktop           # depends on asl-ml (sibling editable)
```

Modern pip (≥24) sibling editable install'ları çözer — `asl-desktop`
`pyproject.toml`'unun `dependencies = ["asl-ml"]` satırı çalışır çünkü
önce `asl-ml` editable install edildi. Eğer **eski pip** kullanıyorsanız:

```bash
pip install --upgrade pip   # pip ≥ 24 zorunlu
```

## Run

> **⚠ ÖNKOŞUL**: `python3 asl-desktop/main.py` editable install gerektirir.
> Aksi halde `ModuleNotFoundError: No module named 'asl_desktop'`.

```bash
# 1) Önce install (her geliştirici makinesinde TEK SEFERLİK):
pip install -r requirements-dev.txt
pip install -e ./asl-ml          # paylaşılan ML helpers
pip install -e ./asl-desktop     # depends on asl-ml (sibling editable)

# 2) Sonra çalıştır:
python3 asl-desktop/main.py
```

Doğrudan `python3 asl-desktop/main.py` editable install yapmadan **fail**
çünkü `main.py` içinde:
```python
from asl_desktop.app.asl_app import ASLApp
```
import zinciri var; `asl_desktop` paketi PYTHONPATH'te bulunmalı.

## What this app does NOT do

This is the **legacy** desktop variant; it does NOT power the active
demo. Differences vs `asl-web/`:

| | asl-desktop (this) | asl-web (active) |
|---|---|---|
| UI | CustomTkinter | HTML/CSS/Vanilla JS |
| MediaPipe | Python `mp.solutions` | MediaPipe Tasks Vision JS |
| Letter model | scikit-learn `.pkl` | ONNX (asl-web/models/) |
| Word model | PyTorch `.pt` | ONNX SignTransformer |
| Distribution | Local install | GitHub Pages (zero install) |
| Active? | Reference / legacy | ✅ Production |

The two implementations share the **model+data contract** documented in
`docs/current/model-contract.md` and `docs/current/data-contract.md`.

## Tests

```bash
pytest tests/asl_desktop/
```

Note: integration tests require MediaPipe + camera + ONNX models. Unit
tests are MediaPipe-independent.
