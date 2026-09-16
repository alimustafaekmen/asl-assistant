# ============================================================
#  ASL Sign Language Assistant — Makefile
# ============================================================
#  Günlük dev workflow için kısa kestirmeler.
#  Sınıf: SAFE-TOOLING — runtime davranışını DEĞİŞTİRMEZ.
#  Her hedef arkasındaki manuel komutla birebir aynı işi yapar.
#
#  Detaylı kullanım rehberi: docs/project-usage.md
#
#  Hızlı kullanım:
#    make help        → hedef listesi
#    make doctor      → aktif Python ortamını kontrol (kurulum yapmaz)
#    make web         → web demoyu localde aç
#    make health      → düzenleme sonrası genel sağlık kapısı
#    make validate    → asset/model/data sağlık kontrolü
#    make test        → hızlı Python unit testleri
#
#  Cross-platform notlar:
#    - macOS/Linux/Git Bash/WSL: doğrudan `make ...` çalışır.
#    - Windows native PowerShell/cmd: `make` default gelmez.
#      Manuel komutlar: docs/project-usage.md
# ============================================================


# ── Python detection (cross-platform güvenli) ───────────────
# Sıralama: önce 'python' (conda/venv aktif çoğunlukla bunu doğru
# yere yönlendirir), 'python' yoksa 'python3'. 'python3' macOS'ta
# bazen Apple CommandLineTools'a düşebildiği için ilk tercih DEĞİL.
PYTHON ?= $(shell command -v python >/dev/null 2>&1 && echo python || (command -v python3 >/dev/null 2>&1 && echo python3 || echo python))
PIP    := $(PYTHON) -m pip
PYTEST := $(PYTHON) -m pytest


# ── Klasör yolları ──────────────────────────────────────────
WEB_DIR        ?= asl-web
ASL_ML_DIR     ?= ./asl-ml
ASL_DESKTOP_DIR ?= ./asl-desktop
DESKTOP_ENTRY  ?= asl-desktop/main.py
PORT           ?= 8080
KAGGLE_DIR     ?= data/raw/asl-signs-jury-subset
SAMPLES_PER_WORD ?= 1


# ── Validation script yolları ───────────────────────────────
VALIDATION_DIR ?= scripts/validation
CHECK_RUNTIME  ?= $(VALIDATION_DIR)/check_runtime_assets.py
VERIFY_ASSETS  ?= $(VALIDATION_DIR)/verify_project_assets.py


# ── Test seçimi ──────────────────────────────────────────────
TEST_FAST      ?= tests/asl_ml/ tests/asl_desktop/unit/ tests/project/
TEST_ALL       ?= tests/
HEALTH_PYTHONPATH ?= $(CURDIR)/asl-ml/src:$(CURDIR)/asl-desktop/src


# ── Bağımlılık manifestoları ────────────────────────────────
REQS_DEV       ?= requirements-dev.txt


# ── İleri kullanıcı kaçış kapısı ────────────────────────────
# Conda/Miniforge base ortamına setup yapmaya izin vermek için 1 ver.
# DEFAULT 0 (base bloklanır). Önerilmez — base ortamı kirletir.
ALLOW_BASE_SETUP ?= 0


# ── PHONY hedefler ──────────────────────────────────────────
.PHONY: help doctor setup web frontend backend test test-full validate \
        validate-full health models notebook-check scripts-check \
        jury-fixtures docker desktop clean

.DEFAULT_GOAL := help


# ============================================================
#  Embedded Python helpers
# ============================================================
#  define ... endef ile multi-line Python script. export ile
#  shell environment'a aktarılır; recipe'larda $$VAR ile çağrılır.
#  Bu sayede inline tek-satır Python sınırlamasından kaçınılır.
# ============================================================

define DOCTOR_PY
import sys, os, platform
from importlib.util import find_spec

# ── Base ortam tespiti ────────────────────────
def is_conda_base(exe, cp, ce):
    """conda/miniforge/anaconda base ortamı mı?"""
    if ce == 'base':
        return True
    if cp:
        if cp.endswith('/base') or cp.endswith(chr(92) + 'base'):
            return True
    base_markers = (
        '/miniforge/base/', '/miniconda/base/', '/anaconda/base/',
        '/Caskroom/miniforge/base/',
        chr(92)+'miniforge'+chr(92)+'base'+chr(92),
        chr(92)+'miniconda'+chr(92)+'base'+chr(92),
        chr(92)+'anaconda'+chr(92)+'base'+chr(92),
    )
    for m in base_markers:
        if m in exe:
            # envs/<env> altındaysa base değil (proje env)
            if '/envs/' in exe or chr(92)+'envs'+chr(92) in exe:
                return False
            return True
    return False

# ── Platform ────────────────────────
print()
print('── Platform ───────────────────────────────')
print(f'OS              : {platform.system()}')
print(f'Architecture    : {platform.machine()}')
print(f'Platform string : {platform.platform()}')
print()

# ── Environment ────────────────────────
print('── Environment ───────────────────────────')
cp = os.environ.get('CONDA_PREFIX', '')
ce = os.environ.get('CONDA_DEFAULT_ENV', '')
ve = os.environ.get('VIRTUAL_ENV', '')
print(f'CONDA_PREFIX      : {cp or "(bos)"}')
print(f'CONDA_DEFAULT_ENV : {ce or "(bos)"}')
print(f'VIRTUAL_ENV       : {ve or "(bos)"}')
print()

# ── Python ────────────────────────
print('── Python ────────────────────────────────')
print(f'PYTHON (Make var) : {os.environ.get("MAKE_PYTHON_VAR", "(unknown)")}')
print(f'sys.executable    : {sys.executable}')
print(f'Python version    : {sys.version.split()[0]}')
print(f'Implementation    : {platform.python_implementation()}')
print()

# ── Uyarılar ────────────────────────
exe = sys.executable
is_apple_clt = '/Library/Developer/CommandLineTools/' in exe
is_base = is_conda_base(exe, cp, ce)
is_win = platform.system() == 'Windows'

warnings = []
if is_apple_clt:
    warnings.append([
        'UYARI: Apple CommandLineTools Python kullaniliyor.',
        '  Bu Python ile "make setup" CALISTIRILAMAZ (guard tarafindan engellenir).',
        '  Cozum:',
        '    Conda : conda activate <env> && make setup',
        '    venv  : python3 -m venv .venv && source .venv/bin/activate && make setup',
        '    Override: make setup PYTHON=$$CONDA_PREFIX/bin/python',
    ])
if is_base:
    warnings.append([
        'UYARI: Conda/Miniforge base Python kullaniliyor.',
        '  Bu proje icin "make setup" base ortamiyla onerilmez ve default olarak BLOKLANIR.',
        '  Sebep: base ortami bircok proje tarafindan paylasilir, kolay kirlenir.',
        '  Proje ortamini aktive et:',
        '    conda activate isaret_dili      # ya da senin proje env adın',
        '  veya yeni venv:',
        '    python3 -m venv .venv && source .venv/bin/activate && make setup',
        '  Ileri kullanici (ONERILMEZ): make setup ALLOW_BASE_SETUP=1',
    ])
if cp and cp not in exe:
    warnings.append([
        'UYARI: Conda aktif ($$CONDA_PREFIX dolu) ama secilen Python conda ortaminda DEGIL.',
        f'  CONDA_PREFIX   = {cp}',
        f'  sys.executable = {exe}',
        '  Cozum: make doctor PYTHON=$$CONDA_PREFIX/bin/python',
    ])
if ve and ve not in exe:
    warnings.append([
        'UYARI: venv aktif ($$VIRTUAL_ENV dolu) ama secilen Python venv icinde DEGIL.',
        f'  VIRTUAL_ENV    = {ve}',
        f'  sys.executable = {exe}',
        '  Cozum: make doctor PYTHON=$$VIRTUAL_ENV/bin/python',
    ])
if is_win:
    warnings.append([
        'NOT: Windows algilandi.',
        '  Makefile Git Bash / WSL / make saglayan terminalde calisir.',
        '  PowerShell/cmd icin manuel komutlar: docs/project-usage.md',
    ])

if warnings:
    for w in warnings:
        for line in w:
            print(line)
        print()
else:
    print('Ortam uyarisi yok.')
    print()

# ── Paket import kontrolü (traceback-free, iki grup) ────────────────
def check(spec_name, label=None):
    label = label or spec_name
    if find_spec(spec_name) is None:
        return ('missing', f'  X {label} yok')
    try:
        mod = __import__(spec_name)
        ver = getattr(mod, '__version__', None)
        if ver:
            return ('ok', f'  + {label} {ver}')
        return ('ok', f'  + {label} (kurulu, surum okunamadi)')
    except Exception as e:
        return ('ok', f'  + {label} (find_spec OK, import hata: {type(e).__name__})')

basic_pkgs = [('pytest', 'pytest'), ('onnxruntime', 'onnxruntime'), ('numpy', 'numpy')]
project_pkgs = [('asl_ml', 'asl_ml'), ('asl_desktop', 'asl_desktop')]

basic_results = [check(spec, label) for spec, label in basic_pkgs]
project_results = [check(spec, label) for spec, label in project_pkgs]

basic_missing = [r[1] for r in basic_results if r[0] == 'missing']
project_missing = [r[1] for r in project_results if r[0] == 'missing']

print('── Paket import kontrolu ────────────────')
print()
print('Temel paketler (validation/test icin gerekli):')
for status, line in basic_results:
    print(line)
print()
print('Proje paketleri (editable install — make setup ile gelir):')
for status, line in project_results:
    if status == 'missing':
        print(f'{line} -> make setup gerekli')
    else:
        print(line)
print()

# ── Durum özeti (akıllı sonraki adım) ────────────────────
print('── Durum ozeti ───────────────────────────')
print()

# State tespiti (oncelik sirasiyla)
state = 'ready'
if is_apple_clt:
    state = 'apple_clt'
elif is_base:
    state = 'base'
elif (cp and cp not in exe) or (ve and ve not in exe):
    state = 'mismatch'
elif basic_missing:
    state = 'basic_missing'
elif project_missing:
    state = 'needs_setup'

# Conda env ismi (durum mesajlarinda kullanmak icin)
env_label = ''
if cp and ('/envs/' in cp or chr(92)+'envs'+chr(92) in cp):
    env_label = cp.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]

if state == 'apple_clt':
    print('  Hatali Python secilmis: Apple CommandLineTools Python.')
    print()
    print('Cozum:')
    print('  conda activate isaret_dili')
    print('  make doctor')
    print()
    print('Eger hala yanlissa:')
    print('  make doctor PYTHON=$$CONDA_PREFIX/bin/python')

elif state == 'base':
    print('  Conda/Miniforge base ortam kullaniliyor. Bu proje icin ONERILMEZ.')
    print()
    print('Cozum:')
    print('  conda activate isaret_dili')
    print('  make doctor')
    print()
    print('Veya yeni venv:')
    print('  python3 -m venv .venv && source .venv/bin/activate')
    print('  make doctor')

elif state == 'mismatch':
    print('  Aktif ortam ile secilen Python uyusmuyor.')
    print()
    print('Cozum:')
    if cp and cp not in exe:
        print('  make doctor PYTHON=$$CONDA_PREFIX/bin/python')
    elif ve and ve not in exe:
        print('  make doctor PYTHON=$$VIRTUAL_ENV/bin/python')

elif state == 'basic_missing':
    print('  Bazi temel paketler eksik (pytest/onnxruntime/numpy).')
    print()
    print('Sonraki adim:')
    print('  make setup')
    print('  make doctor')

elif state == 'needs_setup':
    if env_label:
        print(f'  Ortam dogru gorunuyor (conda env: {env_label}), ama proje paketleri kurulmamis.')
    elif ve:
        print('  Ortam dogru gorunuyor (venv aktif), ama proje paketleri kurulmamis.')
    else:
        print('  Ortam dogru gorunuyor, ama proje paketleri kurulmamis.')
    print()
    print('Sonraki adim:')
    print('  make setup')
    print('  make doctor')
    print('  make validate-full')
    print('  make test')
    print()
    print('Web demo icin (proje paketleri gerekmez):')
    print('  make web')

else:  # state == 'ready'
    if env_label:
        print(f'  + Python ortami hazir (conda env: {env_label}).')
    elif ve:
        print('  + Python ortami hazir (venv aktif).')
    else:
        print('  + Python ortami hazir.')
    print()
    print('Gunluk komutlar:')
    print('  make web                # web demoyu localde ac')
    print('  make validate           # asset/model/data saglik kontrolu')
    print('  make test               # hizli unit testler')
    print('  make validate-full      # kapsamli asset kontrolu')

print()
endef
export DOCTOR_PY


define SETUP_GUARD_PY
import sys, os

def is_conda_base(exe, cp, ce):
    if ce == 'base':
        return True
    if cp:
        if cp.endswith('/base') or cp.endswith(chr(92) + 'base'):
            return True
    base_markers = (
        '/miniforge/base/', '/miniconda/base/', '/anaconda/base/',
        '/Caskroom/miniforge/base/',
        chr(92)+'miniforge'+chr(92)+'base'+chr(92),
        chr(92)+'miniconda'+chr(92)+'base'+chr(92),
        chr(92)+'anaconda'+chr(92)+'base'+chr(92),
    )
    for m in base_markers:
        if m in exe:
            if '/envs/' in exe or chr(92)+'envs'+chr(92) in exe:
                return False
            return True
    return False

exe = sys.executable
is_apple_clt = '/Library/Developer/CommandLineTools/' in exe
cp = os.environ.get('CONDA_PREFIX', '')
ce = os.environ.get('CONDA_DEFAULT_ENV', '')
ve = os.environ.get('VIRTUAL_ENV', '')
allow_base = os.environ.get('ALLOW_BASE_SETUP', '0') == '1'
is_base = is_conda_base(exe, cp, ce)

err = None
if is_apple_clt:
    err = (
        '[BLOCK] Apple CommandLineTools Python ile setup CALISTIRILAMAZ.\n'
        f'  sys.executable = {exe}\n'
        '  Bu Python ile editable install basarisiz olur veya yanlis environment kirlenir.\n'
        '  Cozum:\n'
        '    Conda    : conda activate <env> && make setup\n'
        '    venv     : python3 -m venv .venv && source .venv/bin/activate && make setup\n'
        '    Override : make setup PYTHON=$$CONDA_PREFIX/bin/python'
    )
elif is_base and not allow_base:
    err = (
        '[BLOCK] Conda/Miniforge base Python ile setup CALISTIRILAMAZ.\n'
        f'  sys.executable    = {exe}\n'
        f'  CONDA_DEFAULT_ENV = {ce or "(bos)"}\n'
        f'  CONDA_PREFIX      = {cp or "(bos)"}\n'
        '\n'
        '  Bu proje icin izole ortam kullan:\n'
        '    conda activate isaret_dili      # ya da senin proje env adın\n'
        '    make doctor\n'
        '    make setup\n'
        '\n'
        '  Eger conda aktif oldugu halde yanlis Python goruluyorsa:\n'
        '    make doctor PYTHON=$$CONDA_PREFIX/bin/python\n'
        '    make setup  PYTHON=$$CONDA_PREFIX/bin/python\n'
        '\n'
        '  Yeni venv:\n'
        '    python3 -m venv .venv\n'
        '    source .venv/bin/activate\n'
        '    make setup\n'
        '\n'
        '  Ileri kullanici (ONERILMEZ — base ortamini kirletir):\n'
        '    make setup ALLOW_BASE_SETUP=1'
    )
elif cp and cp not in exe:
    err = (
        '[BLOCK] Conda aktif ama secilen Python conda ortaminda degil.\n'
        f'  CONDA_PREFIX   = {cp}\n'
        f'  sys.executable = {exe}\n'
        '  Cozum: make setup PYTHON=$$CONDA_PREFIX/bin/python'
    )
elif ve and ve not in exe:
    err = (
        '[BLOCK] venv aktif ama secilen Python venv icinde degil.\n'
        f'  VIRTUAL_ENV    = {ve}\n'
        f'  sys.executable = {exe}\n'
        '  Cozum: make setup PYTHON=$$VIRTUAL_ENV/bin/python'
    )

if err is not None:
    print(err)
    sys.exit(2)
else:
    if is_base and allow_base:
        print(f'[WARN] Base ortamda setup CALISIYOR (ALLOW_BASE_SETUP=1 verildi). ONERILMEZ.')
    print(f'[OK] Hedef Python ortami: {exe}')
endef
export SETUP_GUARD_PY


# ============================================================
#  Hedefler
# ============================================================

help:
	@echo ""
	@echo "ASL Sign Language Assistant — Make hedefleri"
	@echo "============================================"
	@echo ""
	@echo "  make help            Bu mesaj"
	@echo "  make doctor          Aktif Python ortamını kontrol (kurulum yapmaz)"
	@echo "  make setup           Aktif ortama bağımlılıkları kur (önce 'make doctor' çalıştır)"
	@echo "  make web             Web demoyu localde aç (default: http://localhost:8080)"
	@echo "  make frontend        make web alias'ı"
	@echo "  make backend         Backend olmadığını açıklar (aktif ürün statik web)"
	@echo "  make web PORT=8081   Port doluysa farklı portta aç"
	@echo "  make test            Hızlı Python unit testleri (setup eksikse net uyarır)"
	@echo "  make test-full       Tüm Python testleri (integration dahil — bazıları MediaPipe gerektirir)"
	@echo "  make validate        Web runtime asset/model/data sağlık kontrolü (hash chain + ONNX I/O)"
	@echo "  make validate-full   validate + dataset/Python script asset kontrolü"
	@echo "  make health          Düzenleme sonrası hızlı genel sağlık kapısı"
	@echo "  make models          Deploy model/data artifact sağlık kontrolü"
	@echo "  make notebook-check  Kritik notebook/results dosyaları yerinde mi?"
	@echo "  make scripts-check   Önemli script entrypoint'leri yerinde mi?"
	@echo "  make jury-fixtures   Lokal Kaggle subset'ten Model Test kelime fixture export"
	@echo "  make docker          Dockerfile yoksa güvenli açıklama verir"
	@echo "  make desktop         Legacy masaüstü prototipini başlat (kamera + GUI gerekli)"
	@echo "  make clean           Sadece cache (__pycache__, .pytest_cache, *.pyc) — data/model SILINMEZ"
	@echo ""
	@echo "Cross-platform:"
	@echo "  macOS/Linux/Git Bash/WSL : doğrudan 'make ...' çalışır"
	@echo "  Windows PowerShell/cmd   : manuel komutlar → docs/project-usage.md"
	@echo ""
	@echo "Yanlış Python ortamı şüphesi:"
	@echo "  make doctor                                    # platform + ortam raporu"
	@echo "  make doctor PYTHON=\$$CONDA_PREFIX/bin/python   # conda override"
	@echo "  make setup  PYTHON=\$$CONDA_PREFIX/bin/python   # setup conda override"
	@echo ""
	@echo "Setup BLOCK eden ortamlar (default):"
	@echo "  - Apple CommandLineTools Python"
	@echo "  - Conda/Miniforge base ortamı (proje env aktive edilmeli)"
	@echo "  - Conda/venv mismatch durumları"
	@echo ""
	@echo "İleri kullanıcı (ÖNERİLMEZ — base ortamı kirletir):"
	@echo "  make setup ALLOW_BASE_SETUP=1"
	@echo ""
	@echo "Detaylı rehber: docs/project-usage.md"
	@echo ""

doctor:
	@MAKE_PYTHON_VAR='$(PYTHON)' $(PYTHON) -c "$$DOCTOR_PY"

setup:
	@ALLOW_BASE_SETUP=$(ALLOW_BASE_SETUP) $(PYTHON) -c "$$SETUP_GUARD_PY"
	@echo ""
	@echo "── Aktif ortama kurulum ──────────────────"
	@echo ""
	$(PIP) install --upgrade pip setuptools wheel
	$(PIP) install -r $(REQS_DEV)
	$(PIP) install -e $(ASL_ML_DIR)
	$(PIP) install -e $(ASL_DESKTOP_DIR)
	@echo ""
	@echo "✓ Kurulum tamam. Doğrulama: make doctor"
	@echo ""

web:
	@echo ""
	@echo "── Web demo başlatılıyor ─────────────────"
	@echo "URL    : http://localhost:$(PORT)"
	@echo "Klasör : $(WEB_DIR)/"
	@echo "Not    : Web demo Python ML paketleri GEREKTİRMEZ — sadece statik dosya."
	@echo "Durdur : Ctrl+C"
	@echo ""
	cd $(WEB_DIR) && $(PYTHON) -m http.server $(PORT)

frontend: web

backend:
	@echo ""
	@echo "── Backend ────────────────────────────────"
	@echo "Bu projede aktif backend yok. Ana ürün statik asl-web/ uygulamasıdır."
	@echo "Frontend için: make web"
	@echo "Python tarafı helper/script/test katmanıdır; servis olarak çalışmaz."
	@echo ""

test:
	@$(PYTHON) -c "import importlib.util, sys; missing=[m for m in ('asl_ml','asl_desktop') if importlib.util.find_spec(m) is None]; print('Eksik proje paketi: ' + ', '.join(missing) + '. Çözüm: make setup') or sys.exit(2) if missing else None"
	$(PYTEST) $(TEST_FAST)

test-full:
	@$(PYTHON) -c "import importlib.util, sys; missing=[m for m in ('asl_ml','asl_desktop') if importlib.util.find_spec(m) is None]; print('Eksik proje paketi: ' + ', '.join(missing) + '. Çözüm: make setup') or sys.exit(2) if missing else None"
	$(PYTEST) $(TEST_ALL)

validate:
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/core/app.js; else echo "not: node yok, app.js syntax kontrolü atlandı"; fi
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/media/camera.js; else echo "not: node yok, camera.js syntax kontrolü atlandı"; fi
	$(PYTHON) $(CHECK_RUNTIME)

validate-full: validate
	@echo ""
	$(PYTHON) $(VERIFY_ASSETS)

models: validate
	@echo ""
	@echo "✓ Deploy model/data artifact sözleşmeleri sağlıklı."

notebook-check:
	@echo ""
	@echo "── Notebook/provenance kontrolü ───────────"
	@test -f notebooks/train_word_model_final.ipynb
	@test -f notebooks/kelime-modeli-results.ipynb
	@test -d notebooks/results
	@test -f notebooks/results/word_model.onnx
	@test -f notebooks/results/word_to_idx.json
	@test -f notebooks/results/classification_report.txt
	@echo "✓ Kritik notebook ve results dosyaları yerinde."

scripts-check:
	@echo ""
	@echo "── Script entrypoint kontrolü ─────────────"
	@test -f scripts/validation/check_runtime_assets.py
	@test -f scripts/validation/verify_project_assets.py
	@test -f scripts/evaluation/download_kaggle_jury_subset.py
	@test -f scripts/evaluation/export_jury_word_samples.py
	@echo "✓ Kritik validation/evaluation scriptleri yerinde."

jury-fixtures:
	@echo ""
	@echo "── Jury word fixture export ───────────────"
	@echo "Kaggle subset: $(KAGGLE_DIR)"
	@echo "Samples/word : $(SAMPLES_PER_WORD)"
	$(PYTHON) scripts/evaluation/export_jury_word_samples.py --kaggle-dir $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)

health:
	@echo ""
	@echo "── Project health gate ───────────────────"
	@echo "Kapsam: JS syntax + runtime assets + provenance + parity + fast tests"
	@echo ""
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/ml/landmarks.js; else echo "not: node yok, landmarks.js syntax kontrolü atlandı"; fi
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/ml/features.js; else echo "not: node yok, features.js syntax kontrolü atlandı"; fi
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/media/camera.js; else echo "not: node yok, camera.js syntax kontrolü atlandı"; fi
	@if command -v node >/dev/null 2>&1; then node --check $(WEB_DIR)/js/core/app.js; else echo "not: node yok, app.js syntax kontrolü atlandı"; fi
	$(PYTHON) $(CHECK_RUNTIME)
	$(PYTHON) $(VERIFY_ASSETS)
	@$(MAKE) --no-print-directory notebook-check
	@$(MAKE) --no-print-directory scripts-check
	@if command -v node >/dev/null 2>&1 && [ -f tests/validation/check_word_feature_parity.py ]; then $(PYTHON) tests/validation/check_word_feature_parity.py; else echo "not: node yok veya script eksik, word parity atlandı"; fi
	@if command -v node >/dev/null 2>&1 && [ -f tests/validation/check_letter_feature_parity.py ]; then $(PYTHON) tests/validation/check_letter_feature_parity.py; else echo "not: node yok veya script eksik, letter parity atlandı"; fi
	PYTHONPATH="$(HEALTH_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)
	@echo ""
	@echo "✓ Project health OK"

docker:
	@echo ""
	@echo "── Docker ─────────────────────────────────"
	@echo "Bu repo için şu anda Dockerfile/docker-compose yok."
	@echo "Aktif demo statik web olduğu için önerilen yol: make web"
	@echo "İleride Docker eklenirse bu hedefler gerçek build/run komutlarına bağlanmalı."
	@echo ""

desktop:
	@echo ""
	@echo "── Desktop prototip (LEGACY) ─────────────"
	@echo "Not    : Aktif ürün asl-web/. Bu sadece referans/prototip."
	@echo "Şart   : Kamera izni + GUI (CustomTkinter) ortamı."
	@echo ""
	$(PYTHON) $(DESKTOP_ENTRY)

clean:
	@echo ""
	@echo "── Cache temizliği ────────────────────────"
	@find . -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name '.pytest_cache' -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name '*.pyc' -delete 2>/dev/null || true
	@echo "✓ Silindi : __pycache__, .pytest_cache, *.pyc"
	@echo ""
	@echo "Korunan   : data/, models/, asl-web/models/, asl-web/data/,"
	@echo "            notebooks/, .venv*, .gitignore, README'ler"
	@echo ""
