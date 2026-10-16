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
# -rs prints why each test was skipped. A skip is fine for an optional local
# dataset; one that names a file the repository tracks is a lost file.
PYTEST := $(PYTHON) -m pytest -rs


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

# Python ↔ JavaScript feature parity: 0 equal, 1 a mismatch, 2 cannot run.
PARITY_DIR     ?= tests/validation
WORD_PARITY    ?= $(PARITY_DIR)/check_word_feature_parity.py
LETTER_PARITY  ?= $(PARITY_DIR)/check_letter_feature_parity.py


# ── Lint/format kapsamı ──────────────────────────────────────
# Test kaynağı da ürün kaynağı kadar okunur ve bakılır; aynı kapıdan geçer.
RUFF_TARGETS   ?= asl-desktop asl-ml scripts tests

# Ortam teshisi ve setup politikasi; Makefile bunlari yalnizca cagirir.
TOOLING_DIR    ?= scripts/tooling


# ── Test seçimi ──────────────────────────────────────────────
TEST_FAST      ?= tests/asl_ml/ tests/asl_desktop/unit/ tests/project/ tests/scripts/
TEST_ALL       ?= tests/
TEST_PYTHONPATH  ?= $(CURDIR)/asl-ml/src:$(CURDIR)/asl-desktop/src


# ── Bağımlılık manifestoları ────────────────────────────────
REQS_DEV       ?= requirements-dev.txt
JS_FILES       := $(shell find $(WEB_DIR)/js -type f -name '*.js' -print 2>/dev/null | sort)
JS_TEST_FILES  := $(shell find tests/web -type f \( -name '*.test.js' -o -name '*.test.mjs' \) -print 2>/dev/null | sort)
TS_WEB_CONFIG  ?= tsconfig.web.json
TSC            ?= node_modules/.bin/tsc


# ── İleri kullanıcı kaçış kapısı ────────────────────────────


# ── PHONY hedefler ──────────────────────────────────────────
.PHONY: help doctor setup web frontend backend test test-full format format-check lint validate \
        validate-full deploy-check health check quick parity js-check js-test js-typecheck \
        test-web watch-web test-py browser-check models notebook-check \
        scripts-check model-test-fixtures git-hygiene docker desktop clean

.DEFAULT_GOAL := help


# ============================================================
#  Embedded Python helpers
# ============================================================
#  define ... endef ile multi-line Python script. export ile
#  shell environment'a aktarılır; recipe'larda $$VAR ile çağrılır.
#  Bu sayede inline tek-satır Python sınırlamasından kaçınılır.
# ============================================================


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
	@echo "  make quick           En hızlı döngü: lint + format-check + js-test (1 sn altı)"
	@echo "  make test-web FILE=tests/web/x.test.js NAME=desen   Tek dosya ve/veya test adı"
	@echo "  make watch-web FILE=...   Dosyalar değiştikçe web testlerini yeniden çalıştır"
	@echo "  make test-py FILE=tests/scripts/test_x.py K=desen   Tek dosya ve/veya pytest -k"
	@echo "  make validate        Web runtime asset/model/data sağlık kontrolü (hash chain + ONNX I/O)"
	@echo "  make validate-full   validate + dataset/Python script asset kontrolü"
	@echo "  make deploy-check    Her yüklemeden önce: validate + asl-web/ dosya envanteri"
	@echo "  make health          Düzenleme sonrası hızlı genel sağlık kapısı"
	@echo "  make check           Commit öncesi: health + js-typecheck (npm ci gerektirir)"
	@echo "  make browser-check   Gerçek Chrome ile CSS ve sayfa kontrolleri (OFFLINE=1: CDN'siz)"
	@echo "  make parity          Python ↔ JavaScript harf ve kelime feature eşitliği (Node gerekir)"
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
	@MAKE_PYTHON_VAR='$(PYTHON)' $(PYTHON) $(TOOLING_DIR)/doctor.py

setup:
	@$(PYTHON) $(TOOLING_DIR)/setup_guard.py
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
	$(PYTHON) -m ruff format $(RUFF_TARGETS)

format-check:
	$(PYTHON) -m ruff format --check $(RUFF_TARGETS)

lint:
	$(PYTHON) -m ruff check $(RUFF_TARGETS)

# node --check takes one file, so the checks run eight at a time. xargs exits
# non-zero when any of them fails, and printf before it cannot fail.
js-check:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript kontrolü çalıştırılamaz."; exit 1; }
	@test -n "$(JS_FILES)" || { echo "✗ $(WEB_DIR)/js altında JavaScript dosyası bulunamadı."; exit 1; }
	@printf '%s\n' $(JS_FILES) | xargs -n 1 -P 8 node --check
	@echo "✓ JavaScript syntax kontrolü tamamlandı ($$(printf '%s\n' $(JS_FILES) | wc -l | tr -d ' ') dosya)."

js-test:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript testleri çalıştırılamaz."; exit 1; }
	@test -n "$(JS_TEST_FILES)" || { echo "✗ tests/web altında JavaScript testi bulunamadı."; exit 1; }
	node --test $(JS_TEST_FILES)

# The inner loop. FILE narrows a run to one test file (or several, space
# separated) and NAME or K to the tests whose names match; without them these
# run what js-test and test run.
test-web:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript testleri çalıştırılamaz."; exit 1; }
	node --test $(if $(NAME),--test-name-pattern="$(NAME)") $(or $(FILE),$(JS_TEST_FILES))

watch-web:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript testleri çalıştırılamaz."; exit 1; }
	node --test --watch $(if $(NAME),--test-name-pattern="$(NAME)") $(or $(FILE),$(JS_TEST_FILES))

test-py:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(or $(FILE),$(TEST_FAST)) $(if $(K),-k "$(K)")

# Real-browser checks of what the Node context cannot see: the cascade layers,
# hidden and mode-only rules, the dark theme, horizontal overflow, the camera
# close control. It needs Chrome, so it stays out of health; without Chrome the
# runner exits 2 and so does this target.
browser-check:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; tarayıcı kontrolleri çalıştırılamaz."; exit 1; }
	node tests/browser/run.mjs $(if $(OFFLINE),--offline)

quick: lint format-check js-test
	@echo "✓ Quick OK (lint + format-check + js-test)"

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

# The upload is a drag-and-drop of asl-web/ as it is on disk, so this also fails
# on files the site must not carry. Not part of health: a development checkout
# may hold the local Model Test fixtures on purpose.
deploy-check: js-check
	$(PYTHON) $(CHECK_RUNTIME) --deploy

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

parity:
	$(PYTHON) $(WORD_PARITY)
	$(PYTHON) $(LETTER_PARITY)

health: lint format-check js-check js-test
	@echo ""
	@echo "── Project health gate ───────────────────"
	@echo "Kapsam: Git hygiene + JS syntax + JS modül testleri + runtime assets + provenance + parity + fast tests"
	@echo ""
	@$(MAKE) --no-print-directory git-hygiene
	$(PYTHON) $(CHECK_RUNTIME)
	$(PYTHON) $(VERIFY_ASSETS) --no-datasets
	@$(MAKE) --no-print-directory notebook-check
	@$(MAKE) --no-print-directory scripts-check
	@$(MAKE) --no-print-directory parity
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)
	@echo ""
	@echo "✓ Project health OK"

# The gate before a commit. health stays free of npm so it works in a fresh
# clone; the JSDoc type check needs `npm ci`, so it joins here instead.
check: health js-typecheck
	@echo "✓ Check OK (health + js-typecheck)"

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
