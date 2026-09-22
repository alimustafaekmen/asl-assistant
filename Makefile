# ============================================================
#  ASL Sign Language Assistant — Makefile
# ============================================================
#  Günlük dev workflow için kısa kestirmeler.
#  Sınıf: SAFE-TOOLING — runtime davranışını DEĞİŞTİRMEZ.
#  Her hedef arkasındaki manuel komutla birebir aynı işi yapar.
#
#  Detaylı kullanım rehberi: docs/getting-started.md
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
#      Manuel komutlar: docs/getting-started.md
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
KAGGLE_DIR     ?= data/raw/asl-signs-sample-subset
SAMPLES_PER_WORD ?= 1


# ── Validation script yolları ───────────────────────────────
VALIDATION_DIR ?= scripts/validation
CHECK_RUNTIME  ?= $(VALIDATION_DIR)/check_runtime_assets.py
VERIFY_ASSETS  ?= $(VALIDATION_DIR)/verify_project_assets.py


# ── Test seçimi ──────────────────────────────────────────────
TEST_FAST      ?= tests/asl_ml/ tests/asl_desktop/unit/ tests/project/
TEST_ALL       ?= tests/
TEST_PYTHONPATH  ?= $(CURDIR)/asl-ml/src:$(CURDIR)/asl-desktop/src


# ── Bağımlılık manifestoları ────────────────────────────────
REQS_DEV       ?= requirements-dev.txt
JS_FILES       := $(shell find $(WEB_DIR)/js -type f -name '*.js' -print 2>/dev/null | sort)
JS_TEST_FILES  := $(shell find tests/web -type f -name '*.test.js' -print 2>/dev/null | sort)
TS_WEB_CONFIG  ?= tsconfig.web.json
TSC            ?= node_modules/.bin/tsc


# ── İleri kullanıcı kaçış kapısı ────────────────────────────


# ── PHONY hedefler ──────────────────────────────────────────
.PHONY: help doctor setup web frontend backend test test-full format format-check lint validate \
        validate-full health js-check js-test js-typecheck models notebook-check scripts-check \
        model-test-fixtures git-hygiene docker desktop clean

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
        '    Conda : conda activate YOUR_ENV_NAME && make setup',
        '    venv  : python3 -m venv .venv && source .venv/bin/activate && make setup',
        '    Override: make setup PYTHON=$$CONDA_PREFIX/bin/python',
    ])
if is_base:
    warnings.append([
        'UYARI: Conda/Miniforge base Python kullaniliyor.',
        '  Bu proje icin "make setup" base ortamiyla onerilmez ve default olarak BLOKLANIR.',
        '  Sebep: base ortami bircok proje tarafindan paylasilir, kolay kirlenir.',
        '  Proje ortamini aktive et:',
        '    conda activate YOUR_ENV_NAME  # kendi ortam adinizi kullanin',
        '  veya yeni venv:',
        '    python3 -m venv .venv && source .venv/bin/activate && make setup',
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
        '  PowerShell/cmd icin manuel komutlar: docs/getting-started.md',
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
    print('  conda activate YOUR_ENV_NAME')
    print('  make doctor')
    print()
    print('Eger hala yanlissa:')
    print('  make doctor PYTHON=$$CONDA_PREFIX/bin/python')

elif state == 'base':
    print('  Conda/Miniforge base ortam kullaniliyor. Bu proje icin ONERILMEZ.')
    print()
    print('Cozum:')
    print('  conda activate YOUR_ENV_NAME')
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
is_base = is_conda_base(exe, cp, ce)

err = None
if is_apple_clt:
    err = (
        '[BLOCK] Apple CommandLineTools Python ile setup CALISTIRILAMAZ.\n'
        f'  sys.executable = {exe}\n'
        '  Bu Python ile editable install basarisiz olur veya yanlis environment kirlenir.\n'
        '  Cozum:\n'
        '    Conda    : conda activate YOUR_ENV_NAME && make setup\n'
        '    venv     : python3 -m venv .venv && source .venv/bin/activate && make setup\n'
        '    Override : make setup PYTHON=$$CONDA_PREFIX/bin/python'
    )
elif is_base:
    err = (
        '[BLOCK] Conda/Miniforge base Python ile setup CALISTIRILAMAZ.\n'
        f'  sys.executable    = {exe}\n'
        f'  CONDA_DEFAULT_ENV = {ce or "(bos)"}\n'
        f'  CONDA_PREFIX      = {cp or "(bos)"}\n'
        '\n'
        '  Bu proje icin izole ortam kullan:\n'
        '    conda activate YOUR_ENV_NAME  # kendi ortam adinizi kullanin\n'
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
	@echo "  make format          Python kaynaklarını Ruff ile biçimlendir"
	@echo "  make format-check    Python biçimini değiştirmeden doğrula"
	@echo "  make lint            Python sözdizimi, adlar ve import düzenini denetle"
	@echo "  make js-check        Tüm web JavaScript dosyalarının sözdizimini denetle"
	@echo "  make js-test         Web modül sözleşmelerini node --test ile doğrula"
	@echo "  make js-typecheck    JSDoc sözleşmelerini checkJs ile denetle (npm ci gerektirir)"
	@echo "  make validate        Web runtime asset/model/data sağlık kontrolü (hash chain + ONNX I/O)"
	@echo "  make validate-full   validate + dataset/Python script asset kontrolü"
	@echo "  make health          Düzenleme sonrası hızlı genel sağlık kapısı"
	@echo "  make models          Deploy model/data artifact sağlık kontrolü"
	@echo "  make notebook-check  Kritik notebook, model ve sonuç dosyaları yerinde mi?"
	@echo "  make scripts-check   Önemli script entrypoint'leri yerinde mi?"
	@echo "  make git-hygiene     Ignore edilmesi gereken tracked dosya var mı?"
	@echo "  make model-test-fixtures  Lokal Kaggle subset'ten Model Test kelime fixture export"
	@echo "  make docker          Dockerfile yoksa güvenli açıklama verir"
	@echo "  make desktop         Legacy masaüstü prototipini başlat (kamera + GUI gerekli)"
	@echo "  make clean           Sadece cache (__pycache__, .pytest_cache, *.pyc) — data/model SILINMEZ"
	@echo ""
	@echo "Cross-platform:"
	@echo "  macOS/Linux/Git Bash/WSL : doğrudan 'make ...' çalışır"
	@echo "  Windows PowerShell/cmd   : manuel komutlar → docs/getting-started.md"
	@echo ""
	@echo "Yanlış Python ortamı şüphesi:"
	@echo "  make doctor                                    # platform + ortam raporu"
	@echo "  make doctor PYTHON=\$$CONDA_PREFIX/bin/python   # conda override"
	@echo "  make setup  PYTHON=\$$CONDA_PREFIX/bin/python   # setup conda override"
	@echo ""
	@echo "Setup BLOCK eden ortamlar:"
	@echo "  - Apple CommandLineTools Python"
	@echo "  - Conda/Miniforge base ortamı (proje env aktive edilmeli)"
	@echo "  - Conda/venv mismatch durumları"
	@echo ""
	@echo "Detaylı rehber: docs/getting-started.md"
	@echo ""

doctor:
	@MAKE_PYTHON_VAR='$(PYTHON)' $(PYTHON) -c "$$DOCTOR_PY"

setup:
	@$(PYTHON) -c "$$SETUP_GUARD_PY"
	@echo ""
	@echo "── Aktif ortama kurulum ──────────────────"
	@echo ""
	$(PIP) install -r $(REQS_DEV)
	$(PIP) install --no-deps -e $(ASL_ML_DIR)
	$(PIP) install --no-deps -e $(ASL_DESKTOP_DIR)
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
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)

test-full:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_ALL)

format:
	$(PYTHON) -m ruff format asl-desktop asl-ml scripts

format-check:
	$(PYTHON) -m ruff format --check asl-desktop asl-ml scripts

lint:
	$(PYTHON) -m ruff check asl-desktop asl-ml scripts

js-check:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript kontrolü çalıştırılamaz."; exit 1; }
	@test -n "$(JS_FILES)" || { echo "✗ $(WEB_DIR)/js altında JavaScript dosyası bulunamadı."; exit 1; }
	@for file in $(JS_FILES); do node --check "$$file" || exit 1; done
	@echo "✓ JavaScript syntax kontrolü tamamlandı ($$(printf '%s\n' $(JS_FILES) | wc -l | tr -d ' ') dosya)."

js-test:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript testleri çalıştırılamaz."; exit 1; }
	@test -n "$(JS_TEST_FILES)" || { echo "✗ tests/web altında JavaScript testi bulunamadı."; exit 1; }
	node --test $(JS_TEST_FILES)

js-typecheck:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; tip kontrolü çalıştırılamaz."; exit 1; }
	@test -x "$(TSC)" || { \
		echo "✗ TypeScript kurulu değil."; \
		echo "  Bu yalnız geliştirici aracıdır; proje-yerel kurulum: npm ci"; \
		echo "  Web uygulaması ve 'make health' bu paketi gerektirmez."; \
		exit 1; \
	}
	$(TSC) --project $(TS_WEB_CONFIG)
	@echo "✓ JSDoc tip kontrolü tamamlandı (checkJs, no-emit, $(TS_WEB_CONFIG))."

validate: js-check
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
	@test -f notebooks/word_50_training.ipynb
	@test -f notebooks/word_50_training_results.ipynb
	@test -f notebooks/word_25_desktop_training.ipynb
	@test -d notebooks/word_50_results
	@test -f models/word/web-50/word_model.onnx
	@test -f models/word/web-50/word_labels.json
	@test -f models/word/desktop-25/word_model.pt
	@test -f models/word/desktop-25/word_labels.json
	@test -f notebooks/word_50_results/classification_report.txt
	@echo "✓ Kritik notebook, model ve sonuç dosyaları yerinde."

scripts-check:
	@echo ""
	@echo "── Script entrypoint kontrolü ─────────────"
	@test -f scripts/validation/check_runtime_assets.py
	@test -f scripts/validation/verify_project_assets.py
	@test -f scripts/evaluation/download_kaggle_sample_subset.py
	@test -f scripts/evaluation/export_model_test_word_samples.py
	@echo "✓ Kritik validation/evaluation scriptleri yerinde."

git-hygiene:
	@echo ""
	@echo "── Git ignore / index hijyeni ────────────"
	@if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		echo "not: Git metadata yok, tracked-ignore kontrolu atlandi"; \
	else \
		tracked_ignored="$$(git ls-files -ci --exclude-standard | while IFS= read -r path; do [ -e "$$path" ] && printf '%s\n' "$$path"; done)"; \
		if [ -n "$$tracked_ignored" ]; then \
			echo "✗ .gitignore ile eslesen tracked dosyalar var:"; \
			printf '%s\n' "$$tracked_ignored"; \
			echo "Cozum: dosya politikasini dogrula; gerekiyorsa Git gecmisinden/index'ten cikar."; \
			exit 1; \
		fi; \
		echo "✓ Ignore edilmesi gereken tracked dosya yok."; \
	fi

model-test-fixtures:
	@echo ""
	@echo "── Model Test word fixture export ─────────"
	@echo "Kaggle subset: $(KAGGLE_DIR)"
	@echo "Samples/word : $(SAMPLES_PER_WORD)"
	$(PYTHON) scripts/evaluation/export_model_test_word_samples.py --kaggle-dir $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)

health: lint format-check js-check js-test
	@echo ""
	@echo "── Project health gate ───────────────────"
	@echo "Kapsam: Git hygiene + JS syntax + JS modül testleri + runtime assets + provenance + parity + fast tests"
	@echo ""
	@$(MAKE) --no-print-directory git-hygiene
	$(PYTHON) $(CHECK_RUNTIME)
	$(PYTHON) $(VERIFY_ASSETS)
	@$(MAKE) --no-print-directory notebook-check
	@$(MAKE) --no-print-directory scripts-check
	$(PYTHON) tests/validation/check_word_feature_parity.py
	$(PYTHON) tests/validation/check_letter_feature_parity.py
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)
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
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -exec rm -rf {} + 2>/dev/null || true
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '.DS_Store' \) -delete 2>/dev/null || true
	@echo "✓ Silindi : proje cache'leri, *.egg-info, *.py[co], .DS_Store"
	@echo ""
	@echo "Korunan   : data/, models/, asl-web/models/, asl-web/data/,"
	@echo "            notebooks/, .venv*, .git/, .gitignore, README'ler"
	@echo ""
