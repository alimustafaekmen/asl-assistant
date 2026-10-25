# Başlangıç Rehberi

<sub>Konum: [`asl-assistant`](../README.tr.md) / [`docs`](README.md) / `getting-started.tr.md`</sub>

<sub>İlgili: [`asl-web/`](../asl-web/README.md) · [`docs/architecture.md`](architecture.md) · [`tests/`](../tests/README.md) · [English](getting-started.md)</sub>

Ürün, `asl-web/` içindeki tarayıcı uygulamasıdır: arka ucu ve derleme adımı
olmayan statik bir site. `asl-desktop/` içindeki masaüstü uygulaması, çalışır
durumda tutulan eski bir prototiptir.

## Hangi yol size uygun?

| Ne yapmak istiyorsunuz | İzleyeceğiniz yol | Ne kurmanız gerekir |
|---|---|---|
| Uygulamayı kendi tarayıcınızda denemek | [Yol 1: web uygulamasını açmak](#yol-1-web-uygulamasını-açmak) | Hiçbir şey. Python 3 ya da herhangi bir statik dosya sunucusu yeterlidir. |
| Web uygulamasını değiştirmek ve denetimlerini çalıştırmak | [Yol 2: web kodu üzerinde çalışmak](#yol-2-web-kodu-üzerinde-çalışmak) | Python ortamı, Node 24 ve bir kez `npm ci` |
| Masaüstü prototipini çalıştırmak, model eğitmek ya da veri hazırlamak | [Yol 3: masaüstü uygulaması, eğitim ve veri](#yol-3-masaüstü-uygulaması-eğitim-ve-veri) | Python ortamı |

Yol 2 ve 3 tek bir Python ortamını paylaşır. Bu ortam bir kez, `make setup`
ile ya da Conda dosyasıyla kurulur; nasıl yapılacağını [Python ortamını
kurmak](#python-ortamını-kurmak) bölümü anlatır. Geri kalan her şey yola
özgüdür:

| Gereksinim | Yol 1 | Yol 2 | Yol 3 |
|---|---|---|---|
| İnternet bağlantısı olan bir tarayıcı | Evet | Evet | Hayır |
| Python 3.12 ortamı (`make setup` ya da Conda dosyası) | Hayır | Evet | Evet |
| Node 24 | Hayır | Evet | Yalnızca `make health` ve `make parity` için |
| Bir kez `npm ci` | Hayır | Tür denetimi için | Hayır |
| Chrome ya da Chromium | Hayır | `make browser-check` için | Hayır |
| Kamera | Kameralı modlar için | Kameralı modlar için | Masaüstü uygulaması için |
| Masaüstü oturumu (ekran) | Hayır | Hayır | Masaüstü uygulaması için |
| Kendi indirdiğiniz veri kümeleri | Hayır | Hayır | Eğitim ve veri hazırlama için |

Bütün komutları depo kökünden çalıştırın. Komutlar `make` kullanır; macOS ve
Linux'ta `make` vardır, Windows PowerShell ve cmd'de yoktur. Düz komutlar
[Make olmadan](#make-olmadan) bölümündedir.

## Yol 1: web uygulamasını açmak

`make web`, `asl-web/` klasörünü Python'ın standart kütüphanesindeki
`http.server` ile sunar. Bu yüzden herhangi bir Python 3 yeterlidir ve hiçbir
paket kurulmaz.

1. Depoyu klonlayın ya da indirip açın, sonra kök klasöründe bir terminal
   açın.
2. Sunucuyu başlatın:

   ```bash
   make web
   ```

   8080 portu doluysa `make web PORT=8081` çalıştırın. Make olmadan herhangi
   bir statik dosya sunucusu da olur, örneğin:

   ```bash
   python3 -m http.server 8080 --directory asl-web
   ```

3. <http://localhost:8080> adresini açın. Uygulama harf ekranıyla,
   tarayıcınızın diline göre Türkçe ya da İngilizce açılır (dil ikisinden biri
   değilse İngilizce); üst çubuğun sonundaki düğme dili değiştirir. Aşağıdaki
   adımlar Türkçe etiketleri verir.
4. **Kamerayı aç** düğmesine basıp kameraya izin verin, sonra kameraya bir
   harf gösterin.
5. Uygulamanın harfleri kamerasız nasıl okuduğunu görmek için **Örneği
   izleyin** düğmesine basın. Kayıtlı bir el FLY kelimesini heceler; sonuç
   kartı bir harfi gösterdiğinde onu Space ya da **Ekle** ile ekleyin. Model bu
   duruşları %100 ile okur, çünkü fotoğrafları eğitim verisinde yer alır;
   bu yüzden örnek, uygulamanın nasıl çalıştığını gösterir, ne kadar
   doğru olduğunu değil.
6. Modelleri saklanmış girdilerle denetlemek için Model Test'i açın: `#test`
   adresine gidin ya da **Nasıl çalışır** sayfasının sonundaki **modeli örnek
   dosyalarla test edin (Model Test)** bağlantısını izleyin. **Tümünü
   çalıştır** düğmesine basın. Bu, harf modelini 24 fixture (saklanmış test
   girdisi) üzerinde çalıştırır ve kaçının doğru çıktığını sayar.
7. Kelime modelini denetlemek için aynı ekranda **Başka model, başka örnek ya
   da kendi dosyanız** bölümünü açın, **Kelime modeli**ni seçin ve yeniden
   **Tümünü çalıştır** düğmesine basın. Hazır gelen tek kelime örneği 0.0760
   güvenle (ekranda %7,6) `give` sonucunu vermeli ve **Çalışma kontrolü**
   olarak işaretlenmelidir. Örnek yapay bir girdidir; bu yüzden çalıştırma,
   modelin, etiketlerinin, maskenin ve tarayıcıdaki çıkarımın uyumlu olduğunu
   denetler, doğruluk hakkında bir şey söylemez.

Sunucuyu Ctrl+C ile durdurun.

Bilmeniz gerekenler:

- `index.html` dosyasını `file://` ile açmayın. Sayfa modellerini ve JSON
  dosyalarını `fetch` ile ister; tarayıcı bu istekleri orada engeller.
- Kamera yalnızca `localhost` ya da HTTPS üzerinde çalışır. Telefon,
  bilgisayarınızdaki `localhost` adresine ulaşamaz; telefonda
  <https://asl-assistant.netlify.app/> adresindeki demoyu kullanın ya da
  klasörü HTTPS ile sunun.
- İlk yükleme için internet gerekir. ONNX Runtime, QR kütüphanesi ve el, poz
  ve yüz modelleriyle birlikte MediaPipe herkese açık CDN'lerden gelir.
  Uygulamanın `asl-web/models/` içindeki kendi modelleri ise yalnızca bir şeye
  gerektiğinde, örneğin kamera ya da kamerasız örnek açıldığında indirilir.

## Python ortamını kurmak

Projenin tek bir Python bağımlılık kümesi vardır; `requirements.txt` hepsini
sabit sürümleriyle listeler:

| Amaç | Paketler |
|---|---|
| Veri | numpy, pandas, pyarrow |
| Landmark ve görüntü | opencv, pillow, mediapipe (jax ile) |
| Harf modelleri | scikit-learn, xgboost, lightgbm, joblib |
| Kelime modelleri | torch, torchvision |
| Masaüstü uygulaması ve konuşma | customtkinter, pyttsx3 |
| Grafikler | matplotlib, pyparsing, seaborn |
| Model denetimleri | onnx, onnxruntime |
| Testler | pytest |

`requirements-dev.txt`, `requirements.txt` ile Ruff'tan (Python için lint ve
biçimlendirme aracı) oluşur. Web ya da masaüstü bölümü için ayrı bir
requirements dosyası yoktur. Web denetimleri, masaüstü ve ML paketlerini içe
aktaran Python testlerini ve doğrulayıcıları da çalıştırır; bu yüzden web
çalışması da aynı ortamı ister.

Python 3.12 kullanın: iki yerel paket başka sürümü kabul etmez. Ortamın adı
ne olursa olsun çalışır. Conda ya da venv'den birini seçin.

### Conda

`environment.yml`; Python 3.12, Node 24 ve macOS'ta LightGBM'in istediği
OpenMP çalışma zamanı `llvm-openmp` ile bir ortam kurar. Ardından
`requirements-dev.txt` dosyasını ve iki yerel paketi pip ile kurar. Bunlar
`make setup` komutunun yaptığı kurulumların aynısıdır; bu yüzden sonrasında
`make setup` çalıştırmanız gerekmez.

1. Ortamı oluşturun:

   ```bash
   conda env create -f environment.yml
   ```

   Ortamın adı `asl-assistant` olur. Başka bir ad için `-n your-name` ekleyin.
2. Ortamı etkinleştirin:

   ```bash
   conda activate asl-assistant
   ```

3. `make doctor` ile denetleyin. Rapor, proje paketlerini kurulu olarak
   göstermelidir.

Python 3.12 içeren, `base` dışındaki mevcut bir Conda ortamı da olur: onu
etkinleştirip `make setup` çalıştırın.

### venv

1. Python 3.12'yi kurun; Yol 2'yi izleyecekseniz Node 24'ü de.
2. Depo kökünde bir ortam oluşturup etkinleştirin:

   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate       # macOS ve Linux
   # py -3.12 -m venv .venv        # Windows: oluşturma
   # .\.venv\Scripts\Activate.ps1  # Windows PowerShell: etkinleştirme
   ```

3. `make doctor` çalıştırın. Kurulumdan önce proje paketlerini eksik gösterir;
   bu beklenen durumdur.
4. `make setup` çalıştırın.
5. `make doctor` komutunu yeniden çalıştırın. Artık paketleri kurulu olarak
   göstermelidir.

macOS'ta LightGBM bir OpenMP çalışma zamanı ister. Conda dosyası bunu içerir.
venv kullanıyorsanız ve LightGBM yüklenemiyorsa bir tane kendiniz kurun,
örneğin Homebrew ile: `brew install libomp`.

### `make setup` neleri kurar

`make setup`, `requirements-dev.txt` dosyasını kurar; ardından depodaki iki
Python paketini, `asl-features` ve `asl-desktop`, ortamınıza tanıtır. Böylece
`import asl_features` ve `import asl_desktop` her klasörden çalışır. Masaüstü
uygulaması buna dayanır; betikler ve testler paketleri kendileri de bulur.
`-e` (editable), klasörleri ortama kopyalamak yerine bağlar; kodda yapılan bir
değişiklik yeniden kurulum gerekmeden geçerli olur. `--no-deps` bu paketlerin
bağımlılıklarını atlar, çünkü ilk komut onları sabitlenmiş sürümleriyle zaten
kurmuştur. Eşdeğer komutlar:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e ./asl-features
python -m pip install --no-deps -e ./asl-desktop
```

### Ortam güvenliği

`make doctor` yalnızca okur. Yorumlayıcıyı, etkin ortamı, platformu ve
projenin ihtiyaç duyduğu içe aktarmaların çalışıp çalışmadığını raporlar.
Ortamı tarif edebildiğinde, bir şey eksik olsa bile 0 ile; kurulu bir paket
içe aktarılamıyorsa 1 ile çıkar.

`make setup` şu ortamlara kurmayı reddeder:

- paylaşılan Conda veya Miniforge `base` ortamı;
- Apple'ın CommandLineTools Python'u;
- etkin Conda ortamının ya da venv'in dışında kalan bir yorumlayıcı.

`base` denetimi için kaçış yolu yoktur. Make yanlış yorumlayıcıyı seçerse
doğrusunu kendiniz verin:

```bash
make doctor PYTHON="$CONDA_PREFIX/bin/python"
make setup  PYTHON="$CONDA_PREFIX/bin/python"
```

## Yol 2: web kodu üzerinde çalışmak

Uygulama, `asl-web/js/` altındaki düz `<script>` dosyalarından oluşur.
Tarayıcı onları olduğu gibi yükler: paketleyici (bundler) yoktur, derlenecek
bir şey de yoktur. Denetimler ise uygulamanın istediğinden fazlasını ister.

1. [Python ortamını kurun](#python-ortamını-kurmak).
2. Node 24'ün PATH üzerinde olduğunu `node --version` ile denetleyin. Conda
   ortamı Node'u içerir; değilse `.node-version` dosyasının belirttiği sürümü
   kurun.
3. Tür denetleyicisini bir kez kurun:

   ```bash
   npm ci
   ```

   Bu komut, `package-lock.json` içinde sabitlenmiş TypeScript'i
   `node_modules/` klasörüne kurar. Onu yalnızca `make js-typecheck` ve `make
   check` kullanır; uygulama ve `make health` kullanmaz.
4. Bir şeyi değiştirmeden önce her şeyin geçtiğini görmek için `make health`
   çalıştırın.
5. Düzenlerken kısa döngüleri kullanın:

   ```bash
   make quick                                             # lint, biçim denetimi, bütün web testleri
   make test-web FILE=tests/web/word-consent.test.js NAME=once
   make watch-web FILE=tests/web/word-consent.test.js     # her kayıtta yeniden çalışır
   ```

6. Sonuca tarayıcıda `make web` ile bakın.
7. Commit'ten önce `make check` çalıştırın: `make health` ve tür denetimi.
8. `index.html` ya da CSS değiştiğinde `make browser-check` de çalıştırın.
   Chrome ya da Chromium gerekir; tarayıcınız standart bir yerde değilse
   yolunu verin: `CHROME=/path/to/chrome make browser-check`.

Test paketinin her katmanının neyi kapsadığını [Testler](../tests/README.md)
belgesi, kodu da [web uygulaması notları](../asl-web/README.md) anlatır.

## Yol 3: masaüstü uygulaması, eğitim ve veri

1. [Python ortamını kurun](#python-ortamını-kurmak); iki yerel paket de
   kurulmalıdır, çünkü masaüstü uygulaması `asl_features` paketini kurulu bir
   paket olarak içe aktarır.
2. Masaüstü uygulamasını başlatın:

   ```bash
   make desktop
   ```

   Kamera izni ve ekranı olan bir masaüstü oturumu gerekir. Uygulama,
   `models/letter/` ve `models/word/desktop-25/` içindeki, depoda izlenen
   modelleri yükler. Kelime modeli, 30 × 321 kare üzerinde çalışan, dikkat
   katmanlı eski 25 sınıflı BiGRU'dur; web uygulamasındaki 50 sınıflı,
   45 × 168'lik SignTransformer ile karıştırılmamalıdır. Ayrıntılar [masaüstü
   README](../asl-desktop/README.md) dosyasındadır.
3. Python testlerini çalıştırın. `make test` hızlı testleri çalıştırır. `make
   test-full` ise MediaPipe ve bir model dosyası isteyen masaüstü entegrasyon
   testleri dahil bütün Python testlerini çalıştırır.
4. Model eğitmek ya da veri hazırlamak için veri kümelerini kendiniz indirin.
   Hiçbiri depoda yoktur ve bazılarının koşulları yeniden dağıtımı yasaklar.
   Onları `data/raw/` altına koyun; Git, `data/raw/` ve `data/processed/`
   klasörlerini yok sayar.
   - Harf modeli: `./scripts/data_preparation/run_static_letter_extraction.sh`
     ASL Alphabet görüntülerini landmark tablolarına çevirir; ardından
     `python scripts/model_training/train_static_letter_model.py --from-csv --full-comparison`
     modelleri eğitir ve karşılaştırır. Eğitim betiği `models/letter/`
     içindeki izlenen dosyaların üzerine yazar (`git restore models/letter`
     bir deneme çalıştırmasını geri alır). ONNX'e dışa aktarmaz; bu yüzden
     tarayıcı uygulaması değişmez.
   - 50 kelimelik web modeli bir betikle değil,
     `notebooks/word_50_training.ipynb` içinde eğitilir.
   - İki indirme adımı, `requirements.txt` içinde olmayan bir araç ister:
     aşağıdaki Kaggle alt kümesi için Kaggle komut satırı aracı, deneysel
     MS-ASL indirmesi için `yt-dlp`.

   Girdileri, çıktıları ve neyin yeniden üretilebildiğini [veri
   hazırlama](../scripts/data_preparation/README.md), [model
   eğitimi](../scripts/model_training/README.md), [veri
   manifestosu](../data/README.md) ve [Models and data](models-and-data.md)
   belgeleri anlatır.

### Model Test fixture'larını dışa aktarma

Model Test ekranı tek bir yapay kelime örneğiyle gelir. Gerçek kelime
örnekleri, kuralları verinin yeniden dağıtımını yasaklayan Kaggle Google
Isolated Sign Language Recognition yarışma verisinden gelir; bu yüzden ne veri
ne de ondan dışa aktarılan fixture'lar depoda bulunur. Onları kendi kopyanıza
eklemek için:

1. Yarışma kurallarını Kaggle'da, tarayıcıda kabul edin.
2. Kaggle komut satırı aracını kurun (`pip install kaggle`) ve kimlik
   bilgilerinizi `~/.kaggle/kaggle.json` dosyasına tanımlayın.
3. Kelime başına bir örnekle küçük bir alt küme indirin:

   ```bash
   python scripts/evaluation/download_kaggle_sample_subset.py \
     --output data/raw/asl-signs-sample-subset \
     --samples-per-word 1
   ```

4. Fixture'ları dışa aktarın:

   ```bash
   make model-test-fixtures
   ```

   Bu komut `scripts/evaluation/export_model_test_word_samples.py` betiğini
   `data/raw/asl-signs-sample-subset` üzerinde çalıştırır. `KAGGLE_DIR=...` ve
   `SAMPLES_PER_WORD=...` klasörü ve sayıyı değiştirir.

Dışa aktarım, Git'in yok saydığı `asl-web/data/model-test-samples/local/`
klasörüne yazar; klasör varsa Model Test ekranı bu örnekleri listeler.
Örnekler tarayıcıdaki çıkarım yolunu denetler; ayrılmış test kümesi
değerlendirmesini yeniden üretmez. `asl-web/` klasörünü herhangi bir yere
yüklemeden önce bu klasörü, [Statik yayınlama](#statik-yayınlama) bölümünde
anlatıldığı gibi kaldırın.

## Komutlar

`make help` aynı hedefleri aynı sırayla listeler. Son sütun, `make` dışında
nelerin hazır olması gerektiğini söyler. "Python ortamı", [Python ortamını
kurmak](#python-ortamını-kurmak) bölümündeki ortamdır. Başka bir yorumlayıcı
kullanmak için herhangi bir hedefe `PYTHON=/path/to/python` ekleyin.

| Komut | Ne yapar | Gerekenler |
|---|---|---|
| `make help` | Hedefleri listeler. | Hiçbir şey |
| `make doctor` | Etkin Python ortamını ve projenin ihtiyaç duyduğu içe aktarmaları, hiçbir şeyi değiştirmeden raporlar. | Herhangi bir Python |
| `make setup` | `requirements-dev.txt` dosyasını ve iki yerel paketi etkin ortama kurar. | Etkinleştirilmiş, `base` olmayan bir Python 3.12 ortamı |
| `make web` | `asl-web/` klasörünü <http://localhost:8080> adresinde sunar; `PORT=8081` portu değiştirir. | Python 3 |
| `make health` | Düzenleme sonrası kapı; adımlarını [Testler](../tests/README.md#what-each-gate-runs) listeler. | Python ortamı, Node |
| `make quick` | Lint, biçim denetimi ve bütün web testleri: en hızlı döngü. | Python ortamı, Node |
| `make test` | Hızlı Python testleri: `tests/asl_features`, `tests/asl_desktop/unit`, `tests/project`, `tests/scripts`. | Python ortamı |
| `make test-full` | Masaüstü entegrasyon testleri dahil bütün Python testleri. Web testlerini, doğrulayıcıları ve özellik eşitliğini çalıştırmaz. | Python ortamı |
| `make test-py FILE=... K=...` | Tek bir pytest dosyası; istenirse `-k` ile süzülür. `FILE` verilmezse `make test` testlerini çalıştırır. | Python ortamı |
| `make js-test` | Bütün web testlerini (`tests/web/**/*.test.js` ve `.test.mjs`) `node --test` ile çalıştırır. | Node |
| `make test-web FILE=... NAME=...` | Tek bir web test dosyası; istenirse yalnızca adı eşleşen testler. | Node |
| `make watch-web FILE=...` | Aynısını her kayıtta yeniden çalıştırır. | Node |
| `make format` | Python kaynaklarını Ruff ile biçimlendirir. | Python ortamı |
| `make desktop` | Masaüstü prototipini başlatır. | Python ortamı, kamera, ekran |
| `make lint` | Ruff ile `asl-desktop`, `asl-features`, `scripts` ve `tests` içinde sözdizimini, adları ve import sırasını denetler. | Python ortamı |
| `make format-check` | Python biçimini değiştirmeden denetler. | Python ortamı |
| `make js-check` | `asl-web/js` altındaki her JavaScript dosyasının sözdizimini denetler. | Node |
| `make js-typecheck` | JSDoc tiplerini TypeScript ile, dosya üretmeden denetler. | Node, `npm ci` |
| `make parity` | Python kodu ile tarayıcı kodu arasında kelime ve harf özellik eşitliğini denetler. | Python ortamı, Node |
| `make validate` | JavaScript sözdizimini, ardından çalışma zamanı dosyalarını denetler: dosyalar, JSON şemaları, fixture'lar, kaynaktan yayına hash'ler, ONNX girdi ve çıktıları ve çevrimdışı kelime örneği. | Python ortamı, Node |
| `make validate-full` | `make validate` ve yerel veri raporlu proje dosya denetimi. Eksik veri kümeleri raporlanır, hata sayılmaz. | Python ortamı, Node |
| `make notebook-check` | Kelime modeli notebook'larının, modellerin ve sonuç dosyalarının yerinde olduğunu denetler. | Hiçbir şey |
| `make git-hygiene` | `.gitignore` ile eşleşen izlenen dosya varsa başarısız olur. | Git |
| `make check` | Commit öncesi kapı: `make health` ve `make js-typecheck`. | Python ortamı, Node, `npm ci` |
| `make browser-check` | Node testlerinin yapamadığı denetimleri gerçek bir headless Chrome'da yapar: CSS katmanları, gizli öğeler, moda özgü denetimler, azaltılmış hareket, koyu tema, yatay taşma, kameranın bırakılması ve kamerasız örnek. `OFFLINE=1`, CDN kütüphanelerini yükleyen iki denetimi atlar. | Node, Chrome ya da Chromium |
| `make deploy-check` | Her yüklemeden önceki adım: JavaScript sözdizimi, çalışma zamanı dosya denetimi ve `asl-web/` içindeki her dosyanın listesi. Sitenin yayınlamadığı her dosyada başarısız olur. | Python ortamı, Node |
| `make model-test-fixtures` | İsteğe bağlı: indirilmiş Kaggle alt kümesinden Model Test kelime fixture'larını dışa aktarır. Alt küme yoksa indirme komutunu yazıp durur. | Python ortamı, Kaggle alt kümesi |
| `make clean` | Önbellekleri (`__pycache__`, `.pytest_cache`, `*.egg-info`, `*.pyc`) ve `.DS_Store` dosyalarını siler. Veri, model, notebook ve ortamlara dokunmaz. | Hiçbir şey |

### Çıkış kodları

Doğrulayıcılar, özellik eşitliği denetimleri ve tarayıcı denetimleri aynı
kurala uyar: her denetim tuttuğunda 0, biri başarısız olduğunda 1, hatalı
kullanım ya da eksik bir araç yüzünden hiç denetleyemediğinde 2 ile çıkar.
Örneğin özellik eşitliği için Node eksikse, `check_runtime_assets.py` için
ONNX Runtime içe aktarılamıyorsa ya da `make browser-check` Chrome bulamazsa
sonuç 2'dir. `--no-onnx`, `check_runtime_assets.py` içindeki model adımını
bilerek atlar. İstisnaları [scripts README](../scripts/README.md#exit-codes)
listeler.

### Make olmadan

Windows PowerShell ve cmd'de `make` yoktur. WSL kullanın ya da hedeflerin
arkasındaki komutları doğrudan çalıştırın:

| Bunun yerine | Şunu çalıştırın |
|---|---|
| `make setup` | [`make setup` neleri kurar](#make-setup-neleri-kurar) bölümündeki üç komut |
| `make web` | `python -m http.server 8080 --directory asl-web` |
| `make lint` | `python -m ruff check asl-desktop asl-features scripts tests` |
| `make format-check` | `python -m ruff format --check asl-desktop asl-features scripts tests` |
| `make js-test` | `npm test` |
| `make js-typecheck` | `npm run typecheck` |
| `make browser-check` | `npm run browser-check`; `OFFLINE=1` için `node tests/browser/run.mjs --offline` |
| `make parity` | `python tests/validation/check_word_feature_parity.py`, ardından `python tests/validation/check_letter_feature_parity.py` |
| `make validate` | `python scripts/validation/check_runtime_assets.py` |
| `make deploy-check` | `python scripts/validation/check_runtime_assets.py --deploy` |
| `make validate-full` | `make validate` komutu, ardından `python scripts/validation/verify_project_assets.py` |
| `make test` | `python -m pytest -rs tests/asl_features tests/asl_desktop/unit tests/project tests/scripts` |
| `make test-full` | `python -m pytest -rs tests/` |
| `make desktop` | `python asl-desktop/main.py` |

`make validate` ve `make deploy-check`, `asl-web/js` altındaki her dosyada
`node --check` de çalıştırır; düz komutlar bunu dışarıda bırakır.

Kelime özellik eşitliği denetimi şu satırla bitmelidir:

```text
Summary: PASS=6, KNOWN_GAP=0, FAIL=0
```

Bu denetimlerin hiçbiri gerçek bir tarayıcı, kamera ve işaret yapan biriyle
yapılan testin yerini tutmaz.

## Statik yayınlama

`asl-web/` yayın klasörüdür ve derleme adımı yoktur. Herhangi bir statik
barındırma hizmeti olur; ancak telefonlarda kamera çalışsın diye siteyi HTTPS
ile sunmalıdır. Depoda CI iş akışı veya Docker kurulumu yoktur, çünkü
uygulamanın ihtiyacı yalnızca bir statik dosya sunucusudur.

<https://asl-assistant.netlify.app/> adresindeki demo elle yayınlanır: klasör
Netlify'ın yayın sayfasına sürüklenir. Yükleme, klasörü diskte olduğu gibi,
yok sayılan dosyalarla birlikte alır; bu yüzden aşağıdaki adımlar önce klasörü
temizler:

1. `make check` çalıştırın; Chrome kuruluysa `make browser-check` de.
2. Uygulamayı `make web` ile sunun ve elle doğrulayın: model hazırlığı,
   kamerasız örnek, `#test` üzerindeki çevrimdışı fixture'lar, kameranın
   açılıp kapanması, harf ekleme, kelime kaydı ve `#letter`, `#word`, `#test`
   bağlantıları (QR ekranı ilk ikisine bağlantı verir).
3. `asl-web/data/model-test-samples/local/` klasörü varsa onu `asl-web/`
   dışına taşıyın ya da silin; `make model-test-fixtures` onu yeniden
   üretebilir. Klasör, yayımlanmaması gereken, yarışma verisinden türetilmiş
   fixture'ları içerir. `make validate` bu klasör için yalnızca uyarır,
   böylece klasörle yerel test sürebilir; `make deploy-check` ise başarısız
   olur.
4. `.DS_Store` dosyalarını ve önbellekleri silmek için `make clean`
   çalıştırın.
5. `make deploy-check` çalıştırın ve bildirdiklerini düzeltin. Komut
   `asl-web/` altındaki her dosyayı listeler ve şunlarda başarısız olur:
   - `asl-web/data/model-test-samples/local/` klasörü;
   - Git'in yok saydığı dosyalar;
   - `.DS_Store` veya `.env` gibi gizli dosyalar;
   - `scripts/validation/contracts.py` içindeki izin listesinin dışında kalan
     her şey.
6. Netlify'da sitenin yayın sayfasına bu deponun kendi `asl-web/` klasörünü
   sürükleyin. Bir kopyasını sürüklemeyin; kopya eski kalmış olabilir.
7. Canlı sitenin tam olarak bu dosyaları sunduğunu doğrulayın. `<script>`
   etiketlerini karşılaştırmak yetmez: `?v=` ekleri nadiren değişir, bu
   yüzden eski bir yayın aynı etiketleri listeleyebilir. İçeriği
   karşılaştırın:

   ```bash
   for f in index.html js/core/app.js css/style.css css/components.css; do
     curl -s "https://asl-assistant.netlify.app/$f" | shasum -a 256
     shasum -a 256 "asl-web/$f"
   done
   ```

   Her hash çifti aynı olmalıdır.

HTTP yanıt başlıkları `asl-web/_headers` dosyasından gelir; Netlify bu dosyayı
yüklenen klasörden okur. Kökteki `netlify.toml` sürükle-bırak yüklemesine dahil
değildir; yalnızca Git bağlantılı ya da komut satırından yapılan yayınlarda
yayın klasörünü seçer.

## Sorun giderme

### Modeller yüklenmiyor

Sayfa açıldığında hiçbir model istenmez; bu yüzden tarayıcının Network
panelinde model isteği ancak bir modele ihtiyaç duyulduğunda görünür: kamera
ya da kamerasız örnek başlatıldığında, kelime kaydında ya da bir Model Test
çalıştırmasında. Harf modu ve kamerasız örnek harf modelini, kelime modu
kelime modelini yükler. Öğrenme Koçu harf modelini yükler; kelime modelini
yalnızca kelimelere geçildiğinde ekler.

`make validate` çalıştırın, bunlardan birini tetikleyin ve tarayıcının Network
ile Console panellerine bakın. Harf modeli `models/letter_model.onnx.gz`,
kelime modeli `models/word_model.onnx` olarak gelir. İkisi de HTTP 200
dönmeli, CDN dosyalarına da erişilebilmelidir. `models/letter_model.onnx`
isteği görünüyorsa sıkıştırılmış kopya kullanılamamıştır; nedeni Console'da
yazar ve uygulama sıkıştırılmamış dosyaya döner, o dosya da 200 dönmelidir.

### Kamera açılmıyor

Sayfanın `localhost` ya da HTTPS üzerinden geldiğini denetleyin, kamerayı
tutan diğer uygulamaları kapatın ve tarayıcının ve işletim sisteminin kamera
izinlerini kontrol edin.

### `make` yok ya da çalışmayı reddediyor

Windows'ta WSL'i ya da [Make olmadan](#make-olmadan) bölümündeki komutları
kullanın. macOS'ta `xcode-select --install`, `make` dahil Command Line
Tools'u kurar. `make` Xcode lisansıyla ilgili bir mesajla duruyorsa lisansı
bir kez `sudo xcodebuild -license accept` ile kabul edin.

### `make setup` kurmayı reddediyor

Mesaj nedeni ve çözümü söyler. `base` olmayan yalıtılmış bir ortamı
etkinleştirin ya da doğru yorumlayıcıyı `PYTHON=...` ile verin;
[Ortam güvenliği](#ortam-güvenliği) bölümü nasıl yapılacağını gösterir.

### Python `asl_features` veya `asl_desktop` paketini bulamıyor

Kullanmak istediğiniz ortamı etkinleştirin, `make doctor` ve ardından `make
setup` çalıştırın. `python` ile `python -m pip` aynı ortamı göstermelidir.

### `make health`, pytest testleri toplarken duruyor

Toplama sırasında bir içe aktarma hatası, `requirements.txt` içindeki bir
paketin etkin ortamda eksik olduğu anlamına gelir; bu durumda hiçbir test
çalışmaz. `make setup` hepsini kurar.

### Node ya da TypeScript eksik

Node yoksa `make js-check`, `make validate` ve `make health` JavaScript
denetimlerini atlamak yerine hatayla durur. Node 24'ü kurun ya da Node'u
içeren Conda ortamını etkinleştirin. `make js-typecheck` TypeScript'in kurulu
olmadığını söylüyorsa bir kez `npm ci` çalıştırın.

## İlgili belgeler

- [Architecture](architecture.md)
- [Models and data](models-and-data.md)
- [Project journey](project-journey.md)
- [Web uygulaması notları](../asl-web/README.md)
- [Masaüstü uygulaması](../asl-desktop/README.md)
- [Testler](../tests/README.md)
- [Betikler](../scripts/README.md)
