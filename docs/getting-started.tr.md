# Başlangıç Rehberi

`asl-web/` içindeki tarayıcı uygulaması projenin bakımı yapılan ürünüdür.
Arka ucu olmayan statik bir sitedir; çalıştırmak için bir dosya sunucusu
yeterlidir. Python ve Node; kontroller, geliştirme araçları ve eski masaüstü
prototipi için gerekir.

[English guide](getting-started.md)

## Web uygulamasını çalıştırma

Repo kökünden:

```bash
make web
```

Bu komut `asl-web/` klasörünü <http://localhost:8080> adresinde sunar. Port
doluysa `make web PORT=8081` kullanın. Make olmadan herhangi bir statik dosya
sunucusu da işe yarar:

```bash
cd asl-web
python3 -m http.server 8080
```

Bilmeniz gereken üç şey:

- `index.html` dosyasını `file://` ile açmayın. Sayfa model ve JSON dosyalarını
  `fetch` ile ister; tarayıcı bu istekleri engeller.
- Kamera `localhost` veya HTTPS gerektirir. Uygulamayı telefonda denemek için
  yayındaki demoyu kullanın ya da HTTPS ile sunun; telefon bilgisayarınızdaki
  `localhost` adresine ulaşamaz.
- İlk yükleme için internet gerekir: ONNX Runtime, QR kütüphanesi ve MediaPipe
  (kod ve el/poz/yüz modelleri) herkese açık CDN'lerden gelir.
  `asl-web/models/` içindeki modeller yalnızca bir şeye gerektiğinde indirilir.

Çalışma ortamını kamerasız denetlemek için **Kamerasız dene** ekranını
(`#test`) açın, **Kelime modeli**ni seçip **Tümünü çalıştır** düğmesine basın.
Hazır kelime örneği yaklaşık `0.0760` güvenle `give` sonucunu vermelidir. Bu,
kelime modelinin, etiketlerin, sıcaklık değerinin, maskenin ve tarayıcıdaki
çıkarım yolunun birbiriyle uyumlu olduğunu gösterir. Bir regresyon
kontrolüdür, doğruluk ölçümü değildir; ekran da bunu belirtir. Harf modeli 24
örneğini aynı şekilde çalıştırır.

## Python ve Node kurulumu

Kontroller, doğrulayıcılar ve masaüstü prototipi Python 3.12 ve Node 24
gerektirir. Aşağıdaki iki kurulumdan birini seçin. Repo, ortamınızın adına
bağlı değildir.

### Conda

`environment.yml`; Python 3.12, Node 24, macOS'ta LightGBM'in istediği OpenMP
runtime'ı, sabitlenmiş bağımlılıkları ve iki yerel paketi içeren yalıtılmış
bir ortam kurar:

```bash
conda env create -f environment.yml
conda activate asl-assistant
make doctor
make health
```

`asl-assistant`, `environment.yml` içindeki varsayılan addır. `base` olmayan
mevcut bir ortamı etkinleştirip içinde `make setup` de çalıştırabilirsiniz.

### venv

Python 3.12 ve Node 24'ü kurduktan sonra:

```bash
python3.12 -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .\.venv\Scripts\Activate.ps1  # Windows PowerShell
make doctor
make setup
make health
```

`make setup`, `requirements-dev.txt` dosyasını kurar; ardından `asl-ml` ve
`asl-desktop` paketlerini bağımlılıklarını yeniden çözmeden editable olarak
ekler. Eşdeğer komutlar:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-ml
python -m pip install --no-deps -e ./asl-desktop
```

macOS'ta LightGBM bir OpenMP runtime ister. Conda tanımı `llvm-openmp`
içerir; `venv` kullanıyorsanız LightGBM yüklenemezse bunu kendiniz kurun.

### Ortam güvenliği

`make doctor` yalnızca okur: yorumlayıcıyı, etkin ortamı, platformu ve projenin
ihtiyaç duyduğu import'ları raporlar. `make setup` şu ortamlara kurmayı
reddeder:

- Paylaşılan Conda veya Miniforge `base` ortamı
- Apple'ın CommandLineTools Python'u
- Etkin Conda ortamı ya da `venv` dışındaki bir yorumlayıcı

`base` denetimi için kaçış yolu yoktur. Make yanlış yorumlayıcıyı seçerse
doğrusunu kendiniz verin:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Komutlar

| Komut | Amaç |
|---|---|
| `make help` | Hedefleri listeler. |
| `make doctor` | Etkin Python ortamını değiştirmeden inceler. |
| `make setup` | Sabitlenmiş bağımlılıkları ve editable yerel paketleri kurar. |
| `make web` | `asl-web/` klasörünü yerelde sunar. |
| `make lint` | Ruff ile Python sözdizimini, adları ve import sırasını denetler. |
| `make format` / `make format-check` | Python kaynaklarını biçimlendirir ya da yalnızca biçimi denetler. |
| `make js-check` | `asl-web/js` altındaki her JavaScript dosyasının sözdizimini denetler. |
| `make js-test` | Bütün web testlerini (`tests/web/**/*.test.js` ve `.test.mjs`) `node --test` ile çalıştırır. |
| `make js-typecheck` | JSDoc tiplerini TypeScript ile, dosya üretmeden denetler. Bir kez `npm ci` gerekir. |
| `make quick` | Lint, biçim denetimi ve web testleri: en hızlı döngü, birkaç saniye. |
| `make test-web FILE=... NAME=...` | Tek bir web test dosyası; istenirse yalnızca adı eşleşen testler. |
| `make watch-web FILE=...` | Her kayıtta web testlerini yeniden çalıştırır. |
| `make test-py FILE=... K=...` | Tek bir pytest dosyası; istenirse `-k` ile süzülür. |
| `make health` | Düzenleme sonrası kapı: lint, biçim, JavaScript sözdizimi ve testleri, Git hijyeni, runtime dosyaları, proje dosya denetimi, notebook, model ve sonuç dosyalarının varlığı, feature eşitliği ve hızlı Python testleri. npm kurulumu gerektirmez. |
| `make check` | Commit öncesi kapı: `make health` ve `make js-typecheck`. |
| `make browser-check` | Node testlerinin göremediği şeyleri gerçek bir headless Chrome'da denetler: CSS katmanları, gizli öğeler, koyu tema, yatay taşma, kameranın bırakılması. `OFFLINE=1`, CDN kütüphanelerini yükleyen tek denetimi atlar. Chrome gerekir; yoksa 2 ile çıkar. |
| `make parity` | Python kodu ile tarayıcı kodu arasında kelime ve harf feature eşitliği. |
| `make validate` | JavaScript sözdizimini denetler, sonra runtime dosyalarını kontrol eder: dosyalar, JSON şemaları, fixture'lar, kaynaktan yayına hash'ler, ONNX girdi/çıktıları ve offline kelime örneği. |
| `make validate-full` | `make validate` ve yerel veri raporlu proje dosya denetimi. |
| `make deploy-check` | Her yüklemeden önceki adım: `make validate` ve `asl-web/` içindeki her dosyanın listesi; sitenin yayınlamadığı her dosyada başarısız olur. |
| `make git-hygiene` | `.gitignore` ile eşleşen izlenen dosya varsa başarısız olur. |
| `make notebook-check` | Kelime modeli notebook'larının, modellerin ve sonuç dosyalarının yerinde olduğunu denetler. |
| `make test` | Hızlı Python testleri: birim ve repo sözleşme testleri. |
| `make test-full` | Masaüstü entegrasyonları dahil bütün Python testleri. JavaScript testlerini, doğrulayıcıları ve feature eşitliğini çalıştırmaz. |
| `make model-test-fixtures` | İsteğe bağlı: indirilmiş Kaggle alt kümesinden Model Test fixture'larını dışa aktarır; alt küme yoksa indirme komutunu söyleyip durur. |
| `make desktop` | Eski masaüstü prototipini başlatır. |
| `make clean` | Cache'leri ve `.DS_Store` dosyalarını siler; veri, model, notebook ve ortamlara dokunmaz. |

Node zorunlu bir doğrulama bağımlılığıdır. Node yoksa `make js-check`,
`make validate` ve `make health` JavaScript denetimlerini atlamak yerine
hatayla durur; feature eşitliği komutları 2 ile çıkar.

`make validate` arkasındaki `check_runtime_assets.py`, bütün sözleşmeler
sağlandığında 0, biri bozulduğunda 1, kontrol edemediğinde 2 ile çıkar: hatalı
kullanım ya da ONNX Runtime'ın içe aktarılamaması. `--no-onnx`, model adımını
bilerek atlar.

### Make olmadan

`make`, Windows PowerShell veya cmd'de varsayılan olarak kurulu gelmez.
Arkasındaki kontroller düz komutlardır:

```bash
python scripts/validation/check_runtime_assets.py
python scripts/validation/verify_project_assets.py
python tests/validation/check_word_feature_parity.py
python tests/validation/check_letter_feature_parity.py
python -m pytest tests/
npm test                       # web testleri; yalnızca Node gerekir
```

Kelime feature eşitliği denetimi şu satırla bitmelidir:

```text
Summary: PASS=6, KNOWN_GAP=0, FAIL=0
```

Bu kontroller gerçek tarayıcı, kamera ve işaret yapan biriyle yapılan testin
yerini tutmaz.

## Masaüstü prototipi

CustomTkinter uygulaması tarihsel bir prototiptir; web uygulamasının arka ucu
değildir. Grafik oturumu, kamera izni, MediaPipe, PyTorch, LightGBM ve
yayımlanmış masaüstü model dosyaları gerekir:

```bash
make setup
make desktop
```

Kelime modeli, 30 × 321 kare üzerinde çalışan eski 25 sınıflı BiGRU + dikkat
modelidir. Web uygulamasındaki 50 sınıflı, 45 × 168'lik SignTransformer ile
karıştırılmamalıdır. Ayrıntılar için [masaüstü README](../asl-desktop/README.md)
dosyasına bakın.

## Model Test fixture'larını dışa aktarma

Model Test kelime örnekleri, kuralları verinin yeniden dağıtımını yasaklayan
Kaggle Google Isolated Sign Language Recognition yarışma verisinden gelir. Bu
yüzden ham veri repoda tutulmaz; ondan dışa aktardığınız fixture'lar da
tutulmaz. Yarışma kurallarını kabul edip Kaggle kimlik bilgilerinizi
tanımladıktan sonra:

```bash
python scripts/evaluation/download_kaggle_sample_subset.py \
  --output data/raw/asl-signs-sample-subset \
  --samples-per-word 1

python scripts/evaluation/export_model_test_word_samples.py \
  --kaggle-dir data/raw/asl-signs-sample-subset \
  --samples-per-word 1
```

Dışa aktarım, Git'in yok saydığı `asl-web/data/model-test-samples/local/`
klasörüne yazar. Klasör varsa Model Test ekranı bu örnekleri listeler.
`asl-web/` klasörünü herhangi bir yere yüklemeden önce bu klasörü kaldırın;
klasör oradayken `make deploy-check` başarısız olur. Örnekler tarayıcıdaki
çıkarım yolunu denetler; ayrılmış test kümesi değerlendirmesinin yerini tutmaz.

## Statik yayınlama

`asl-web/` yayın klasörüdür ve build adımı yoktur. Telefonlarda kamera
çalışsın diye sunucunun HTTPS vermesi gerekir. Repoda CI workflow'u veya Docker
kurulumu yoktur; web uygulaması için statik bir dosya sunucusu yeterlidir.

<https://asl-assistant.netlify.app/> adresindeki demo elle yayınlanır; bir
klasör Netlify'ın deploy sayfasına sürüklenir:

1. `make check` çalıştırın; Chrome kuruluysa `make browser-check` de. Sonra
   elle doğrulayın: model hazırlığı, offline örnek, kameranın açılıp kapanması,
   harf ekleme, kelime kaydı ve `#letter`, `#word`, `#test` bağlantıları.
2. `make deploy-check` çalıştırın ve bildirdiklerini düzeltin. Yükleme,
   klasörü diskte olduğu gibi, yok sayılan dosyalarla birlikte alır; bu
   yüzden komut `asl-web/` altındaki her dosyayı listeler ve sitenin
   yayınlamadığı her dosyada başarısız olur:
   - yarışma verisinden üretilen fixture'ların
     `asl-web/data/model-test-samples/local/` klasörü (klasörü `asl-web/`
     dışına taşıyın);
   - Git'in yok saydığı dosyalar;
   - `.DS_Store` (`make clean` siler) veya `.env` gibi gizli dosyalar;
   - `scripts/validation/contracts.py` içindeki izin listesinin dışında kalan
     her şey.

   `make validate` `local/` klasörü için yalnızca uyarır; böylece klasörle
   yerel test sürebilir.
3. Deploy sayfasına bu deponun kendi `asl-web/` klasörünü sürükleyin, bir
   kopyasını değil; kopya eski kalmış olabilir.
4. Canlı sitenin tam olarak bu dosyaları sunduğunu doğrulayın. `<script>`
   etiketlerini karşılaştırmak yetmez: `?v=` ekleri nadiren değişir, bu yüzden
   eski bir yayın aynı etiketleri listeleyebilir. İçeriği karşılaştırın:

   ```bash
   for f in index.html js/core/app.js css/style.css css/components.css; do
     curl -s "https://asl-assistant.netlify.app/$f" | shasum -a 256
     shasum -a 256 "asl-web/$f"
   done
   ```

   Her hash çifti aynı olmalıdır.

HTTP yanıt başlıkları `asl-web/_headers` dosyasından gelir; Netlify bu dosyayı
yüklenen klasörden okur. Kökteki `netlify.toml` sürükle-bırak yüklemesine dahil
değildir; yalnızca Git bağlantılı veya CLI ile yapılan yayınlarda yayın
klasörünü seçer.

## Sorun giderme

### Modeller yüklenmiyor

Sayfa açıldığında hiçbir model istenmez; Network panelinde model isteği ancak
bir modele ihtiyaç duyulduğunda görünür: kamera başlatıldığında, kelime
kaydında veya bir Model Test çalıştırmasında. Harf modu
harf modelini, kelime modu kelime modelini, Öğrenme Koçu harf modelini yükler;
kelime modelini yalnızca kelimelere geçildiğinde ekler.

`make validate` çalıştırın, bunlardan birini tetikleyin ve tarayıcının Network
ile Console panellerine bakın. Harf modeli `models/letter_model.onnx.gz`, kelime
modeli `models/word_model.onnx` olarak gelir. İkisi de HTTP 200 dönmeli, CDN
dosyalarına da erişilebilmelidir. `models/letter_model.onnx` isteği
görünüyorsa sıkıştırılmış kopya kullanılamamıştır; nedeni Console'da yazar ve
uygulama sıkıştırılmamış dosyaya döner, o dosya da 200 dönmelidir.

### Kamera izni reddediliyor

`localhost` veya HTTPS kullanın, kamerayı tutan diğer uygulamaları kapatın,
tarayıcının ve işletim sisteminin kamera izinlerini kontrol edin.

### Python `asl_ml` veya `asl_desktop` paketini bulamıyor

Kullanmak istediğiniz ortamı etkinleştirin, `make doctor` ve ardından `make
setup` çalıştırın. `python` ile `python -m pip` aynı ortamı göstermelidir.
`make health`, pytest testleri toplarken içe aktarma hatasıyla duruyorsa
`requirements.txt` içindeki bir paket etkin ortamda eksiktir; `make setup`
hepsini kurar.

### LightGBM macOS'ta yüklenmiyor

Conda ortam tanımını kullanın ya da yalıtılmış etkin ortama bir OpenMP runtime
kurun. Projeyi Conda `base` ortamına kurmayın.

## İlgili belgeler

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web uygulaması notları](../asl-web/README.md)
