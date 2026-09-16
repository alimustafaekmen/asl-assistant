# Proje Yapisi

Bu proje icin ana prensip: web demosu kendi icinde kapali ve tasinabilir kalir, egitim ve arastirma artefaktlari web runtime'ina karismaz.

## Runtime Katmani

`asl-web/` aktif web uygulamasidir. GitHub Pages'e verilecek klasor budur.

```text
asl-web/
├── index.html              UI iskeleti — 4 mod tab + kamera + paneller
├── README.md               Web-specific kullanim/demo dokumani
├── css/style.css           Koyu tema + 3 breakpoint responsive + a11y
├── js/
│   ├── core/
│   │   └── app.js          Init, state, mod gecisleri, UI wiring,
│   │                        keyboard, render loop, offline test
│   ├── media/
│   │   └── camera.js       MediaPipe Tasks Vision yukleme,
│   │                        _processFrame rAF, realInference,
│   │                        _finishWordRecordingReal, drawLandmarks
│   ├── ml/
│   │   ├── landmarks.js    MP result → 321D vector + omuz normalize
│   │   ├── features.js     Letter 93D + Word 168D feature engineering
│   │   ├── gating.js       Confusion + difficulty + temporal smoother
│   │   ├── letter-model.js ONNX LightGBM + ZipMap fallback
│   │   └── word-model.js   ONNX SignTransformer + mask dtype fallback
│   └── services/
│       └── benchmark.js    Latency olcumu (mp/feature/onnx/total)
├── models/                 Deploy ONNX modelleri (notebook + masaustu kaynakli)
│   ├── letter_model.onnx   13 MB — LightGBM 24 sinif
│   └── word_model.onnx     1.85 MB — SignTransformer 50 sinif
├── data/                   Deploy JSON contract dosyalari
│   ├── letter_labels.json  {harf: idx} 24 eleman
│   ├── word_labels.json    {kelime: idx} 50 eleman
│   ├── temperature.json    {T: 0.985}
│   ├── per_word_stats.json {kelime: {accuracy, f1, difficulty}}
│   ├── confusion_pairs.json [{word_a, word_b, count}]
│   ├── curriculum.json     Kolay → zor sira
│   └── test_sample.json    ONNX dogrulama (give @ %7.6 ground truth)
└── assets/signs/
    ├── letters.png         Harf rehberi gorseli
    └── kelime.png          Kelime rehberi gorseli
```

Runtime kodu `./models`, `./data` ve `./assets` relative yollarini kullanir.
Bu sayede `asl-web/` tek basina servis edilebilir. Dis bagimlilik:
- jsdelivr CDN: `onnxruntime-web@1.22.0`, `@mediapipe/tasks-vision@0.10.18`
- googleusercontent: MediaPipe `.task` model dosyalari (hand/pose/face)

## Python Paket Katmani

```text
asl-ml/                          Shared Python ML/data utilities (asl_ml package)
├── src/asl_ml/
│   ├── features/letter_features.py    93D extract_features (letter LightGBM)
│   └── utils/
│       ├── landmarks.py               normalize_landmarks (wrist+MCP scale)
│       ├── labels.py                  load/save/invert_label_map
│       └── io.py                      ensure_dir
├── README.md
└── pyproject.toml                     pip install -e asl-ml

asl-desktop/                     Eski masaustu CustomTkinter prototipi (asl_desktop package)
├── src/asl_desktop/
│   ├── app/asl_app.py                 ASLApp main controller
│   ├── camera/camera_widget.py
│   ├── detection/{hand,holistic}_detector.py
│   ├── models/{letter,sequence}_classifier.py
│   ├── services/{personalization,tts_engine}.py
│   ├── ui/{translation,learning_coach}_view.py
│   └── utils/{landmark_smoother,smoother,motion_tracker}.py
├── main.py                            Entrypoint (python3 asl-desktop/main.py)
├── README.md
└── pyproject.toml                     pip install -e asl-desktop

config/                          Shared Python config (KOKTE KALIR)
                                 PROJECT_ROOT-based path semantigi.
                                 Kullanan: asl-desktop, scripts/, tests/.
                                 asl-web KULLANMAZ.
```

## Egitim ve Arastirma Katmani

```text
scripts/data_preparation/ Veri indirme, landmark cikarma, dataset hazirlama
scripts/model_training/   Legacy Python harf ve J/Z egitimi
scripts/validation/       Asset/runtime saglik kontrolu (hash chain dahil)
notebooks/                Final egitim notebooklari ve 50 kelime export kaydi; DOKUNMA
notebooks/results/        Final word model export source — DOKUNMA
models/                   Harf modeli source/provenance + kullanici profilleri
data/                     Lokal ham/islenmis veri (3 GB, gitignore'li)
tests/asl_ml/             asl-ml package unit testleri
tests/asl_desktop/        asl-desktop unit + integration testleri
tests/validation/         (placeholder)
tests/smoke/              (placeholder)
```

Bu klasorler web demo tarafindan direkt okunmamalidir.

## Legacy Katmani

```text
legacy/word-training-experiments/  ESKI training/ paketi (production source DEGIL)
                                    word-list-50.json + 507D pipeline runtime ile uyumsuz.
                                    BiGRU + SignTransformer experimental code.
                                    Kullanim ihtiyaci varsa once parity verification.

legacy/script-wrappers/            Eski scripts/ kok-seviye runpy compatibility wrapper'lari
                                    9 dosya (check_datasets, extract_landmarks, train_letters, vb.)
                                    Aktif scriptler scripts/{data_preparation,model_training,validation}/

legacy/old_notebooks/              Eski deney notebook'lari (01_word_15 .. 07_video_classification)
                                    Her klasorde `outputs/` altinda eski model artifacts.
legacy/front-end/                  Eski frontend taslaklari (HTML mockup, React jsx)
                                    Aktif runtime degil; tasarim referansi.
```

Bu katman tarihce ve karsilastirma icindir. Yeni web isleri `asl-web/` icinde yapilmalidir.

> **2026-04-26 refactor notu**: Eski `src/` (16 modul) ikiye ayrildi:
> - Ortak ML/data kodu (`feature_engineer.py`, `utils.py`) → `asl-ml/src/asl_ml/`
> - Desktop-only kod (UI, camera, detection, services, ...) → `asl-desktop/src/asl_desktop/`
>
> `main.py` → `asl-desktop/main.py` tasinmistir.
> Eski `training/` → `legacy/word-training-experiments/` tasinmistir (production source DEGIL).
> Eski `scripts/` kok-seviye wrapper'lari → `legacy/script-wrappers/` tasinmistir.
> `config/` KOKTE KALDI (PROJECT_ROOT path semantigi).
>
> Tum import path'leri yeni paket yapisina gore guncellendi:
>   `from src.utils` → `from asl_ml.utils`
>   `from src.feature_engineer` → `from asl_ml.features.letter_features`
>   `from src.holistic_detector` → `from asl_desktop.detection.holistic_detector`
>   `from src.app` → `from asl_desktop.app.asl_app`
>   ... (toplam 19 dosya, 15 mapping)

## Dokuman Katmani

```text
# Aktif teknik kaynaklar (docs/current/)
docs/current/project-structure.md     Bu dosya — repo katman ve klasor rehberi
docs/current/system-architecture.md   Pipeline ve sistem akisi (juri rehberi, kapsamli)
docs/current/demo-plan.md             Juri/demo hazirligi
docs/current/project-history.md       Proje yolculugu (tarihsel anlatim, sinir durumda)
docs/current/model-contract.md        93D + 168D + ONNX I/O sozlesmesi (KRMIZI CIZGI!)
docs/current/data-contract.md         JSON sema + provenance hash chain (KRMIZI CIZGI!)
docs/current/runtime-pipeline.md      Inference pipeline + smoother + threshold (KRMIZI CIZGI!)

# Tarihsel arsivler
docs/archive/historical/              Eski durum raporu, plan, overview, file-audit
                                      (2026-04-30'da docs/current/'tan tasindi)
docs/archive/analysis/                Eski strateji + plan analizleri
docs/archive/notes/                   Literatur / cevap notlari
docs/assets/                          Dokuman gorselleri
```

Karar verirken once `README.md`, sonra `docs/current/` okunur. Model/data
contract degisikligi yapacaksaniz once `docs/current/model-contract.md` ve
`data-contract.md`'yi inceleyin — kirmizi cizgiler orada belgelenmistir.

## Degisiklik Kurali

- Web davranisi degisecekse once `asl-web/README.md` ve bu dosya ile uyum kontrol edilir.
- Top-level `notebooks/` final kayittir; dogrulama haricinde degistirilmez.
- `asl-web/models/` ve `asl-web/data/` deploy ciktisidir; yalnizca bilincli export replacement ile degisir.
- `models/` harf modeli ve kullanici profillerini tutar; notebook kokenli kelime ciktilari `legacy/old_notebooks/*/outputs/` altindadir.
- `scripts/` kokundeki eski komutlar wrapper olarak kalir; yeni isimlerde alt klasorler tercih edilir.
- Yeni web runtime dosyalari `asl-web/` disina bagimlilik vermemelidir.
