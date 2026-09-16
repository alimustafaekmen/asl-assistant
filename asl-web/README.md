# ASL Sign Language Assistant — Web Uygulaması

Tarayıcıda gerçek zamanlı ASL (Amerikan İşaret Dili) tanıma. Vanilla
HTML/CSS/JS, build step yok, tek dosya bağımlılığı CDN'den (ONNX Runtime
Web + MediaPipe Tasks Vision).

## Modüller

| Mod | Ne yapar |
|---|---|
| **Harf** | 24 ASL harfini sürekli tanır (LightGBM ONNX, %99.4 lab accuracy) |
| **Kelime** | 50 ASL kelimesini 45 frame kayıtla tanır (SignTransformer, %71.4 test F1) |
| **Koç** | Hedef harf/kelime seç, kameradan pratik yap, ilerleme takibi |
| **Model Test** | Jüri için JSON fixture yükler, ONNX çıktısını ve top-3 sonucu gösterir |
| **Proje** | Akademik özet (model, deney, sınırlılıklar) |

## Lokal çalıştırma

```bash
cd asl-web
python3 -m http.server 8080
# Tarayıcı → http://localhost:8080
```

ONNX modellerinin yüklenmesi için statik dosya sunucusu gerekli; `file://`
ile direkt açma çalışmaz (CORS).

İlk açılışta tarayıcı `Modeller yükleniyor...` gösterir → ~1-2 saniye
sonra `Modeller hazır: Harf ✓, Kelime ✓` görünmeli. F12 console'da:
```
Word ONNX inputs: ['input', 'mask']
Word ONNX outputs: ['output']
Letter ONNX outputs: ['label', 'probabilities']
Kelime modeli yüklendi. T=0.985..., 50 kelime
```

## Klavye kısayolları

| Tuş | İşlev |
|---|---|
| `Ctrl+D` | Debug paneli (latency, FPS, frame count) |
| `Space` | Harf modu — tahmini transcript'e ekle |
| `S` | TTS — transcript'i sesli oku |
| `C` | Transcript'i temizle |
| `M` | Modlar arası dön |

## GitHub Pages dağıtımı

Tüm yollar relative (`./models/`, `./data/`, `./assets/`) olduğu için
`asl-web/` klasörü statik site olarak yayınlanabilir. CDN bağımlılıkları
(`onnxruntime-web@1.22.0`, `@mediapipe/tasks-vision@0.10.18`) dış erişim
gerektirir.

QR ile canlı kamera demosu için public **HTTPS** gerekir. Telefon tarayıcıları
`http://192.168.x.x` gibi düz HTTP adreslerde kamera erişimini engelleyebilir.

Önerilen deploy yolları:

- Netlify: publish directory `asl-web`, build command boş.
- GitHub Pages root yayını: demo linki
  `https://<kullanici>.github.io/<repo>/asl-web/#letter`.
- GitHub Actions Pages: `asl-web/` klasörünü artifact olarak publish et.

QR için önerilen giriş linki:

```text
https://asl-demo.netlify.app/#letter
```

Bu link Harf Çeviri modunu doğrudan açar. Jüri telefonu ile QR'ı okutur,
siteyi normal web sayfası olarak açar, `Kamerayı Başlat` ile canlı harf
modelini deneyebilir.

`QR Demo` sekmesi aynı bağlantıyı büyük ve animasyonlu QR olarak üretir.
Hedef seçimi:

- `Canlı Harf` → `#letter`, jüri için en stabil telefon demosu.
- `Kelime` → `#word`, telefonla denenebilir ama ışık/kadraj daha hassastır.
- `Model Test` → `#test`, kamera gerektirmeyen yedek demo.

Aktif demo adresi:

```text
https://asl-demo.netlify.app/
```

`asl-web/` **tek başına çalışır** — hiçbir Python paketine, `asl-ml/`'ye
veya `asl-desktop/`'a bağımlı değildir. Tarayıcıda ONNX Runtime Web (WASM)
ve MediaPipe Tasks Vision JS kullanılır.

## Demo stratejisi

### Önce kontrol et
1. **Offline test** butonu — `data/test_sample.json` ile ONNX
   doğrulaması. Beklenen sonuç: `✓ Eşleşiyor · Beklenen: give · ONNX: give @ 0.0760`.
   Bu çalışıyorsa model+pipeline tamam, sadece kamera bağımlılığı kaldı.
   Not: `test_sample.json` tek deterministic fixture'dır; resmi test F1
   değildir. Resmi metrikler için `notebooks/results/classification_report.txt`
   (test acc %71.9, macro F1 0.714).
2. **Model Test** sekmesi — jüriye doğrudan model çıktısı göstermek için:
   - Hızlı demo butonları: `Harf A Demo` ve `Kelime Bird Demo`.
   - Hazır harf kütüphanesi: `data/jury-samples/letters/*.json` → 24 statik harfin tamamı.
   - Hazır kelime kütüphanesi: `data/jury-samples/words/*.json` → 50 kelime fixture'ları.
   - Varsayılan kelime demo örneği güçlü fixture olarak `bird` seçilir; düşük güvenli örnekler panelden ayrıca seçilebilir.
   - Dışarıdan yüklenen veya sürükle-bırak yapılan JSON da desteklenir.

### Görsel referans assetleri

Referans alanı iki domain için ayrı davranır:

| Domain | Asset | UI davranışı |
|---|---|---|
| Harf | `assets/signs/letters.png` | Tek harf referans kartı olarak gösterilir |
| Kelime | `assets/signs/word-1.png` ... `word-5.png` | 5 sayfalık kelime referans galerisi, alttaki sayfa butonlarıyla gezilir |
| Legacy/genel | `assets/signs/kelime.png` | Eski geniş poster, geriye dönük asset olarak tutulur |

Yeni kelime referans görseli eklenecekse `js/core/app.js` içindeki
`REFERENCE_ASSETS.wordPages` listesi ve `scripts/validation/check_runtime_assets.py`
minimum asset kontrolü birlikte güncellenmelidir. Ardından `make health`
çalıştırılmalıdır.

### Model Test JSON formatı

```json
{
  "schema_version": "asl-sample-v1",
  "task": "letter",
  "features": [0.0],
  "expected_label": "A"
}
```

```json
{
  "schema_version": "asl-sample-v1",
  "task": "word",
  "features": [0.0],
  "mask": [true],
  "expected_label": "give"
}
```

Gerçek uzunluklar:

| Task | Girdi |
|---|---|
| `letter` | `features` tam **93** float |
| `word` | `features` tam **7560** float (`45×168`) + `mask` tam **45** bool |

Kaggle ham parquet/pkl/json dosyaları tarayıcıya doğrudan yüklenmez. Önce Python/notebook
pipeline ile bu küçük fixture formatına export edilir, sonra Model Test sekmesinde
çalıştırılır. Böylece web demo stabil kalır ve ham veri Git'e taşınmaz. Kelime tarafında
gerçek held-out örnek sayısını artırmak için Kaggle ASL Signs `train_landmark_files`
verisinden seçilen örnekler notebook'taki `321D -> 168D -> 45 frame + mask`
pipeline'ından geçirilmelidir.

Kelime fixture export komutu:

```bash
python3 scripts/evaluation/download_kaggle_jury_subset.py \
  --output data/raw/asl-signs-jury-subset \
  --samples-per-word 1

python3 scripts/evaluation/export_jury_word_samples.py \
  --kaggle-dir data/raw/asl-signs-jury-subset \
  --samples-per-word 1
```

İlk komut Kaggle CLI ile sadece gerekli küçük alt kümeyi indirir. Kaggle CLI
kurulu ve Kaggle hesabında competition rules kabul edilmiş olmalıdır.

### Demo akışı
1. **Kolay kelime** ile başla (yüksek F1):
   - water (0.91), sad (0.91), cow (0.91), uncle (0.91), brown (0.90)
2. **Zor kelimeden kaçın** (başlangıçta):
   - open (0.43), give (0.46), all (0.47), sleepy (0.51), book (0.51)
   - Bunları "modelin zorlandığı sınıflar" olarak sonra göster.
3. **Yedek video** hazırda — kamera/MediaPipe sorununda hızlı geçiş.
4. **Kamera çalışmıyorsa** → Offline test ile demo. ONNX çalıştığını
   gösterir, kamera dependency'sini ortadan kaldırır.

### Hata senaryoları
| Sorun | Belirti | Çözüm |
|---|---|---|
| Kamera izni reddi | "Kamera izni reddedildi" | Adres çubuğundan izin ver |
| Model 404 | "Model yüklenemedi" | Network tab'da kontrol et, CDN/path |
| MediaPipe yüklenemedi | "MediaPipe yok" badge | İnternet kontrol — CDN'den iniyor |
| Kelime kaydı ilerlemiyor | "Hand + Pose + Face" uyarısı | Yüz, omuzlar ve el aynı kadrajda olmalı |
| HTTPS olmayan | "HTTPS gerekli" | `localhost` veya HTTPS üzerinden aç |
| Kelime tahmini yavaş | Tahmin gelmiyor | Kayıt 45 frame topluyor (~1.5 sn) |

## Konfigurasyon

`js/core/app.js` üst kısımdaki `CONFIG` objesi (mod-spesifik eşikler dahil):

```js
// Harf modu eşikleri (LightGBM 24 sınıf, top-1 tipik 0.5–0.95)
LETTER_UNKNOWN: 0.45        // <0.45 → "emin değilim"
LETTER_CONFIDENT: 0.65      // ≥0.65 → "güvenli"
LETTER_ACCEPT: 0.60

// Kelime modu eşikleri (SignTransformer 50 sınıf, top-1 tipik 0.05–0.30)
WORD_UNKNOWN: 0.10
WORD_CONFIDENT: 0.20
WORD_ACCEPT: 0.15

// Diğer
TOP_K: 3                    // alternatives sayısı
WORD_FRAME_COUNT: 45        // kelime modunda kayıt frame sayısı (model girişi)
COUNTDOWN_SECONDS: 3        // kayıt öncesi geri sayım
LETTER_SMOOTHER_WINDOW: 5   // harf modu mode-of-N filtresi
SELFIE_HANDEDNESS_SWAP: false // demo öncesi gerçek kamerada doğrula
```

`_thresholdsForMode()` yardımcısı `state.mode`'a göre uygun eşikleri seçer.
Eşik değişiklikleri canlı demo davranışını etkiler — değiştirmeden önce
mod-spesifik sınıf sayısına göre tipik confidence aralıklarını gözden geçir.

## Pipeline özeti

```
Kamera → MediaPipe Holistic (Hand+Pose+Face)
       → 321D landmark vektörü (sağ el 0-62, sol el 63-125, yüz 126-245, gövde 246-320)
       → Omuz-merkezli normalizasyon
       
Harf modu:
  → Dominant el 63D + shape 30D = 93D feature
  → letter_model.onnx (LightGBM, no-zipmap export — tensor probabilities)
  → 5-frame mode smoother
  → top-3

Kelime modu:
  → Normalized 321D frame buffer
  → Sequence-level compact 168D feature (dom 63 + shape 30 + handBody 12 + motion 63)
  → Hand + Face + Pose görünmüyorsa frame buffer'a yazma
  → 45 frame buffer + bool mask
  → word_model.onnx (SignTransformer)
  → logits / T (=0.985) → softmax → top-3
  → Confusion-aware feedback (margin < 0.2 → uyarı)
```

## Bilinen sınırlılıklar

- Tek signer-independent split — multi-seed yok
- No-sign / unknown sınıfı yok (confidence threshold ile yaklaşık)
- Bazı kelimeler düşük F1 (open, give, all, sleepy)
- Augmentation mask-aware değil
- ORT Web ZipMap limiti (legacy): eski `_duplicate.onnx` artifact'i
  `seq(map(int64,float))` cikartmasi tarayicida fail ederdi → şu an
  aktif artifact no-zipmap export, `probabilities` direkt `tensor(float)[N,24]`.
  `letter-model.js` içindeki label-only fallback yalnızca yanlışlıkla eski
  artifact deploy edilirse devreye girer (sessizdir; hash chain ile yakalanır).
- Kelime canlı pipeline parity düzeltildi: final inference artık
  sequence-level dominant hand ve notebook min-max shoulder fallback ile
  çalışır. `tests/validation/check_word_feature_parity.py` beklenen çıktı:
  `PASS=6, KNOWN_GAP=0, FAIL=0`.
- MediaPipe selfie-mode handedness'i tarayıcı/driver'a göre değişebilir;
  demo öncesi gerçek kamerada test edilmeli (sağ el kaldır → "Right" mı?)
- CDN bağımlılığı: jsdelivr (ort + tasks-vision) ve googleusercontent
  (mediapipe `.task`) — çevrimdışı çalışmaz

## Dosya yapısı

```
asl-web/
├── index.html               UI
├── css/style.css            Tema + responsive
├── js/
│   ├── core/app.js          Mode/state machine, UI, init
│   ├── media/camera.js      MediaPipe + realInference + word recording
│   ├── ml/landmarks.js      MP result → 321D + omuz normalize
│   ├── ml/features.js       Compact 168D + Letter 93D
│   ├── ml/letter-model.js   ONNX LightGBM (no-zipmap; legacy fallback korunur)
│   ├── ml/word-model.js     ONNX SignTransformer (mask fallback)
│   ├── ml/gating.js         Confusion + difficulty + smoother
│   └── services/benchmark.js Latency ölçüm (mp/fe/onnx/total)
├── models/
│   ├── letter_model.onnx    24 sınıf, ~13 MB
│   └── word_model.onnx      50 sınıf, 1.85 MB
├── data/
│   ├── word_labels.json     {word: idx}, 50 eleman
│   ├── letter_labels.json   {letter: idx}, 24 eleman
│   ├── temperature.json     {T: 0.985}
│   ├── per_word_stats.json  {word: {accuracy, f1, difficulty}}
│   ├── confusion_pairs.json [{word_a, word_b, count}]
│   ├── curriculum.json      Kolay→zor sıra
│   ├── letter_test_sample.json Harf Model Test fixture (A → A, 93D)
│   ├── jury-samples/
│   │   ├── manifest.json    Model Test hazır örnek listesi
│   │   ├── letters/         24 harf için 93D fixture
│   │   └── words/           Kelime fixture'ları (şu an give smoke)
│   └── test_sample.json     ONNX doğrulama fixture (give @ 0.0760, mask 30/45 gerçek)
└── assets/signs/
    ├── letters.png          Harf rehberi
    └── kelime.png           Kelime rehberi
```
