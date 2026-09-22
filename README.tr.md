# ASL Assistant

ASL Assistant, Amerikan İşaret Dili parmak alfabesini ve seçili izole
işaretleri tanıyan tarayıcı tabanlı bir projedir. Landmark çıkarma ve ONNX
çıkarımı tarayıcıda gerçekleşir; uygulama backend'i yoktur ve kamera
kareleri sunucuya gönderilmez.

[Canlı demo](https://asl-demo.netlify.app/#letter) · [Başlangıç rehberi](docs/getting-started.tr.md) · [English README](README.md) · [Dokümantasyon](docs/README.md)

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
kamera başarısı garantisi değildir.

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
- MediaPipe ve ONNX tarayıcı bağımlılıkları CDN'den yüklenir.
- Model Test fixture'ları tam held-out değerlendirme seti değildir.

## Veri, görseller ve lisans

Ham veri setleri depoya eklenmez. Veri kaynakları ve kullanım sınırları
[Models and data](docs/models-and-data.md) belgesinde açıklanır. Arayüzdeki
referans görseller bu proje için hazırlanmıştır; üçüncü taraf
stok görsel lisansına dayanmaz.

Depo için henüz bir açık kaynak lisansı seçilmemiştir. Kodun public olması
tek başına kopyalama, değiştirme veya yeniden dağıtma izni vermez.
