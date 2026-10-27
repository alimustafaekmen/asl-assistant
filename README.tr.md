# ASL Assistant

[![CI](https://github.com/alimustafaekmen/asl-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/alimustafaekmen/asl-assistant/actions/workflows/ci.yml)

**Canlı demo:** https://asl-assistant.pages.dev/ · [Teknik rapor](docs/technical-report.tr.md) · [English](README.md)

ASL Assistant, Amerikan İşaret Dili (ASL) harflerini kameradan gerçek zamanlı okuyup metne çeviriyor ve bunu tamamen tarayıcıda yapıyor. Sunucu olmadığı için görüntü cihazınızdan hiç çıkmıyor. Deneysel bir kelime modu da 50 tekil işareti tanıyor; arayüz Türkçe ve İngilizce.

![Harf ekranında yerleşik örnek oynuyor: sarı noktalarla çizilmiş kayıtlı bir el FLY kelimesinin L harfini yapıyor. Sonuç kartında %100 ile L yazıyor, en olası sonuçlar L, K ve G, metin alanında F zaten var.](docs/assets/screenshots/demo-laptop.tr.png)

<p align="center">
  <img src="docs/assets/screenshots/letter-phone.tr.png" height="300" alt="Telefonda harf ekranı.">
  <img src="docs/assets/screenshots/word-laptop.tr.png" height="300" alt="Dizüstü bilgisayarda deneysel kelime ekranı: en olası sonuçlar, kelime referansı ve 50 kelimelik liste.">
</p>

## Sonuçlar

| | Harfler (24 statik) | Kelimeler (50 tekil işaret) |
|---|---|---|
| Model | 93 el şekli özelliği üzerinde LightGBM | 45 kare × 168 özellik üzerinde Transformer |
| Doğruluk | Ayrı bir test setinde %68,9 | Eğitimde hiç görülmemiş 4 kişide %71,9 doğruluk, 0,71 makro-F1 |

Harf modeli rastgele ayrılmış test verisinde %99,35 alıyor, ama bu sayı gerçeği yansıtmıyor. Ana veri seti her harfi birbirine çok benzeyen uzun fotoğraf dizileriyle çekmiş; rastgele ayırınca test fotoğraflarının neredeyse aynısı eğitimde kalıyor. Bu yüzden modeli ayrı bir test setinde (%68,9) ve bir veri setini tamamen dışarıda bırakıp yeniden eğiterek (yaklaşık %40 ile %80 arası) tekrar ölçtüm. Ayrıntılar [teknik raporda](docs/technical-report.tr.md#harf-modeli). Örnekteki el pozları eğitim fotoğraflarından geliyor; örnek uygulamanın çalıştığını, tablo ise doğruluğu gösteriyor.

## Neler yaptım?

- Harf verisi hattı: üç veri setinden el noktaları (landmark), temizleme, 93 el şekli özelliği (mesafeler, eklem açıları, parmak bayrakları) ve ONNX'e aktarılan bir LightGBM modeli.
- Kelime modelini bir Kaggle notebook'unda, kişiye göre ayrılmış veriyle eğittim. Özellik setlerini, dizi uzunluklarını ve dört mimariyi karşılaştırdım. Transformer ile bir BiGRU doğrulama setinde berabere kaldı (0,792 ve 0,791 makro-F1); daha küçük olduğu için Transformer'ı seçtim.
- Tarayıcı uygulaması: video modunda MediaPipe ve ONNX Runtime Web. Modeller ilk gerektiğinde yükleniyor, bu yüzden sayfayı açmak yaklaşık 0,35 MB tutuyor.
- Özellikler Python'da (`asl-features/`) bir kez tanımlı; JavaScript'te yeniden yazdım ve iki tarafın en fazla 1e-4 ayrıştığını testlerle denetliyorum.
- Türkçe ve İngilizce arayüz, kamerasız örnek ve bir alıştırma modu.
- Gerçek uygulamayı Node'da ve headless Chrome'da açan testler (kamera, MediaPipe ve ONNX Runtime taklit ediliyor) ve GitHub Actions üzerinde CI.

## Nasıl çalışıyor?

```text
kamera karesi -> MediaPipe Tasks Vision (el, vücut ve yüz noktaları)
  harf:   21 el noktası -> 93 özellik -> LightGBM (ONNX) -> 24 harf
  kelime: 45 kare x 168 özellik + maske -> SignTransformer (ONNX) -> 50 kelimeden ilk 3
  -> ONNX Runtime Web (WebAssembly) -> kullanıcı harfi ekler ya da kelimeyi onaylar
```

Uygulama düz HTML, CSS ve JavaScript ile yazıldı; framework ya da derleme adımı yok, yani sitenin tamamı `asl-web/` klasörü.

## Önemli kararlar

- **Her şey tarayıcıda çalışıyor.** Çalıştırılacak ya da parası ödenecek bir sunucu yok ve kamera görüntüsü sizde kalıyor.
- **Pikseller yerine el noktaları.** MediaPipe her kareyi noktalara çeviriyor; böylece modeller küçük kalıyor ve özellikleri inceleyebiliyorum.
- **Kelime verisi kişiye göre ayrıldı.** Rastgele ayırınca model kişileri ezberleyebiliyor; bu yüzden modeli hiç görmediği 4 kişide test ettim.
- **Her kelimeyi kullanıcı onaylıyor.** Doğru kelimelerin güven değeri de çoğu zaman düşük çıkıyor; uygulama bu yüzden ilk üç sonucu gösterip sizi bekliyor.

## Çalıştırma

Uygulamayı https://asl-assistant.pages.dev/ adresinde deneyebilir ya da `make web` ile kendi bilgisayarınızda açabilirsiniz (http://localhost:8080, yalnızca Python 3 gerekir). Geliştirme için (`make setup`, `npm ci`, `make check`) [başlangıç rehberine](docs/getting-started.md) bakın (İngilizce).

## Sınırlamalar

- J ve Z hareket gerektirdiği için bu iki harf için bir model eğitmedim.
- Harf modeli ayrı test kümesinde yaklaşık %70 oranında doğru. Daha fazla kişiden eğitim verisine ihtiyacı var.
- Kelime modeli yalnızca 50 tekil işaret tanıyor; onu 4 test kişisinde ve tek bir eğitim tohumuyla (seed) ölçtüm.
- Uygulamayı masaüstü Chrome'da test ettim, gerçek bir telefonda henüz denemedim.

## Kullanılan teknolojiler

- **Tarayıcı:** HTML, CSS ve JavaScript, MediaPipe Tasks Vision 0.10.18, ONNX Runtime Web 1.22.0, Cloudflare Pages.
- **Makine öğrenmesi:** Python 3.12, LightGBM, PyTorch, scikit-learn, ONNX.
- **Test:** `node:test`, pytest, headless Chrome, JSDoc tipleri için TypeScript, Ruff, GitHub Actions.

## Lisans

Kaynak kod ve eğitilmiş model dosyaları [PolyForm Noncommercial License 1.0.0](LICENSE) ile yayımlandı: kişisel, eğitim ve araştırma amaçlı kullanım serbest, ticari kullanım için iznim gerekiyor. Model dosyalarına aşağıdaki eğitim verilerinin koşulları da uygulanır.

## Veri ve atıf

- Harfler: [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), Akash Nagaraj, 2018, [doi:10.34740/KAGGLE/DSV/29550](https://doi.org/10.34740/KAGGLE/DSV/29550) (GPL-2.0, sağlayıcının belirttiği gibi).
- Harfler ve örnek pozlar: [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset), Ayush Thakur (CC0 1.0).
- Harfler: [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) ile ilişkili `ASL_SemCom` görselleri (koşulları kayıtlı değil; görseller dağıtılmıyor).
- Kelimeler: [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) (Kaggle, 2023), Deaf Professional Arts Network ve Georgia Institute of Technology ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), yarışma kurallarıyla birlikte).

Yaptığım değişiklikler: harf görsellerinden MediaPipe el noktalarını, onlardan da 93 özelliği çıkardım. Kelimelerde 250 işaretten 50'sini seçtim ve her diziyi 168 özellikli 45 kareye yeniden örnekledim. Modeller yalnızca öğrenilmiş parametreleri içeriyor. Yarışma kuralları veriyi yeniden dağıtmayı yasakladığı için (madde 7.B) depoda bu veriden türetilmiş nokta verisi yok, kelime örneği de sentetik. Model Test'teki 24 harf örneği, test için ayrılmış satırların 93 özelliğinden oluşuyor: 23'ü ASL Alphabet'ten, K örneği `ASL_SemCom` görsellerinden. `asl-web/data/demo-letters.json` içindeki örnek pozlar, American Sign Language Dataset'teki üç fotoğraftan çıkarılan noktalar.

Diğer bileşenler:

- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) ve Google'ın landmark modelleri (Apache-2.0), jsDelivr ve Google Cloud Storage'dan yükleniyor.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) ve [kjua](https://github.com/lrsjng/kjua) (MIT), jsDelivr'dan yükleniyor.
- [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) ve [Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono) (SIL OFL 1.1), alt küme olarak, lisansıyla birlikte `asl-web/assets/fonts/` içinde.
- [ASL alfabe tablosu](https://commons.wikimedia.org/wiki/File:Asl_alphabet_gallaudet.svg): Ds13, Gallaudet yazı tipinden (© 1991 David Rakowski), vektöre çeviren Marnanel (kamu malı); kırpılarak `asl-web/assets/signs/letters.png` olarak kullanılıyor.
- `asl-web/data/asl_video_links.json` içindeki video bağlantıları YouTube'daki videolara gidiyor; videolar sahiplerine ait.
