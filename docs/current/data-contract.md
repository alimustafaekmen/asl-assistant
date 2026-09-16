# Data Contract

> **`asl-web/data/` runtime contract klasorudur.** Buradaki JSON dosyalari
> tarayici ML pipeline'inin ihtiyac duydugu butun yardimci verileri tutar.
> Format/sema/anahtar adlari degisirse **runtime kirilir**. Bu dokuman her
> dosyanin sema'sini, kaynak provenance'ini ve hash chain'ini kayit altina alir.

---

## 1. Provenance Hash Chain

Web runtime dosyalari **bilincli kopyalardir**; kaynak training veya masaustu
script ciktilarinin **birebir** halidir. Hash uyusmazligi bir yerde drift
oldugunu gosterir.

### Kelime modeli + data (notebook kaynakli)

Source: `notebooks/results/` (Kaggle T4 GPU egitim ciktisi)

| Web dosyasi | Source dosyasi | SHA-256 |
|---|---|---|
| `asl-web/models/word_model.onnx` | `notebooks/results/word_model.onnx` | `0de1739b54f11eb382608fa1afc35612e667fbf9fdca7dca7da06ac7c3775d61` |
| `asl-web/data/word_labels.json` | `notebooks/results/word_to_idx.json` | `7d29d7722a887e0a69390fa4d8d144a5f15c04f09b0621536de1ee1df2b5dea9` |
| `asl-web/data/temperature.json` | `notebooks/results/temperature.json` | `690157fb2f6f4b9719fcfde9c50ca08fcf3e02a8ff668fda87ad28ed1fec769d` |
| `asl-web/data/per_word_stats.json` | `notebooks/results/per_word_stats.json` | `97c41bc49590d10cdb617fae8c3b5f62b2aef0b24cbe9bedf1bb5b1cfff2231f` |
| `asl-web/data/curriculum.json` | `notebooks/results/curriculum.json` | `dbd6b04eea98cd34f6a6750861cb1a96b844fe9d377266b708b9143ecbc106ee` |
| `asl-web/data/confusion_pairs.json` | `notebooks/results/confusion_pairs.json` | `84841a6b8b1fbfd723c0c746c8500c6dd22737dd2140899d71cb9716e290813d` |
| `asl-web/data/test_sample.json` | `notebooks/results/test_sample.json` | `f28ef69324951546e40ce398893dd76ad872b7b67e4e7a43a9e657519af65485` |

### Harf modeli + data (masaustu Python script kaynakli)

Source: `scripts/model_training/train_static_letter_model.py` ciktisi → `models/letter/`

| Web dosyasi | Source dosyasi | SHA-256 |
|---|---|---|
| `asl-web/models/letter_model.onnx` | `models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx` | `82c35482f41442da0c2904a3308a745885bbc6b10be6492e69d8fda471c6d04b` |
| `asl-web/data/letter_labels.json` | `models/letter/letter_label_map.json` | `8c2da0ac3dcf8a3a9b4dd52564a99aabdbbd67fbc63527e01678edb499c7cbbd` |

### Hash dogrulama komutu

```bash
shasum -a 256 \
  asl-web/models/word_model.onnx \
  notebooks/results/word_model.onnx \
  asl-web/models/letter_model.onnx \
  models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx \
  asl-web/data/word_labels.json \
  notebooks/results/word_to_idx.json \
  asl-web/data/letter_labels.json \
  models/letter/letter_label_map.json
```

Veya otomatik: `python3 scripts/validation/check_runtime_assets.py`

---

## 2. JSON Sema Tanimlari

Her dosyanin nasil okundugu + hangi alanin nerede kullanildigi.

### `word_labels.json` — Kelime label mapping

**Format**: `{kelime: int}` — 50 eleman, alfabetik sira

```json
{
  "all": 0,
  "before": 1,
  ...
  "yes": 49
}
```

**Kullanim**: `asl-web/js/ml/word-model.js::loadWordModel`

```js
wordLabels = new Array(50);
for (const [word, idx] of Object.entries(labelsData)) {
  wordLabels[Number(idx)] = word;          // wordLabels[0] = "all"
}
// predictWord: wordLabels[argmax_idx] → tahmin label'i
```

**KRITIK**: Index sirasi model output sirasi ile BIREBIR olmali. Model
`output[idx]` icin label `wordLabels[idx]` doner.

### `letter_labels.json` — Harf label mapping

**Format**: `{harf: int}` — 24 eleman

```json
{"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6, "H": 7, "I": 8,
 "K": 9, "L": 10, "M": 11, "N": 12, "O": 13, "P": 14, "Q": 15, "R": 16,
 "S": 17, "T": 18, "U": 19, "V": 20, "W": 21, "X": 22, "Y": 23}
```

J ve Z DAHIL DEGIL (dinamik isaretler).

**Kullanim**: `asl-web/js/ml/letter-model.js::loadLetterModel`

### `temperature.json` — Calibration sicakligi

**Format**:

```json
{
  "T": 0.9853780269622803,
  "ece_before": 0.0235,
  "ece_after": 0.0252,
  "usage": "Web inference icin logits / T uygulanir, sonra softmax hesaplanir."
}
```

**Kullanim**: `asl-web/js/ml/word-model.js::loadWordModel`

```js
const tempData = await fetch("./data/temperature.json").then(r => r.json());
temperature = Number(tempData.T ?? tempData.temperature ?? 1.0);
// ...predictWord: const calibrated = logits.map(x => x / temperature);
```

**KRITIK**: T degeri `notebooks/train_word_model_final.ipynb` calibration
adimindan gelir (post-train ECE optimizasyonu). Hardcode etme — JSON'dan oku.

### `per_word_stats.json` — Kelime zorluk + F1

**Format**: `{kelime: {accuracy, f1, difficulty, sample_count}}`

```json
{
  "all": {"accuracy": 0.438, "f1": 0.474, "difficulty": "hard", "sample_count": 73},
  "water": {"accuracy": 0.95, "f1": 0.91, "difficulty": "easy", "sample_count": 80},
  ...
}
```

**Kullanim**: `asl-web/js/ml/gating.js::getDifficultyMessage`

Hard word uyarisi tetiklemek icin (`difficulty === "hard"`). UI'da turuncu
"⚠ X model icin zor sinifta. Tahmini dikkatli yorumlayin." mesaji.

### `confusion_pairs.json` — Karisan kelime ciftleri

**Format**: `[{word_a, word_b, count}]` — 30 eleman, count'a gore sirali

```json
[
  {"word_a": "listen", "word_b": "hear", "count": 23},
  {"word_a": "can", "word_b": "yes", "count": 22},
  ...
]
```

**Kullanim**: `asl-web/js/ml/gating.js::getConfusionFeedback`

Top-1 ile top-2 arasi margin < 0.20 ise pair'a bakar; varsa "⚠ X / Y sik
karisir. Hareketi daha belirgin yapin." uyarisi.

### `curriculum.json` — Egitim sirasi (kolay → zor)

**Format**: Henuz UI'da kullanilmiyor (placeholder). Gelecek "ogrenme kocu"
seviye sistemi icin reserved.

### `test_sample.json` — Offline ONNX dogrulama ornegi

**Format**:

```json
{
  "features": [...],          // 7560 float (45 frame × 168 feature flat)
  "mask": [...],              // 45 bool (ilk 30 True, geri kalan False padding)
  "expected_word": "give",
  "expected_confidence": 0.07602518796920776,
  "expected_top3": [
    {"label": "give", "confidence": 0.0760},
    {"label": "dog", "confidence": 0.0476},
    {"label": "hungry", "confidence": 0.0441}
  ],
  "expected_logits": [...],   // 50 float (raw, pre-temperature)
  "temperature": 0.9853780269622803,
  "actual_frames": 30,
  "seed": 42,
  "note": "Bu dosya Python ONNX Runtime ile uretildi..."
}
```

**Kullanim**: `asl-web/js/core/app.js::runOfflineCheck` — "Offline test" butonu.

```js
const sample = await fetch("./data/test_sample.json").then(r => r.json());
const features = Float32Array.from(sample.features);
const result = await predictWord(features, sample.mask);
// Beklenen: result.label === "give" && |result.confidence - 0.076| < 1e-3
```

**Beklenen sonuc (smoke test referansi)**: `give @ 0.0760` (Δconf < 1e-3).
Mask anlami: 45 frame icinde ilk 30'u **gercek** (True), son 15'i **padding** (False).
Bu deger `scripts/validation/check_runtime_assets.py [4/4]` ve tarayicidaki
"Offline test" butonunda dogrulanir. Sapma varsa kontrat bozulmus demektir.

Onemli: **`test_sample.json` tek bir deterministic fixture'dir** — resmi test
setinin yerine **gecmez**. Kelime modelinin resmi metrikleri
`notebooks/results/classification_report.txt` icindedir (test acc %71.9,
macro F1 0.714). `test_sample.json` sadece **runtime pipeline + ONNX/temperature/
mask/label kontrati**nin canli oldugunu dogrular. Canli kayit parity'si icin
`tests/validation/check_word_feature_parity.py` (PASS / KNOWN_GAP / FAIL).

**Yeniden uretmek**: `python3 scripts/validation/generate_word_onnx_test_sample.py`

### `letter_test_sample.json` — Juri Model Test harf fixture'i

**Format**:

```json
{
  "schema_version": "asl-sample-v1",
  "task": "letter",
  "features": [...],          // 93 float
  "expected_label": "A",
  "expected_confidence": 1.0,
  "expected_top3": [
    {"label": "A", "confidence": 1.0}
  ],
  "source": "data/processed/semcom_test_landmarks.csv",
  "source_row_index": 4,
  "feature_contract": "letter-93d-v1"
}
```

**Kullanim**: `asl-web` icindeki **Model Test** sekmesi. Bu fixture web ONNX
harf modeline dogrudan 93D input verir; kamera veya MediaPipe calistirmaz.
Beklenen demo sonucu: `A -> A`.

### Model Test yukleme formati (`asl-sample-v1`)

Juri sirasinda ham Kaggle/parquet/pkl dosyasi tarayiciya dogrudan yuklenmez.
Dogru yol: Python/notebook pipeline'da kucuk fixture export etmek ve web
arayuzunde bu fixture'i calistirmaktir.

Desteklenen minimal format:

```json
{"schema_version": "asl-sample-v1", "task": "letter", "features": [93 float], "expected_label": "A"}
```

```json
{"schema_version": "asl-sample-v1", "task": "word", "features": [7560 float], "mask": [45 bool], "expected_label": "give"}
```

### `jury-samples/` — Model Test hazir ornek kutuphanesi

```text
asl-web/data/jury-samples/manifest.json
asl-web/data/jury-samples/letters/letter-a.json ... letter-y.json   (24)
asl-web/data/jury-samples/words/word-<label>-01.json                 (50)
asl-web/data/jury-samples/words/word-give-smoke.json                 (1)
```

- `letters/`: 24 statik deploy harfinin tamami icin 93D fixture bulunur
  (J/Z dahil degil; aktif model 24 statik sinif).
- `words/`: 50 gercek Kaggle held-out kelime fixture'i (`word-<label>-01.json`,
  `kind: kaggle-heldout`) + 1 deterministik `give` smoke fixture bulunur.
  Toplam 51, `manifest.json` word_count=51 ile eslesir. Ham parquet/pkl web'e
  konmaz; notebook/Python pipeline `features[7560] + mask[45]` JSON'a export eder.
- `manifest.json`: Model Test sekmesindeki hazir ornek dropdown'unu besler.

Kelime fixture export komutu:

```bash
python3 scripts/evaluation/download_kaggle_jury_subset.py \
  --output data/raw/asl-signs-jury-subset \
  --samples-per-word 1

python3 scripts/evaluation/export_jury_word_samples.py \
  --kaggle-dir data/raw/asl-signs-jury-subset \
  --samples-per-word 1
```

Ilk komut tam 56GB arsivi indirmez; once `train.csv`, sonra secilen held-out
test satirlarinin parquet dosyalarini indirir. Kaggle CLI kurulu ve
competition rules kabul edilmis olmalidir. Ham Kaggle verisi web runtime'a
veya Git'e dogrudan eklenmez; sadece export edilen kucuk JSON fixture'lar
eklenir.

---

## 3. Veri Klasoru Sorumluluklari

```
asl-web/data/                 RUNTIME contract — tarayici fetch eder, format SABIT
                              (sha hash chain ile kontrol edilir)
notebooks/results/            FINAL EXPORT kaydi — kelime modeli kaynak ciktisi;
                              asl-web/data/'in source of truth'u
notebooks/results/Grafikler/  Eğitim sonuc gorselleri (PNG); web kullanmaz
models/letter/                Harf modeli kaynak — pkl + label_map + meta + onnx_exports
data/raw/                     Lokal dataset HAM dosyalar (3 GB, gitignore'li);
                              indirme/extraction icin scripts/data_preparation/
data/processed/               Lokal dataset ISLENMIS (npy, csv, json — gitignore'li);
                              eğitim icin
data/reference/               Referans pozlar (json — gitignore'li)
legacy/word-training-experiments/data/  Eski kelime modeli yeniden eğitim pipeline kodu
                              (production source DEGIL — bkz. project-structure.md
                              "2026-04-26 refactor notu")
```

**Web runtime'i** sadece `asl-web/data/`'i fetch eder. `data/`, `notebooks/results/`,
`models/letter/` HIC fetch edilmez (cross-origin + GitHub Pages erisilemez).

---

## 4. Veri Drift Riskleri

| Risk | Etki | Tespit |
|---|---|---|
| `word_labels.json` index'i model output ile uyusmuyor | Yanlis kelime gosterilir (mapping kayar) | Offline test fail; expected_word eslemez |
| `letter_labels.json` index kayar | Yanlis harf gosterilir | Manuel kamera testi (A→A bekle, B doner) |
| `temperature.json` farkli T | Confidence dagilimi degisir, decision badge yanlis kategoride | Offline test Δconf > 1e-3 |
| `per_word_stats.json` `difficulty` yanlis kelimede | Hard word uyarisi yanlis kelimede tetiklenir | UX bozuldu, model tahmini hala dogru |
| `confusion_pairs.json` formati `{a,b}` yerine `{word_a,word_b}` | Confusion uyarisi hic tetiklenmez | UI'da uyari hic gorunmedi |
| `test_sample.json` yenilendi ama web kopyasi degil | "Offline test" eski dataya bakar, drift maskelenir | Hash chain kontrolu fail |
| ONNX yeniden export edildi ama label mapping eski | Inference cikti silinmesin | Offline test top-1 yanlis |

---

## 5. Veri Yenileme Politikasi

**Kelime modeli yeniden egitildi** (`notebooks/train_word_model_final.ipynb`):

1. Notebook calistir (Kaggle T4)
2. `notebooks/results/` icine cikti dosyalari yazilsin
3. `cp notebooks/results/word_model.onnx asl-web/models/`
4. `cp notebooks/results/{word_to_idx,temperature,per_word_stats,confusion_pairs,curriculum,test_sample}.json asl-web/data/`
   - **DIKKAT**: `word_to_idx.json` web'de `word_labels.json` adina sahip — rename ederek kopyala
5. `python3 scripts/validation/check_runtime_assets.py` — hash chain dogrulama
6. Tarayicida "Offline test" calistir — `give @ %7.6` esitliği bekle
7. `docs/current/data-contract.md` hash tablosunu guncelle

**Harf modeli yeniden egitildi** (`scripts/model_training/train_static_letter_model.py`):

1. Script calistir (yerel)
2. `models/letter/onnx_exports/` icine ONNX yazilir
3. `cp models/letter/onnx_exports/letter_model_*.onnx asl-web/models/letter_model.onnx`
4. `cp models/letter/letter_label_map.json asl-web/data/letter_labels.json`
5. Hash chain + manuel kamera testi
6. `docs/current/data-contract.md` hash tablosunu guncelle
