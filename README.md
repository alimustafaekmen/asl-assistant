# 🤟 ASL Assistant

**Real-time American Sign Language recognition that runs entirely in your browser — no server, no upload, 100% on-device.**

ASL Assistant reads your webcam, recognizes **24 fingerspelling letters** and **50 word-signs**, and turns them into text and speech. Every frame is processed locally with MediaPipe landmarks + ONNX Runtime Web — the camera image never leaves your device. It's plain HTML/CSS/JavaScript: no build step, no framework, deployable to any static host.

![Vanilla JS](https://img.shields.io/badge/Vanilla-HTML%2FCSS%2FJS-yellow)
![ONNX Runtime Web](https://img.shields.io/badge/ONNX-Runtime%20Web%201.22-blue)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks%20Vision%200.10-green)
![On-device](https://img.shields.io/badge/Inference-On--device-success)

🔗 **Live demo:** [asl-demo.netlify.app](https://asl-demo.netlify.app/#letter) · 📇 Course project for an *AI Applications* class · 🎓 Portfolio build

![ASL Assistant — letter recognition UI](docs/assets/project-ui-screenshot.png)

---

## Why this project is interesting

- **Two different problems, two right tools.** A *letter* is a single static hand pose; a *word* is a short motion sequence. They are not the same ML problem, so they get different pipelines: **LightGBM** on geometric features for letters, a **Transformer** on frame sequences for words.
- **It actually runs the models in the browser.** The trained models are exported to ONNX and executed client-side with ONNX Runtime Web (WASM). This is a real inference app, not a notebook screenshot.
- **Privacy by design.** No backend. The webcam feed is turned into numeric landmarks and classified on-device — nothing is uploaded. A static host (GitHub Pages / Netlify) is enough to ship it.
- **Feature engineering over raw pixels.** 21 hand landmarks (63 raw values) become **93 engineered features** (distances, joint angles, finger states) for letters, and 168-D compact motion features for words.
- **Honest, reproducible evaluation.** Word results use a **signer-independent** split (the same person never appears in both train and test). Python↔JS feature parity is unit-tested (`max_diff < 1e-4`), and a **Model Test** panel runs the real ONNX model on held-out fixtures live in the UI.

---

## Quick start

The web app needs **no Python and no build** — just a static file server:

```bash
cd asl-web
python3 -m http.server 8080
# open http://localhost:8080  (Chrome/Edge desktop recommended; mobile works too)
```

> **Sanity check:** click **"Offline test"** in the UI. Expected deterministic output: `give @ 7.6%`. This runs the real word model on a bundled fixture and proves the whole pipeline (feature build → ONNX → softmax → top-3) works end to end.

A camera demo needs an **HTTPS** origin (browsers block camera on plain-HTTP IPs), which is why the public demo is hosted on Netlify. The `#letter` hash opens the app directly in letter mode.

---

## The product (letter-first)

The **letter model is the hero** — it's the most reliable part and the core experience. Word mode and the learning coach are intentionally positioned as *extras / lab*.

| Mode | What it does |
|---|---|
| **Harf Çeviri** *(hero)* | Fingerspell A–Y live, append to a text line, speak it aloud. |
| **Öğrenme Koçu** *(extra)* | Pick a target letter/word, practice against the camera, quiz + progress. |
| **Kelime Pratik** *(lab)* | 50-word model with top-3 output and honest confusion/limitation notes. |
| **Model Test** | Upload or pick a JSON fixture and see the raw ONNX prediction — no camera needed. |

*(The UI is in Turkish; this README is in English for reach. Letters J and Z are intentionally excluded — they involve motion, so they don't fit a static single-frame model.)*

---

## Results

All numbers below are from held-out evaluation, not training accuracy.

### Letter model — LightGBM (24 classes)

| Metric | Value |
|---|---:|
| Held-out accuracy | **99.35%** |
| Augmented-split accuracy | 99.44% |
| Classes | 24 (A–Y, no J/Z) |
| Feature vector | 93-D (geometric) |
| Train / test / held-out samples | 238,251 / 42,045 / 8,245 |
| Avg. inference | ~0.05 ms |

Static fingerspelling is well-separated by geometry, so a gradient-boosted model on engineered features is both accurate and tiny/fast — a good fit for the browser.

### Word model — SignTransformer (50 classes)

| Metric | Value |
|---|---:|
| Test accuracy | **71.92%** |
| Test macro-F1 | **0.714** |
| Best validation F1 | 0.803 |
| Parameters | 446,195 |
| Input | 45 frames × 168-D + padding mask |
| Temperature (calibration) | 0.985 |
| ONNX size | 1.77 MB |
| Split | signer-independent (14 / 3 / 4 signers) |

Words are genuinely harder: they contain motion, are sensitive to camera angle and speed, and several signs look alike. Rather than hide this, the UI shows **top-3** and a **confusion hint**, and the project frames word mode as an honest research surface.

<details>
<summary><b>Ablation & architecture studies (word model)</b></summary>

**Feature ablation** — the 168-D compact set beat both smaller and larger sets (more features ≠ better):

| Feature set | Dim | Test F1 |
|---|---:|---:|
| Raw landmarks | 321 | 0.581 |
| Shape | 72 | 0.613 |
| Shape + motion | 132 | 0.621 |
| Pairwise + dominant | 444 | 0.671 |
| **Compact (chosen)** | **168** | **0.699** |
| Full | 519 | 0.639 |

**Architecture comparison** — SignTransformer gave the best single-model result; the ensemble was stronger but heavier, so the lighter Transformer was chosen for deployment:

| Model | Params | Test F1 |
|---|---:|---:|
| SmallGRU | 104,627 | 0.682 |
| BiGRU | 602,739 | 0.700 |
| ConvGRU | 338,259 | 0.702 |
| **SignTransformer (chosen)** | **446,195** | **0.719** |
| Ensemble | 1,048,934 | 0.733 |

**Reliable words:** `water`, `sad`, `uncle`, `cow`, `brown` · **Hard words:** `open`, `give`, `all`, `sleepy`, `book`
**Common confusions:** `listen↔hear`, `can↔yes`, `open↔book`, `sleep↔sleepy`, `who↔bird`

</details>

---

## How it works

```text
Webcam / fixture
  → MediaPipe (hand + pose + face landmarks)
  → 321-D landmark vector
  → feature engineering        (letters: 93-D · words: 168-D)
  → ONNX model inference       (LightGBM · SignTransformer)
  → smoothing / thresholds / top-3
  → text + speech + feedback
```

**Letter features (93-D)** — from 21 hand landmarks:

```text
[0..62]   normalized 21 landmarks (wrist origin + middle-MCP scale)
[63..67]  5 fingertip→wrist distances
[68..71]  4 adjacent-fingertip distances
[72..85]  14 finger joint angles
[86..87]  bounding-box aspect / area
[88..92]  5 finger-extended flags
```

**Word features (168-D per frame × 45 frames + bool mask)**:

```text
[0..62]    dominant-hand landmarks
[63..92]   hand-shape features
[93..104]  hand ↔ face/body distances
[105..167] motion vectors (frame-to-frame)
```

The exact same feature math is implemented twice — in Python (training / source of truth) and in JavaScript (browser runtime) — and a parity test asserts they agree to `< 1e-4`.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no framework, no build) |
| Landmarks | MediaPipe Tasks Vision (JS) |
| Inference | ONNX Runtime Web (WASM) |
| Letter training | LightGBM + scikit-learn |
| Word training | PyTorch (exported to ONNX) |
| Speech | Web Speech API |
| Deploy | Static hosting (Netlify / GitHub Pages) |

---

## Repository layout

```text
asl-web/          🚀 the product — browser app (self-contained, static)
  ├─ js/ml/       feature engineering + ONNX letter/word models
  ├─ js/media/    camera + MediaPipe + frame loop
  ├─ models/      letter_model.onnx · word_model.onnx
  └─ data/        labels, fixtures, curriculum, jury samples
asl-ml/           shared Python ML/data helpers (feature source of truth)
asl-desktop/      legacy CustomTkinter prototype (kept runnable, not the product)
scripts/          data prep · model training · validation
notebooks/        word-model training record
models/           letter-model source / provenance
tests/            unit · parity · repo-guardrail tests
```

The browser app (`asl-web/`) is **fully self-contained** — it does not import any Python. The Python side is for training, validation, and the desktop prototype.

---

## Validation

```bash
python3 scripts/validation/check_runtime_assets.py     # deploy smoke test + provenance hashes
python3 tests/validation/check_word_feature_parity.py  # Python ↔ JS feature parity
pytest tests/asl_ml/ tests/asl_desktop/unit/ tests/project/
```

---

## Limitations & roadmap

**Known limits (by design or scope):**
- Word recognition is much weaker live than on curated data (motion, lighting, framing, MediaPipe jitter). It's a 50-word research demo, not general translation.
- Letters J and Z (motion letters) are out of scope for the static model.
- The web runtime currently loads MediaPipe / ONNX Runtime from a CDN.

**Next up:** local-vendored runtime (CDN-independent deploy), richer letter learning (per-letter curriculum + confusion drills), broader word coverage, and live-capture quality adaptation.

---

## Data & credits

Word data derives from the **Google – Isolated Sign Language Recognition** landmark format on Kaggle, related to the **PopSign ASL v1.0** dataset (NeurIPS 2023 Datasets & Benchmarks). Letter data derives from public ASL alphabet datasets, converted to MediaPipe landmarks. Only tiny derived JSON fixtures are committed to this repo — no raw datasets.

- Kaggle — Isolated Sign Language Recognition: <https://www.kaggle.com/competitions/asl-signs>
- PopSign ASL v1.0 (NeurIPS 2023): <https://openreview.net/forum?id=yEf8NSqTPu>
- MediaPipe Tasks Vision · ONNX Runtime Web

---

## License

© 2026 Ali Mustafa Ekmen. All rights reserved. Third-party runtimes and training datasets keep their own licenses.
