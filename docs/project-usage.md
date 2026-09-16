# ASL Assistant Kullanım Kılavuzu

> Bu dosya projenin **güncel çalıştırma ve terminal komutları** rehberidir.
> [`README.md`](../README.md) kısa başlangıç içindir; bu dosya günlük
> kullanım için detaydır.

---

## 1. Bu dosya ne için?

- README.md kısa tanıtım + yönlendirici giriş.
- `docs/usage.md` (bu dosya) — terminal komutları, ortam seçimleri,
  kurulum varyasyonları, sorun giderme.
- Klasör yolları veya entrypoint dosyaları ileride değişirse
  `Makefile` üst kısmındaki **değişkenler** güncellenir; bu dosya da
  buna göre revize edilir. Hedef bloklarına dokunmaya gerek yoktur.

---

## 2. En basit kullanım

### Son kullanıcı (jüri, demo izleyicisi)

QR kod veya web link açılır. Terminal gerekmez. Tarayıcı + kamera izni
yeterlidir.

Canlı kamera demosu için QR linki public **HTTPS** siteye gitmelidir. Önerilen
giriş linki:

```text
https://asl-demo.netlify.app/#letter
```

Bu link Harf Çeviri modunu doğrudan açar; jüri üyesi telefonda `Kamerayı
Başlat` ile elini kameraya gösterip modeli deneyebilir. Kelime modu da aynı
site içinde çalışır, ancak telefon performansı ve ışık koşulları değişebildiği
için sunumda önce harf modu, sonra istenirse kelime modu gösterilmelidir.

Sunum ekranında uygulamadaki `QR Demo` sekmesini açarsan QR kodu canlı üretilir.
Bu ekrandaki hedefler:

- `Canlı Harf`: `https://asl-demo.netlify.app/#letter`
- `Kelime`: `https://asl-demo.netlify.app/#word`
- `Model Test`: `https://asl-demo.netlify.app/#test`

### Geliştirici

```bash
make help        # Hedefleri gör
make web         # Web demoyu localde aç (Python ML kurulumu gerekmez)
```

Test/validation gerekirse:

```bash
make doctor      # Ortam kontrolü
make setup       # Kurulum (sadece bir kere)
make health      # Düzenleme sonrası genel sağlık kapısı
make validate    # Asset sağlık kontrolü
make test        # Hızlı testler
```

---

## 3. Web demo çalıştırma

```bash
make web
```

Arkasındaki gerçek komut:

```bash
cd asl-web && python3 -m http.server 8080
```

**Önemli noktalar**:

- `asl-web/` klasörünü statik olarak servis eder.
- Tarayıcıda `http://localhost:8080` aç.
- **Web demo Python ML paketi GEREKTİRMEZ** — `make setup` yapmadan da
  çalışır. ONNX Runtime Web ve MediaPipe Tasks Vision tarayıcı tarafında
  CDN'den yüklenir.
- `Ctrl+C` ile durdurulur.
- `file://` ile direkt açma çalışmaz (CORS engeli) — mutlaka HTTP server
  kullan veya GitHub Pages'e deploy et.
- Localhost dışında bir IP'den bağlanılacaksa HTTPS şarttır
  (`getUserMedia` için secure context gereği).
- İlk açılışta `Modeller yükleniyor...` → 1-2 saniye → `Modeller hazır:
  Harf ✓, Kelime ✓` görünmeli.

### 3.1 QR / telefon demo testi

Sunumdan önce gerçek telefonla şu sıra doğrulanmalıdır:

1. `QR Demo` sekmesindeki kod `https://asl-demo.netlify.app/#letter` adresine gidiyor mu?
2. Sayfa `Modeller hazır: Harf ✓, Kelime ✓` durumuna geliyor mu?
3. `Kamerayı Başlat` butonu kamera izni istiyor mu?
4. Telefon kamerasında el kadraja girince harf tahmini güncelleniyor mu?
5. `Kelime Pratik` modunda kayıt başlatma/bitirme akışı görünüyor mu?
6. Ağ kapatılıp tekrar açıldığında veya sayfa yenilendiğinde site yeniden yükleniyor mu?

Aktif demo adresi:

```text
https://asl-demo.netlify.app/
```

### 3.2 Frontend / backend ayrımı

Aktif ürün statik frontend'dir:

```bash
make frontend    # make web alias'ı
make backend     # backend olmadığını açıklar, servis başlatmaz
```

Projede ayrı bir backend API yoktur. Python tarafı eğitim, validation,
fixture export ve legacy desktop için helper katmanıdır.

---

## 4. Python ortamı seçimi (cross-platform)

Bu projede Python tarafı için **tek aktif ortam** kullanılır.
`asl-ml`, `asl-desktop`, `scripts` ve `tests` aynı ortamdan çalışır.
Farklı klasörler için farklı environment gerekmez.

> **Web demo için Python ortamına HİÇ ihtiyaç yoktur.** Aşağıdaki
> seçimler yalnızca *test, validation ve desktop prototip* için.

### 4.0 Önce `make doctor`

Hangi platformda olursan ol, ilk komut **`make doctor`**'dır:

```bash
make doctor
```

Doctor çıktısı sana şunu söyler:
- OS + architecture (Darwin arm64 / Darwin x86_64 / Linux / Windows)
- `CONDA_PREFIX`, `CONDA_DEFAULT_ENV`, `VIRTUAL_ENV` env değişkenleri
- Hangi Python `sys.executable` (gerçek yol)
- Apple CommandLineTools Python uyarısı (macOS'ta yanlış Python seçilmişse)
- Conda mismatch uyarısı (conda aktif ama Python conda env'inde değil)
- venv mismatch uyarısı (venv aktif ama Python venv'de değil)
- Windows uyarısı (PowerShell/cmd için manuel komut yönlendirmesi)

Uyarı çıkıyorsa **`make setup`'ı çalıştırma** — önce ortamı düzelt.

### 4.1 macOS Apple Silicon / ARM (M1, M2, M3, M4)

Önerilen: **Miniforge / Conda**.

```bash
conda activate isaret_dili     # ya da senin env adın
make doctor
```

Doctor çıktısında **Apple CommandLineTools uyarısı** veya **conda mismatch
uyarısı** görürsen:

```bash
make doctor PYTHON=$CONDA_PREFIX/bin/python
make setup  PYTHON=$CONDA_PREFIX/bin/python
make validate PYTHON=$CONDA_PREFIX/bin/python
make test     PYTHON=$CONDA_PREFIX/bin/python
```

**Önemli notlar (Apple Silicon)**:
- Miniforge ARM64 native Python sağlar (önerilen).
- Apple system Python (`/Library/Developer/CommandLineTools/...`) bazen
  `python3` aramasında ilk sırada gelir. **Bu Python ile setup
  çalıştırılamaz** — Makefile guard tarafından bloklanır.
- Homebrew Python `/opt/homebrew/bin/python3` altındadır (ARM için doğru).
- ARM/Intel paket karışıklığı: `make doctor` çıktısında `Architecture: arm64`
  beklenir. `x86_64` görünüyorsa Rosetta üzerinde Python çalışıyor — yeniden
  ARM native venv kur.

### 4.2 macOS Intel

Önerilen: **Miniconda / Miniforge** veya **venv**.

```bash
conda activate isaret_dili
make doctor
```

Veya venv:

```bash
python3 -m venv .venv
source .venv/bin/activate
make doctor
```

Doctor çıktısında `Architecture: x86_64` beklenir. Apple CLT veya conda
mismatch uyarısı çıkarsa Apple Silicon bölümündeki override yöntemini
uygula.

**Önemli notlar (Intel)**:
- Homebrew yolu `/usr/local/...` altındadır (ARM'da `/opt/homebrew/`).
- Bazı paketler için universal2 (Intel + ARM) wheel'leri otomatik
  seçilir; manuel müdahale gerekmez.

### 4.3 Linux (Ubuntu, Fedora, vb.) ve WSL

Önerilen: **venv** veya **conda**.

```bash
python3 -m venv .venv
source .venv/bin/activate
make doctor
make setup
```

WSL altında çalışıyorsan: davranış Linux ile aynıdır. Windows host'tan
kamera/GUI erişimi sınırlı olabilir; **web demo için sorun yok**, desktop
prototip için Windows host önerilir.

### 4.4 Windows (native PowerShell / cmd)

> ⚠ Windows native PowerShell/cmd ortamında **`make` default gelmez**.
> 3 seçenek var:

#### Seçenek A — Conda Prompt / Anaconda Prompt + make

`make` Windows Conda Prompt'ta `conda install -c conda-forge make` ile
kurulabilir. Sonra:

```powershell
conda activate isaret_dili
make doctor
make setup
make validate
make test
```

#### Seçenek B — Git Bash veya WSL (önerilen)

Git Bash ve WSL Unix-benzeri Make sağlar. Doğrudan:

```bash
make doctor
make setup
make validate
make test
```

#### Seçenek C — Make olmadan manuel komutlar

PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-dev.txt
python -m pip install -e .\asl-ml
python -m pip install -e .\asl-desktop
python scripts\validation\check_runtime_assets.py
python -m pytest tests\asl_ml tests\asl_desktop\unit
```

cmd:

```cmd
py -3 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-dev.txt
python -m pip install -e .\asl-ml
python -m pip install -e .\asl-desktop
```

**Önemli notlar (Windows)**:
- Web demo Windows tarayıcısında sorunsuz çalışır — `python -m http.server 8080`
  veya `py -3 -m http.server 8080` yeterli (ML kurulumu gerekmez).
- Desktop prototip Windows'ta test edilmemiştir — kamera/GUI/CustomTkinter
  davranışı garanti edilmez.

### 4.5 PYTHON değişkenini override etme

Makefile öncelikle `python` (PATH'te ne varsa) sonra `python3` arar.
Belirli bir Python'a yönlendirmek için override:

```bash
# Tek seferlik
make doctor PYTHON=python3.11
make setup  PYTHON=$CONDA_PREFIX/bin/python
make test   PYTHON=/full/path/to/venv/bin/python

# Kalıcı (shell session)
export PYTHON=$CONDA_PREFIX/bin/python
make setup
```

Override en yaygın kullanım: `make doctor` Apple CLT uyarısı veriyorsa
veya conda mismatch tespit ediyorsa. Doctor çıktısı **doğru komutu
sana söyler**.

---

## 5. Kurulum ne yapar?

```bash
make setup
```

Arkasında şu komutları çalıştırır:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-dev.txt
python -m pip install -e ./asl-ml
python -m pip install -e ./asl-desktop
```

Sade açıklama:

| Adım | Ne yapar? |
|---|---|
| `--upgrade pip setuptools wheel` | Editable install için modern pip (≥24) ve setuptools/wheel — eski sürümler sibling editable çözmez |
| `requirements-dev.txt` | Test, validation ve ONNX araçları (`pytest`, `onnx`, `onnxruntime`, `numpy` vb.) |
| `pip install -e ./asl-ml` | Shared Python ML helper paketi (FE + utils + label I/O) editable install |
| `pip install -e ./asl-desktop` | Legacy CustomTkinter masaüstü paketi editable install |
| `-e` (editable) | Klasörleri aktif Python ortamına tanıtır; kod değişikliklerinde re-install gerekmez |

### Setup guard

`make setup` **otomatik koruma katmanı** içerir. Guard, yanlış Python
ortamına kurulum yapılmasını engeller:

| Tetikleyici | Davranış |
|---|---|
| Apple CommandLineTools Python (`/Library/Developer/CommandLineTools/...`) | **BLOCK + exit 2** |
| Conda/Miniforge **base** ortamı (proje env değil) | **BLOCK + exit 2** |
| `CONDA_PREFIX` dolu ama Python conda'da değil | **BLOCK + exit 2** |
| `VIRTUAL_ENV` dolu ama Python venv'de değil | **BLOCK + exit 2** |
| Proje env (conda non-base, venv, override) | `[OK]` — kurulum devam eder |

Guard tetiklenirse mesaj sana hangi `PYTHON=...` override'ını
kullanman gerektiğini söyler.

#### Base ortam neden bloklanır?

Conda/Miniforge `base` ortamı **birçok proje tarafından paylaşılır** ve
kolay kirlenir. Editable install yaparken eski paketler çakışabilir veya
sürümler birbirini bozar. Bu yüzden proje için **izole ortam** kullanılır:

- `conda activate isaret_dili` (proje env)
- veya `python3 -m venv .venv && source .venv/bin/activate`

Base'i tespit ederken:
- `CONDA_DEFAULT_ENV == "base"` ise → base
- `CONDA_PREFIX` `/base` ile bitiyorsa → base
- Python yolu `/miniforge/base/`, `/miniconda/base/`, `/anaconda/base/`,
  `/Caskroom/miniforge/base/` (macOS) içeriyorsa → base
- Windows: `\miniforge\base\` vs paterni → base
- Path `envs/<env>` içeriyorsa **base değil** (proje env)

#### İleri kullanıcı kaçış kapısı

```bash
make setup ALLOW_BASE_SETUP=1
```

⚠ **Önerilmez** — base ortamı kirletir. Sadece bilinçli yapılan tek
seferlik durumlarda kullanın (örn. CI gibi izole ortamlarda base'in
zaten temiz olduğu durumlar). Tetiklenirse `[WARN]` mesajı çıkar ve
kurulum devam eder.

---

## 6. Ortam kontrolü (`make doctor` çıktısı)

```bash
make doctor
```

3 bölümlük rapor verir:

### 6.1 Platform

```text
OS              : Darwin / Linux / Windows
Architecture    : arm64 / x86_64
Platform string : macOS-26.x.x-arm64-... (detay)
```

### 6.2 Environment

```text
CONDA_PREFIX      : /path/to/conda/env (veya "(bos)")
CONDA_DEFAULT_ENV : env_name (veya "(bos)")
VIRTUAL_ENV       : /path/to/.venv (veya "(bos)")
```

### 6.3 Python

```text
PYTHON (Make var) : python (Makefile değişkeni)
sys.executable    : /opt/homebrew/.../python (gerçek yol)
Python version    : 3.13.12
Implementation    : CPython
```

### 6.4 Uyarılar

Yukarıdaki bilgilere göre **otomatik** uyarı çıkar:

| Uyarı | Anlamı | Çözüm |
|---|---|---|
| Apple CommandLineTools Python | macOS sistem Python'ı seçildi | Conda/venv aktive et veya `PYTHON=$CONDA_PREFIX/bin/python` override |
| **Conda/Miniforge base Python** | `make setup` base ortamda **BLOKLANIR** (default) | Proje env'i aktive et: `conda activate isaret_dili` |
| Conda mismatch | `$CONDA_PREFIX` dolu ama Python conda'da değil | `make doctor PYTHON=$CONDA_PREFIX/bin/python` |
| venv mismatch | `$VIRTUAL_ENV` dolu ama Python venv'de değil | `make doctor PYTHON=$VIRTUAL_ENV/bin/python` |
| Windows algılandı | PowerShell/cmd için Make uyumsuz olabilir | Git Bash, WSL veya manuel komutlar (§4.4) |

### 6.5 Paket import kontrolü

```text
✓ pytest <ver>
✓ onnxruntime <ver>
✓ numpy <ver>
✓ asl_ml import OK (editable kurulu)
✓ asl_desktop import OK (editable kurulu)
```

Eksik varsa `✗` işareti + `make setup gerekli` notu.

`doctor` **hiçbir kurulum yapmaz** — sadece raporlar. Eksiklerse
`make setup` çağırarak çöz.

---

## 7. Test ve validation

| Komut | Ne yapar? | Süre |
|---|---|---|
| `make health` | Düzenleme sonrası genel sağlık kapısı: JS syntax, runtime asset, provenance, notebook/script varlığı, word/letter parity, hızlı testler. | ~10-20 sn |
| `make validate` | Web runtime asset/model/data sağlık kontrolü (hash chain + JSON şema + ONNX I/O + offline test). **Beklenen**: `give @ %7.6 Δconf=0`. | ~3-5 sn |
| `make validate-full` | `validate` + `verify_project_assets.py` (dataset varlığı, harf modeli pkl/ONNX, legacy artifact kontrol) | ~10 sn |
| `make models` | Deploy model/data artifact sözleşmelerini `make validate` ile kontrol eder. | ~3-5 sn |
| `make notebook-check` | Kritik notebook ve `notebooks/results/` provenance dosyalarının yerinde olduğunu kontrol eder. | <1 sn |
| `make scripts-check` | Validation/evaluation script entrypoint'leri yerinde mi diye kontrol eder. | <1 sn |
| `make jury-fixtures` | `KAGGLE_DIR` altındaki lokal Kaggle subset'ten Model Test kelime fixture'ları export eder. Network indirme yapmaz. | Veri boyutuna bağlı |
| `make test` | Hızlı Python unit/proje testleri. Kamera/MediaPipe bağımsız. | ~1 sn |
| `make test-full` | Tüm Python testleri (`tests/`). Bazı integration testler MediaPipe + kamera gerektirir, eksikse otomatik skip eder. | Değişken |

---

## 8. Desktop prototip

```bash
make desktop
```

Arkasındaki komut:

```bash
python3 asl-desktop/main.py
```

**Önemli noktalar**:

- Desktop **legacy/prototip**'tir. Aktif ürün `asl-web/`'tir.
- `make setup` ile editable install ZORUNLU — yoksa
  `ModuleNotFoundError: No module named 'asl_desktop'`.
- macOS'ta ilk açılışta kamera izin dialogu açılır.
- GUI için CustomTkinter kullanılır (Tkinter + Python 3.x ile gelir).
- Web ile masaüstü farkları için bkz. [`HANDBOOK.md`](../HANDBOOK.md) §6.

---

## 9. Temizlik

```bash
make clean
```

Sadece şunları siler:

- `__pycache__/` (proje genelinde)
- `.pytest_cache/`
- `*.pyc`

**ASLA silmez**:

- `data/raw/`, `data/processed/`
- `models/`, `asl-web/models/`, `asl-web/data/`
- `notebooks/`
- `.venv*`
- `.gitignore`, README'ler

---

## 10. Komut yolları ileride değişirse

Makefile komutları kesin/değişmez path'ler olarak tasarlanmadı.
Üst kısımdaki değişkenler ile yönetilir:

```makefile
PYTHON         ?= python3
WEB_DIR        ?= asl-web
ASL_ML_DIR     ?= ./asl-ml
ASL_DESKTOP_DIR ?= ./asl-desktop
DESKTOP_ENTRY  ?= asl-desktop/main.py
VALIDATION_DIR ?= scripts/validation
CHECK_RUNTIME  ?= $(VALIDATION_DIR)/check_runtime_assets.py
VERIFY_ASSETS  ?= $(VALIDATION_DIR)/verify_project_assets.py
TEST_FAST      ?= tests/asl_ml/ tests/asl_desktop/unit/
TEST_ALL       ?= tests/
REQS_DEV       ?= requirements-dev.txt
```

Eğer ileride klasör yapısı değişirse:

1. Önce **Makefile üstündeki değişkeni** güncelle.
2. Sonra bu dokümandaki bahsedilen yolları güncelle.
3. Hedef bloklarına dokunma — değişken üzerinden geçer.

Bu dosya **tek bakım noktasıdır**. README/HANDBOOK içindeki yollar
referans için tutulur, ama Makefile değişkenleri her zaman truth
source'tur.

### Override örnekleri

Tek seferlik:

```bash
make web PYTHON=python3.11
make validate VALIDATION_DIR=other/validation
make test TEST_FAST=tests/asl_ml/
```

Kalıcı (shell session):

```bash
export PYTHON=python3.11
export WEB_DIR=alternative-web
make web
```

---

## 11. Docker durumu

Şimdilik Docker bu projenin ana kullanım yolu **değildir**.

| Kullanıcı tipi | Önerilen yol |
|---|---|
| Son kullanıcı (jüri) | QR / web link → tarayıcı |
| Geliştirici | Makefile + conda/venv |
| Docker (opsiyonel, gelecek) | Sadece dev/test/validation için olabilir |
| Desktop GUI Docker | **ÖNERİLMEZ** — kamera/GUI/macOS izinleri sorunlu |

Docker eklenirse:

- `Dockerfile.dev` — sadece test + validation environment
- Web için Docker zaten gereksiz (GitHub Pages = "Docker'sız Docker")
- `.dockerignore` mutlaka `data/raw/`, `data/processed/`, `.venv*`,
  `__pycache__`, `*.egg-info` dışlamalı

Bu sprint'te Docker P0 değildir.

---

## 12. Sorun giderme

### `make setup` BLOCK ile durdu

Guard tetiklendi. Çıktıda yazan **`Cozum:`** satırını uygula. En yaygın 3 durum:

#### a) Apple CommandLineTools Python

```text
[BLOCK] Apple CommandLineTools Python ile setup CALISTIRILAMAZ.
  sys.executable = /Library/Developer/CommandLineTools/usr/bin/python3
  ...
  Cozum:
    Conda    : conda activate <env> && make setup
    venv     : python3 -m venv .venv && source .venv/bin/activate && make setup
    Override : make setup PYTHON=$CONDA_PREFIX/bin/python
```

Çözüm: Conda veya venv aktive et, sonra tekrar `make setup`.

#### a2) Conda/Miniforge base ortamı

```text
[BLOCK] Conda/Miniforge base Python ile setup CALISTIRILAMAZ.
  sys.executable    = /opt/homebrew/Caskroom/miniforge/base/bin/python
  CONDA_DEFAULT_ENV = (bos)
  CONDA_PREFIX      = (bos)

  Bu proje icin izole ortam kullan:
    conda activate isaret_dili      # ya da senin proje env adın
    make doctor
    make setup
  ...
```

Çözüm: Proje env'i aktive et (`conda activate isaret_dili`), sonra
`make doctor` → uyarı kaybolur → `make setup`.

İleri kullanıcı kaçış (önerilmez): `make setup ALLOW_BASE_SETUP=1`.

#### b) Conda mismatch

```text
[BLOCK] Conda aktif ama secilen Python conda ortaminda degil.
  CONDA_PREFIX   = /opt/homebrew/Caskroom/miniforge/base/envs/isaret_dili
  sys.executable = /Library/Developer/CommandLineTools/usr/bin/python3
  Cozum: make setup PYTHON=$CONDA_PREFIX/bin/python
```

`conda activate` yapıldı ama PATH order karıştı. Override ile zorla:

```bash
make setup PYTHON=$CONDA_PREFIX/bin/python
```

#### c) venv mismatch

```text
[BLOCK] venv aktif ama secilen Python venv icinde degil.
  Cozum: make setup PYTHON=$VIRTUAL_ENV/bin/python
```

Aynı mantık: override ile zorla.

### `make test` çalışmıyor / `ModuleNotFoundError`

```bash
make doctor    # Ortamı gör
make setup     # Eksikse kur (guard'ı geçmesi gerekir)
```

Conda kullanıyorsan önce `conda activate isaret_dili`.
venv kullanıyorsan önce `source .venv/bin/activate`.

### `asl_ml import edilemiyor`

```bash
make setup
make doctor
```

Hâlâ çalışmıyorsa: `pip --version` ile pip'in hangi ortamda olduğunu
kontrol et. Conda + venv karışmış olabilir.

### Web açılıyor ama model yüklenmiyor

```bash
make validate
```

Console'a bak (F12). Beklenen log:

```text
Word ONNX inputs: ['input', 'mask']
Letter ONNX outputs: ['label', 'probabilities']
Modeller hazır: Harf ✓, Kelime ✓
```

Hata gelirse:
- `asl-web/models/letter_model.onnx` ve `word_model.onnx` mevcut mu?
- Network tab → 200 OK?
- CDN erişimi (jsdelivr.net, googleapis.com) açık mı?

### Kamera açılmıyor

- Browser permission kontrol et (`chrome://settings/content/camera`)
- macOS: System Settings → Privacy → Camera → Browser ✓
- `localhost` veya HTTPS kullanılıyor mu? (`http://192.168.x.x` çalışmaz)
- Diğer uygulamalar (Zoom, FaceTime) kamerayı açmış mı?

### Tarayıcı `getUserMedia` reddediyor

`http://localhost:8080` veya HTTPS gerekli. `file://` ve düz HTTP IP
çalışmaz. **Localhost istisna** — secure context kabul edilir.

### `make help` boş çıktı veriyor

Bu Makefile syntax problemi. `make` versiyonu eski olabilir:

```bash
make --version
```

GNU Make 3.81+ veya BSD Make modern sürümü gerekir. macOS default `make`
çalışır. Windows'ta WSL veya Git Bash önerilir.

### `make` komutu yok (Windows)

```text
WSL kurulu mu? → Ubuntu üzerinden `make` çalışır.
Git Bash → `make` Windows'ta default yok; manuel kur veya WSL kullan.
PowerShell → `make` yok; manuel komutları docs/usage.md'den oku.
```

Bu projede Make yokken manuel komutlar:

```bash
# Web demo
cd asl-web && python3 -m http.server 8080

# Validation
python3 scripts/validation/check_runtime_assets.py

# Test
python3 -m pytest tests/asl_ml/ tests/asl_desktop/unit/

# Desktop
python3 asl-desktop/main.py
```

---

## İlgili dokümanlar

- [`../README.md`](../README.md) — Kısa tanıtım, yönlendirme tablosu
- [`../HANDBOOK.md`](../HANDBOOK.md) — Yolculuk-bazlı detaylı rehber
- [`current/model-contract.md`](current/model-contract.md) — ONNX I/O sözleşmesi
- [`current/data-contract.md`](current/data-contract.md) — JSON şema + provenance
- [`current/runtime-pipeline.md`](current/runtime-pipeline.md) — Pipeline akışı
- [`current/demo-plan.md`](current/demo-plan.md) — Jüri sunumu
- [`../scripts/README.md`](../scripts/README.md) — CLI script detayları
- [`../tests/README.md`](../tests/README.md) — Test rehberi
- [`../CHANGELOG.md`](../CHANGELOG.md) — Değişiklik geçmişi
