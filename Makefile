# ASL Assistant — developer shortcuts.
#
# Each target runs the command you would otherwise type by hand and changes no
# runtime behaviour. `make help` lists them; docs/getting-started.md explains
# them and gives the plain commands for shells without make.
#
# macOS, Linux, Git Bash and WSL run `make` directly. Native Windows shells
# ship no make.
#
# Messages and `make help` are Turkish, like the product UI. Code and comments
# are English.


# ── Interpreter ─────────────────────────────────────────────
# Prefer `python`: an activated conda or venv environment puts its own first.
# `python3` is the fallback only, because on macOS it can resolve to the Apple
# Command Line Tools interpreter, which has none of the project's packages.
PYTHON ?= $(shell command -v python >/dev/null 2>&1 && echo python || (command -v python3 >/dev/null 2>&1 && echo python3 || echo python))
PIP    := $(PYTHON) -m pip
# -rs prints why each test was skipped. A skip is fine for an optional local
# dataset; one that names a file the repository tracks is a lost file.
PYTEST := $(PYTHON) -m pytest -rs


# ── Paths and options ───────────────────────────────────────
WEB_DIR         ?= asl-web
ASL_ML_DIR      ?= ./asl-ml
ASL_DESKTOP_DIR ?= ./asl-desktop
DESKTOP_ENTRY   ?= asl-desktop/main.py
PORT            ?= 8080

# Optional Model Test fixtures. The Kaggle subset is downloaded by hand into an
# ignored folder, so a fresh clone does not have it (see model-test-fixtures).
KAGGLE_DIR       ?= data/raw/asl-signs-sample-subset
SAMPLES_PER_WORD ?= 1

VALIDATION_DIR ?= scripts/validation
CHECK_RUNTIME  ?= $(VALIDATION_DIR)/check_runtime_assets.py
VERIFY_ASSETS  ?= $(VALIDATION_DIR)/verify_project_assets.py

# Python <-> JavaScript feature parity: exit 0 equal, 1 a mismatch, 2 cannot run.
PARITY_DIR     ?= tests/validation
WORD_PARITY    ?= $(PARITY_DIR)/check_word_feature_parity.py
LETTER_PARITY  ?= $(PARITY_DIR)/check_letter_feature_parity.py

# Environment diagnosis and the setup policy live in Python, where they are
# tested; the Makefile only calls them.
TOOLING_DIR    ?= scripts/tooling

# Tests are read and maintained like product code, so they pass the same gate.
RUFF_TARGETS   ?= asl-desktop asl-ml scripts tests

# The desktop integration tests need MediaPipe and a model file, so they stay
# out of the fast set and run under test-full.
TEST_FAST        ?= tests/asl_ml/ tests/asl_desktop/unit/ tests/project/ tests/scripts/
TEST_ALL         ?= tests/
TEST_PYTHONPATH  ?= $(CURDIR)/asl-ml/src:$(CURDIR)/asl-desktop/src

REQS_DEV       ?= requirements-dev.txt
JS_FILES       := $(shell find $(WEB_DIR)/js -type f -name '*.js' -print 2>/dev/null | sort)
JS_TEST_FILES  := $(shell find tests/web -type f \( -name '*.test.js' -o -name '*.test.mjs' \) -print 2>/dev/null | sort)
TS_WEB_CONFIG  ?= tsconfig.web.json
TSC            ?= node_modules/.bin/tsc

# Tracked files that the word-model provenance depends on.
NOTEBOOK_ARTIFACTS ?= \
	notebooks/word_50_training.ipynb \
	notebooks/word_50_training_results.ipynb \
	notebooks/word_25_desktop_training.ipynb \
	notebooks/word_50_results \
	notebooks/word_50_results/classification_report.txt \
	models/word/web-50/word_model.onnx \
	models/word/web-50/word_labels.json \
	models/word/desktop-25/word_model.pt \
	models/word/desktop-25/word_labels.json


.PHONY: help doctor setup web health \
        quick test test-full test-py js-test test-web watch-web format desktop \
        lint format-check js-check js-typecheck parity validate validate-full \
        notebook-check git-hygiene check browser-check \
        deploy-check model-test-fixtures clean

.DEFAULT_GOAL := help


# ============================================================
#  Start here
# ============================================================

help:
	@echo ""
	@echo "ASL Assistant — make hedefleri"
	@echo "=============================="
	@echo ""
	@echo "Start here"
	@echo "  make help              Bu listeyi gösterir"
	@echo "  make doctor            Aktif Python ortamını kontrol eder (hiçbir şey kurmaz)"
	@echo "  make setup             Bağımlılıkları aktif ortama kurar (önce 'make doctor')"
	@echo "  make web               Web uygulamasını yerelde açar (http://localhost:8080; farklı port: PORT=8081)"
	@echo "  make health            Düzenleme sonrası hızlı sağlık kapısı (npm gerekmez)"
	@echo ""
	@echo "Everyday"
	@echo "  make quick             En hızlı döngü: lint + format-check + js-test"
	@echo "  make test              Hızlı Python testleri"
	@echo "  make test-full         Tüm Python testleri (entegrasyon dahil; MediaPipe gerekir)"
	@echo "  make test-py           Tek pytest dosyası ve/veya -k deseni (FILE=... K=...)"
	@echo "  make js-test           Web testlerinin tümü (node --test)"
	@echo "  make test-web          Tek web test dosyası ve/veya test adı (FILE=... NAME=...)"
	@echo "  make watch-web         Dosya değiştikçe web testlerini yeniden çalıştırır (FILE=...)"
	@echo "  make format            Python kaynaklarını Ruff ile biçimlendirir"
	@echo "  make desktop           Eski masaüstü prototipini başlatır (kamera + GUI gerekir)"
	@echo ""
	@echo "Checks"
	@echo "  make lint              Python sözdizimi, adlar ve import düzeni (Ruff)"
	@echo "  make format-check      Python biçimini değiştirmeden denetler"
	@echo "  make js-check          Web JavaScript dosyalarının sözdizimi (Node gerekir)"
	@echo "  make js-typecheck      JSDoc tür sözleşmeleri (bir kez 'npm ci' gerekir)"
	@echo "  make parity            Python ile JavaScript arasında harf ve kelime özellik eşitliği"
	@echo "  make validate          JS sözdizimi + web runtime dosyaları, hash zinciri, ONNX girdi/çıktıları"
	@echo "  make validate-full     validate + proje dosya denetimi ve yerel veri raporu"
	@echo "  make notebook-check    Notebook, model ve sonuç dosyaları yerinde mi?"
	@echo "  make git-hygiene       .gitignore ile eşleşen izlenen dosya var mı?"
	@echo "  make check             Commit öncesi: health + js-typecheck (npm ci gerekir)"
	@echo "  make browser-check     Gerçek Chrome ile CSS ve sayfa kontrolleri (OFFLINE=1: CDN'siz)"
	@echo ""
	@echo "Deploy"
	@echo "  make deploy-check      Her yüklemeden önce: validate + asl-web/ dosya envanteri"
	@echo ""
	@echo "Data and models"
	@echo "  make model-test-fixtures   İsteğe bağlı: indirilmiş Kaggle alt kümesinden Model Test örnekleri"
	@echo ""
	@echo "Maintenance"
	@echo "  make clean             Yalnızca önbellekleri siler; veri ve modellere dokunmaz"
	@echo ""
	@echo "Başka bir Python yorumlayıcısı için herhangi bir hedefe PYTHON=/yol/python ekleyin."
	@echo "Windows PowerShell/cmd'de make yoktur; elle komutlar: docs/getting-started.md"
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

# The web app is static files, so the standard library's server is enough.
web:
	@echo ""
	@echo "── Web uygulaması başlatılıyor ───────────"
	@echo "URL    : http://localhost:$(PORT)"
	@echo "Klasör : $(WEB_DIR)/"
	@echo "Not    : Python ML paketleri gerekmez; yalnızca statik dosyalar sunulur."
	@echo "Durdur : Ctrl+C"
	@echo ""
	cd $(WEB_DIR) && $(PYTHON) -m http.server $(PORT)

# health stays free of npm so it works in a fresh clone once the Python
# environment exists. The JSDoc type check needs `npm ci`, so it joins health
# in `check` instead.
health: lint format-check js-check js-test
	@echo ""
	@echo "── Project health gate ───────────────────"
	@echo "Kapsam: Git hygiene + JS syntax + JS modül testleri + runtime assets + provenance + parity + fast tests"
	@echo ""
	@$(MAKE) --no-print-directory git-hygiene
	$(PYTHON) $(CHECK_RUNTIME)
	$(PYTHON) $(VERIFY_ASSETS) --no-datasets
	@$(MAKE) --no-print-directory notebook-check
	@$(MAKE) --no-print-directory parity
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)
	@echo ""
	@echo "✓ Project health OK"


# ============================================================
#  Everyday
# ============================================================

quick: lint format-check js-test
	@echo "✓ Quick OK (lint + format-check + js-test)"

test:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)

test-full:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_ALL)

test-py:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(or $(FILE),$(TEST_FAST)) $(if $(K),-k "$(K)")

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

format:
	$(PYTHON) -m ruff format $(RUFF_TARGETS)

# The desktop app is the earlier prototype; the product is asl-web/.
desktop:
	@echo ""
	@echo "── Masaüstü prototipi (eski sürüm) ───────"
	@echo "Not    : Ürün asl-web/ klasörüdür; bu yalnızca bir prototiptir."
	@echo "Şart   : Kamera izni ve GUI (CustomTkinter) ortamı."
	@echo ""
	$(PYTHON) $(DESKTOP_ENTRY)


# ============================================================
#  Checks
# ============================================================

lint:
	$(PYTHON) -m ruff check $(RUFF_TARGETS)

format-check:
	$(PYTHON) -m ruff format --check $(RUFF_TARGETS)

# node --check takes one file, so the checks run eight at a time. xargs exits
# non-zero when any of them fails, and printf before it cannot fail.
js-check:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; JavaScript kontrolü çalıştırılamaz."; exit 1; }
	@test -n "$(JS_FILES)" || { echo "✗ $(WEB_DIR)/js altında JavaScript dosyası bulunamadı."; exit 1; }
	@printf '%s\n' $(JS_FILES) | xargs -n 1 -P 8 node --check
	@echo "✓ JavaScript syntax kontrolü tamamlandı ($$(printf '%s\n' $(JS_FILES) | wc -l | tr -d ' ') dosya)."

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

parity:
	$(PYTHON) $(WORD_PARITY)
	$(PYTHON) $(LETTER_PARITY)

validate: js-check
	$(PYTHON) $(CHECK_RUNTIME)

# The project asset audit also reports the optional local datasets. Missing
# ones are noted, not failed, so this works in a fresh clone.
validate-full: validate
	@echo ""
	$(PYTHON) $(VERIFY_ASSETS)

# Without this, a missing file shows only as `make` exiting 1.
notebook-check:
	@echo ""
	@echo "── Notebook/provenance kontrolü ───────────"
	@missing=0; \
	for path in $(NOTEBOOK_ARTIFACTS); do \
		[ -e "$$path" ] || { echo "✗ Eksik: $$path"; missing=1; }; \
	done; \
	[ "$$missing" -eq 0 ] || exit 1
	@echo "✓ Kritik notebook, model ve sonuç dosyaları yerinde."

# Compares against .gitignore and the repository's own exclude list, so it
# also catches a file that was added before its ignore rule.
git-hygiene:
	@echo ""
	@echo "── Git ignore / index hijyeni ────────────"
	@if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		echo "Not: Git bilgisi yok, izlenen-ama-ignore-edilen dosya denetimi atlandı."; \
	else \
		tracked_ignored="$$(git ls-files -ci --exclude-standard | while IFS= read -r path; do [ -e "$$path" ] && printf '%s\n' "$$path"; done)"; \
		if [ -n "$$tracked_ignored" ]; then \
			echo "✗ .gitignore ile eşleşen izlenen dosyalar var:"; \
			printf '%s\n' "$$tracked_ignored"; \
			echo "Çözüm: dosya politikasını doğrulayın; gerekiyorsa dizinden çıkarın (git rm --cached)."; \
			exit 1; \
		fi; \
		echo "✓ Ignore edilmesi gereken izlenen dosya yok."; \
	fi

# The gate before a commit.
check: health js-typecheck
	@echo "✓ Check OK (health + js-typecheck)"

# Real-browser checks of what the Node context cannot see: the cascade layers,
# hidden and mode-only rules, the dark theme, horizontal overflow, the camera
# close control. It needs Chrome, so it stays out of health; without Chrome the
# runner exits 2 and so does this target.
browser-check:
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js bulunamadı; tarayıcı kontrolleri çalıştırılamaz."; exit 1; }
	node tests/browser/run.mjs $(if $(OFFLINE),--offline)


# ============================================================
#  Deploy
# ============================================================

# The upload is a drag-and-drop of asl-web/ as it is on disk, so this also fails
# on files the site must not carry, such as Model Test fixtures exported with
# model-test-fixtures. Not part of health: a development checkout may hold
# those on purpose.
deploy-check: js-check
	$(PYTHON) $(CHECK_RUNTIME) --deploy


# ============================================================
#  Data and models
# ============================================================

# Optional. The Model Test panel works without these fixtures; they add real
# competition recordings and only make sense after downloading the Kaggle
# subset, whose rules forbid redistributing it. The export writes to an ignored
# folder under asl-web/data/model-test-samples/.
model-test-fixtures:
	@test -f "$(KAGGLE_DIR)/train.csv" || { \
		echo "✗ $(KAGGLE_DIR)/train.csv bulunamadı."; \
		echo "  Kaggle alt kümesi depoda yoktur. Yarışma kurallarını kabul edip Kaggle"; \
		echo "  kimlik bilgilerinizi ayarladıktan sonra indirin:"; \
		echo "  $(PYTHON) scripts/evaluation/download_kaggle_sample_subset.py --output $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)"; \
		echo "  Ayrıntı: docs/getting-started.md (Export Model Test fixtures)"; \
		exit 1; \
	}
	@echo ""
	@echo "── Model Test kelime örnekleri ────────────"
	@echo "Kaggle alt kümesi : $(KAGGLE_DIR)"
	@echo "Kelime başına     : $(SAMPLES_PER_WORD)"
	$(PYTHON) scripts/evaluation/export_model_test_word_samples.py --kaggle-dir $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)


# ============================================================
#  Maintenance
# ============================================================

clean:
	@echo ""
	@echo "── Önbellek temizliği ─────────────────────"
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -exec rm -rf {} + 2>/dev/null || true
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '.DS_Store' \) -delete 2>/dev/null || true
	@echo "✓ Silindi : proje önbellekleri, *.egg-info, *.py[co], .DS_Store"
	@echo ""
	@echo "Korunan   : data/, models/, asl-web/models/, asl-web/data/,"
	@echo "            notebooks/, .venv*, .git/, .gitignore, README'ler"
	@echo ""
