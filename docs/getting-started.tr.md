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
| `make lint` | Python sözdizimini, adları ve import sırasını Ruff ile denetler. |
| `make format` / `make format-check` | Python kaynaklarını biçimlendirir ya da yalnız biçimi denetler. |
| `make js-check` | Tüm JavaScript dosyalarının sözdizimini denetler; Node 24 gerekir. |
| `make js-test` | Bütün web testlerini (`tests/web/**/*.test.js` ve `.test.mjs`) `node --test` ile çalıştırır. |
| `make js-typecheck` | JSDoc sözleşmelerini TypeScript ile, çıktı üretmeden denetler; bir kez `npm ci` gerekir. |
| `make quick` | Lint, format denetimi ve web testleri: en hızlı döngü, bir saniyenin altında. |
| `make test-web FILE=... NAME=...` | Tek bir web test dosyası; istenirse yalnız adı eşleşen testler. |
| `make watch-web FILE=...` | Her kayıtta web testlerini yeniden çalıştırır. |
| `make test-py FILE=... K=...` | Tek bir pytest dosyası; istenirse `-k` ile. |
| `make health` | Düzenleme sonrası kapı: lint, format, JS sözdizimi ve testleri, git hijyeni, runtime artifact'leri, proje denetimi, feature parity ve hızlı Python testleri. npm kurulumu gerektirmez. |
| `make check` | Commit öncesi kapı: `make health` ve `make js-typecheck`. |
| `make parity` | Python ile tarayıcı kodu arasında kelime ve harf feature eşitliği. |
| `make validate` | JS, runtime artifact, ONNX I/O, hash ve offline fixture kontrolü yapar. |
| `make validate-full` | Proje asset denetimini ve yerel veri raporunu ekler. |
| `make deploy-check` | Her yüklemeden önce: `make validate` ve `asl-web/` içindeki her dosyanın listesi; sitenin yayınlamadığı her dosyada başarısız olur. |
| `make git-hygiene` | `.gitignore` ile eşleşen tracked dosya varsa başarısız olur. |
| `make test` | Hızlı unit ve repo sözleşme testlerini çalıştırır. |
| `make test-full` | Masaüstü entegrasyonları dahil bütün Python testlerini çalıştırır; JavaScript, validator ve parity çalışmaz. |
| `make model-test-fixtures` | İndirilmiş Kaggle alt kümesinden tarayıcı fixture'larını dışa aktarır. |
| `make desktop` | Legacy masaüstü prototipini başlatır. |
| `make clean` | Veri, model ve ortamları silmeden cache'leri temizler. |

Node zorunlu bir doğrulama bağımlılığıdır. `make js-check`, `make
validate` ve `make health`, Node yoksa kontrolleri sessizce atlamak yerine açık
bir hatayla durur; parity komutları Node olmadan 2 ile çıkar.

`make validate` arkasındaki `check_runtime_assets.py`, bütün sözleşmeler
sağlandığında 0, biri bozulduğunda 1, kontrol edemediğinde 2 ile çıkar: hatalı
kullanım ya da ONNX Runtime'ın içe aktarılamaması. Model adımını bilerek
atlamak için `--no-onnx` verin.

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
2. `make deploy-check` çalıştırın ve bildirdiklerini düzeltin. Yükleme
   klasörü diskte olduğu gibi, yok sayılan dosyalarla birlikte alır; bu
   yüzden komut `asl-web/` altındaki her dosyayı listeler ve sitenin
   yayınlamadığı her dosyada başarısız olur: yarışma verisinden üretilen
   kelime örneklerinin `asl-web/data/model-test-samples/local/` klasörü
   (yarışma kuralları bunların yayımlanmasını yasaklar; klasörü `asl-web/`
   dışına taşıyın), Git'in yok saydığı dosyalar, `.DS_Store` (`make clean`
   siler) ya da `.env` gibi gizli dosyalar ve `scripts/validation/contracts.py`
   içindeki izin listesinin dışında kalan her şey. `make validate` `local/`
   klasörü için yalnızca uyarır; böylece klasörle yerel test sürer.
3. Deploy sayfasına bu deponun kendi `asl-web/` klasörünü sürükleyin, bir
   kopyasını değil; kopya eski kalmış olabilir.
4. Canlı sitenin tam olarak bu dosyaları sunduğunu kontrol edin. `<script>`
   etiketlerini karşılaştırmak yetmez: `?v=` ekleri nadiren değişir, bu yüzden
   eski bir deploy aynı etiketleri listeleyebilir. İçeriği karşılaştırın:

   ```bash
   for f in index.html js/core/app.js css/style.css css/components.css; do
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
