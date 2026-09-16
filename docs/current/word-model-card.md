# Word Model Card — SignTransformer 50

> **Bu dosya kelime modelinin demo/sunum stratejisi için kanıt-bazlı kartıdır.**
> Per-word performans bantları + confusion çiftleri + güvenli demo kelime
> listesi. Kaynak: `asl-web/data/per_word_stats.json` (50 sınıf) +
> `asl-web/data/confusion_pairs.json` (top 30 çift).

---

## 1. Model Özeti

| Alan | Değer | Kaynak |
|---|---|---|
| Mimari | SignTransformer (encoder-only, d=128, 4 head, 2 layer) | `notebooks/train_word_model_final.ipynb` |
| Sınıf sayısı | 50 | `asl-web/data/word_labels.json` |
| Feature dim | 168 (compact) | `docs/current/model-contract.md` |
| Sequence length | 45 frame + bool padding mask | aynı |
| Parametre | 446,195 | manifest.json |
| Test accuracy | %71.9 | manifest.json |
| Test macro F1 | 0.714 | manifest.json |
| Best validation F1 | 0.803 | manifest.json |
| Temperature (post-hoc) | 0.985 | `asl-web/data/temperature.json` |
| ECE (before/after) | 0.0235 / 0.0252 | aynı |

> Calibration kazancı çok küçük; UI confidence'ı kalibre değil — top-3 yanı
> sıra confusion-aware feedback kullanılır.

---

## 2. Performans Bantları (per-word F1)

### 🟢 GREEN — F1 ≥ 0.85 (9 sınıf, demo ana kelimeler)

| Kelime | F1 | Sample |
|---|---|---|
| water | 0.912 | 75 |
| sad | 0.910 | 80 |
| uncle | 0.909 | 79 |
| cow | 0.908 | 81 |
| brown | 0.899 | 80 |
| donkey | 0.882 | 86 |
| lips | 0.877 | 84 |
| shhh | 0.872 | 82 |
| duck | 0.851 | 88 |

### 🟡 YELLOW — 0.70 ≤ F1 < 0.85 (22 sınıf, dikkatli)

Üstler: **dad (0.838), sick (0.823), finish (0.814), home (0.812),
food (0.807), no (0.803), have (0.792), like (0.789), thankyou (0.778),
hungry (0.773), bird (0.744), wait (0.736), mouse (0.730), bye (0.717),
mom (0.717)** — alttakiler (15 sınıf): demo'da kullanılabilir ama
confusion riski var.

### 🟠 ORANGE — 0.50 ≤ F1 < 0.70 (16 sınıf, riskli)

| Kelime | F1 | Difficulty |
|---|---|---|
| toothbrush | 0.691 | medium |
| happy | 0.686 | easy |
| before | 0.657 | medium |
| hello | 0.651 | medium |
| hear | 0.639 | medium |
| yes | 0.634 | medium |
| talk | 0.625 | hard |
| listen | 0.616 | hard |
| who | 0.608 | hard |
| sleep | 0.606 | hard |
| dog | 0.594 | easy |
| can | 0.587 | hard |
| child | 0.550 | hard |
| go | 0.530 | hard |
| book | 0.512 | hard |
| sleepy | 0.510 | hard |

### 🔴 RED — F1 < 0.50 (3 sınıf, demo'da rastgele kullanma)

| Kelime | F1 | Difficulty |
|---|---|---|
| all | 0.474 | hard |
| give | 0.458 | hard |
| open | 0.427 | hard |

> Bunlar **modelin sistematik zorlandığı** sınıflar. Demo'da kasıtlı olarak
> "modelin zorlandığı kelimeler" başlığında **özellik vurgusu** olarak
> gösterilebilir (confusion-aware feedback otomatik tetiklenir).

---

## 3. En Çok Karışan Kelime Çiftleri (Top 10)

| # | Çift | Karışma sayısı |
|---|---|---|
| 1 | listen ↔ hear | 23 |
| 2 | can ↔ yes | 22 |
| 3 | open ↔ book | 20 |
| 4 | (kalan 27 çift) | … |

**Demo akışı önerisi**: Karışan çiftlerin **ikisini birden** demo'da gösterirsen
confusion-aware feedback otomatik çıkar — bu özellik tanıtılabilir.

---

## 4. Önerilen Demo Akışı

### Açılış (kullanıcı güveni inşa et) — 4 kelime

```text
1. water    (F1 0.91)
2. sad      (F1 0.91)
3. cow      (F1 0.91)
4. brown    (F1 0.90)
```

### Çeşitlilik (gesture tipi farklı) — 4 kelime

```text
5. uncle    (F1 0.91)
6. donkey   (F1 0.88)
7. lips     (F1 0.88)
8. duck     (F1 0.85)
```

### Confusion özelliği vurgu (kasıtlı) — 2 kelime

```text
9. open     (F1 0.43) → confusion-aware feedback "open ↔ book" tetiklenir
10. give     (F1 0.46) → "modelin zorlandığı sınıf" anlatımı
```

### Yedek güvenli orta seviye — 4 kelime

```text
finish (F1 0.81), home (F1 0.81), dad (F1 0.84), thankyou (F1 0.78)
```

### KESİNLİKLE rastgele demo'ya alma

```text
all, give, open                      (RED — F1 < 0.50)
listen, hear, can, yes, sleep, dog,
child, go, book, sleepy, who, talk    (ORANGE + confusion top'ta)
```

> Bu kelimelerin demo'ya alınması "kasıtlı confusion özellik vurgusu" olarak
> çerçevelenmedikçe risk yüksek.

---

## 5. Canlı Kullanımda Beklenen Davranış

| Faktör | Etki |
|---|---|
| Yüz/omuz görünmüyor | Frame buffer dolmaz, recording uzar (HUD ile uyarı verir) |
| Hızlı gesture | 45 frame'e sığmaz, kesik sequence oluşur |
| Yavaş gesture | 45 frame'e sığar; pose/face kaybı riski daha düşük |
| Yan ışık | MediaPipe handedness score düşer (letter gate'i word'e direkt etki etmiyor ama landmark kalitesi etkilenir) |
| Kullanıcı kameraya çok yakın | Yüz kadrajda ama omuzlar dışarıda → poseVisible düşük |

> `aslDebug.wordDebug` her kayıt sonrası `visibility.{hand,pose,face}Ratio`,
> `qualityWarnings`, `feature168Stats`, `motionStats`, `prediction.top3` döndürür —
> demo öncesi kalibrasyon için kullan.

---

## 6. İlgili Dokümanlar

- [`model-contract.md`](model-contract.md) — ONNX I/O sözleşmesi
- [`data-contract.md`](data-contract.md) — JSON şemaları + provenance
- [`runtime-pipeline.md`](runtime-pipeline.md) — pipeline akışı
- [`demo-plan.md`](demo-plan.md) — jüri sunumu detayları
- [`../../README.md`](../../README.md) — proje genel
- [`../../HANDBOOK.md`](../../HANDBOOK.md) — yolculuk-bazlı rehber
