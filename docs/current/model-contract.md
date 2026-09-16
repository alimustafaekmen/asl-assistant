# Model Contract

> **Bu dosya kirmizi cizgi tutar.** Burada belirtilen feature siralari, ONNX I/O
> isimleri, label mapping ve normalizasyon mantigi `asl-web/` runtime'i ile
> egitim Python pipeline'i (`notebooks/train_word_model_final.ipynb` +
> `scripts/model_training/train_static_letter_model.py` + `asl-ml/`)
> arasinda **kontrat**dir. Tek bir kayma
> modelin cop tahmin uretmesine yol acar. Degisiklik yapilacaksa hem `asl-web/`
> hem source notebook/script ile ESZAMANLI yapilmali ve `data/test_sample.json`
> ile dogrulanmalidir.

---

## 1. Harf Modeli (Letter)

### Genel

| Alan | Deger |
|---|---|
| Mimari | LightGBM (gradient boosted trees) |
| Sinif sayisi | 24 (A-Y, J ve Z dinamik oldugu icin haric) |
| Lab accuracy | %99.4 (held-out) |
| Web ONNX dosyasi | `asl-web/models/letter_model.onnx` (sha `82c35482...` — no-zipmap aktif) |
| Kaynak | `scripts/model_training/train_static_letter_model.py` (masaustu Python) |
| Aktif source ONNX | `models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx` (sha 82c35482..., **tensor probabilities** verir) |
| Eski source ONNX | `models/letter/onnx_exports/letter_model_static_24_web_duplicate.onnx` (sha b206f9..., **provenance/history** — ZipMap, ORT Web 1.20-1.22'de okunamaz; runtime'a deploy edilmez) |
| Pickle yedek | `models/letter/letter_model.pkl` (provenance, runtime kullanmaz) |
| Datasets | ASL Alphabet + American Sign Language Dataset + ASL_SemCom (multi-person, 238k+42k) |

### ONNX I/O sozlesmesi (AKTIF artifact)

```text
Input  "input":           float32  shape (1, 93)
Output 0 "label":         int64    shape (1,)         argmax sinif indeksi
Output 1 "probabilities": float32  shape (1, 24)      ← TENSOR, ZipMap DEGIL
```

Aktif no-zipmap export, `probabilities`'i duz `tensor(float)[N,24]` olarak verir;
web `letter-model.js::predictLetter` bunu okuyup top-3 + confidence uretir.
`check_runtime_assets.py [4/4]` her çalıştırmada bu I/O sozlesmesini dogrular.

**ZipMap legacy fallback (sadece backwards-compat)**: Eger birisi yanlislikla
eski `_duplicate.onnx` (ZipMap) artifact'ini deploy ederse, ORT Web 1.20-1.22
`seq(map(int64,float))` extracting'i fail eder
(`Reading data from non-tensor typed value is not supported`).
`letter-model.js` bu durumda `session.run(feeds, ["label"])` ile sadece argmax
cekmeye duser ve confidence'i temporal smoother ile uretir
(bkz. runtime-pipeline.md). Bu fallback **gorsel olarak sessizdir**;
network'te eski hash gorulurse `verify_project_assets.py` hash chain'i kirilir.

### Label mapping

`asl-web/data/letter_labels.json` (sha 8c2da0...). Format `{harf: idx}`:

```json
{"A": 0, "B": 1, "C": 2, ..., "Y": 23}
```

J ve Z dinamik isaretler oldugu icin DAHIL DEGIL.

### 93D feature breakdown (KIRMIZI CIZGI)

```text
[0..62]    63D   Normalized 21 landmark
                 (wrist origin + middle MCP scale)
[63..67]    5D   Fingertip → wrist mesafeleri (5 parmak)
[68..71]    4D   Komsu fingertip mesafeleri (4 boslukta)
[72..85]   14D   Parmak eklem acilari
                 - basparmak: (1,2,3), (2,3,4)            → 2
                 - isaret:    (0,5,6), (5,6,7), (6,7,8)   → 3
                 - orta:      (0,9,10), (9,10,11), (10,11,12) → 3
                 - yuzuk:     (0,13,14), (13,14,15), (14,15,16) → 3
                 - serce:     (0,17,18), (17,18,19), (18,19,20) → 3
[86..87]    2D   El bounding box (aspect ratio + alan)
[88..92]    5D   Finger-extended binary flag (5 parmak)
                 - flag = 1.0 if dist(tip, wrist) > dist(mcp, wrist) else 0.0
─────────────
TOPLAM    93D
```

### Normalization (KIRMIZI CIZGI)

```python
# masaustu Python: src/utils.py::normalize_landmarks
coords = landmarks_63.reshape(21, 3)
coords -= coords[0]                                # 1) wrist origin
ref_dist = np.linalg.norm(coords[9])
if ref_dist > 1e-6:
    coords /= ref_dist                             # 2) middle MCP scale
return coords.flatten().astype(np.float32)
```

```js
// web JS: asl-web/js/ml/features.js::normalizeHandForLetter
// numerik olarak Python ile birebir (max_diff < 1e-4)
```

### Mirror standardization (KIRMIZI CIZGI — web tarafinda)

Masaustu Python `multi_hand_landmarks[0]` ham landmark verir; mirror YOK.
Sonuc: model right-hand-bias'li (Kaggle ASL Alphabet sag-el agirlikli).

Web `selectPrimaryHandForLetter` masaustunden FARKLI:

```js
// asl-web/js/ml/features.js
if (rightVisible >= leftVisible) return new Float32Array(right);

// Sol el dominant → x mirror (1 - x) ile sag-el formatina cevir
const mirrored = new Float32Array(63);
for (let i = 0; i < 21; i++) {
  const x = left[i * 3];
  // ...sifir landmark'lar dokunulmaz
  mirrored[i * 3] = isZero ? 0 : 1.0 - x;
  mirrored[i * 3 + 1] = y;
  mirrored[i * 3 + 2] = z;
}
```

Bu sayede sag el / sol el / telefon on kamera selfie modu — hepsi ayni 93D
feature uretir, model tutarli tahmin verir. Mirror invariance burada saglanir
(model tarafinda degil, FE tarafinda).

### Pipeline

```
MediaPipe Hand → 21 landmark
  ↓
selectPrimaryHandForLetter (mirror standardization)
  ↓
normalizeHandForLetter (wrist origin + middle MCP scale)
  ↓
computeLetterShapeFeatures (30D)
  ↓
93D feature → letter_model.onnx → label
  ↓
gating.js _smoother — temporal stability
  → confidence = (bestCount / window) × rawAvg
  ↓
updatePrediction(label, smoothedConf)
```

---

## 2. Kelime Modeli (Word)

### Genel

| Alan | Deger |
|---|---|
| Mimari | SignTransformer (encoder-only, d=128, 4 head, 2 layer) |
| Sinif sayisi | 50 ASL kelimesi (alfabetik) |
| Parametre | 446,195 |
| Test Accuracy | %71.9 |
| Test Macro F1 | 0.714 |
| Best Val F1 | 0.803 |
| Temperature | 0.985 (calibration) |
| Web ONNX dosyasi | `asl-web/models/word_model.onnx` (sha 0de173...) |
| Source ONNX | `notebooks/results/word_model.onnx` (sha 0de173...) — birebir |
| Source notebook | `notebooks/train_word_model_final.ipynb` |
| PyTorch ↔ ONNX farki | 5.96e-7 |

### ONNX I/O sozlesmesi (KIRMIZI CIZGI)

```text
Input  "input":  float32  shape (1, 45, 168)
Input  "mask":   bool     shape (1, 45)        True=gercek frame, False=padding
Output "output": float32  shape (1, 50)        50 sinif logit (softmax DEGIL)
```

**Mask anlami**: True = gercek frame, False = padding. Transformer icindeki
tersleme ONNX grafiginin ICINDEDIR; web tarafinda tersleme yapilmamali.

**Mask dtype fallback**: ONNX bool destegi tarayici/runtime varyasyonlarinda
saglikli olmayabilir. `asl-web/js/ml/word-model.js` `_buildMaskTensor` 3 adimli
fallback uygular: `bool → uint8 → int64`.

**ONNX input/output adlari**: HARDCODE EDILMEMELI. Web tarafi `session.inputNames`
ve `session.outputNames`'i runtime'da okur.

### Label mapping

`asl-web/data/word_labels.json` (sha 7d29d7...) ↔ `notebooks/results/word_to_idx.json` BIREBIR.

50 kelime alfabetik sirasinda, model output[idx] → wordLabels[idx]:

```
0:  all      10: dad      20: happy    30: look    40: sleep
1:  before   11: dog      21: have     31: mom     41: sleepy
2:  bird     12: donkey   22: hear     32: mouse   42: talk
3:  book     13: drink    23: hello    33: no      43: thankyou
4:  brother  14: duck     24: home     34: open    44: toothbrush
5:  brown    15: finish   25: hot      35: please  45: uncle
6:  bye      16: fireman  26: hungry   36: pretend 46: wait
7:  can      17: food     27: like     37: sad     47: water
8:  child    18: give     28: lips     38: shhh    48: who
9:  cow      19: go       29: listen   39: sick    49: yes
```

### 168D Compact feature breakdown (KIRMIZI CIZGI)

```text
[0..62]    63D   Dominant el landmark
                 (compute_dominant_hand_features: az sifir olan el secilir;
                  sol el dominant ise x mirror)
[63..92]   30D   El sekil ozellikleri
                 (5 tip-wrist + 4 adjacent + 10 pairwise + 5 ext + 3 angle
                  + 2 bbox + 1 avg_tip = 30)
                 normalized hand uzerinde (wrist + palm_size scale)
[93..104]  12D   El-yuz/govde mesafeleri
                 (her el icin 6: tip-nose, tip-mouth, tip-forehead,
                  wrist-nose, tip_y - nose_y, tip-wrist)
[105..167] 63D   Hareket vektorleri
                 (motion = current_dominant - previous_dominant;
                  ilk frame icin sifir)
─────────────
TOPLAM    168D
```

### Sequence (KIRMIZI CIZGI)

| Alan | Deger |
|---|---|
| Sequence stratejisi | padmask45 (45 frame + bool padding mask) |
| Buffer (web) | `frameBuffer` (app.js) — her kayit basinda RESET |
| Motion state | `previousFrame` (app.js) — her kayit basinda RESET |
| Capture suresi | ~1.5 sn (45 frame ÷ ~30 fps) |
| Frame doldurma | `mask[i] = true` for `i < frameBuffer.length`, geri kalan padding |

### 321D landmark sirasi (KIRMIZI CIZGI)

```text
[0..62]    63D   Sag el (21 landmark × 3)
[63..125]  63D   Sol el (21 landmark × 3)
[126..245] 120D  Yuz (40 secili nokta × 3, FACE_INDICES sirasi)
[246..320] 75D   Govde/pose (25 secili nokta × 3, POSE_INDICES sirasi)
─────────────
TOPLAM    321D
```

`asl-web/js/ml/landmarks.js` `FACE_INDICES` (40 eleman) ve `POSE_INDICES`
(25 eleman) `notebooks/train_word_model_final.ipynb` cell 1'deki Python
kaynagiyla BIREBIR ayni.

### Omuz normalizasyonu

Pose 11 (sol omuz) → 246 + 11×3 = 279
Pose 12 (sag omuz) → 246 + 12×3 = 282

```js
// asl-web/js/ml/landmarks.js::normalizeShoulders
const ls = [frame[279], frame[280], frame[281]];
const rs = [frame[282], frame[283], frame[284]];
const center = (ls + rs) / 2;
const width = ||ls - rs||
out[i] = (frame[i] - center[i % 3]) / width
```

### Pipeline

```
MediaPipe Holistic → 321D landmark vektoru
  ↓
normalizeShoulders (omuz-merkezli)
  ↓
buildCompactFeatures(normalized, previousFrame) → 168D
  (per-frame; sadece uyumluluk/debug icin frameBuffer'i doldurur)
  ↓
frameBuffer.push(168D)  +  normalizedFrameBuffer.push(normalized)
previousFrame = normalized   ← motion icin
  ↓
buffer.length >= 45
  ↓ ASIL inference: buildCompactSequenceFeatures(normalizedFrameBuffer)
    → dominant hand SEKANS seviyesinde secilir (final inference)
  ↓
flat 7560 + bool mask 45 → predictWord
  ↓
ort.Tensor float32 (1,45,168) + bool/uint8/int64 (1,45)
  ↓
results[outputNames[0]].data → Float32Array(50) logits
  ↓
logits / temperature (0.985)
  ↓
stableSoftmax (max-subtract numerik stabil)
  ↓
top-3 + label
  ↓
updatePrediction + confusion feedback + hard-word warning
```

---

## 3. Dogrulama (test_sample.json)

`asl-web/data/test_sample.json` (sha f28ef6...) ↔ `notebooks/results/test_sample.json` BIREBIR.

```json
{
  "features": [...],          // 7560 float (45 × 168 flat)
  "mask": [...],              // 45 bool, ilk 30 True (actual_frames=30, son 15 padding)
  "expected_word": "give",
  "expected_confidence": 0.07602...,
  "expected_top3": [{"label": "give", ...}, {"label": "dog", ...}, {"label": "hungry", ...}],
  "expected_logits": [...],   // 50 float (raw, pre-temperature)
  "temperature": 0.985378...,
  "actual_frames": 30,
  "seed": 42
}
```

Onemli: **`test_sample.json` tek bir deterministic fixture'dir**, resmi test
setinin yerine **gecmez**. Kelime modelinin resmi metrikleri
`notebooks/results/classification_report.txt` icindedir (test accuracy %71.9,
macro F1 0.714). `test_sample.json` sadece **runtime pipeline'in canli oldugunu
ve ONNX/temperature/mask/label kontratlarinin korundugunu** dogrulayan tek-ornek
bir akil-sagligi testidir.

### Beklenen sonuc

```text
✓ Esleşiyor · Beklenen: give · ONNX: give @ 0.0760 · Δconf < 1e-3 · ~25ms
```

Tarayicida "Offline test" butonu bu testi calistirir. `Δconf > 1e-3` ise
**kontrat bozulmus** demektir — ONNX/temperature/label mapping kontrol edilmeli.

### Word live pipeline parity durumu (KIRMIZI CIZGI)

`test_sample.json` deterministik fixture uzerinde calisirken, **canli kamera
recordings**'inde notebook contract'i ile web JS pipeline'i arasinda parity
korunmalidir. Daha once olculen iki gap kapatildi: final inference artik
sequence-level dominant hand kullanir ve shoulder fallback notebook min-max
fallback ile aynidir. Bu parity kontrati asagidaki tabloda ozetlenir ve
`tests/validation/check_word_feature_parity.py` ile fixture-bazli olculur.

| Kontrat | Notebook (egitim) | Web (canli) | Beklenen test |
|---|---|---|---|
| Dominant hand secimi | Sequence-level (`compute_dominant_hand_features(seq_321d)`) | Sequence-level final inference (`buildCompactSequenceFeatures`) | PASS |
| Shoulder fallback | min-max normalization (cell 6) | `normalizeShouldersFallbackMinMax` | PASS |

`test_sample.json` bu gapleri **tetiklemez** (notebook'tan birebir kopya feature
buffer kullanir), bu yuzden offline test her zaman `give @ 0.0760` verir.
Canli kayitta dogrulanmak isteniyorsa: `python3 tests/validation/check_word_feature_parity.py`
calistir; mevcut beklenen sonuc `PASS=6, KNOWN_GAP=0, FAIL=0`.

---

## 4. Kontrat Degisiklik Politikasi

| Alan | Politika |
|---|---|
| 168D segment sirasi | DEGISMEZ — degisirse word model cop tahmin |
| 93D segment sirasi | DEGISMEZ — degisirse letter model cop tahmin |
| 321D landmark sirasi | DEGISMEZ — degisirse FE bozulur |
| Mask anlami (True=real) | DEGISMEZ — ONNX graph icindeki tersleme bozulur |
| ONNX input/output adlari | Hardcode YOK; runtime'da okunur |
| Label mapping | Notebook output sirasi ile birebir; degisirse karistirma |
| Temperature | `temperature.json`'dan okunur; sabit hardcode YOK |
| Mirror standardization | Web letter modu icin gerekli; masaustunden farkli (kasitli) |

Yeni model artifact (ONNX) eklenirse:
1. `asl-web/models/{letter,word}_model.onnx`'yi degistir
2. `asl-web/data/test_sample.json`'i (gerekirse) yeniden uret
3. Tarayicida "Offline test" geçtigini dogrula
4. `scripts/validation/check_runtime_assets.py`'i calistir (hash chain)
5. `models/README.md` provenance bolumunu guncelle
