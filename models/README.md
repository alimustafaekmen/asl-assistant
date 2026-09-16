# Model Klasoru

Bu klasor **harf modelinin kaynak/provenance dosyalarini** tutar. Web runtime'i
(`asl-web/models/letter_model.onnx`) bu klasordeki ONNX'in birebir kopyasidir.

> **Web runtime BU KLASORU FETCH ETMEZ.** Bu klasor sadece kaynak/provenance
> kayit icindir. Web tarayici sadece `asl-web/models/` ve `asl-web/data/`'i
> okur (relative path).

---

## Harf Modeli (LightGBM)

```text
letter/
├── README.md
├── letter_model.pkl                                    # scikit-learn pickle (~21 MB)
├── letter_label_map.json                               # {harf: idx} 24 eleman
├── letter_model_meta.json                              # egitim parametreleri + accuracy
└── onnx_exports/
    ├── letter_model_static_24_web_duplicate.onnx      # Eski ZipMap export
    └── letter_model_static_24_web_no_zipmap.onnx      # Aktif web export → asl-web/models/'ya kopyalandi
```

### Provenance

| Alan | Deger |
|---|---|
| Egitim scripti | `scripts/model_training/train_static_letter_model.py` |
| Cihaz | Apple M4 Pro CPU |
| Egitim suresi | 80.8 sn |
| Datasets | ASL Alphabet + American Sign Language Dataset + ASL_SemCom |
| Train sample | 238,251 |
| Test sample | 42,045 (8,245 held-out) |
| Augmentation | 5× (rotation 45°, noise 0.02, scale 0.2) |
| Accuracy (held-out) | %99.35 |
| Accuracy (augmented split) | %99.44 |
| Sinif sayisi | 24 (A-Y, J ve Z dinamik oldugu icin haric) |
| Feature dim | 93D (FE on, augmentation on) |

### Hash chain (asl-web ile birebir esleme)

```text
82c35482f41442da0c2904a3308a745885bbc6b10be6492e69d8fda471c6d04b
  asl-web/models/letter_model.onnx                              ← runtime
  models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx  ← kaynak

8c2da0ac3dcf8a3a9b4dd52564a99aabdbbd67fbc63527e01678edb499c7cbbd
  asl-web/data/letter_labels.json                               ← runtime
  models/letter/letter_label_map.json                            ← kaynak
```

Dogrulama: `python3 scripts/validation/check_runtime_assets.py`

### Dosya isimlendirme notu

`onnx_exports/letter_model_static_24_web_no_zipmap.onnx` aktif web
kaynagidir. Eski `letter_model_static_24_web_duplicate.onnx` dosyasi
korunur, ancak web runtime artik onu kullanmaz. Aktif export'ta `ZipMap`
kaldirilmistir; `probabilities` cikisi web tarafinda okunabilir duz
`tensor(float)[N,24]` formatindadir. Bu sayede harf modu gercek top-3 ve
model olasiligi gosterebilir.

1. Hash chain referansi aktif no-ZipMap kaynaga baglidir
2. Dosya rename = `letter_model.onnx` olur, `asl-web/models/letter_model.onnx`
   ile karistir, hangisi kaynak hangisi runtime ayrimi gorsel olarak kaybolur
3. Runtime dokunulmaz; web kopyasi `asl-web/models/letter_model.onnx`'tir,
   bu klasor sadece **kaynak/provenance** rolu oynar

Web kopyasinin nereden geldigi her zaman bu README ile dogrulanir.

### Pickle dosyasi

`letter_model.pkl` (scikit-learn LightGBM pickle) ONNX'e donusturuldukten
sonra runtime kullanmaz. Korunur cunku:

- Eski masaustu Python uygulamasi (`src/letter_classifier.py`) hala bu pkl'i
  yukleyebilir (alternative path)
- Yeniden ONNX export yapmak gerekirse kaynak pickle bu
- Provenance kaydi (egitim sonrasi orijinal model artifact)

`asl-web/` (web runtime) **pickle ile DEGIL ONNX ile** calisir.

---

## Kullanici Profilleri

```text
profiles/
```

K-NN kisisellestirme sablonlari icin ayrildi. Bos olabilir. Web runtime su an
profil destegi sunmaz; gelecek genisleme icin yer.

---

## Kelime Modeli (notebook kaynakli)

Kelime modeli **bu klasorde DEGIL** — notebook ciktisi oldugu icin
`notebooks/results/` altindadir:

```text
notebooks/results/
├── word_model.onnx                  # Web runtime kaynagi (sha 0de173...)
├── word_to_idx.json                 # → asl-web/data/word_labels.json olarak kopyalandi
├── temperature.json                 # → asl-web/data/ kopyalandi
├── per_word_stats.json              # → asl-web/data/ kopyalandi
├── confusion_pairs.json             # → asl-web/data/ kopyalandi
├── curriculum.json                  # → asl-web/data/ kopyalandi
├── test_sample.json                 # → asl-web/data/ kopyalandi
├── final_model.pt                   # PyTorch checkpoint (provenance, runtime kullanmaz)
├── manifest.json                    # Export manifest
├── classification_report.txt        # Per-class precision/recall/f1
├── all_experiment_results.json      # 15 deneyin sonucu
└── Grafikler/                       # 10 PNG (deney + confusion matrix + F1)
```

Provenance ve hash chain detayi: `docs/current/data-contract.md`

---

## Eski deneyler (legacy)

Eski 25 kelime model ciktilari:

```text
legacy/old_notebooks/02_word_25_bigru_v2/outputs/
legacy/old_notebooks/03_word_25_holistic_v3/outputs/
legacy/old_notebooks/04_word_25_holistic_v4/outputs/
```

Bunlar referans/karsilastirma icin tutulur; web runtime kullanmaz.

---

## Yeniden egitim politikasi

Harf modeli yeniden egitilirse:

1. `python3 scripts/model_training/train_static_letter_model.py` calistir
2. Yeni `models/letter/letter_model.pkl` + ONNX export uretilir
3. ONNX'i `asl-web/models/letter_model.onnx` 'a kopyala
4. Label map'i `asl-web/data/letter_labels.json` 'a kopyala
5. Bu README'deki hash chain bilgisini guncelle
6. Web tarayicida manuel kamera testi (A/B/C/L gibi farkli harfler)

Adim 5 atlanirsa hash chain dokumantasyonu drift eder; yeni geliştirici
provenance izleyemez.
