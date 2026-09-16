# ASL Assistant — Projeye Tam Hakimiyet Rehberi

> Bu dokuman seni projenin her kosesine hakim yapacak.
> Okuduktan sonra juriye her soruyu, her detayi, her "neden?"i cevaplayabileceksin.
> Hicbir kavram, hicbir karar, hicbir teknik detay aciklamasiz birakilmadi.

---

# BOLUM A: TEMELDEN BASLAYALIM — KAVRAMLAR

Projeyi anlamadan once, kulllanilan temel kavramlari bilmen lazim. Bunlari bilmeden kodu, modeli, kararlari anlayamazsin.

---

## A1. Makine Ogrenmesi (ML) Nedir?

Makine ogrenmesi, bilgisayara ACIKCA kural yazmadan, VERIDEN ogrenmesini saglamak. Ornek: "A harfini tanimak icin basparmak yanda olmali" diye kural yazmaiyorsun. Bunun yerine binlerce "A" harfi ornegi veriyorsun, model kendi KURALLARINI veriyi inceleyerek buluyor.

Iki ana yaklasim var:
- **Supervised Learning (Denetimli Ogrenme):** Veriye etiket koyarsın ("bu foto A harfi", "bu foto B harfi"). Model etiketli orneklerden ogrenir. Bizim tum modellerimiz bu yaklasimi kullaniyor.
- **Unsupervised Learning:** Etiketsiz veriyle calisir. Biz kullanmiyoruz.

## A2. Classification (Siniflandirma) Nedir?

Bir girdi alip onu onceden belirlenmis siniflardan birine atama. Bizim iki siniflandirma problemimiz var:
- **Harf siniflandirmasi:** 93 sayilik ozellik vektoru → 24 siniftan biri (A, B, C, ..., Y)
- **Kelime siniflandirmasi:** 30 frame'lik hareket sekansı → 25 siniftan biri (hello, yes, no, ...)

## A3. Train / Validation / Test Nedir?

Veriyi uc parcaya boluyoruz:
- **Train (%70-85):** Model bundan ogrenir. Agirliklarini bu veriyle gunceller.
- **Validation (%15):** Egitim sirasinda modelin "ne kadar iyi gidiyor?" sorusuna cevap verir. Model bu veriyi GORMEZ ama biz buna bakarak ayar yapariz (ornegin ne zaman durduracagimiza karar veririz).
- **Test (%15):** En son, her sey bittikten sonra SADECE BIR KEZ test ederiz. Bu bizim "gercek" dogrulugumuz.

Neden ayiriyoruz? Cunku model egitim verisini EZBERLEYEBILIR. Ezberlemis mi ogrenmis mi anlamak icin HICBIR ZAMAN GORMEDIG veride test etmek lazim.

## A4. Overfitting Nedir?

Model egitim verisini EZBERLEME. Veri setinde %99.4 dogruluk gosterir ama gercek dunyada (yeni insanlar, yeni ortamlar) cok dusuk calisir. Bizim en buyuk sorunumuzdu — model tek bir kisinin elini ezberledi, baska birine %28.7 dogruluk gosterdi.

**Nasil onliyoruz?**
- Dropout (egitim sirasinda rastgele noronlari kapat — model tek bir yola bagimli olmasin)
- Augmentasyon (veriyi yapay olarak cesitlendir)
- Early Stopping (model iyilesmemeye basladiginda dur)
- Regularizasyon (agirliklarin cok buyumesini engelle)

## A5. Confusion Matrix Nedir?

Modelin hangi sinifi neyle karistirdigini gosteren tablo. Ornegin harf modeli "M" harfini %32 oraninda "N" olarak tahmin ediyorsa, confusion matrix bunu gosterir. Bu cok degerli cunku nerede sorun oldugunu GORURSUN.

## A6. Accuracy, Precision, Recall, F1 Nedir?

- **Accuracy (Dogruluk):** Toplam tahminlerin kacta kaci dogru? %99.4 = her 1000 tahminden 994'u dogru.
- **Precision:** "Model X dediginde, gercekten X mi?" Ornegin model "A" dediginde %99.96 oraninda gercekten A.
- **Recall:** "Gercek X'lerin kacta kacini bulabiliyor?" Ornegin gercek "A" orneklerinin %99.9'unu yakaladi.
- **F1-Score:** Precision ve Recall'un dengeli ortalamasi. Ikisi de yuksekse F1 yuksek olur.

Neden sadece accuracy yetmiyor? Cunku dengesiz veri setlerinde yaniltici olabilir. Ornegin 100 ornekten 95'i "A" ise, model her seferinde "A" dese bile %95 accuracy alir — ama aslinda hicbir sey ogrenmemis.

## A7. Cross-Validation Nedir?

Veriyi parcalara bol, her seferinde farkli parcayi test olarak kullan, diger parcalarla egit. Ornegin 5-fold CV: veriyi 5'e bol, 5 kez egit (her seferinde farkli 1/5'i test), ortalama al. Bu daha guvenilir dogruluk verir.

Biz bunu **capraz kisi validasyonu** icin de kullandik: bir kisinin verisini test, digerlerini egitim olarak kullandik. Sonuc sok ediciydi: %28.7.

## A8. Landmark Nedir?

Elin (veya vucudun) uzerindeki belirlenmis anahtar noktalar. MediaPipe Hands 21 landmark verir:
- Landmark 0: Bilek (wrist)
- Landmark 1-4: Basparmak (CMC, MCP, IP, TIP)
- Landmark 5-8: Isaret parmagi (MCP, PIP, DIP, TIP)
- Landmark 9-12: Orta parmak
- Landmark 13-16: Yuzuk parmagi
- Landmark 17-20: Serce parmak

Her landmark icin x (yatay konum), y (dikey konum), z (derinlik) koordinati var. 21 × 3 = 63 sayi.

## A9. Normalizasyon Nedir?

Verinin olcegini ve konumunu standartlastirma. Bizim iki normalizasyonumuz var:

**Bilek-merkezli normalizasyon (harf modu):**
1. Bilegi (0,0,0) noktasi yap — tum diger noktalardan bilegi cikar
2. Bilek ile orta parmak MCP arasi mesafeye bol — el buyuklugunden bagimsiz yap

Boylece elini kameranin neresine tutarsan tut, ayni sayi cikiyor. Buyuk el de kucuk el de ayni sonucu veriyor.

**Omuz-merkezli normalizasyon (kelime modu):**
1. Iki omuzun ortasini (0,0,0) yap
2. Omuz genisligine bol

Neden farkli? Cunku kelime modunda tum vucut var. Omuzlar nispeten sabit — bilek ise hareket ettikce degisiyor.

## A10. Augmentasyon Nedir?

Mevcut egitim verisine yapay degisiklikler uygulayarak yeni ornekler olusturma. Amac: modelin gercek dunyadaki varyasyonlara dayanikli olmasini saglamak.

Neden gerekli? Cunku egitim verimiz sinirlı ve kontrollü ortamda cekilmis. Gercek dunyada kullanici:
- Farkli acilarda tutuyor (rotasyon augmentasyonu bunu simule eder)
- Farkli mesafelerde duruyor (olcek augmentasyonu)
- Kamerasi titriyor (gurultu augmentasyonu)
- Farkli hizda isaret yapiyor (TimeStretch)
- MediaPipe bazen parmak kacirir (FingerDropout)

## A11. Gradient Boosting Nedir?

Birden fazla karar agacinin SIRAYLA calistigi bir yaklasim. Her agac oncekinin hatasini duzeltmeye calisir:

1. **1. agac:** Kaba bir tahmin yapar. Hata: %20
2. **2. agac:** 1. agacin yanlistigı yerlere odaklanir. Toplam hata: %12
3. **3. agac:** 2. agacin yanlistigı yerlere odaklanir. Toplam hata: %7
4. ... 300 agac sonra toplam hata: %0.04

**LightGBM** Microsoft'un gelistirdigi hizli gradient boosting implementasyonu. Veriyi histograma boler (daha hizli), leaf-wise buyume yapar (daha dogru). Kaggle yarismalarda tabular veride en cok kullanilan algoritma.

## A12. RNN, LSTM, GRU Nedir?

**RNN (Recurrent Neural Network):** Sirayla gelen verileri isler. Her adimda onceki adimlarin bilgisini "hafizada" tasir. Video frame'leri, cumledeki kelimeler gibi SIRALANMIS veriler icin.

**Sorun — Vanishing Gradient:** RNN 30 frame'lik bir sekans islerken, frame 1'in etkisi frame 30'a gelene kadar neredeyse sifira duser. Cunku egitim sirasinda gradyanlar (ogrenme sinyalleri) her katmanda kuculur. Model baslangic frame'lerini OGRENMEKTE ZORLANIR.

**LSTM (Long Short-Term Memory):** Bu sorunu cozmek icin 4 kapili bir mekanizma tasarlanmis:
- **Input gate:** Yeni bilginin ne kadari hafizaya alinacak?
- **Forget gate:** Eski bilginin ne kadari unutulacak?
- **Cell state:** Uzun sureli hafiza — bilgi bozulmadan tasinar
- **Output gate:** Hafizadan ne cikarilacak?

Cell state bir "otoyol" gibi — bilgi neredeyse kayipsiz akiyor. Bu yuzden LSTM uzun sekanslari ogrenebiliyor.

**GRU (Gated Recurrent Unit):** LSTM'in sadelestirmesi. 3 kapi yeterli:
- **Reset gate:** Onceki bilgiyi ne kadar unutayim?
- **Update gate:** Yeni bilgiyi ne kadar alayim?
- **Output:** Sonucu uret

LSTM'in cell state'i yok — dogrudan hidden state kullaniyor. Daha az parametre = kucuk veri setlerinde daha iyi geneller, daha az hesaplama.

**Bizim seçimimiz GRU cunku:**
- Veri setimiz kucuk (~9,500 ornek)
- GRU'nun 3 gate'i (reset, update, output) yeterli
- Deneysel sonuc: GRU %86.7 vs LSTM %78.2

## A13. Bidirectional (Cift Yonlu) Nedir?

Normal GRU sekansi SADECE ileri okur (frame 1→2→3→...→30). Ama bazı hareketlerde sonraki frame'ler onceki frame'lerin anlamini degistirir. Ornegin "hello" kelimesinde son frame'ler (el geri cekilir) baslangicin "sallama" oldugunu dogruluyor.

Bidirectional'da IKI GRU paralel calisir:
- Ileri GRU: frame 1→30 (her frame'de "simdiye kadar ne gordum?" bilgisi)
- Geri GRU: frame 30→1 (her frame'de "bundan sonra ne olacak?" bilgisi)

Iki GRU'nun ciktilari birlestiriliyor → frame basina 128 + 128 = 256 boyutlu vektor. Daha zengin baglam = daha iyi tahmin.

## A14. Attention Mekanizmasi Nedir?

Normal GRU'da son frame'in ciktisini alip tahmin yapiyorsun. Ama 30 frame'in hepsi esit derecede onemli degil:
- Frame 1-5: El hazirlaniyor, henuz isaret baslamadi → DUSUK onem
- Frame 10-20: Hareketin ana kismi → YUKSEK onem
- Frame 25-30: Hareket bitiyor → ORTA onem

Attention mekanizmasi her frame'e bir AGIRLIK atiyor. Nasil:
1. Her frame'in 256D vektoru kucuk bir sinir agından gecirilir
2. Cikti: 0 ile 1 arasi bir sayi (o frame'in onemi)
3. Tum frame'ler bu agirliklarla carpilip TOPLANIR
4. Sonuc: TEK bir 256D vektor (en onemli frame'lerin bilgisi yogun)

Bu V4'te eklendi. Adi: **Attention Pooling**. "Pooling" = birden fazla vektoru tek vektore indirgemek.

## A15. Focal Loss Nedir?

Normal **CrossEntropy Loss** her ornege esit onem verir. Ama egitim sirasinda:
- Kolay ornekler: Model zaten %99 emin → kayip cok dusuk → ama yine de hesaplanıyor
- Zor ornekler: Model %30 emin → kayip yuksek → ama toplam loss'un kucuk bir kismini olusturuyor

Sorun: Model vaktinin cogunu kolay ornekleri daha da iyilestirmeye harciyor. Zor ornekleri ogrenmek yerine kolay ornekleri "cilalamak" — verimsiz.

**Focal Loss** (Lin et al. 2017, Facebook AI Research):
- Formul: `FL(pt) = -(1-pt)^gamma * log(pt)`
- `gamma = 2` kullaniyoruz
- pt = modelin dogru sinifa verdigi olasilik
- pt yuksekse (kolay ornek): `(1-0.95)^2 = 0.0025` → kayip neredeyse sifir
- pt dusukse (zor ornek): `(1-0.30)^2 = 0.49` → kayip yari yari

Sonuc: Model OTOMATIK OLARAK zor orneklere odaklaniyor. V3→V4 gecisinde +%2.1 dogruluk artisi sagladi.

## A16. Entropy Nedir?

Belirsizlik olcusu. Model tahmin yaparken 25 kelimeye olasilik dagiliyor. Iki senaryo:

**Dusuk entropy (model emin):** hello=%92, goodbye=%3, yes=%2, ... → MODEL EMIn, tahmin guvenilir
**Yuksek entropy (model kararsiz):** hello=%8, goodbye=%7, yes=%6, ... → MODEL KARARSIZ, tum siniflar benzer olasilik

Hesaplama: `entropy = -sum(p * log(p))` tum siniflar icin. Maksimum entropy = tum siniflar esit (uniform dagilim) = tam belirsizlik.

Normalize entropy = entropy / max_entropy. Biz bunu gating icin kullaniyoruz: normalize entropy > 0.85 ise model cok kararsiz → guveni %50 dusuruyoruz.

## A17. Cosine Similarity Nedir?

Iki vektor arasindaki YON benzerligini olcer. 0 ile 1 arasi (normalizasyon sonrasi):
- 1.0 = tam ayni yon (cok benzer)
- 0.5 = kismen benzer
- 0.0 = tamamen farkli

Neden Euclidean distance (oklid mesafesi) yerine cosine kullaniyoruz? Cunku cosine BUYUKLUGE BAKMAZ, sadece YONE bakar. Yani buyuk el de kucuk el de ayni sekli yapiyorsa cosine similarity yuksek cikar.

K-NN kisisellestirmede esik: 0.94. Yani kullanicinin eli kalibrasyon sablonuyla %94 benzer yon gosteriyorsa, "bu kesinlikle o harf" diyoruz.

## A18. EMA (Exponential Moving Average) Nedir?

Zaman serilerinde titresimi azaltma yontemi. Her yeni deger onceki degerle AGIRLIKLI ortalamayla birlestiriliyor:

```
yeni_deger = alpha × gercek_olcum + (1-alpha) × onceki_deger
```

Bizde alpha = 0.6. Yani:
- %60 yeni frame'in landmark'lari
- %40 onceki frame'in landmark'lari

Bu neden onemli? MediaPipe her frame'de landmark'lari BIRAZ farkli yerde buluyor (jitter). EMA bu titresimi yumusatiyor — landmark'lar daha sabit gorunuyor, model daha tutarli tahmin yapiyor.

## A19. Sliding Window vs Tumbling Window Nedir?

Sekans verisini parcalara bolme yontemleri:

**Tumbling Window:** 30 frame topla → islet → TEMIZLE → sifirdan 30 frame topla. Parcalar arasinda CAKISMA yok. J/Z harf modunda kullaniyoruz.

**Sliding Window:** 30 frame'lik pencere, her seferinde 10 frame KAYDIR. Yani frame 1-30, sonra 11-40, sonra 21-50... Parcalar arasinda %67 CAKISMA var. Daha akici ama eski frame'ler kalir. Ceviri kelime modunda kullaniyoruz (ogrenme kocunda kullanMIYORUZ — orda tumbling/tek seferlik kayit).

## A20. State Machine (Durum Makinesi) Nedir?

Bir sistemin farkli DURUMLARI ve bu durumlar arasi GECISLERI tanimlayan model. Her durumda sistem farkli DAVRANIR.

Kelime ogrenme kocundaki state machine:
```
IDLE → (butona bas) → COUNTDOWN → (3s bitti) → RECORDING → (30 frame) → RESULT → (sure bitti) → IDLE
```

Her durumda farkli is yapiliyor:
- IDLE: Kamera acik ama kayit yok, "Hazirim" butonu gorunur
- COUNTDOWN: 3-2-1 geri sayim, kayit yok
- RECORDING: Frame toplaniyor, kirmizi cerceve
- RESULT: Tahmin gosteriliyor, "Tekrar Dene" butonu

Neden state machine? Cunku durumlari KARISTIRMAMAK lazim. Ornegin RECORDING durumundayken "Hazirim" butonu gorunmemeli. RESULT durumundayken frame toplanmamali. State machine bu kurallari NET tanimliyor.

---

# BOLUM B: SISTEM NASIL CALISIYOR — ADIM ADIM

---

## B1. KAMERA → LANDMARK: Ilk Adim

Kullanici uygulamayi aciyor. Kamera aciliyor (OpenCV kutuphanesi ile, 1280×720 cozunurluk, 30 FPS). Her frame (~33ms arayla) su pipeline'dan geciyor:

### Harf Modunda:

```
Kamera frame'i (1280×720 piksel, RGB)
    ↓
MediaPipe Hands (Google'in el algilama araci)
    - max_num_hands = 1 (tek el algilıyor)
    - min_detection_confidence = 0.5 (en az %50 emin olmali)
    - min_tracking_confidence = 0.4 (takipte %40 yeterli)
    ↓
21 landmark bulundu mu?
    ↓ HAYIR → "Eller gorunmuyor" mesaji, bu frame atlanir
    ↓ EVET → devam
    ↓
Kalite kontrolu: MediaPipe'in handedness_score'u > 0.75 mi?
    ↓ HAYIR → dusuk kalite, bu frame atlanir
    ↓ EVET → devam
    ↓
Normalizasyon: bilek (0,0,0) yap, olcek sabitle
    ↓
EMA smoothing: alpha=0.6 ile onceki frame ile karistir (titresim azalt)
    ↓
Cikti: 63 sayilik numpy array [x0,y0,z0, x1,y1,z1, ..., x20,y20,z20]
```

### Kelime Modunda:

```
Kamera frame'i
    ↓
MediaPipe Holistic (tum vucut algilama)
    ↓
4 bilesen cikarilir:
    - Sag el: 21 landmark (63 sayi)
    - Sol el: 21 landmark (63 sayi)
    - Yuz: 40 secilmis landmark (120 sayi)
    - Govde: 25 landmark (75 sayi)
    ↓
Toplam: 107 landmark × 3 = 321 sayi/frame
    ↓
Forward-fill: El/yuz bulunamazsa SON IYI degeri kullan
    (yoksa model girdisi NaN olur ve cokler)
    ↓
Omuz-merkezli normalizasyon + EMA smoothing
    ↓
Cikti: 321 sayilik numpy array
```

**Neden kelime modunda daha fazla landmark?** Cunku kelime isaretleri sadece el degil, tum vucut iceriyor. "Dad" kelimesi alin + basparmak, "no" kelimesi bas sallama + el hareketi. Yuz ve govde landmark'lari bu bilgiyi sagliyor. Kanitimiz: V2 (sadece el, 63D) → V3 (el+yuz+govde, 321D) gecisinde "dad" kelimesi %50'den %98'e cikti.

---

## B2. FEATURE ENGINEERING: Ham Sayilari Anlamli Ozelliklere Cevirme

Bu projenin EN KRITIK adimi. Juriye mutlaka anlat.

### Sorun Tam Olarak Neydi?

MediaPipe'dan 63 sayi geliyor. Ama bunlar HAM KOORDINAT — elin ekrandaki KONUMUNA bagli.

Dusun: "A" harfini yap. Simdi elini 20cm saga tasi, ayni harfi tut. El sekli AYNI ama tum x koordinatlari DEGISTI. MediaPipe'a gore bu iki "A" tamamen farkli girdiler. Model bu durumda elin SEKLINI degil, KONUMUNU ogrenmeye calisiyor.

Daha da kotusu: kameraya yaklasirsan tum sayilar BUYUR, uzaklasirsan KUCULUR. Yani ayni harf, ayni konum ama farkli mesafe = farkli sayilar.

### Cozum: Konum-Bagimsiz Ozellikler Hesapla

Biz su mantikla dusunduk: elini nereye tutarsan tut, basparmak ucuyla bilek arasi MESAFE degismez. Isaret parmaginin bukulme ACISI degismez. Parmak acik mi kapali mi — degismez. Bunlar ELIN KENDISINE ait ozellikler.

**5 Parmak-Bilek Mesafesi:**
Her parmak ucunun (landmark 4, 8, 12, 16, 20) bilekten (landmark 0) Euclidean mesafesi. Ornek: "A" harfinde tum parmaklar kapalı → mesafeler KUCUK. "B" harfinde 4 parmak acik → mesafeler BUYUK. Bu 5 sayi el seklini KONUMDAN BAGIMSIZ tarif ediyor.

**4 Komsu Parmak Mesafesi:**
Yan yana parmak uclarinin arasi: basparmak↔isaret, isaret↔orta, orta↔yuzuk, yuzuk↔serce. "V" harfinde isaret↔orta arasi BUYUK (acik). "U" harfinde KUCUK (bitisik). "W" harfinde isaret↔orta ve orta↔yuzuk ikisi de buyuk.

**14 Eklem Bukulme Acisi:**
Her parmagin eklem noktalarindaki aci. Basparmak icin 2 aci (2 eklem), diger 4 parmak icin 3'er aci (3 eklem). Toplam: 2 + 3×4 = 14 aci. Hesaplama: 3 noktali aci — `arctan2` fonksiyonu ile. Ornek: isaret parmagi DUZ ise aci ~180°, BUKUK ise ~90°.

"C" harfinde tum parmaklar hafif bukuk → acilar ~120°. "B" harfinde tum parmaklar duz → acilar ~170°. Bu acilar elin SEKLINI matematiksel olarak ifade ediyor.

**2 Bounding Box Ozelligi:**
Elin etrafindaki en kucuk dikdortgenin en-boy orani ve normalize alani. "B" harfinde el UZUN (en-boy orani yuksek). "C" harfinde daha YUVARLAK. "O" harfinde neredeyse KARE.

**5 Parmak Uzanma Bayragi:**
Her parmak acik mi kapali mi? Basit bir karsilastirma: parmak ucu (TIP) bilekten daha mi uzak yoksa parmak dibi (MCP) mi? Eger TIP daha uzaksa → parmak ACIK (1.0). Degilse → KAPALI (0.0). Cok basit ama cok etkili.

### Ablasyon Kaniti

| Feature Engineering | Augmentasyon | Dogruluk | Analiz |
|----|-------------|----------|--------|
| ACIK | ACIK | **%99.4** | Her sey acik — en iyi sonuc |
| ACIK | KAPALI | %98.8 | FE tek basina neredeyse yeterli — %98.8 bile cok iyi |
| **KAPALI** | **ACIK** | **%33.2** | **FE OLMADAN MODEL ISLEMEZ. 24 sinif icin rastgele %4.2 olur, %33 biraz daha iyi ama kullanilamaz** |
| KAPALI | KAPALI | %99.45 | YANILTICI! Model tek kisinin koordinatlarini ezberledi. Baska birine %28.7 |

**Bu tabloyu juriye goster ve soyle:** "Feature Engineering projenin kalbi. %33'ten %99.4'e cikmak demek — bu %66'lik fark tek bir muhendislik karariyla geldi. Ham koordinatlar elin konumuna bagimli, ama bizim urettgiimiz ozellikler elin SEKLINI yakaliyor."

---

## B3. HARF MODELI — LightGBM Detayli

### Tam Akis

```
63 sayi (normalized landmarks)
    ↓
Feature Engineering → 93 sayi
    ↓
LightGBM modeli → 24 sinifa olasilik dagılımı
    ↓
K-NN kontrolu → kullanici kalibre ettiyse, sablonuyla karsilastir
    ↓
En yuksek olasilikli sinif secilir (ornegin A=%97, B=%2, C=%1)
    ↓
Top-3 liste olusturulur: [(A, 0.97), (B, 0.02), (C, 0.01)]
    ↓
Smoother'a gider (son 5 tahminin cogunluk oyu)
    ↓
Dwell-Time: 0.6 saniye sabit tutulursa ekrana yazilir
```

### LightGBM Nasil Calisiyor? (Detayli)

1. **Karar Agaci:** Bir soru zinciri. "Feature #47 (isaret parmagi acisi) > 150° mi?" Evet → sag dal. "Feature #23 (basparmak-bilek mesafesi) > 0.3 mu?" Evet → "Bu B harfi". Her agac bir dizi if-else karari.

2. **Gradient Boosting:** 300 agac SIRAYLA calisir. Her agac ONCEKININ HATASINI duzeltir:
   - Agac 1: Kaba tahmin yapar, %80 dogru
   - Agac 2: Agac 1'in yanlistigi orneklere bakar, onlari duzeltir → %90
   - Agac 3: Agac 2'nin yanlistigi orneklere bakar → %95
   - ... Agac 300: → %99.96

3. **LightGBM'in ozel avantajlari:**
   - **Histogram-based splitting:** Surekli degerleri kumelere boler → daha hizli
   - **Leaf-wise growth:** En cok hatayi azaltan yapragi buyutur (diger frameworkler level-wise yapar)
   - **GPU destegi var** ama bizim verimiz kucuk, CPU yeterli

### 5 Model Karsilastirmasi

| Model | Dogruluk | CV Std | Inference | Boyut | F1 (min) | Karar |
|-------|----------|--------|-----------|-------|----------|-------|
| **LightGBM** | **%99.96** | **±0.08** | 0.017ms | 21 MB | 0.992 | **SECILDI — en yuksek, en tutarli** |
| Random Forest | %99.94 | ±0.12 | 0.026ms | 18 MB | 0.989 | Cok yakin ama her metrikikte biraz dusuk |
| XGBoost | %99.88 | ±0.15 | 0.005ms | 12 MB | 0.985 | En hizli inference ama dogruluk dusuk |
| 1D-CNN | %98.7 | ±0.22 | 0.043ms | 4.2 MB | 0.981 | Derin ogrenme — tabular veride gereksiz |
| MLP | — | — | — | — | — | Cross-validation'da TAKILDI |

**MLP neden takildi?** MLP (Multi-Layer Perceptron) bir sinir agi. Cross-validation yaparken 5 ayri egitim yapilir. MLP bunlardan birinde CPU %100'e yapisti, ilerleme yok. Neden? Muhtemelen hiperparametre uyumsuzlugu veya veri boyutu sorunu. Pragmatik karar: bekleme, LightGBM zaten en iyi — devam et.

### K-NN Kisisellestirme (Detayli)

**Sorun:** Herkesin eli farkli. Sen "A" yaptiginda basparmak biraz daha yukarda olabilir. Base model bunu "S" olarak algilayabilir.

**Cozum mekanizmasi:**
1. Kullanici "Kalibre Et" → hedef harf secer (ornegin "A")
2. 3 saniyelik geri sayim
3. 30 frame boyunca 93D ozellik vektorleri kaydedilir
4. Bu vektorler `models/profiles/user_templates.npz` dosyasina saklanir (harf basina max 50 sablon)
5. Sonraki tahminlerde ONCE K-NN kontrol: kullanicinin mevcut 93D vektoru ile saklanan sablonlar arasinda cosine similarity hesaplanir
6. En yuksek benzerlik > 0.94 ise → direkt o harfi dondur, base modeli ATLA
7. Degilse → normal LightGBM tahmin

Bu "few-shot learning" (az ornekle ogrenme) prensibi. 30 frame = ~1 saniye veri ile kullaniciya ozel adaptasyon.

### Prediction Smoother (Detayli)

**Sorun:** Model her frame'de tahmin yapiyor (30/saniye). Bazen ust uste A, A, B, A, A diyor — B araya girmis. Kullanıcı icin titresim gorunuyor.

**Cozum:** Son 5 tahmini bir pencerede (deque) tut. Cogunluk oyu uygula:
- 5 tahminden en az 3'u ayni harfi gostermeli → o harfi cikar
- Yoksa → hicbir sey gosterme (None)

Ek kural: Confidence < %55 olan tahminler pencereye EKLENMEZ (dusuk guvenli tahminler filtrelenir).

### Dwell-Time Otomatik Yazma

**Sorun:** Kullanicinin her harf icin Enter'a basmasi zahmetli.

**Cozum:** El sabit tutuldugunda bir sayac isler:
- Her frame'de tahmin sabit kaliyorsa → sayac + 1
- Sayac 20'ye ulasirsa (20 frame / 30 FPS ≈ 0.67 saniye) → harfi otomatik yaz
- Yazildiktan sonra 15 frame cooldown (0.5 saniye) → cift yazmayi onle

Gorsel: progress bar doluyor. Kullanici "elimi sabit tutuyorum, bar doluyor, harf yazildi" seklinde dogal bir deneyim yasiyor.

---

## B4. KELIME MODELI — Bi-GRU V4 Detayli

### Tam Akis (Ceviri Modunda)

```
Her frame:
    MediaPipe Holistic → 321 sayi
    ↓
    Sliding window buffer'a ekle (deque, max 30 frame)
    ↓
    Buffer < 30 frame → bekle, progress goster
    ↓
    Buffer >= 30 frame VE son tahminden 10 frame gecti mi?
    ↓ EVET
    30 frame'lik sekans → Bi-GRU V4 modeline ver
        ↓
        Gating 1 — Motion Variance: El yeterince hareket etti mi?
            Hand data'nin frame-to-frame farklarinin ortalamasi
            < 0.003 ise → cok statik, kelime isareti DEGIL → ("?", 0.0) dondur
        ↓
        Gating 2 — Aktif frame kontrolu: En az 10 frame'de el gorunuyor mu?
            < 10 ise → yeterli veri yok → ("?", 0.0) dondur
        ↓
        Model forward pass:
            Input tensor: (1, 30, 321)
            → Bi-GRU Layer 1: (1, 30, 256)
            → Bi-GRU Layer 2: (1, 30, 256) + Dropout(0.4)
            → Attention Pooling: (1, 256) — her frame'e agirlik
            → FC: Linear(256→128) → ReLU → Dropout(0.4) → Linear(128→25)
            → Softmax: 25 olasilik
        ↓
        Gating 3 — Entropy: Model emin mi?
            Normalize entropy > 0.85 → confidence *= 0.5
        ↓
        Cikti: ("hello", 0.87)
```

### Model Evrimi — Her Versiyonda Ne Degisti, Neden?

Bu tablo ozet — asagida her versiyonun detayli hikayesi var:

| Versiyon | Degisiklik | Dogruluk | Neden Bu Degisikligi Yaptik |
|----------|-----------|----------|---------------------------|
| **15-word** | 15 kelime, tek el (63D), Bi-LSTM | %91.4 | Baslangic prototipi — calisiyor mu gore |
| **25-word** | 25 kelimeye genisleme, GRU'ya gecis | %82.4 | 15→25 kelimede -%9 beklenen. GRU LSTM'den %4 daha iyi cikti |
| **V3** | 107 landmark (el+yuz+govde, 321D), omuz normalizasyonu, 6 augmentasyon | %84.6 | Yuz/govde bilgisi ekle — "dad" %50→%98 |
| **V4** | Focal Loss, Attention Pooling, dropout 0.4, weight decay, Mixup, CosineAnnealing | %86.7 | Overconfidence azalt, zor orneklere odaklan |

---

**VERSIYON 1: 15 Kelime Prototipi (%91.4)**

Ilk amacimiz basitti: "Kelime tanima yapilabilir mi?" Cevabi bulmak icin en basit kurulumu sectik:
- 15 kolay kelime (hello, yes, no, please, thankyou, water, food, drink, home, sleep gibi)
- Sadece el landmark'lari (21 nokta, 63D)
- Bi-LSTM mimarisi (o zaman standart secimdi)
- Google ASL Signs verisinden 15 kelime filtresi

Sonuc: %91.4. Gayet iyi — kelime tanima MUMKUN. Ama 15 kelime sinirlı. Ve LSTM cok yavas egitim yapiyordu.

**VERSIYON 2: 25 Kelime + GRU Gecisi (%82.4)**

15 kelime iyi calisinca 25'e genislettik. Ayni zamanda bir deney yaptik: LSTM vs GRU. Sonuc sok ediciydi:
- GRU: %82.4 (25 kelime icin)
- LSTM: %78.2

GRU %4 daha iyi ve daha HIZLI egitiliyor. Sebep: GRU'nun 3 gate'i LSTM'in 4 gate'inden daha az parametre uretir → kucuk veride (9,500 ornek) daha az overfitting → daha iyi genelleme. Bu noktadan sonra tum sonraki versiyonlar GRU ile devam etti.

15→25 kelimede -%9 (91.4→82.4) neden oldu? Normal ve beklenen. Sinif sayisi arttikca karisma olasılığı artar. 15 kelimede model 15 sinif arasinda secim yapiyor, 25'te 25 sinif arasi. Benzer hareketler daha fazla — ornegin "go" ve "give" el uzatma hareketi iceriyor.

**VERSIYON 3: 107 Landmark + Yuz/Govde (%84.6)**

V2'de bir sorun fark ettik: "dad" kelimesi %50'de takilmis. Neden? "Dad" alna basparmakla dokunma hareketi. AMA V2'de sadece EL landmark'lari var — model elin NEREYE dokundugunu GORMUYOR cunku yuz landmark'i yok. El yukari kalkiyor ama nereye gidiyorsa gitsin, model ayni landmark'lari goruyor.

Cozum: MediaPipe Holistic ile yuz (40 secilmis nokta) + govde (25 nokta) + iki el (42 nokta) = 107 landmark, 321D girdi. Ayrica:
- Omuz-merkezli normalizasyon (Roh et al. KAIST makalesinden ilham)
- 6 augmentasyon teknigi (TimeStretch, FingerDropout, GaussianNoise, Rotation, Scale, Mirror)

Sonuc: %84.6. Ozellikle "dad" %50→%98'e FIRLADI. Cunku artik model "el yuzun ust kismina dokunuyor" bilgisini gorebiliyor.

**VERSIYON 4: Focal Loss + Attention (%86.7) — Final Model**

V3 iyi calisiyordu ama bir sorun vardi: model bazi kolay kelimelere (ornegin "food") %99.9 guven veriyordu ama zor kelimelerde (ornegin "go") %40'ta kaliyordu. Model kolay orneklerden ogrenmeye DEVAM EDIYORDU — zor ornekleri ihmal ediyordu.

V4'te 6 degisiklik yaptik — her biri bir soruna cozum:

| Degisiklik | Hangi Sorunu Cozuyor | Etkisi |
|-----------|---------------------|--------|
| **Focal Loss (gamma=2)** | Kolay orneklere gereksiz odaklanma | Zor orneklerin loss'u artik baskin — model "go" gibi zor kelimeleri ogreniyor |
| **Attention Pooling** | Son frame'e asiri bagimlılık | Her frame'e onem agirliği — hareketin ORTASI daha onemli ise oraya odaklan |
| **Dropout 0.4 (artti)** | Overfitting | Daha agresif regularizasyon — model daha az ezberliyor |
| **Weight Decay 1e-4** | Buyuk agirliklar → overfitting | Agirliklari kucuk tutma → daha basit, genelleyici model |
| **CosineAnnealingWarmRestarts** | Sabit ogrenme orani → yerel minimuma takilma | LR periyodik olarak artiyor ve azaliyor → model farkli cozumleri kesfediyor |
| **Mixup augmentasyonu** | Sinif sinirlari cok keskin | Iki ornegin karisimi → daha yumusak sinif sinirlari → daha robust |

Sonuc: %84.6 → %86.7 (+%2.1). Kucuk gibi gorunebilir ama %85+ bolgesinde her %1 cok ZORDUR.

### En Zor ve En Kolay Kelimeler — Neden?

| Kelime | F1 | Neden Kolay/Zor |
|--------|-----|----------------|
| **dad** | 0.97 | KOLAY: Basparmak alna dokunma — cok belirgin, diger kelimelerden cok farkli. V3'te yuz landmark'lari eklendikten sonra patlama yapti |
| **hello** | 0.95 | KOLAY: Ikonik el sallama — genis hareket, kolay ayirt ediliyor |
| **food** | 0.94 | KOLAY: Parmaklar agza — yuz+el kombinasyonu cok benzersiz |
| **home** | 0.93 | KOLAY: El yanaga dokunma — belirgin konum |
| **go** | 0.67 | ZOR: Cok hizli ve kisa hareket — 30 frame'de yakalaması guc. Diger kisa hareketlerle karisiyor |
| **give** | 0.75 | ZOR: El one dogru uzatma — "go" ve baska kelimelerle benzer el hareketi |

---

## B5. CANLI PERFORMANS — GATING SISTEMI

### Neden Gating Lazim?

Model her frame'de tahmin YAPAR — durduramayiz. Ama gercek hayatta su durumlar oluyor:
- Elini kameradan cektin → model arka plandaki herhangi bir seyi tahmin etmeye calisiyor
- Bir harften digerine gecis yapiyorsun → gecis aninda model saçma seyler soyluyor
- Kamera titriyor → her frame farkli tahmin
- Model aslinda emin degil ama %51 ile bir sey soyluyor

Bu yanlis tahminleri KULLANICIYA GOSTERMEMEK lazim. Bunun icin 5 katmanli filtre var:

### 5 Katmanli Filtre Detayi

**Katman 1 — Landmark Quality Gate:**
MediaPipe her el icin bir "handedness_score" (elilik skoru) veriyor. Bu skor elin ne kadar iyi algilandigini gosterir. Biz esik olarak 0.75 kullaniyoruz. Altindaysa bu frame'i ATLIYORUZ — dusuk kaliteli landmark'la tahmin yapmak yanlis sonuc verir.

**Katman 2 — Motion Gate:**
Her frame'de onceki frame ile landmark farki hesaplaniyor (hiz).
- **Harf modunda:** Hareket varsa tahmin DURDUR. Cunku kullanici A→B gecisi yapiyor, gecis aninda el "A" da degil "B" de degil → yanlis tahmin gelir. Hareket durgunca devam et.
- **Kelime modunda:** Hareket YOKSA tahmin yapMA. Cunku kelime isareti hareket gerektirir — sabit el = kelime isareti degil.

**Katman 3 — Entropy Gate:**
Model 25 kelimeye olasilik dagıtıyor. Dagılım cok DUZ ise (her kelime ~%4) → model hicbir siniftan emin degil → normalize entropy yuksek (> 0.85). Bu durumda guveni %50 dusuruyoruz. Boylece belirsiz tahminler confidence threshold'u gecemiyor.

**Katman 4 — Confidence Threshold:**
- Harf modu: <%55 → gosterme. Neden dusuk esik? Cunku dwell-time mekanizmasi var — %55 ile bile dogru harfi 0.6 saniye tutunca yaziliyor. Daha yuksek esik bazi harflerin hic yazilmamasina neden oluyordu.
- Kelime modu: <%78 → gosterme. Neden yuksek esik? Cunku Focal Loss ile egitilmis V4 modeli daha kalibre edilmis guvenler veriyor. %78 alti genellikle yanlis tahmin.

**Katman 5 — Prediction Smoother:**
Son 5 tahmin bir pencerede (deque) tutuluyor. Cogunluk oyu: 5'ten en az 3'u ayni sinifi gostermeli. Tek bir frame'deki yanlis tahmin filtreleniyor.

---

## B6. DOMAIN GAP — DETAYLI ANALIZ

### Ne, Neden, Kanit, Cozum

**Ne:** Egitim ortami ile gercek ortam arasindaki performans farki. Model veri setinde %99.4 ama webcam'de ~%70-80.

**Neden:** Egitim verisi dar bir dagilimdan geliyor:
- Cogunlukla tek kisi (ASL Alphabet = tek kisi)
- Studyo ortami (sabit isik, sabit mesafe, sabit arka plan)
- Ideal kosullar (MediaPipe'in en iyi calistigi kosullar)

Gercek dunya cok daha CESITLI:
- Farkli el boyutlari, parmak oranlari
- Degisen isik (gun isigi, lamba, karanlik)
- Degisen mesafe (50cm → 2m)
- Degisen arka plan
- MediaPipe jitter (her frame'de biraz farkli sonuc)
- Farkli isaret yapma hizlari

**Kanitimiz — 3 Farkli Test:**

| Test | Dogruluk | Ne Gosteriyor |
|------|----------|-------------|
| Ayni kisi, ayni veri seti (ASL Alphabet icinde) | %99.96 | Model o kisiyi MUKEMMEL biliyor |
| Farkli kisi (ASL_SemCom verisinden biri) | %28.7 | Model baska birini HICBIR SEKILDE tanimiyor — %71 dusus |
| Literatur: Ethiopian SL (Nature 2025) | %94→%73 | Ayni sorun, farkli ulke — %21 dusus |

%71'lik dusus sok ediciydi. Ama literaturde de belgelenmis — bizim icin unique bir sorun degil, alandaki herkesin yaşadıgı bir problem.

**5 Katmanli Cozum:**

| # | Cozum | Nasil Calisiyor | Etki |
|---|-------|----------------|------|
| 1 | **Feature Engineering** | Koordinat yerine mesafe/aci/bayrak → konum-bagimsiz | **+%66** (en buyuk etki) |
| 2 | **Coklu kisi verisi** | American SL'den 962 + SemCom'dan 1,580 ornek | +%10-15 |
| 3 | **Augmentasyon** | 7 teknik, 5x cogaltma → gercek dunya varyasyonlari | +%5-10 |
| 4 | **K-NN Kalibrasyon** | Kullanici 3 saniyede kendi elini ogretir | +%5-10 |
| 5 | **Gating** | 5 katmanli filtreleme → yanlis pozitif azaltma | FP -%50+ |

---

## B7. VERI SETI YOLCULUGU — NASIL BULDUK, NASIL KARAR VERDIK

Bu bolum projenin en onemli ogrenme sureclerinden birini anlatiyor. 8 farkli veri seti denedik — bazilari harika calisti, bazilari tam bir hayal kirikligi oldu. Her birinden bir sey ogrendik. Juri "veri setini nasil sectiniz?" diye sorarsa, bu hikayeyi anlat.

### Veri Seti Secim Kriterlerimiz

Herhangi bir veri setini kullanmadan once su 3 soruyu sorduk:

1. **MediaPipe isleyebilir mi?** Veri setindeki gorsellerde/videolarda MediaPipe el bulabiliyor mu? Bulma orani (hit rate) ne kadar? %50'nin altindaysa veri setinin yarisi cope gidiyor demek.

2. **Coklu kisi var mi?** Tek kisiden alinan veri ne kadar buyuk olursa olsun, model o kisiyi EZBERLEME riski tasiyor. Farkli eller, farkli boyutlar, farkli ten renkleri lazim ki model gercek dunyada calissin.

3. **Use case'imize uyuyor mu?** Biz iki sey yapiyoruz: (a) tek bir harfi gosterip tanima, (b) tek bir kelimeyi isaret edip tanima. Surekli konusma tanima, cumle ceviri, parmakla heceleme gibi problemler BIZIM problemimiz degil.

Bu 3 kriterle 8 veri setini degerlendirdik. Sonuc: 3 kullandik, 5 reddettik.

---

### 1. ASL Alphabet — Birincil Harf Veri Seti (KULLANDIK)

**Boyut:** 87,000 gorsel, 1.2 GB, 29 sinif (A-Z + space/delete/nothing)

**Nasil bulduk:** Kaggle'da "ASL" aratinca ilk cikan veri seti. En populer, en cok kullanilan. Her sinif ~3,000 foto. Gorunuste kusursuz bir baslangic noktasi.

**Ne oldu:** MediaPipe ile isledigimizde hit rate %72.8 cikti — yani her 100 fotoğraftan 73'unde el algilandi, 27'sinde algilanamadi (kotu aci, bulaniklik, gorselin kesilmis olmasi gibi nedenlerle). Model bu veriyle egitildiginde %99.96 dogruluk — MUKEMMEL.

**Ama bir sorun vardi:** Veri setinin TAMAMI TEK BIR KISIYE ait. Studyo ortaminda cekilmis, yesil arka plan, sabit mesafe, sabit isik. Model bu tek kisiyi EZBERLEDI. Biz bunu fark ettigimizde capraz kisi testi yaptik — sonuc: baska birine gosterdiginde %28.7. Bu "domain gap" sorununu kesfettigimiz an oldu.

**Ne ogrendik:** Miktar YANILTICI olabilir. 87,000 gorsel cok gibi gorunuyor ama hepsi ayni kisiden geliyorsa, 87K GORSEL BILE YETMEZ. Model kisiyi degil, el seklini ogrenmeli. Bunun icin cesitlilik (diversity) sart.

---

### 2. American Sign Language Dataset — Cesitlilik Kaynagi (KULLANDIK)

**Boyut:** 71 MB, 2,516 gorsel

**Neden aradik:** ASL Alphabet'in tek-kisi sorunu ortaya cikinca, farkli kisilerden veri lazimdi. Kaggle'da "ASL multiple signers" tarzinda aratmalar yaptik.

**Ne oldu:** Bu veri seti FARKLI kisilerin ellerini iceriyor — farkli el boyutlari, ten renkleri, parmak oranlari, acilari. Hit rate %57.4 — ASL Alphabet'ten dusuk cunku ortam daha dogal (studyo degil). 2,516 gorselden 962 kullanilabilir ornek cikarildi.

**Etki:** 87K tek-kisi verisi + 962 coklu-kisi verisi birlestirince model artik "kisi" degil "el sekli" ogrendi. Domain gap'te gozle gorulur iyilesme. Az sayida ama CESITLI veri, cok sayida ama TEKDUZE veriden daha degerli.

**Ne ogrendik:** Veri kalitesi > veri miktari. 962 farkli-kisi ornegi, modelin genelleme yetenegini 87K tek-kisi orneginden daha cok iyilestirdi.

---

### 3. ASL_SemCom — Capraz Kisi Testi Verisi (KISMI KULLANDIK)

**Boyut:** 398 MB

**Ne bekliyorduk:** Farkli kisilerden ek veri.

**Ne oldu:** Gorselleri actigimizda sorun anlasildi: fotograflarin uzerine el iskeleti CIZILMIS. Yani gercek el fotosunun ustunde renkli cizgiler ve daireler var. MediaPipe bu cizimleri gercek el saniyor, yanlis landmark'lar cikariyor. Hit rate %5-15 arasi — kullanisiz.

**Ama:** Bu veri setini tamamen copse atmadik. Icindeki bazi gorselleri CAPRAZ KISI VALIDASYONU icin kullandik. Yani modelimizi bu veri setinden bir kisinin gorselleriyle test ettik — sonuc %28.7. Bu test bize domain gap'in boyutunu somut olarak gosterdi.

**Ne ogrendik:** Islenmis/annotated gorseller, tekrar isleme icin uygun degil. Eger bir veri seti uzerinde zaten gorsel manipulasyon yapilmissa, bizim pipeline'imiz (MediaPipe → landmark → model) calismiyor.

---

### 4. MediaPipe_Processed_Asl — En Buyuk Hayal Kirikligi (REDDETTIK)

**Boyut:** 105,000 gorsel, 1.4 GB

**Ne bekliyorduk:** Ismine bakarak buyuk umutlarla indirdik. "MediaPipe Processed" — yani baskasi zaten MediaPipe ile isledigı gorseller. Biz de direkt landmark'lari alip kullanabilecegimizi dusunduk.

**Ne oldu:** Gorselleri acinca hayretler icinde kaldik: bunlar GERCEK EL FOTOGRAFI DEGIL. Bilgisayar tarafindan cizilmis iskelet resimleri — siyah arka plan uzerine renkli noktalar ve cizgiler. 36,000 gorsel islemden gecirdik — MediaPipe EL BULAMADI. Hit rate: **TAM OLARAK %0.**

**Bu an proje icin onemli bir ders oldu:** Hic bir veri setini ismine bakip guvenme. Her zaman ilk 100 ornegi elle incele. Biz bunu yapmadan 36,000 gorsel isleme baslatmistik — saatler kayip gitti. Bu olaydan sonra "100 ornekle on-test" kuralini koyduk.

**Ne ogrendik:** (1) Veri seti ismi yaniltici olabilir. (2) Her zaman kucuk bir ornekle ONCE test et. (3) "Islenmis veri" her zaman senin pipeline'ina uygun demek degil.

---

### 5. Google ASL Signs — Birincil Kelime Veri Seti (KULLANDIK)

**Boyut:** 250 ASL kelimesi, 94,477 video, 21 farkli kisi, Kaggle'da

**Nasil bulduk:** Kelime modeli icin video verisi arastirirken Kaggle'da Google'in bu yarismasi ile karsilastik. Verinin MUHTESEM bir ozelligi var: videolar yerine LANDMARK VERILERI Parquet formatinda sunulmus. Yani MediaPipe isleme adimini ATLIYORSUN — indirip direkt egitim yapabiliyorsun.

**Neden ozel:** (1) 21 farkli kisi — tek-kisi sorunu YOK. (2) Landmark zaten cikarilmis — veri isleme gereksiz. (3) 250 kelime var, biz 25 sectik. (4) Google'in kendi kalite kontrolunden gecmis.

**Ne yaptik:** 25 gunluk-hayat kelimesi sectik: hello, yes, no, please, thankyou, water, food, drink, home, sleep, mom, dad, child, happy, sad, sick, hungry, go, give, look, wait, talk, open, finish, bye. Secim kriteri: (a) Gunluk iletisimde sik kullanilma, (b) Hareketlerin birbirinden yeterince farkli olmasi, (c) Yeterli ornek sayisi.

**Ne ogrendik:** Temiz, hazir, coklu-kisi verisi ALTIN DEGERINDE. Gorselleri indirip MediaPipe'dan gecirmek yerine, zaten landmark olarak sunulan veriyle baslamak bize haftalar kazandirdi.

---

### 6. WLASL — Akademik Benchmark (REDDETTIK, Gelecek Icin Sakli)

**Boyut:** 5.1 GB, 11,982 video, 2,000 ASL kelimesi

**Ne bekliyorduk:** Akademik dunyada en cok kullanilan ASL benchmark'i. 2,000 kelime — cok genis. Kullanabilsek muhteşem olur.

**Sorun:** Videolar YouTube'da barindiriliyor ve sadece URL'ler veriliyor. Indirdigimizde %43'u SILINMIS veya erisim engellenmis. Kalan %57'yi indirmek saatler suruyor ve indirme sonrasi da isleme gerekiyor.

**Karar:** Su an 25 kelime ile calisiyoruz ve Google ASL Signs zaten 21 kisiden temiz veri sunuyor. WLASL'yi simdi kullanmak zaman kaybi olur. ANCAK gelecekte 50+ kelimeye genisleme planlandiginda birincil aday bu veri seti — cunku 2,000 kelimelik kapsamı benzersiz.

**Ne ogrendik:** Akademik veri setlerinin erisim sorunu olabiliyor. YouTube baglantili veri setleri zamanla bozuluyor (link rot). Kalici, indirilebilir formattaki veriler (Google ASL Signs gibi) cok daha guvenilir.

---

### 7. MS-ASL — Buyuk Ama Erisimsiz (REDDETTIK)

**Boyut:** 1,000 kelime, 25K+ video, 200+ kisi (sadece metadata var)

**Sorun:** Microsoft'un sundugu bu veri seti aslinda VERI icermiyor — sadece YouTube URL'leri ve JSON metadata var. Her videoyu tek tek indirmek, isimlendirmek, etiketlemek, islemek gerekiyor. Bu projenin kapsaminda bu is yuku cok buyuk.

**Karar:** Google ASL Signs zaten ihtiyacimizi karsiladigı icin bu veri setini atlattik. 200+ kisinin cesitliligi cekici ama erisim maliyeti cok yuksek.

---

### 8. Google ASL Fingerspelling — Yanlis Problem (REDDETTIK)

**Boyut:** 158 GB, 94 kisi, harf harf heceleme videolari

**Ne bekliyorduk:** Belki harf tanima icin kullanabiliriz diye baktigik.

**Sorun:** Bu veri setinde insanlar kelimeleri HARF HARF HECELIYORLAR — ornegin "HELLO" icin H-E-L-L-O sirasiyla isaret yapiyorlar. Bizim problemimiz farkli: biz TEK BIR HARFI gostermek ve tanimak istiyoruz. Fingerspelling'de harfler arasi gecis, hiz, baglam var — bizim durumumuzda bunlar yok.

**Karar:** Veri seti harika ama bizim use case'imize UYMUYOR. Mükemmel bir veri seti bile yanlis probleme uygulanirsa ise yaramaz.

**Ne ogrendik:** Veri seti seciminde en onemli soru "Bu veri, BENIM problemimi cozuyor mu?" sorusu. Kalite, boyut, kisi sayisi hep onemli — ama use case uyumu her seyden once gelir.

---

### Ozet Tablo — 8 Veri Seti Bir Bakista

| # | Veri Seti | Boyut | Hit Rate | Kullandik mi? | Bir Cumlelik Ders |
|---|-----------|-------|----------|--------------|-------------------|
| 1 | ASL Alphabet | 87K gorsel | %72.8 | EVET (harf) | Tek kisi verisi ezber getiriyor |
| 2 | American SL | 2.5K gorsel | %57.4 | EVET (cesitlilik) | Az ama cesitli > cok ama tekduze |
| 3 | ASL_SemCom | 398 MB | %5-15 | KISMI (test) | Annotated gorsel tekrar islenemez |
| 4 | MediaPipe_Processed | 105K gorsel | **%0** | HAYIR | Isme guvenme, once test et |
| 5 | Google ASL Signs | 94K video | — (hazir) | EVET (kelime) | Temiz hazir veri altin degerde |
| 6 | WLASL | 12K video | — | HAYIR (gelecek) | YouTube linkleri bozulabiliyor |
| 7 | MS-ASL | metadata | — | HAYIR | Erisim maliyeti cok yuksek |
| 8 | Fingerspelling | 158 GB | — | HAYIR | Use case uyumu her seyden once |

---

## B8. TEKNOLOJI KARARLARI — NEDEN BU ARACLARI SECTIK

Her teknoloji seciminin arkasinda bir neden var. Juri "neden X degil de Y?" diye soracak — her secimin hikayesini bilmen lazim.

### 8.1 El Algilama: Neden MediaPipe?

**Alternatifler:**
- **OpenPose (Carnegie Mellon):** Akademik dunyada yaygin. AMA: (1) GPU gerektirir — biz CPU'da calisiyoruz, (2) kurulumu karmasik, (3) daha yavas (~30ms vs MediaPipe'in ~15ms'i).
- **YOLO-Pose:** Obje tespiti tabanli — el tespitinde MediaPipe kadar uzmanlasmamis. El landmark detayi yetersiz.
- **Leap Motion Controller:** Ozel donanim gerektirir — her bilgisayarda yok. Biz sadece webcam ile calismak istiyoruz.

**Neden MediaPipe:** (1) Google'in bakimini yaptigi, surekli guncellenen bir kutuphane. (2) CPU'da gercek zamanli calisiyor (~15ms/frame). (3) 21 landmark — parmak detayi yeterli. (4) Python entegrasyonu kolay (`pip install mediapipe`). (5) Kaggle yarisma kazananlarinin %90'indan fazlasi MediaPipe kullaniyor — KANITLANMIS bir arac.

**Bilinen eksikler:** (1) %46-50 oraninda parmak kacirma (Kaggle Fingerspelling ekibinin olcumu). (2) Karanlik ortamda performans duser. (3) Cok hizli hareketlerde kayip olusur. Bunlari augmentasyon (FingerDropout) ve gating ile telafi ediyoruz.

### 8.2 Harf Modeli: Neden LightGBM?

**Onemli bir karar noktasi:** Biz gorsel islemiyoruz — LANDMARK isliyoruz. MediaPipe zaten eli buluyor ve bize 21 nokta veriyor. Biz bu noktalardan 93 sayi uretiyoruz (Feature Engineering). Bu bir TABLO verisi — satir = ornek, sutun = ozellik. Gorsel degil.

**Bu cok onemli cunku:** CNN ve derin ogrenme modelleri gorsel isleme icin optimize. Ama elimizdeki veri bir Excel tablosu gibi — 93 sutun, binlerce satir. Tabular veride gradient boosting modelleri (LightGBM, XGBoost) NEREDEYSE HER ZAMAN derin ogrenmeden iyi.

**5 model test ettik — somut sonuclar:**

| Model | Dogruluk | Neden Bu Sonucu Verdi |
|-------|----------|----------------------|
| **LightGBM** | **%99.96** | Tabular veride EN IYISI. Histogram splitting + leaf-wise buyume. 300 agac, her biri oncekinin hatasini duzeltiyor |
| Random Forest | %99.94 | Cok yakin ama bagimsiz agaclar — gradient boosting'in "hatayi duzelt" stratejisi yok |
| XGBoost | %99.88 | Ayni prensip ama LightGBM'den biraz yavas ve daha az dogru (veri boyutumuzda) |
| 1D-CNN | %98.7 | Tabular veride gereksiz karmasiklik — convolution katmanlari GORSEL icin tasarlanmis |
| MLP | TAKILDI | Cross-validation'da CPU %100'e yapisti. Hiperparametre uyumsuzlugu muhtemel |

**Juriye soyle:** "5 model test ettik, LightGBM en iyisiydi. Sebebi basit: elimizdeki veri gorsel degil, tablo. Tablo verisinde LightGBM Kaggle yarismalarda da en cok kullanilan algoritma. Biz dogru araci dogru is icin sectik."

### 8.3 Kelime Modeli: Neden GRU, Neden LSTM Degil?

**Teorik farklari:**
- LSTM: 4 gate (input, forget, output, cell state) → daha cok parametre → buyuk veride avantaj
- GRU: 3 gate (reset, update, output) → daha az parametre → kucuk veride avantaj

**Deneysel sonucumuz:**
- GRU: **%86.7** dogruluk, 711K parametre
- LSTM: **%78.2** dogruluk, 950K+ parametre

%8.5'lik fark cok buyuk. Neden? Veri setimiz ~9,500 ornek — bu KUCUK. Daha fazla parametreye sahip LSTM overfitting yapti (egitim verisini ezberledi). GRU daha az parametreyle daha iyi GENELLEME yapti.

**Bilimsel destek:** Chung et al. (2014, Bengio lab) ayni bulguyu raporlamis: kucuk veri setlerinde GRU, LSTM'den tutarli olarak daha iyi performans gosteriyor.

**Neden Transformer degil?** Transformer daha guclu — Kaggle 1. sirasi kullaniyor. AMA: (1) Cok daha fazla parametre (milyonlarca), (2) Buyuk veri gerektirir (overfitting riski), (3) 25 kelime ve 9,500 ornek icin overkill. Gelecekte 50+ kelimeye geciste dusunecegiz.

### 8.4 Feature Engineering: 63D → 93D

**Bu projenin KALBI.** Juriye en cok anlatman gereken konu.

Orijinal 63 landmark (21 nokta × 3 koordinat) elin KONUMUNA bagli — elini saga tasirsan tum sayilar degisiyor. Biz konumdan bagimsiz ozellikler urettik:

| Ozellik Grubu | Sayi | Ne Oldugu | Neden Onemli |
|---------------|------|-----------|-------------|
| Ham landmark (normalized) | 63 | x,y,z koordinatlari | Temel girdi — bilek-merkezli normalize edilmis |
| Parmak-bilek mesafeleri | 5 | Her parmak ucunun bilekten uzakligi | "A" da hepsi yakin, "B" de 4'u uzak |
| Komsu parmak mesafeleri | 4 | Yan yana parmak uclarinin arasi | "V" de isaret↔orta buyuk, "U" da kucuk |
| Eklem bukulme acilari | 14 | Parmak eklemlerindeki aci | "C" de hepsi ~120°, "B" de hepsi ~170° |
| Bounding box | 2 | El dikdortgeninin en-boy orani + alani | "B" uzun, "O" yuvarlak |
| Parmak uzanma bayraklari | 5 | Parmak acik mi kapali mi (1/0) | En basit ama en etkili ozelliklerden biri |
| **TOPLAM** | **93** | | |

**Ablasyon kaniti:** FE olmadan %33.2, FE ile %99.4. Bu %66'lik fark TEK BIR MUHENDISLIK KARARIYLA geldi. Bu projedeki en etkili karar.

### 8.5 GUI: Neden CustomTkinter?

| Alternatif | Neden Reddettik |
|-----------|----------------|
| **PyQt5/6** | Cok guclu ama lisans sorunu (GPL/commercial), daha fazla kod, daha dik ogrenme egrisi |
| **Kivy** | Mobil odakli, masaustunde gorunum zayif, tema desteği sinirli |
| **Electron** | Web teknolojisi (JS/HTML) — Python backend icin overkill, 200MB+ kurulum boyutu |
| **Tkinter (vanilla)** | Gorunum eski ve cirkin — 1990'lar estetiginde |

**Neden CustomTkinter:** (1) Tkinter'in modern gorunumlu versiyonu — karanlik tema dahili. (2) Tamamen Python — ekstra dil gereksiz. (3) Hafif — Electron'un 1/100'u boyutunda. (4) OpenCV ile kolay entegrasyon (kamera frame'lerini dogrudan gosterebiliyorsun). (5) Ogrenme egrisi dusuk — hizli gelistirme.

### 8.6 TTS: Neden pyttsx3?

| Alternatif | Neden Reddettik |
|-----------|----------------|
| **Google TTS (gTTS)** | Internet baglantisi GEREKTIRIR — biz offline calisiyoruz |
| **Web Speech API** | Tarayici tabanlı — masaustu uygulamada kullanilamaz |
| **Coqui TTS** | Kaliteli ama agir model (yuzlerce MB), ayrı GPU gerektirebilir |

**Neden pyttsx3:** (1) Tamamen offline — internet gerektirmez. (2) Isletim sisteminin yerlesik TTS motorunu kullaniyor (macOS: NSSpeechSynthesizer). (3) 3 satir kodla calisıyor. (4) Ses kalitesi "mukemmel" degil ama YETERLI — biz dogal konusma sentezi degil, kelimeleri sesli okuma yapiyoruz.

### 8.7 Inference: Neden CPU?

Bu ilk duyuldiginda garip gelebilir: "GPU varken neden CPU kullaniyorsun?" Cevap basit: modelimiz cok KUCUK.

- Harf modeli (LightGBM): 21 MB, 300 karar agaci → CPU'da 0.017ms
- Kelime modeli (Bi-GRU): 2.7 MB, 711K parametre → CPU'da ~8ms

GPU'nun avantaji BUYUK modellerde ortaya cikar (milyonlarca parametre, gigabyte'larca agirlik). Kucuk modelde su oluyor: CPU→GPU veri transferi ~0.1ms + GPU hesaplama ~0.5ms + GPU→CPU sonuc transferi ~0.1ms = toplam ~0.7ms. CPU'da dogrudan hesaplama: ~0.5ms. GPU hicbir sey kazandirmiyor — hatta dispatch overhead yuzunden bazen DAHA YAVAS.

Apple M4 Pro'daki MPS (Metal Performance Shaders) GPU backend'i de test edildi — ayni sonuc. CoreML + ANE (Apple Neural Engine) ise GRU DESTEKLEMIYOR (konvolusyon motoru).

### 8.8 Egitim Ortami: Neden Kaggle T4?

| Alternatif | Neden Reddettik |
|-----------|----------------|
| **Lokal M4 Pro** | MPS destegi var ama LSTM/GRU egitiminde stabil degil, beklenmedik hatalar |
| **Google Colab** | Ucretsiz tier'da GPU suresi sinirli (90 dk), baglanti kopabiliyor |
| **AWS SageMaker** | Ucretli — ogrenci projesi icin gereksiz maliyet |
| **Lightning AI** | Iyi ama Kaggle zaten yeterli |

**Neden Kaggle:** (1) Haftada 30 saat ucretsiz T4 GPU. (2) Notebook ortami — deney sonuclarini kaydetmek kolay. (3) Veri setleri zaten Kaggle'da — indirme gereksiz. (4) Versiyon kontrolu dahili.

---

## B8b. ARASTIRMA VE LITERATUR — NEREDEN NE OGRENDIK

Projedeki her teknik kararin arkasinda ya bir Kaggle yarismasi sonucu ya da bir akademik makale var. Hicbir seyi "tahminen" yapmadik — her kararin bilimsel veya deneysel bir gerekçesi var.

### Kaggle Yarismalarindan Ogrendiklerimiz

**Kaggle GISLR 1. Sira (hoyso48, 2023):**
Bu yarismada 250 ASL kelimesi tanima yapildi. Kazananin cozumu bize 3 sey ogretti: (1) 130 landmark secimi (76 yuz + 42 el + 12 govde) standart haline geldi. (2) Model boyutu <40MB tutularak TFLite ile mobilde bile calistirilabiliyor. (3) 1D-CNN + Transformer kombinasyonu buyuk veri setlerinde guclu. Biz 107 landmark kullaniyoruz — gelecekte 130'a gecis planliyoruz.

**Kaggle Fingerspelling 1. Sira (Henkel/NVIDIA, 2023):**
Bu ekip iki kritik bilgi paylasti: (a) FingerDropout ve TimeStretch en etkili augmentasyon teknikleri, (b) MediaPipe %46-50 oraninda parmak kaciriyor. Bu bilgi bizim augmentasyon stratejimizi dogrudan sekillendirdi — V3'ten itibaren her iki teknigi kullaniyoruz.

### Akademik Makaleler ve Etkisi

| Makale | Yil / Kaynak | Ne Buldular | Bize Nasil Etki Etti |
|--------|-------------|-------------|---------------------|
| **Roh et al.** | 2024, KAIST (Guney Kore) | Omuz-merkezli normalizasyon WLASL'de +%6.05 | V3'te omuz normalizasyonu uyguladik — ozellikle vucut kullanilan kelimelerde buyuk fark |
| **Ethiopian SL** | 2025, Nature Scientific Reports | Signer-dependent %94 → independent %73 | Domain gap sorunumuzun bizimle sinirli olmadigini, alandaki herkesin yasadigini dogruladi |
| **Lin et al. (Focal Loss)** | 2017, Facebook AI (ICCV) | Zor orneklere odaklanma siniflandirmayi iyilestirir | V4'te uyguladik → +%2.1 dogruluk artisi, overconfidence azaldi |
| **Chung et al.** | 2014, Bengio lab | GRU kucuk veride LSTM'den tutarli olarak daha iyi | GRU secimimizin bilimsel dayanagi — deneysel sonucumuz (%86.7 vs %78.2) bunu dogruladi |
| **SPOTER** | 2022, WACV | 847K param Transformer, 127 FPS | Gelecek 50+ kelime icin aday mimari |
| **Woods & Rana** | 2023, MDPI | 94K param encoder-only Transformer, 50 kelime %87 | GRU'dan sonraki en hafif Transformer alternatifi |
| **MR Teaching** | 2024, arXiv:2404.10490 | Poz karsilastirma + bilesen bazli skorlama | Ogrenme Kocu modulu tasariminda referans |
| **BdSL-SPOTER** | 2023 | Curriculum learning ile +%22.8 | Egitim stratejisi icin gelecek referansi |
| **LiteSPOTER** | 2025, SSRN | WLASL-100'de %99.41, cok kucuk model | Gelecek model upgrade adayi |
| **Kopuklu et al.** | 2019, IEEE | Gesture Detector pre-filter mimarisi | Gating sistemimizin ilham kaynagi |

---

## B9. OGRENME KOCU — DETAYLI

### Harf Modu

Kullanici listeden harf secer → referans gorsel + Turkce ipucu gosterilir → kameradan el algilanir → model tahmini yapilir → hedef harfin gercek yuzdesi hesaplanir → geri bildirim gosterilir.

**Basari Mekanizmasi (Her frame'de):**
1. Model tahmini yapilir: `(predicted_label, confidence, top3)`
2. Hedef harfin gercek olasiligi top-3'ten cikarilir (ornegin hedef "B", model "D" dedi ama top3'te "B" %23 ile var → target_prob = 0.23)
3. `target_prob >= 0.65` (COACH_SUCCESS_THRESHOLD) ise → `success_frames += 1`
4. Degilse → `success_frames = max(0, success_frames - 1)` (yavasca dusur, sifirin altina dusturyeme)
5. `success_frames >= 60` (~2 saniye @ 30fps) ise → **TAMAMLANDI!** "MUKEMMEL! %94 ile tamamladiniz! ✓"

**Neden 60 frame?** 30fps × 2 saniye = 60 frame. Kullanicinin harfi dogru yapip ~2 saniye sabit tutmasini istiyoruz. Bu sure ne cok kisa (tesadüfi basari onlenir) ne cok uzun (kullanici sabırsizlanmaz).

**Feedback Throttling:** Metin guncelleme 1.5 saniye arayla (FEEDBACK_DELAY). Neden? Her frame'de metin degisse UI titresir, okunamaz. Ama basari sayaci (success_frames) her frame'de calisiyor — metin guncellenmese bile sayac artıyor. Bu ayrim onemli.

### Kelime Modu (State Machine)

Eski problemler:
- Surekli sliding window → kullanici ne zaman kayit yapildigini bilmiyor
- Eski frame'ler yeni denemeye karisiyor
- Kullanici hazirlanmadan tahmin geliyor

Yeni sistem — 4 durumlu state machine:

**IDLE durumu:**
- Kamera ACIK, landmark'lar CIZILI (kullanici kendini goruyor)
- Ama frame TOPLANMIYOR (buffer bos)
- "Hazirim — Kayda Basla" butonu gorunur
- Kullanici referans gorsele bakiyor, hareketi pratikte yapabilir

**COUNTDOWN durumu:**
- Butona basildi → 3 saniye geri sayim
- Hala frame TOPLANMIYOR — sadece "3... 2... 1..." goruyor
- Kullanici hazirlaniyor

**RECORDING durumu:**
- Geri sayim bitti → KAYIT BASLAR
- Her frame'de `keypoints.copy()` listeye ekleniyor
- Progress bar doluyor: "Kaydediliyor ▓▓▓▓░░░ 15/30"
- Kamera frame'ine KIRMIZI CERCEVE ciziliyor (gorsel ipucu: kayit aktif)
- 30 frame toplandiginda → `predict_sequence()` DOGRUDAN cagiriliyor
- `add_frame()` KULLANILMIYOR — sliding window sorunu yok

**RESULT durumu:**
- Tahmin gosteriliyor: "Harika! %72" veya "✗ 'dad' algilandi — tekrar deneyin"
- Top-3 tahminler gosteriliyor (model ne gordugunun seffafligi)
- 3 saniye sonra → IDLE'a don
- Basari ise: `success_frames += 1`. 3 basarili tahmin → "MUKEMMEL!" + sonraki kelime

**Neden tumbling (tek seferlik) tercih ettik?** Cunku ogrenme kocunda kullanicinin KONTROLU onemli. Surekli sliding window'da kullanici "ben simdi basladim mi, bitti mi?" bilemiyor. Tek seferlik kayit = net baslangic (buton), net sure (3s hazirlık + 1s kayit), net sonuc.

---

## B10. INFERENCE HIZI VE DONANIM

### Her Bilesen Ne Kadar Suruyor?

| Bilesen | Gecikme | Toplamin Yuzde Kaci | Darboğaz mi? |
|---------|---------|--------------------|----|
| MediaPipe Hand Detection | ~15ms | **%65** | **EVET — en yavas** |
| Normalizasyon | ~0.1ms | <%1 | Hayir |
| Feature Engineering | ~0.5ms | ~%2 | Hayir |
| Harf Tahmini (LightGBM) | 0.017ms | <%1 | Hayir |
| Kelime Tahmini (Bi-GRU) | ~8ms | ~%33 | Biraz |
| Smoother | ~0.2ms | <%1 | Hayir |
| **TOPLAM** | **~18-25ms** | | **30-50 FPS** |

### Neden GPU (MPS) Kullanmiyoruz?

| Framework | Hiz | Sorun |
|-----------|-----|-------|
| **PyTorch CPU** ✅ | <1ms | YETERLI — model cok kucuk |
| PyTorch MPS (Apple GPU) | ~1ms | Dispatch overhead — GPU'ya veri gondermek, sonucu geri almak ~0.1ms suruyor. Model kendisi de ~0.5ms → toplam kazanc YOK |
| CoreML + ANE | 2-4ms | ANE bir "konvolusyon motoru" — GRU DESTEKLEMIYOR |
| MLX | <1ms | Apple'in ML framework'u. LightGBM entegrasyonu yok, yeniden yazmak lazim |

**Aciklama:** Modelimiz 2.7 MB ve 350K parametre. Bu cok KUCUK. GPU'nun avantaji BUYUK modellerde (milyonlarca parametre, gigabyte'larca veri). Kucuk modellerde GPU'ya veri transfer etme maliyeti (dispatch overhead) kazanctan BUYUK oluyor. CPU zaten <1ms'de bitiyor — GPU'ya gerek yok.

---

## B11. PROJE YOLCULUGU — STRATEJIK KARARLAR

### Over-Engineering'den Odaklanmaya

**Baslangic plani (cok hırsli):**
- 6 yerel + 3 Kaggle veri seti kullan
- Fingerspelling Transformer + LSTM + Continuous ASL
- GNN, CNN, Siamese Network alternatifleri degerlendir
- 2000 kelime sozlugu
- Otomatik mod algilama

**Donüm noktasi:** "Belki tum veri setlerini bu kadar teknolojiyle kullanmak over-engineering. Belki her seyden faydalanamayiz ve isimizi zorlastiriz."

**Yeni plan (odaklanmis):**
- 2-3 veri seti, 1 mimari, 25 kelime kalitesi
- LightGBM (harf) + Bi-GRU (kelime) — kanitlanmis, basit
- Manuel mod secimi (daha guvenilir)

**Sonuc:** Her sey daha iyi calisiyor. Odaklanma > kapsam genisletme.

### Feature Mismatch Olayi

Feature Engineering'de `area` (el alanı) normalizasyonu eklenmek istendi. Ama model bu normalizasyon OLMADAN egitilmisti. Degisiklik uygulansa egitim sirasindaki feature'lar ile canli tahmin sirasindaki feature'lar FARKLI olacakti. Bu "train-inference mismatch" cok tehlikeli — model alti ust olur.

**Karar:** Degisiklik GERI ALINDI. Dogru karar.

**Ders:** Egitilmis modelin feature pipeline'ini ASLA degistirme (yeniden egitmeden). "Iyilestirme" her zaman ilerleme demek degil.

### Reddedilen Teknolojiler ve Nedenleri

| Teknoloji | Neden Dusunduk | Neden Reddettik |
|-----------|---------------|----------------|
| CNN (MobileNetV2) | Gorsel islemede guclu | Landmark-tabanli yaklasim zaten %99.4 veriyor — gereksiz |
| Fingerspelling Transformer | 94 kisi, buyuk veri seti | Use case uyumsuz — biz tek harf gosteriyoruz |
| GNN (Graph Neural Network) | El iskeleti dogal bir graf | FE zaten yeterli — ekstra karmasiklik |
| Siamese Network | Az veriyle ogrenme (few-shot) | K-NN daha basit ve yeterli |
| SVM | Klasik baseline | Her zaman LightGBM'den dusuk |
| 2000 kelime (WLASL) | Genis sozluk | 25 kelime kalitesi > 2000 kelime kaosu |
| Otomatik mod algilama | Akilli gec | Manuel buton daha GUVENILIR |

---

# BOLUM C: SUNUMU NASIL YAPACAKSIN

---

## C1. 10 DAKIKALIK SUNUM SENARYOSU

### Dakika 0-2: Giris
> "Merhaba, ben Ali Mustafa Ekmen. Projem: webcam'den Amerikan Isaret Dili taniyan ve ogreten bir masaustu uygulamasi. Tamamen offline calisiyor — internet gerektirmiyor. 24 harf ve 25 kelime taniyabiliyor. Sesli okuma yapiyor. Ve ogrenme kocu moduluyle kullaniciya isaret dilini ogretiyor."

### Dakika 2-4: Canli Demo
1. Uygulamayi ac → Harf modunda A, B, C yap → ekranda dogru tanima
2. Kelime moduna gec → "Hello" yap → sesli okuma
3. Ogrenme Kocuna gec → harf sec → basariyla tamamla
4. Kelime kocunda "Hazirim" → geri sayim → kayit → sonuc

### Dakika 4-7: Teknik Aciklama (3 Ana Nokta)

**1. Feature Engineering:**
> "Sistemin kalbi Feature Engineering. MediaPipe elin 21 noktasini cikartiyor — 63 sayi. Bu sayilar elin konumuna bagimli — elini saga tasirsan degisir. Biz bunlardan parmak mesafeleri, eklem acilari ve parmak bayraklari cikardik — 93 konum-bagimsiz ozellik. Ablasyon calismasindan sonuc: FE olmadan %33, FE ile %99.4."

**2. Model Secimi:**
> "Harf icin 5 algoritma test ettik: LightGBM, Random Forest, XGBoost, 1D-CNN, MLP. LightGBM en iyisi — %99.96 dogruluk. Kelime icin GRU vs LSTM karsilastirdik — GRU %86.7, LSTM %78.2. GRU daha az parametreye sahip, kucuk veri setimizde daha iyi genelliyor."

**3. Domain Gap:**
> "En buyuk zorlugumuz domain gap. Model veri setinde %99 ama farkli kisiye gosterince %28.7'ye dustu. 5 katmanli cozum uyguladik: Feature Engineering, coklu kisi verisi, 7 augmentasyon teknigi, K-NN kalibrasyon ve 5 katmanli gating sistemi."

### Dakika 7-9: Zorluklar + Dersler
> "8 farkli veri seti denedik. Birinde 36,000 gorsel isledik, sifir sonuc — gorseller gercek el degil, bilgisayar cizimleri. Bu bize ogretici oldu. Augmentasyon tekniklerini Kaggle yarisma kazananlarindan, normalizasyonu KAIST arastirmasindan, Focal Loss'u Facebook AI'dan ogrendik."

### Dakika 9-10: Gelecek + Kapanıs
> "Gelecek planlarimiz: J/Z harfleri, 130 landmark gecisi, 50 kelimeye genisleme, web versiyonu. 50+ kelimede Transformer mimarisine gecis planliyoruz. Sorularinizi bekliyorum."

---

## C2. JURI SORULARI VE HAZIR CEVAPLAR

### "Neden CNN yerine LightGBM?"
> Biz gorseli degil, landmark'lari isliyoruz. MediaPipe zaten eli buluyor, bize 21 nokta veriyor. Bu noktalardan Feature Engineering ile 93 ozellik uretiyoruz. Bu bir TABLO verisi — CNN gorsel isleme icin optimize edilmis, tabular veride LightGBM neredeyse her zaman daha iyi. Bunu ablasyon calismasiyla kanitladik: 5 model test ettik, LightGBM en iyisiydi.

### "%99.4 gercekci mi?"
> Durust olacagim: veri seti uzerinde %99.4, canli webcam'de tahminen %70-80. Bunu biliyoruz cunku capraz kisi validasyonu yaptik — ayni kisi %99.96, farkli kisi %28.7. Bu farki bilmek ve cozum uretmek onemli. 5 katmanli yaklasimla gercek ortam performansini yukseltmeye calisiyoruz.

### "GRU mu LSTM mi?"
> GRU 3 gate, LSTM 4 gate — daha az parametre, kucuk veride daha iyi genelleme. Deneysel sonuc: GRU %86.7, LSTM %78.2. Literatur de destekliyor (Chung et al. 2014). Veri setimiz ~9,500 ornek — bu boyutta GRU daha uygun.

### "Focal Loss ne?"
> Normal loss kolay ve zor orneklere esit bakar. Focal Loss (gamma=2) kolay orneklerin kaybini otomatik azaltir, modeli zor orneklere odaklandirir. V4'te uyguladik — +%2.1 dogruluk artisi, overconfidence azaldi.

### "Feature Engineering neden bu kadar etkili?"
> Ham koordinatlar elin KONUMUNA bagimli. Mesafe, aci ve bayrak ise elin SEKLINE bagimli — nereye tutarsan ayni. Model artik sEkil ogreniyor, konum degil. %33 → %99 = %66 fark.

### "Transformer dusundunuz mu?"
> Evet. Kaggle 1. sirasi kullaniyor. SPOTER 847K param ile 127 FPS calisiyor. Ama 25 kelime ve ~9,500 ornekle overfit riski yuksek. Gelecekte 50+ kelimede gecis planliyoruz.

### "25 kelime yeterli mi?"
> ASL'de en sik 100 kelime gunluk iletisimin %80'ini kapsiyor. Moduler tasarim — kelime eklemek veri + egitim gerektiriyor, mimari degisiklik yok.

### "Domain gap'i nasil cozdunuz?"
> 5 katman: FE (konum-bagimsiz ozellikler), coklu kisi verisi, 7 augmentasyon, K-NN kalibrasyon (3 saniyede kullaniciya ozel), 5 katmanli gating.

### "Offline neden?"
> Isaret dili tanima surekli video — bulut API: gecikme + maliyet + internet + gizlilik. Offline: hicbiri yok.

### "Attention ne ise yariyor?"
> Normal GRU son frame'e bakar. Ama "hello"da hareketin ORTASI en onemli. Attention her frame'e "ne kadar onemli?" soruyor — onemli frame'lere daha fazla agirlik veriyor.

### "Augmentasyonu nereden ogrendiniz?"
> Kaggle yarisma kazananlarindan. Fingerspelling 1. sirasi FingerDropout ve TimeStretch'i "en onemli" olarak belirledi. MediaPipe %46-50 parmak kaciriyor — FingerDropout bunu egitimde simule ediyor.

### "Veri setini nasil sectiniz?"
> 8 veri seti denedik, 3 kriterle elemek: (1) MediaPipe isleyebilir mi? (2) Coklu kisi var mi? (3) Use case'e uygun mu? 3 kullandik, 5 reddettik. Her birinden bir ders aldik.

### "Model boyutu neden onemli?"
> Harf: 21 MB, Kelime: 2.7 MB. Toplam ~24 MB. Bu cok kucuk — mobilde bile calisir. Karsilastirma: Kaggle 1. sirasi <40 MB. Kucuk model = hizli inference = gercek zamanli calisma.

### "Neden 107 landmark, neden 130 degil?"
> 130 landmark (Kaggle standardi) ideal ama biz projein erken asamasinda 107 ile basladik. 107 de gayet iyi calisiyor — V3'te "dad" %50'den %98'e cikti. Gelecekte 130'a gecis planliyoruz — ozellikle yuz landmark'larini 32'den 76'ya cikaracagiz.

### "Neden pyttsx3, neden Google TTS degil?"
> Proje tamamen offline calisiyor — internet baglantisi gerektirmiyor. Google TTS her sesli okumada sunucuya istek gondermek zorunda. pyttsx3 ise isletim sisteminin yerlesik TTS motorunu kullaniyor (macOS'ta NSSpeechSynthesizer). Ses kalitesi "mukemmel" degil ama amacimiz dogal konusma sentezi degil, kelimeleri sesli okumak. Offline calisma, gizlilik ve gecikme acisından cok daha avantajli.

### "Projeye nasil basladiniz? Nasil bir yol izlediniz?"
> ASL isaret dili secmemizin sebebi, erisilebilirlik alaninda gercek bir etki yaratabilecek bir proje yapmak istememizdi. Baslangiçta cok hırsli bir planla basladik — 6 veri seti, birden fazla model mimarisi, 2000 kelime. Sonra fark ettik ki bu over-engineering. Plani daralttik: 2-3 veri seti, 25 kelime, LightGBM + GRU. Odaklanma her seyi iyilestirdi.

### "En buyuk hata ne oldu? Tekrar yapsan ne degistirirsin?"
> En buyuk hatamiz baslangicta veri setini yeterince incelememek. MediaPipe_Processed_Asl veri setinde 36,000 gorsel isledik — sonuc %0, cunku icindeki gorseller gercek el degil, bilgisayar cizimleri. Saatler kayip gitti. Tekrar yapsam ONCE 100 ornekle test ederdim. Simdi bu kurali uyguluyoruz.

### "Neden bu konuyu sectiniz?"
> Isaret dili tanima hem teknik olarak zorlayici hem de sosyal olarak anlamli. Isitme engelli bireylerle iletisim kurabilecek bir arac gelistirmek motivasyonumuzu yuksek tuttu. Ayrica bilgisayarli gorme, makine ogrenmesi ve gercek zamanli sistem tasarimi konularini bir arada deneyimleme firsati sunuyor.

### "Zaman yonetiminizi nasil yaptiniz?"
> Kaggle T4 GPU'da haftada 30 saat egitim hakki var. Bu sinir bizi disiplinli olmaya zorladi — her deney oncesinden planlanmali, gereksiz deney yapilmamali. Harf modeli haftalar icinde tamamlandi cunku tabular veri ve LightGBM cok hizli. Kelime modeli 4 versiyon surdu — her versiyonda spesifik bir sorunu cozduk.

### "Bu projenin gercek hayatta kullanim alani ne?"
> Iki ana senaryo: (1) Isitme engelli bireylerin isaret dilini metne/sese cevirme araci — gunluk iletisimde kullanilabilir. (2) Isaret dili ogrenmek isteyen kisiler icin interaktif ogrenme kocu — bireyin el formunu analiz edip geri bildirim veriyor. Her ikisi de tamamen offline calisiyor, ozel donanim gerektirmiyor.

### "Overfitting'i nasil onlediniz?"
> 5 katmanli yaklasim: (1) Dropout — V4'te %40'a cikardik. (2) Weight decay (1e-4) — agirliklari kucuk tutar. (3) Early stopping — validation loss iyilesmemeye basladiginda dur. (4) Augmentasyon — 7 teknikle veriyi 5x cogalttik. (5) Coklu kisi verisi — tek kisi yerine farkli insanlarin verisini kullanma.

### "Attention mekanizması tam olarak ne yapiyor?"
> Normal GRU'da 30 frame'in sonuncusunun ciktisini alip tahmin yapiyorsun. Ama her frame esit onemde degil — baslangictaki hazirlik frame'leri onemSIZ, hareketin ORTASI en onemli. Attention her frame'e 0-1 arasi bir agirlik atiyor. Bu agirliklar egitim sirasinda ogreniliyor. Sonuc: onemli frame'ler one cikiyor, onemSIZ frame'ler bastiriliyor. V4'te eklendi — ozellikle "go" ve "give" gibi kisa, hizli hareketlerde iyilesme sagladi.

### "Augmentasyon tekniklerini nasil sectiniz?"
> Kaggle yarisma kazananlarindan ogrendik. Fingerspelling 1. sirasi FingerDropout ve TimeStretch'i "en onemli augmentasyonlar" olarak raporladi. MediaPipe %46-50 oranında parmak kaciriyor — FingerDropout bunu egitimde simule ediyor. TimeStretch farkli isaret yapma hizlarini simule ediyor. Bunlara GaussianNoise, Rotation, Scale, Mirror ve Mixup ekledik — toplam 7+1 teknik. V2'de 3 teknikle basladik, V4'e kadar 7+Mixup'a ciktik.

### "Bu proje neden offline calisiyor? Bulut kullanilsa daha mi iyi olur?"
> Isaret dili tanima surekli video isleme gerektiriyor — her saniye 30 frame. Bulut API'ye gondermek: (1) gecikme ekler (kullaniciya gercek zamanli hissettirmez), (2) surekli internet baglantisi gerektirir, (3) maliyet olusturur (her API cagrisi ucretli), (4) gizlilik riski tasiyor (video verisi sunucuya gidiyor). Offline cozumde bunlarin HICBIRI yok. Modelimiz 2.7 MB — herhangi bir laptopte calisir.
> pyttsx3 tamamen OFFLINE calisiyor — internet gerektirmiyor. Google TTS daha kaliteli ses uretir ama internet sart. Projemiz offline odakli oldugu icin pyttsx3 secildi.

---

# BOLUM D: BENIM AGZIMDAN — PROJE YOLCULUGUM

> Bu bolum sunumda ve juri karsisinda kullanman icin SENIN AGZINDAN yazildi.
> Birebir okuman gerekmiyor — ama akisi, tonunu, nerelerde duracagini buradan cap.
> Amac: dogal, samimi, ozguvenli ama abartisiz bir anlatim.

---

## D1. Projeye Nasil Basladim

Projeye baslarken kafamdaki fikir basitti: kamerayla isaret dili taniyabilecek bir uygulama yapmak. Isitme engelli bireylerle iletisim kurmak icin bir kopru olmasi hosuma gidiyordu — hem teknik olarak zorlayici, hem de toplumsal acidan anlamli.

Ilk arastirmami yaptigimda geri kaldim diye hissettim. Kaggle'da yarisma kazananlari Transformer kullaniyor, binlerce kelime taniyor, 130 landmark kullaniyorlar. Ben daha "landmark nedir" bilmiyordum. Ama ogrendim ki arada cok buyuk bir fark var: yarisma cozumleri ile gercek zamanli calisan uygulama cok farkli seyler. Yarismalarda inference hizi onemsiz, bende ise her frame'i 33ms icinde islemem lazim.

Ilk planım asiri buyuktu: 6 veri seti kullanacaktim, hem LSTM hem Transformer deneyecektim, 2000 kelime taniyacaktim, otomatik mod algilama yapacaktim. Sonra fark ettim ki bu planla bitmez. Odaklanmam lazim. 25 kelime, iyi calisin. 24 harf, stabil olsun. Geri kalani gelecek plani olsun.

---

## D2. Ilk Hayal Kirikliklari

Proje boyunca en cok ogretici olan seyler basarisizliklar oldu.

**36,000 gorsel, sifir sonuc.** MediaPipe_Processed_Asl diye bir veri seti buldum. Ismine bakarak "MediaPipe ile islenmis, harika!" dedim ve 36,000 gorseli islemden gecirmeye basladim. Saatler sonra sonuc: SIFIR. Hicbir gorselde MediaPipe el bulamadi. Cunku gorseller gercek el fotografi degil — bilgisayar cizimleri. O gunden sonra hicbir veri setini ismine bakip kullanmiyorum. Once 100 ornegi elle inceliyorum.

**%99.96'dan %28.7'ye dusus.** Harf modeli veri setinde muhtesem calisiyordu. Sonra farkli bir kisinin verisini test ettim — %28.7. Ilk anki tepkim: "Model bozuk." Sonra arastirdim ve bunun "domain gap" denilen, alanda herkesin yasadigi bir sorun oldugunu ogrendim. Ethiopian SL makalesinde %94'ten %73'e dusus raporlanmis. Biz %99.96'dan %28.7'ye dustuk — daha kotu ama en azindan yalniz degiliz. Bu beni rahatlatmadi ama sorunu ciddiye almami sagladi.

**LSTM vs GRU surprizi.** Herkes "LSTM daha guclu" diyor. Ilk kelime modelini LSTM ile yaptim. Sonra GRU denedim — %8.5 daha iyi. Sasirdim. Arastirdim: Chung et al. (2014) makalesinde ayni bulgu var — kucuk veri setlerinde GRU, LSTM'den tutarli olarak daha iyi. Ders: "herkesin soyledigi" her zaman dogru degil, kendin dene.

---

## D3. Donum Noktalari

Bazi anlar projenin yonunu tamamen degistirdi.

**Feature Engineering keşfi.** Modeli ham landmark'larla egittigimde %33 dogruluk aliyordum — neredeyse rastgele. Sonra dusundum: elin koordinatlari konumuna bagli. Elimi saga tasiyinca tum sayilar degisiyor ama el sekli AYNI. Peki konumdan bagimsiz seyler hesaplasam? Parmak-bilek mesafeleri, eklem acilari, parmak acik/kapali bayraklari... 63 sayidan 93 sayi urettim. Sonuc: %33'ten %99.4'e firladi. TEK bir muhendislik karariyla %66 artis. Bu projedeki en onemli ders: bazen en etkili cozum en karmasik algoritma degil, veriyi dogru temsil etmek.

**107 landmark gecisi.** Kelime modelinde "dad" kelimesi %50'de takiliydi. "Dad" alna basparmakla dokunma hareketi — ama sadece el landmark'lari var, model elin NEREYE dokundugunu gormuyor. Yuz ve govde landmark'lari ekleyince "dad" %98'e cikti. Bazen sorun modelde degil, modele verdigin bilgide.

**Focal Loss + Attention.** V3 modelinde bazi kelimeler harika calisiyordu ama "go" gibi kisa hareketlerde %40'ta kaliyorduk. Normal loss fonksiyonu kolay ve zor orneklere esit bakiyor — model kolay ornekleri "cilalamaya" devam ediyor. Focal Loss (Lin et al. 2017, Facebook AI) bunu cozuyor: kolay orneklerin etkisini otomatik azaltiyor. Attention mekanizmasi da eklendi: 30 frame'den en onemli olanlara daha cok agirlik veriyor. V3'ten V4'e +%2.1 artis — %85 ustu bolgede bu BUYUK bir gelisme.

---

## D4. En Cok Zorlandigim Anlar

**Veri toplama sureci.** 8 farkli veri seti inceledim. Bazilari cok buyuk ama erisilemez (WLASL'nin %43'u silinmis), bazilari gorseller yanlis format (iskelet cizimleri), bazilari use case'e uymuyor (fingerspelling ≠ tek harf). Her veri setini degerlendirmek, islemek, sonuc almak gunler surdu. Ama bu surec bana veri kalitesinin veri miktarindan daha onemli oldugunu ogretti.

**Canli performans sorunu.** Model veri setinde harika calisiyordu ama webcam'e gectigimde her sey farkli. El titriyordu (jitter), model her frame farkli sey soyluyordu (oscillation), arka plan karistiriyordu (false positive). Bunlari cozmek icin 5 katmanli bir gating sistemi kurdum: landmark kalite kontrolu, hareket algilama, entropy filtreleme, guven esigi, prediction smoother. Bu muhendislik calismasi model egitiminden daha fazla zaman aldi.

**Over-engineering tuzagi.** Baslangiçta her seyi yapmak istiyordum: CNN, Transformer, GNN, Siamese Network, 2000 kelime... Sonra hicbiri tam calismiyordu cunku odaklanamiyordum. "Az ama iyi" prensibine gectigimde her sey yerine oturdu. 25 kelime, 2 model, 1 pipeline — ama duzgun calisiyor.

---

## D5. Ne Ogrendim

### Teknik Ogrendiklerim
- **Veri > Algoritma.** En iyi model bile kotu veriyle calismaz. Feature Engineering tek basina %66 fark yaratti.
- **Basitlik > Karmasiklik.** LightGBM (gradient boosting) tabular veride CNN'den iyi. GRU kucuk veride LSTM'den iyi. Her zaman en karmasik model en iyi degil.
- **Gercek dunya ≠ Veri seti.** Laboratuvar sonuclari gercek performansi yansitmaz. Domain gap, her ML projesinde karsina cikar.
- **Augmentasyon cok onemli.** 7 teknikle veriyi cesitlendirmek, yeni veri toplamaktan bazen daha etkili.
- **Kaggle yarismalari bilgi hazinesi.** Kazananlarin cozumlerini okumak, ders kitaplarından bazen daha ogretici.

### Kisisel Ogrendiklerim
- **Planlama kadar odaklanma da onemli.** Buyuk plan yapmak kolay, duzgun uygulamak zor. Daha az sey planla, ama planladigini duzgun bitir.
- **Basarisizlik en iyi ogretmen.** 36,000 gorsel cope gitti — ama o olaydan sonra hicbir veri setini kontrol etmeden kullanmadim.
- **Literatur okumak zaman kazandirir.** Roh et al. makalesi omuz normalizasyonu icin haftalarca deneme yapacagimi onledi — direkt uyguladim.
- **Muhendislik kararlari bilimsel olmali.** "Bu daha iyi GORUNUYOR" degil, "bu %2.1 daha iyi, cunku Focal Loss zor orneklere odaklaniyor" — olculebilir gerekce.

---

## D6. Sunumda Kullanabilecegim Cumleler

Bunlar ezberlenecek cumleler degil — akisini gormek icin. Kendi tonunla soyle.

**Giris icin:**
"Projem, webcam'den Amerikan Isaret Dili'ni taniyip metne ve sese ceviren, ayni zamanda isaret dili ogreten bir masaustu uygulamasi. Tamamen offline calisiyor, ozel donanim gerektirmiyor."

**Feature Engineering anlatirken:**
"Sistemin kalbi Feature Engineering. MediaPipe elin 21 noktasini cikariyor — 63 sayi. Ama bu sayilar elin konumuna bagli. Ben bunlardan parmak mesafeleri, eklem acilari ve bayraklar urettim — 93 konum-bagimsiz ozellik. FE olmadan %33, FE ile %99.4. Tek bir muhendislik karariyla %66 fark."

**Domain gap anlatirken:**
"En buyuk zorlugumuz domain gap oldu. Model veri setinde %99.96, ama farkli kisiye gosterince %28.7'ye dustu. Bu alanda herkesin yasadigi bir sorun — Nature dergisindeki Ethiopian SL calismasinda da %21 dusus raporlanmis. Biz 5 katmanli bir cozum uyguladik."

**Veri seti sureci anlatirken:**
"8 farkli veri seti denedik. Birinde 36,000 gorsel isledik, sifir sonuc aldi — gorseller gercek el degil, bilgisayar cizimleri cikti. Bu bize veri kalitesinin veri miktarindan onemli oldugunu ogrettigoren onemli bir deneyim oldu."

**Model secimi anlatirken:**
"Harf icin 5 model test ettik — LightGBM en iyisi cikti, %99.96. Neden? Cunku elimizdeki veri gorsel degil, tablo. MediaPipe zaten eli buluyor, bize 93 sayilik ozellik vektoru geliyor. Bu veride gradient boosting her zaman derin ogrenmeden iyi."

**Kelime modeli anlatirken:**
"Kelime modeli 4 versiyondan gecti. Ilk versiyon 15 kelime, %91.4. Sonra 25 kelimeye cikardik, GRU'ya gectik. V3'te yuz ve govde landmark'lari ekledik — 'dad' kelimesi %50'den %98'e firladi. V4'te Focal Loss ve Attention ekledik — final dogruluk %86.7."

**Kapanista:**
"Bu proje bana en cok sunu ogretti: en etkili cozum her zaman en karmasik algoritma degil. Bazen veriyi dogru temsil etmek, dogru feature'lari secmek, odaklanmak — bunlar karmasik mimarilerden daha cok ise yariyor."

---

## D7. Juri Karsisinda Dikkat Edilecekler

- **Soruyu yanitlamadan once 2 saniye dusun.** Aceleyele cevapta yanliss sey soylemektense, kisa bir dusunme ani cok normaldir.
- **Bilmedigini soyle.** "Bu konuyu detayli arastirmadim ama bildiklerimle soyle cevap verebilirim..." juriye GUVEN verir.
- **Rakam ver.** "%99.4", "%28.7", "%66 fark", "5 model test ettik", "8 veri seti denedik" — somut rakamlar ikna edici.
- **Kaynak goster.** "Chung et al. 2014 makalesine gore...", "Kaggle 1. sirasinin cozumunde..." — arastirma yaptigini goster.
- **Basarisizligi anlat.** Jurilere basarisizlik degil, basarisizliktan ogrenme etkiler. "36K gorsel, sifir sonuc — ama bu bize on-test yapmayi ogretti."
- **Karsilastirma yap.** "Transformer da kullanabilirdik ama 9,500 ornekle overfitting riski vardi. GRU daha az parametreyle daha iyi genelledi." Alternatifleri bilmek guclu gosterir.
- **Pragmatik ol.** "Mukemmel cozum yok, her seyin bir trade-off'u var. Biz kullandigimiz kaynaklarla en iyi sonucu almaya calistik."
