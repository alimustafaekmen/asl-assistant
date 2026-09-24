# Başlangıç Rehberi

Tarayıcı uygulaması projenin aktif ürünüdür. Uygulama backend'i olmayan
statik bir sitedir; normal web kullanımı için Python ML ortamı gerekmez. Python
ve Node; repo doğrulamaları, geliştirme araçları ve legacy masaüstü prototipi
için gereklidir.

[English guide](getting-started.md)

## Yalnızca web uygulamasını çalıştırma

Repo kökünden:

```bash
make web
```

Eşdeğer komut:

```bash
cd asl-web
python3 -m http.server 8080
```

<http://localhost:8080> adresini açın. Port doluysa `make web PORT=8081`
kullanın. Herhangi bir basit statik HTTP sunucusu uygundur; Python ML
bağımlılıkları bu akışa dahil değildir.

Model ve JSON istekleri engelleneceği için `index.html` dosyasını `file://` ile
açmayın. Kamera erişimi `localhost` veya HTTPS gerektirir. İlk yüklemede CDN
üzerindeki ONNX Runtime, MediaPipe, QR yardımcısı ve MediaPipe task dosyaları
için internet bağlantısı gerekir.

Kamerasız kontrol için **Offline test** kullanılabilir. Hazır kelime fixture'ı
yaklaşık `0.0760` güvenle `give` sonucunu vermelidir. Bu bir runtime regresyon
kontrolüdür; doğruluk benchmark'ı değildir.

## Önerilen Conda kurulumu

Public ortam tanımı Python 3.12, Node 24, macOS LightGBM için OpenMP runtime,
sabitlenmiş proje bağımlılıkları ve iki yerel paketi kurar:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

`asl-assistant`, `environment.yml` içindeki public varsayılan addır. Makefile bu
ada bağlı değildir. Var olan ve `base` olmayan bir Conda ortamı da aktive
edilip `make setup` ile hazırlanabilir.

## Alternatif `venv` kurulumu

Python 3.12 ve Node 24'ü kurduktan sonra:

```bash
python3.12 -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .\.venv\Scripts\Activate.ps1  # Windows PowerShell
make doctor
make setup
make health
```

`make setup`, sabitlenmiş geliştirme bağımlılıklarını kurar; ardından iki
yerel paketi bağımlılıkları yeniden çözmeden editable olarak ekler. Doğrudan
komutlar:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-ml
python -m pip install --no-deps -e ./asl-desktop
```

macOS'ta LightGBM bir OpenMP runtime ister. Conda dosyası `llvm-openmp`
içerir; `venv` kullanıcısı LightGBM yüklenemiyorsa bu sistem bağımlılığını
ayrıca sağlamalıdır.

## Ortam güvenliği

`make doctor` yalnızca okuma yapar. Seçilen interpreter, aktif ortam, platform
ve gerekli import'ları raporlar. `make setup` şu hedeflere yazmayı reddeder:

- Paylaşılan Conda/Miniforge `base` ortamı
- Apple CommandLineTools Python
- Aktif Conda ortamı veya `venv` dışındaki interpreter

Base ortamına kurulum için kaçış bayrağı yoktur. Make yanlış interpreter'ı
seçerse aktif ortamın Python yolunu açıkça verin:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Temel komutlar

| Komut | Amaç |
|---|---|
| `make help` | Desteklenen hedefleri listeler. |
| `make doctor` | Aktif Python ortamını değiştirmeden inceler. |
| `make setup` | Sabit bağımlılıkları ve editable paketleri kurar. |
| `make web` | `asl-web/` klasörünü yerelde sunar. |
| `make js-check` | Tüm JavaScript dosyalarını denetler; Node 24 gerekir. |
| `make health` | Lint, format, JS, artifact, parity ve hızlı testleri çalıştırır. |
| `make validate` | JS, runtime artifact, ONNX I/O, hash ve offline fixture kontrolü yapar. |
| `make validate-full` | Daha geniş kaynak artifact ve yerel veri raporunu ekler. |
| `make test` | Hızlı unit ve repo sözleşme testlerini çalıştırır. |
| `make test-full` | Entegrasyonlar dahil tam Python test paketini çalıştırır. |
| `make desktop` | Legacy masaüstü prototipini başlatır. |
| `make clean` | Veri, model ve ortamları silmeden cache'leri temizler. |

Node zorunlu bir doğrulama bağımlılığıdır. `make js-check`, `make
validate` ve `make health`, Node yoksa kontrolleri sessizce atlamak yerine açık
bir hatayla durur.

## Masaüstü prototipi

CustomTkinter uygulaması tarihsel bir prototiptir; web uygulamasının backend'i
değildir. GUI oturumu, kamera izni, MediaPipe, PyTorch, LightGBM ve yayınlanan
masaüstü artifact'leri gerekir.

```bash
make setup
make desktop
```

Masaüstü kelime modeli 25 sınıflı, 30×321 BiGRU+Attention pipeline'dır. Web
uygulamasındaki 50 sınıflı, 45×168 SignTransformer ile karıştırılmamalıdır.

## Statik yayınlama

Deploy klasörü `asl-web/` dizinidir ve build komutu yoktur. Public hosting,
kamera erişimi için HTTPS sunmalıdır. Bu aşamada CI/CD workflow veya Docker
kurulumu eklenmemiştir; somut bir ihtiyaç oluştuğunda ayrıca eklenebilir.

Site elle yayınlanır; bir klasör sitenin Netlify deploy sayfasına sürüklenir:

1. `make health` çalıştırın; ardından model hazırlığını, offline fixture'ı,
   kamera başlatma/durdurmayı, harf kabulünü, kelime kaydını ve `#letter`,
   `#word`, `#test` linklerini elle kontrol edin.
2. Deploy sayfasına bu deponun kendi `asl-web/` klasörünü sürükleyin, bir
   kopyasını değil; kopya eski kalmış olabilir.
3. Canlı sitenin tam olarak bu dosyaları sunduğunu kontrol edin. `<script>`
   etiketlerini karşılaştırmak yetmez: `?v=` ekleri nadiren değişir, bu yüzden
   eski bir deploy aynı etiketleri listeleyebilir. İçeriği karşılaştırın:

   ```bash
   for f in index.html js/core/app.js css/style.css; do
     curl -s "https://asl-assistant.netlify.app/$f" | shasum -a 256
     shasum -a 256 "asl-web/$f"
   done
   ```

   Her hash çifti aynı olmalıdır.

HTTP yanıt başlıkları `asl-web/_headers` dosyasından gelir; Netlify bu dosyayı
yüklenen klasörden okur. Kökteki `netlify.toml` bu yüklemeye dahil değildir;
yalnızca Git bağlantılı veya CLI ile yapılan yayınlarda publish klasörünü seçer.

## Sorun giderme

### Modeller yüklenmiyor

Sayfa açıldığında hiçbir model istenmez; Network panelinde model isteği ancak
bir modele ihtiyaç duyulduğunda görünür: kamera başlatıldığında, kelime
kaydında, **Offline test** ile veya bir Model Test çalıştırmasında. Harf modu
harf modelini, kelime modu kelime modelini, Öğrenme Koçu ikisini de yükler.

`make validate` çalıştırın, bunlardan birini tetikleyin ve tarayıcının
Network/Console panellerini inceleyin. Harf modeli `models/letter_model.onnx.gz`,
kelime modeli `models/word_model.onnx` olarak gelir; ikisi de HTTP 200 dönmeli
ve CDN kaynakları erişilebilir olmalıdır. `models/letter_model.onnx` isteği
görünüyorsa sıkıştırılmış kopya kullanılamamıştır: nedeni Console'dadır ve
uygulama bunun yerine sıkıştırılmamış dosyayı yükler; o dosya da 200
dönmelidir.

### Kamera izni reddediliyor

`localhost` veya HTTPS kullanın, kamerayı kullanan diğer uygulamaları kapatın
ve tarayıcı/işletim sistemi izinlerini kontrol edin.

### Python `asl_ml` veya `asl_desktop` paketini bulamıyor

Doğru ortamı aktive edin, `make doctor` ve ardından `make setup` çalıştırın.
`python` ile `python -m pip` aynı ortamı göstermelidir.

## İlgili belgeler

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web notları](../asl-web/README.md)
