# ASL Assistant

ASL Assistant, Amerikan İşaret Dili parmak alfabesini ve seçili izole
işaretleri tanıyan tarayıcı tabanlı bir projedir. Landmark çıkarma ve ONNX
çıkarımı tarayıcıda gerçekleşir; uygulama backend'i yoktur ve kamera
kareleri sunucuya gönderilmez.

[Canlı demo](https://asl-assistant.netlify.app/#letter) · [Başlangıç rehberi](docs/getting-started.tr.md) · [English README](README.md) · [Dokümantasyon](docs/README.md)

## Neler var?

| Mod | Amaç |
|---|---|
| Harf çevirisi | Projenin desteklediği 24 statik harf sınıfını tanır ve metin oluşturur. |
| Öğrenme koçu | Seçilen harf veya kelimeyle pratik yapmayı ve ilerlemeyi yerelde tutmayı sağlar. |
| Kelime pratiği | 50 sınıflı izole işaret modelini çalıştırır ve ilk üç sonucu gösterir. Deneyseldir. |
| Model Test | Hazır JSON fixture'larını tarayıcıdaki ONNX modelleriyle deterministik olarak çalıştırır. |
| QR Demo | Canlı harf, kelime veya model-test ekranını başka cihazda açar. |

Ana ürün harf deneyimidir. Canlı kelime tanıma; kişi, kadraj, hareket
hızı, aydınlatma ve landmark kalitesine duyarlı olduğu için sınırlı bir
araştırma demosu olarak sunulur.

## Hızlı başlangıç

Web uygulaması için derleme veya Python ML paketleri gerekmez:

```bash
make web
```

<http://localhost:8080> adresini açın. Kamera için `localhost` veya HTTPS
gerekir. Kamera kullanmadan temel çalışma kontrolü yapmak için **Offline
test** kullanılabilir.

## Model özeti

| Pipeline | Harf modeli | Kelime modeli |
|---|---|---|
| Görev | Statik el şekli sınıflandırma | İzole işaret dizisi sınıflandırma |
| Model | LightGBM | SignTransformer encoder |
| Sınıf | 24 | 50 |
| Girdi | 93 tasarlanmış özellik | 45 × 168 özellik + padding maskesi |
| Raporlanan test metriği | %99,35 held-out doğruluk | %71,92 doğruluk; 0,714 macro-F1 |
| Runtime | ONNX Runtime Web | ONNX Runtime Web |

Bu iki sonuç doğrudan karşılaştırılamaz; görevleri, veri setleri,
ayırma stratejileri ve özellik pipeline'ları farklıdır. Harf skoru canlı
kamera başarısı garantisi değildir. Harf modelinin held-out satırları ayrı
kişilerden değil, birleştirilmiş görüntülerden rastgele seçilmiştir; aynı
kişinin neredeyse aynı kareleri ayrımın iki tarafında da bulunabilir. Bu
yüzden skor, yeni bir kişi için başarıyı büyük olasılıkla olduğundan yüksek
gösterir. Kelime modelinin ayrımı ise kişiden bağımsızdır.

## Kurulum seçenekleri

### Yalnızca web

```bash
make web
```

Statik uygulama için Python ML ortamı veya npm kurulumu gerekmez.

### Önerilen Conda ortamı

Public ortam dosyası Python 3.12 ve Node 24 kullanır:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

`asl-assistant` public örnek addır; Makefile belirli bir ortam adına bağlı
değildir ve Conda `base` ortamına kurulum yapmaz.

### Alternatif `venv`

Python 3.12 ortamı oluşturun, Node 24'ü ayrıca kurun ve ardından:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
make doctor
make setup
make health
```

Windows PowerShell aktivasyonu `.\.venv\Scripts\Activate.ps1` komutuyla
yapılır. Ayrıntılar için [Türkçe başlangıç rehberine](docs/getting-started.tr.md)
bakın.

## Depo yapısı

```text
asl-web/       Aktif tarayıcı uygulaması ve deploy artifact'leri
asl-ml/        Ortak Python ML sözleşmeleri ve veri yardımcıları
asl-desktop/   Legacy masaüstü prototipi
data/          Yerel veri alanı; ham ve üretilen veriler Git dışında
models/        Seçilmiş harf ve kelime model artifact'leri
notebooks/     Eğitim kayıtları, metrikler ve grafikler
scripts/       Veri, eğitim, değerlendirme ve doğrulama araçları
tests/         Python, repo, web sözleşmesi ve parity testleri
docs/          Güncel kullanım ve teknik belgeler
```

## Sınırlamalar

- J ve Z desteklenmez; eğitilmiş J/Z modeli yayınlanmamıştır.
- Açık bir no-sign/unknown eğitim sınıfı yoktur.
- Kelime modeli sürekli ASL çevirisi değil, izole işaretler içindir.
- Canlı kelime güveni offline test başarısından daha düşük olabilir.
- Kelime kaydının süre sınırı ve iptal düğmesi yoktur. Yalnızca el, yüz ve
  omuzların birlikte göründüğü kareler sayılır; biri kadraj dışında kalırsa
  kayıt, kamera durdurulana veya mod değiştirilene kadar bekler.
- Otomatik tarayıcı kontrolleri, sanal kamerayla headless masaüstü Chrome'da
  çalışır. Uygulama iOS Safari ve Android Chrome'da henüz test edilmemiştir.
- MediaPipe ve ONNX tarayıcı bağımlılıkları CDN'den yüklenir.
- Model Test fixture'ları tam held-out değerlendirme seti değildir.

## Veri, görseller ve lisans

Ham veri setleri depoya eklenmez. Veri kaynakları ve kullanım sınırları
[Models and data](docs/models-and-data.md) belgesinde açıklanır.

| Model | Kaynak | Koşullar |
|---|---|---|
| Harf | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), Akash Nagaraj, 2018, [doi:10.34740/KAGGLE/DSV/29550](https://doi.org/10.34740/KAGGLE/DSV/29550) | GPL-2.0 (sağlayıcının etiketi) |
| Harf | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset), Ayush Thakur | CC0 1.0 |
| Harf | [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) ile ilişkili yerel `ASL_SemCom` alt kümesi (54.961 landmark satırının 1.580'i) | Kaydedilmemiş; görseller dağıtılmaz |
| Kelime | [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) yarışma verisi (Kaggle, 2023); sağlayıcılar Deaf Professional Arts Network ve Georgia Institute of Technology | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), yarışma kurallarına tabi |

Veride yapılan değişiklikler: harf görselleri MediaPipe el landmark'larına,
ardından 93 özelliğe indirgendi; kelimelerde 250 işaretten 50'si seçildi ve her
landmark dizisi 168 özellikli 45 kareye yeniden örneklendi. Yayımlanan modeller
yalnızca öğrenilmiş parametreleri içerir; görselleri, kayıtları veya landmark
tablolarını içermez.

Yarışma kuralları verinin yeniden dağıtılmasını yasakladığı için ondan
üretilen Model Test kelime örnekleri yerelde kalır; yayımlanan kelime örneği
sentetiktir.

Tarayıcı şu kütüphaneleri public CDN'lerden yükler; depoda dağıtılmazlar:
[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22.0 (MIT),
[MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) 0.10.18
(Apache-2.0) ve Google'ın el, poz ve yüz landmark modelleri, QR ekranı için
[kjua](https://github.com/lrsjng/kjua) 0.9.0 (MIT).
`asl-web/data/asl_video_links.json` içindeki işaret videosu bağlantıları
üçüncü taraf YouTube videolarına gider; videolar sahiplerine aittir.

Arayüz yazı tipleri depoda dağıtılır: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next)
ve [Atkinson Hyperlegible Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono)
(SIL Open Font License 1.1); Latin ve Türkçe karakterlere indirgenmiş hâlleri
lisanslarıyla birlikte `asl-web/assets/fonts/` içindedir.

Arayüzdeki referans görseller bu proje için hazırlanmıştır; üçüncü taraf
stok görsel lisansına dayanmaz.

Kaynak kod [PolyForm Noncommercial License 1.0.0](LICENSE) kapsamında sunulur.
Kişisel, eğitim ve araştırma amaçlı kullanım serbesttir; ticari kullanım için
telif hakkı sahibinin izni gerekir. Eğitim veri setleri kendi koşullarına
tabidir; bu koşullar [Models and data](docs/models-and-data.md) belgesinde
kayıtlıdır.

`asl-web/models/` ve `models/` altındaki eğitilmiş model dosyaları aynı lisansla
yayımlanır ve yazılımın parçası sayılır; yukarıdaki eğitim verisi koşulları da
geçerlidir. Bu proje, bir veri seti lisansının (örneğin ana harf kaynağındaki
GPL-2.0 etiketinin) eğitilmiş ağırlıklara geçip geçmediği konusunda bir iddiada
bulunmaz. Kullanımınız için kesinlik gerekiyorsa kaynak koşullarını kontrol edin
veya buradaki betiklerle kendi modelinizi eğitin. `.pkl` ve `.pt` dosyaları
Python pickle biçimindedir; yalnızca güvendiğiniz bir kopyadan yükleyin.
