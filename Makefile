# ASL Assistant developer commands. `make help` lists them.

# `python` first: an activated conda or venv environment puts its own there,
# while `python3` on macOS can be Apple's interpreter without the packages.
PYTHON ?= $(shell command -v python >/dev/null 2>&1 && echo python || echo python3)
PORT   ?= 8080
TSC    ?= node_modules/.bin/tsc

WEB_DIR       := asl-web
RUFF_TARGETS  := asl-desktop asl-features scripts tests
CHECK_RUNTIME := scripts/validation/check_runtime_assets.py

# The desktop integration tests need MediaPipe and a camera model, so they
# are left out; run them with pytest tests/asl_desktop/integration.
PYTEST_FAST := tests/asl_features/ tests/asl_desktop/unit/ tests/project/ tests/scripts/
PYTHONPATHS := $(CURDIR)/asl-features/src:$(CURDIR)/asl-desktop/src

JS_FILES := $(shell find $(WEB_DIR)/js -type f -name '*.js' | sort)
JS_TESTS := $(shell find tests/web -type f \( -name '*.test.js' -o -name '*.test.mjs' \) | sort)

.PHONY: help setup web format test check browser-check
.DEFAULT_GOAL := help

help:
	@echo "Setup"
	@echo "  make setup          install the dependencies into the active Python environment"
	@echo "  make web            serve asl-web/ at http://localhost:$(PORT) (PORT=...)"
	@echo ""
	@echo "Develop"
	@echo "  make format         format the Python sources"
	@echo "  make test           Python and web tests, Python/JavaScript parity"
	@echo "  make check          lint, formatting, JS syntax and types, runtime files, then test"
	@echo "  make browser-check  page checks in headless Chrome (OFFLINE=1, UI_LANG=en)"

setup:
	$(PYTHON) scripts/tooling/setup_guard.py
	$(PYTHON) -m pip install -r requirements-dev.txt
	$(PYTHON) -m pip install --no-deps -e ./asl-features -e ./asl-desktop

web:
	cd $(WEB_DIR) && $(PYTHON) -m http.server $(PORT)

format:
	$(PYTHON) -m ruff format $(RUFF_TARGETS)

test:
	PYTHONPATH="$(PYTHONPATHS):$$PYTHONPATH" $(PYTHON) -m pytest -rs $(PYTEST_FAST)
	node --test $(JS_TESTS)
	$(PYTHON) tests/validation/check_word_feature_parity.py
	$(PYTHON) tests/validation/check_letter_feature_parity.py
	$(PYTHON) tests/validation/check_letter_model_parity.py

# The type check needs `npm ci` once; the web app itself installs nothing.
check:
	$(PYTHON) -m ruff check $(RUFF_TARGETS)
	$(PYTHON) -m ruff format --check $(RUFF_TARGETS)
	@printf '%s\n' $(JS_FILES) | xargs -n 1 -P 8 node --check
	$(TSC) --project tsconfig.web.json
	$(PYTHON) $(CHECK_RUNTIME)
	@$(MAKE) --no-print-directory test

browser-check:
	node tests/browser/run.mjs $(if $(OFFLINE),--offline) $(if $(UI_LANG),--lang $(UI_LANG))

