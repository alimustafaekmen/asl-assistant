# Runtime Pipeline

> Bu dokuman `asl-web/` tarayici runtime'inin **inference akisini** uctan uca
> belgeler: kameradan tahmin gosterimine. Her asama icin sorumlu dosya, kritik
> guard ve UI etkisi yazilir. Yeni geliştirici buradan baslayip kodu izleyebilir.

---

## 1. Genel Akis

```
┌─────────────────┐
│  index.html     │  4 mod tab + kamera + paneller + countdown overlay
└────────┬────────┘
         │ DOM hazir
         ▼
┌─────────────────┐
│  core/app.js    │  init() → bindEvents → restoreTranscript →
│                 │  setMode("letter") → loadModelsWithStatus
└────────┬────────┘
         │ Modeller hazir
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Kullanici "Başlat" butonuna basar                              │
│  toggleCamera → getUserMedia → state.cameraOn = true            │
│             → startMediaPipe(els.video) (camera.js)             │
└────────┬────────────────────────────────────────────────────────┘
         ▼
┌─────────────────┐
│  media/camera.js│  startMediaPipe → import vision_bundle.mjs →
│                 │  3 landmarker (Hand → mpRunning=true; Pose+Face
│                 │  arka planda) → requestAnimationFrame(_processFrame)
└────────┬────────┘
         │ MediaPipe rAF dongusu (~60 fps)
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  _processFrame                                                   │
│    detectForVideo(hand, pose?, face?) → adapt {rh,lh,face,pose} │
│    → latestMediaPipeResult global guncelle                       │
│    → recordBenchmark("mediapipe", elapsed)                       │
│    → requestAnimationFrame(_processFrame)                        │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼  (paralel)
┌──────────────────────────────────────────────────────────────────┐
│  app.js renderLoop (rAF, ~60 fps)                                │
│    updateFps(now)                                                │
│    drawOverlay(now)         ← drawLandmarks(latestMediaPipeResult)│
│    if (state.cameraOn) realInference(now)                        │
│      letter mode: throttle 120ms                                 │
│      word/coach: her frame                                       │
│    updateMediaPipeStatus → latency badge                         │
│    updateDebug → debug panel                                     │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  camera.js realInference (async, _inferenceInFlight guard)       │
│    raw = landmarksTo321D(latestMediaPipeResult)                  │
│    normalized = normalizeShoulders(raw)                          │
│                                                                  │
│    if mode === "letter":                                         │
│      f93 = computeLetterFeatures(raw)                            │
│      result = await predictLetter(f93)                           │
│      smoothed = smoothLetterPrediction(result)                   │
│      updatePrediction(smoothed)                                  │
│                                                                  │
│    elif mode === "word" || coach-word:                           │
│      if state.wordState === "RECORDING":                         │
│        compact = buildCompactFeatures(normalized, previousFrame) │
│        frameBuffer.push(compact)                                 │
│        previousFrame = normalized                                │
│        if (buffer.length >= 45) await _finishWordRecordingReal() │
│                                                                  │
│    elif mode === "coach" (letter target):                        │
│      same as letter mode + updateCoachFromPrediction()           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Mod Bazli Pipeline

### Harf Modu (sürekli inference)

```
MediaPipe Hand → 21 landmark
  ↓ (camera.js _processFrame: 60 fps)
landmarksTo321D → 321D vector (rh slot dolu, lh sifir, face sifir, pose sifir)
  ↓ (camera.js realInference: 120ms throttle)
computeLetterFeatures(raw)              ← features.js
  ├─ selectPrimaryHandForLetter
  │   └─ rh dolu ise direkt
  │   └─ lh dolu ise x mirror (1-x) ile sag-el formatina cevir   ⚠ KRITIK
  ├─ normalizeHandForLetter
  │   ├─ wrist origin (-coords[0])
  │   └─ middle MCP scale (/||coords[9]||)
  └─ computeLetterShapeFeatures: 30D
  → 93D feature
  ↓
predictLetter(f93)                      ← letter-model.js
  ├─ Birincil: session.run(feeds) → probabilities tensor (1,24)
  │   └─ Aktif no-zipmap export: tensor(float)[N,24] → top-3 + raw confidence
  └─ Legacy fallback (sadece eski ZipMap artifact yanlislikla deploy edilirse):
      session.run(feeds, ["label"])
      └─ argmax label dondur; confidence smoother-derived olur
  ↓
smoothLetterPrediction(result)          ← gating.js _smoother
  ├─ buffer.push(prediction) → max 5 eleman (CONFIG.SMOOTHER_WINDOW)
  └─ Confidence formul: (bestCount / window) × rawAvg
      ├─ Stabil 5/5 ayni harf: 1.0 × 1.0 = 1.0  → yesil "Guvenli"
      ├─ Karisik 3/5: 0.6 × 1.0 = 0.6           → sari "Muhtemel"
      └─ Tek frame sicrayisi: 0.2 × 1.0 = 0.2  → gri "Emin degil"
  ↓
updatePrediction(smoothed)              ← app.js
  ├─ state.prediction, state.confidence, state.top3 set
  ├─ Confidence ring (--score) + border rengi (good/maybe/low)
  ├─ Decision label ("Guvenli" / "Muhtemel" / "Emin degil")
  ├─ renderTop3 (alternatives gosterir)
  └─ updateMessageForPrediction (UI mesaji)
```

**Throttle**: 120ms (renderLoop). 60 fps dongude her ~7-8 frame'de bir
`predictLetter` cagrilir. Stabil tahmin icin yeterli, GPU yormaz.

### Kelime Modu (state machine)

```
IDLE
  ↓ Kullanici "Kelime kaydı" butonuna basar
  ↓ app.js startWordRecording
  ├─ Guards:
  │   - state.cameraOn ?
  │   - mod uygun mu (word veya coach-word) ?
  │   - mpRunning ?
  │   - poseLandmarker + faceLandmarker hazir mi ?
  │   - wordState IDLE/RESULT mi ?
  ├─ frameBuffer = []                    ⚠ MOTION RESET
  ├─ previousFrame = null                ⚠ MOTION RESET
  ├─ wordState = "COUNTDOWN"
  └─ updateWordState
COUNTDOWN
  ↓ Async loop: 3-2-1, her sn (~720ms) countdown overlay guncelle
  ↓ Her iterasyon basinda guard:
  │   - state.cameraOn ?
  │   - canCaptureWordInCurrentMode ?
  │   - wordState hala COUNTDOWN mu ?
  ↓ Loop bitti
  ├─ wordState = "RECORDING"
  └─ cameraStage[data-state] = "recording" (CSS sari border + glow)
RECORDING
  ↓ camera.js realInference (her frame, throttle YOK)
  ├─ Guards:
  │   - latestMediaPipeResult var mi ?
  │   - rh veya lh hand var mi ?
  │   - _hasRequiredWordLandmarks: hand + pose + face hepsi var mi ?
  │     └─ Yoksa: "Kelime kaydi icin el, yuz ve omuzlar..." mesaji (throttled)
  ├─ raw = landmarksTo321D(latestMediaPipeResult)
  ├─ normalized = normalizeShoulders(raw)
  ├─ compact = buildCompactFeatures(normalized, previousFrame)  ← 168D
  │   (per-frame; sadece uyumluluk/debug icin frameBuffer'i doldurur)
  │   ├─ dominant hand (63D)
  │   ├─ shape features (30D)
  │   ├─ hand-body relations (12D)
  │   └─ motion = current_dominant - previous_dominant (63D)
  ├─ frameBuffer.push(compact)               ← compat/debug buffer
  ├─ normalizedFrameBuffer.push(normalized)  ← ASIL inference bunu kullanir
  ├─ previousFrame = normalized
  ├─ state.wordFrames = frameBuffer.length
  └─ updateWordState (progress bar)
  ↓ buffer.length >= 45
PROCESSING
  ↓ _finishWordRecordingReal (camera.js)
  ├─ wordState = "PROCESSING"
  ├─ seq = buildCompactSequenceFeatures(normalizedFrameBuffer)  ← ASIL yol
  │   └─ dominant hand SEKANS seviyesinde secilir (final inference):
  │      tum kayit boyunca tek karar. frameBuffer per-frame fallback kalir.
  ├─ flat = Float32Array(45 × 168 = 7560)  ← seq'ten doldurulur
  ├─ mask = Array(45) of False
  │   └─ for i in 0..44: flat.set(seq[i], i*168); mask[i] = True
  ├─ result = await predictWord(flat, mask)         ← word-model.js
  │   ├─ ort.Tensor float32 (1, 45, 168)
  │   ├─ _buildMaskTensor: bool / uint8 / int64 fallback
  │   ├─ session.run(feeds) → results[outputNames[0]].data
  │   ├─ logits / temperature (0.985)
  │   ├─ stableSoftmax (max-subtract)
  │   └─ top-3 + label
  ├─ Mode/cameraOn guard (kullanici mod degistirmis olabilir)
  │   └─ Yapmissa: state.wordState=IDLE, buffers reset, return
  ├─ updatePrediction(result)
  ├─ Confusion feedback (margin < 0.20 ve confusion_pairs.json'da var ise)
  ├─ Hard word feedback (per_word_stats.json'da difficulty="hard" ise)
  ├─ if confidence >= WORD_ACCEPT_THRESHOLD: acceptPrediction(false)
  ├─ wordState = "RESULT"
  ├─ frameBuffer = []                  ⚠ MOTION RESET (sonraki kayit icin)
  └─ previousFrame = null              ⚠ MOTION RESET
RESULT
  ↓ Kullanici "Kelime kaydı" tekrar basar veya mod degistirir
  └─ IDLE (yeniden)
```

---

## 3. State Machine Reset Noktalari

`asl-web/js/core/app.js` icinde **frameBuffer + previousFrame** reset 4 yerde:

| Yer | Sebep |
|---|---|
| `setMode(newMode)` baslangic | Mod degisince eski tahmin sızmasin |
| `stopCamera` | Kamera durdurulunca temiz state |
| `startWordRecording` baslangic | Yeni kayit, motion sifirla |
| `_finishWordRecordingReal` sonu | Sonraki kayit icin temiz state |

`_smoother.reset()` (gating.js) reset noktalari:

| Yer | Sebep |
|---|---|
| `setMode(newMode)` | Letter buffer'i karistirma |
| `coachTarget change` event | Hedef harf degisince eski tahminler sizmasin |
| `stopCamera` | Temiz state |

---

## 4. Confidence ve UI Davranisi

### Mod-spesifik esikler

`asl-web/js/core/app.js::_thresholdsForMode()`:

| Mod | UNKNOWN | CONFIDENT | ACCEPT |
|---|---|---|---|
| Harf (letter, coach-letter) | 0.45 | 0.65 | 0.60 |
| Kelime (word, coach-word) | 0.10 | 0.20 | 0.15 |

**Neden farkli?** 50-sinif SignTransformer top-1 confidence tipik 0.05-0.30
araliginda. 24-sinif LightGBM top-1 tipik 0.5-0.95. Esikler model dağilimina
uyarli olarak ayarlanmis. Smoother sayesinde harf modu confidence 0-1.0
araliginda dolasir; kelime modu raw softmax dondurur.

### UI tepkisi

| Confidence | Border | Decision badge | UI mesaji |
|---|---|---|---|
| `< unknown` | gri | "Emin degil" | "Emin degilim. Isik/aci/konum iyilestir." |
| `unknown ≤ c < confident` | sari | "Muhtemel" | "Muhtemel sonuc: X. Alternatifleri kontrol et." |
| `≥ confident` | yesil | "Guvenli" | "X guvenli gorunuyor." |

### Recording rengi

Kelime modu RECORDING durumunda border **sari** + **glow pulse** animasyon.
`updatePrediction` `els.cameraStage.dataset.state` 'i confidence level'a degil
`"recording"` 'a set eder bu sırada.

### Latency badge

`updateMediaPipeStatus` (saniyede 1):

- "MP: bekleniyor..." → MediaPipe baslamadi
- "MP: 1/3 hazir" → Hand hazir, Pose+Face arka planda yukleniyor
- "MP: 3/3 hazir" → Hepsi hazir
- "✋ El bekleniyor" → MediaPipe calisiyor ama el goremiyor (5 sn sonra setMessage)
- "✓ El: R · 60 fps" → El algilandi, fps gosterimi

---

## 5. Latency Olcumu (`benchmark.js`)

`recordBenchmark(stage, ms)` her asamada cagrilir:

| Stage | Olculen yer | Tipik degerler |
|---|---|---|
| `mediapipe` | _processFrame detect cagrilari | ~10-30 ms (GPU delegate) |
| `feature` | buildCompactFeatures + computeLetterFeatures | ~0.5-2 ms |
| `onnx` | predictLetter, predictWord | letter ~1-5 ms, word ~50-100 ms |
| `total` | realInference toplam | ~15-150 ms |

`getBenchmarkSummary()` son 30 olcumun ortalamasini doner. Debug paneli
(Ctrl+D) "mp:X fe:Y onnx:Z total:T" formatinda gosterir.

---

## 6. Hata Akislari

| Hata noktasi | Davranis | UI mesaji |
|---|---|---|
| `getUserMedia` reddedildi (NotAllowedError) | toggleCamera catch, state cameraOn=false | "Kamera izni reddedildi. Tarayici adres cubugundan izin verin." |
| Kamera bulunamadi (NotFoundError) | aynisi | "Kamera bulunamadi. Cihazda webcam takili mi?" |
| HTTPS yok (HTTP'de mediaDevices undefined) | toggleCamera early return | "Kamera icin HTTPS veya localhost gerekiyor." |
| MediaPipe import fail (CDN) | startMediaPipe catch, mpRunning=false | "MediaPipe modeli yuklenemedi. Internet baglantisi kontrol edin." |
| ONNX model 404 | loadModelsWithStatus catch | "Model yuklenemedi. ./models/ altinda ONNX dosyalari var mi?" |
| Letter ONNX eski ZipMap artifact yanlislikla deploy edildi | label-only fallback aktif (otomatik); aktif no-zipmap artifact sorun yasamaz | (sessiz, bir kez warn log'u) — hash chain ile yakalanir |
| MediaPipe el algilamiyor | latestMediaPipeResult var ama hand null | "✋ El bekleniyor" badge + 5 sn sonra setMessage |
| word recording hand+pose+face yok | _hasRequiredWordLandmarks fail | "Kelime kaydi icin el, yuz ve omuzlar ayni anda gorunmeli" (throttled) |
| word inference hatasi | _finishWordRecordingReal catch | console.error, wordState=RESULT yine setlenir |
| realInference exception | try/catch ile yakala | console.error, _inferenceInFlight finally'da false |

---

## 7. Performance ve Reliability Notlari

| Konu | Davranis |
|---|---|
| Model loading | Tek seferlik (init'te `Promise.all(loadLetterModel, loadWordModel, loadGatingData)`) |
| Model warmup | `warmupWordModel` + `warmupLetterModel` dummy inference, ilk gercek inference latency'sini dusurur |
| Frame buffer memory | Maksimum 45 × 168 × 4 byte = ~30 KB; her kayit basinda reset |
| MediaPipe rAF lifecycle | mpRunning bayragi ile durdurulabilir; stopMediaPipe `?.close()` cagrir |
| Reentrancy guard | `_inferenceInFlight` async predictLetter/predictWord cakisma onler |
| Throttle (letter mode) | renderLoop 120ms throttle (state.lastTick); 60fps × throttle = ~7-8 frame'de bir inference |
| CDN bagimliligi | jsdelivr (ort + tasks-vision) + googleusercontent (mediapipe `.task`); demo network koparsa kelime canli tahmin yok ama Offline test çalisir |
| Cache busting | `index.html` script src'lerde `?v=N` query; manuel artirilir |
| Window debug | `window.aslDebug.dump()` console'da state introspection |

---

## 8. Demo Oncesi Pipeline Smoke Test

```bash
# 1. Lokal server
cd asl-web && python3 -m http.server 8080

# 2. Tarayici → http://localhost:8080
# 3. Console'da:
window.aslDebug.dump()
# Beklenen:
#   models.wordSession: true, letterSession: true
#   models.wordLabels: 50, letterLabels: 24
#   models.temperature: 0.9853780269622803

# 4. "Offline test" butonu
# Beklenen UI:
#   ✓ Esleşiyor · Beklenen: give · ONNX: give (%7.6) · Δconf=2.5e-7 · ~25ms

# 5. "Başlat" → kamera izni ver
# Beklenen badge: "MP: 3/3 hazir" → "✋ El bekleniyor"

# 6. El göster → "✓ El: R · 60 fps" badge
# Beklenen: harf modunda yesil border + tahmin gorunur
```

Bu adimlar gecerse pipeline saglam — demo guvenli.
