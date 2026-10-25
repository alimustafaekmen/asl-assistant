# ASL Assistant developer shortcuts.
#
# Each target runs the command you would otherwise type by hand and changes no
# runtime behaviour. `make help` lists them; docs/getting-started.md explains
# them and gives the plain commands for shells without make.
#
# macOS, Linux, Git Bash and WSL run `make` directly. Native Windows shells
# ship no make.
#
# Messages and `make help` are English, like the code and comments. Only the
# product UI is Turkish.


# Interpreter

# Prefer `python`: an activated conda or venv environment puts its own first.
# `python3` is the fallback only, because on macOS it can resolve to the Apple
# Command Line Tools interpreter, which has none of the project's packages.
PYTHON ?= $(shell command -v python >/dev/null 2>&1 && echo python || (command -v python3 >/dev/null 2>&1 && echo python3 || echo python))
PIP    := $(PYTHON) -m pip
# -rs prints why each test was skipped. A skip is fine for an optional local
# dataset; one that names a file the repository tracks is a lost file.
PYTEST := $(PYTHON) -m pytest -rs


# Paths and options

WEB_DIR          ?= asl-web
ASL_FEATURES_DIR ?= ./asl-features
ASL_DESKTOP_DIR  ?= ./asl-desktop
DESKTOP_ENTRY    ?= asl-desktop/main.py
PORT             ?= 8080

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
RUFF_TARGETS   ?= asl-desktop asl-features scripts tests

# The desktop integration tests need MediaPipe and a model file, so they stay
# out of the fast set and run under test-full.
TEST_FAST        ?= tests/asl_features/ tests/asl_desktop/unit/ tests/project/ tests/scripts/
TEST_ALL         ?= tests/
TEST_PYTHONPATH  ?= $(CURDIR)/asl-features/src:$(CURDIR)/asl-desktop/src

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


# Start here

help:
	@echo ""
	@echo "ASL Assistant: make targets"
	@echo "==========================="
	@echo ""
	@echo "Start here"
	@echo "  make help              Show this list"
	@echo "  make doctor            Check the active Python environment (installs nothing)"
	@echo "  make setup             Install the dependencies into the active environment (run 'make doctor' first)"
	@echo "  make web               Serve the web app locally (http://localhost:8080; another port: PORT=8081)"
	@echo "  make health            Fast health gate to run after an edit (no npm needed)"
	@echo ""
	@echo "Everyday"
	@echo "  make quick             Fastest loop: lint + format-check + js-test"
	@echo "  make test              Fast Python tests"
	@echo "  make test-full         All Python tests, integration included (needs MediaPipe)"
	@echo "  make test-py           One pytest file and/or a -k pattern (FILE=... K=...)"
	@echo "  make js-test           All web tests (node --test)"
	@echo "  make test-web          One web test file and/or test name (FILE=... NAME=...)"
	@echo "  make watch-web         Rerun the web tests whenever a file changes (FILE=...)"
	@echo "  make format            Format the Python sources with Ruff"
	@echo "  make desktop           Start the legacy desktop prototype (needs a camera and a GUI)"
	@echo ""
	@echo "Checks"
	@echo "  make lint              Python syntax, names and import order (Ruff)"
	@echo "  make format-check      Check the Python formatting without changing it"
	@echo "  make js-check          Syntax of the web JavaScript files (needs Node)"
	@echo "  make js-typecheck      JSDoc type contracts (needs 'npm ci' once)"
	@echo "  make parity            Letter and word feature parity between Python and JavaScript"
	@echo "  make validate          JS syntax + web runtime files, hash chain, ONNX inputs and outputs"
	@echo "  make validate-full     validate + the project asset audit and the local data report"
	@echo "  make notebook-check    Check that the notebook, model and result files are in place"
	@echo "  make git-hygiene       Check that no tracked file matches .gitignore"
	@echo "  make check             Before a commit: health + js-typecheck (needs npm ci)"
	@echo "  make browser-check     CSS and page checks in real Chrome (OFFLINE=1: no CDN; UI_LANG=en: English pages)"
	@echo ""
	@echo "Deploy"
	@echo "  make deploy-check      Before every upload: validate + the asl-web/ file inventory"
	@echo ""
	@echo "Data and models"
	@echo "  make model-test-fixtures   Optional: Model Test samples from a downloaded Kaggle subset"
	@echo ""
	@echo "Maintenance"
	@echo "  make clean             Delete caches only; data and models are left alone"
	@echo ""
	@echo "Add PYTHON=/path/to/python to any target to use another interpreter."
	@echo "Windows PowerShell and cmd have no make; the plain commands are in docs/getting-started.md"
	@echo ""

doctor:
	@MAKE_PYTHON_VAR='$(PYTHON)' $(PYTHON) $(TOOLING_DIR)/doctor.py

setup:
	@$(PYTHON) $(TOOLING_DIR)/setup_guard.py
	@echo ""
	@echo "── Setup in the active environment ───────"
	@echo ""
	$(PIP) install -r $(REQS_DEV)
	$(PIP) install --no-deps -e $(ASL_FEATURES_DIR)
	$(PIP) install --no-deps -e $(ASL_DESKTOP_DIR)
	@echo ""
	@echo "Setup done. To check it: make doctor"
	@echo ""

# The web app is static files, so the standard library's server is enough.
web:
	@echo ""
	@echo "── Starting the web app ──────────────────"
	@echo "URL    : http://localhost:$(PORT)"
	@echo "Folder : $(WEB_DIR)/"
	@echo "Note   : no Python ML package is needed; only static files are served."
	@echo "Stop   : Ctrl+C"
	@echo ""
	cd $(WEB_DIR) && $(PYTHON) -m http.server $(PORT)

# health stays free of npm so it works in a fresh clone once the Python
# environment exists. The JSDoc type check needs `npm ci`, so it joins health
# in `check` instead.
health: lint format-check js-check js-test
	@echo ""
	@echo "── Project health gate ───────────────────"
	@echo "Scope: Git hygiene + JS syntax + JS module tests + runtime assets + provenance + parity + fast tests"
	@echo ""
	@$(MAKE) --no-print-directory git-hygiene
	$(PYTHON) $(CHECK_RUNTIME)
	$(PYTHON) $(VERIFY_ASSETS) --no-datasets
	@$(MAKE) --no-print-directory notebook-check
	@$(MAKE) --no-print-directory parity
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)
	@echo ""
	@echo "Project health OK"


# Everyday

quick: lint format-check js-test
	@echo "Quick OK (lint + format-check + js-test)"

test:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_FAST)

test-full:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(TEST_ALL)

test-py:
	PYTHONPATH="$(TEST_PYTHONPATH):$$PYTHONPATH" $(PYTEST) $(or $(FILE),$(TEST_FAST)) $(if $(K),-k "$(K)")

js-test:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the JavaScript tests cannot run."; exit 1; }
	@test -n "$(JS_TEST_FILES)" || { echo "ERROR: no JavaScript test found under tests/web."; exit 1; }
	node --test $(JS_TEST_FILES)

# The inner loop. FILE narrows a run to one test file (or several, space
# separated) and NAME or K to the tests whose names match; without them these
# run what js-test and test run.
test-web:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the JavaScript tests cannot run."; exit 1; }
	node --test $(if $(NAME),--test-name-pattern="$(NAME)") $(or $(FILE),$(JS_TEST_FILES))

watch-web:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the JavaScript tests cannot run."; exit 1; }
	node --test --watch $(if $(NAME),--test-name-pattern="$(NAME)") $(or $(FILE),$(JS_TEST_FILES))

format:
	$(PYTHON) -m ruff format $(RUFF_TARGETS)

# The desktop app is the earlier prototype; the product is asl-web/.
desktop:
	@echo ""
	@echo "── Desktop prototype (legacy) ────────────"
	@echo "Note   : the product is asl-web/; this is only a prototype."
	@echo "Needs  : camera permission and a GUI (CustomTkinter) session."
	@echo ""
	$(PYTHON) $(DESKTOP_ENTRY)


# Checks

lint:
	$(PYTHON) -m ruff check $(RUFF_TARGETS)

format-check:
	$(PYTHON) -m ruff format --check $(RUFF_TARGETS)

# node --check takes one file, so the checks run eight at a time. xargs exits
# non-zero when any of them fails, and printf before it cannot fail.
js-check:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the JavaScript check cannot run."; exit 1; }
	@test -n "$(JS_FILES)" || { echo "ERROR: no JavaScript file found under $(WEB_DIR)/js."; exit 1; }
	@printf '%s\n' $(JS_FILES) | xargs -n 1 -P 8 node --check
	@echo "JavaScript syntax check passed ($$(printf '%s\n' $(JS_FILES) | wc -l | tr -d ' ') files)."

js-typecheck:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the type check cannot run."; exit 1; }
	@test -x "$(TSC)" || { \
		echo "ERROR: TypeScript is not installed."; \
		echo "  It is a developer tool only; install it into the project with: npm ci"; \
		echo "  The web app and 'make health' do not need it."; \
		exit 1; \
	}
	$(TSC) --project $(TS_WEB_CONFIG)
	@echo "JSDoc type check passed (checkJs, no-emit, $(TS_WEB_CONFIG))."

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
	@echo "── Notebook and provenance check ─────────"
	@missing=0; \
	for path in $(NOTEBOOK_ARTIFACTS); do \
		[ -e "$$path" ] || { echo "Missing: $$path"; missing=1; }; \
	done; \
	[ "$$missing" -eq 0 ] || exit 1
	@echo "The key notebook, model and result files are in place."

# Compares against .gitignore and the repository's own exclude list, so it
# also catches a file that was added before its ignore rule.
git-hygiene:
	@echo ""
	@echo "── Git ignore and index hygiene ──────────"
	@if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		echo "Note: no Git information; the check for tracked but ignored files was skipped."; \
	else \
		tracked_ignored="$$(git ls-files -ci --exclude-standard | while IFS= read -r path; do [ -e "$$path" ] && printf '%s\n' "$$path"; done)"; \
		if [ -n "$$tracked_ignored" ]; then \
			echo "ERROR: tracked files match .gitignore:"; \
			printf '%s\n' "$$tracked_ignored"; \
			echo "Fix: check the file policy; if needed, remove them from the index (git rm --cached)."; \
			exit 1; \
		fi; \
		echo "No tracked file matches .gitignore."; \
	fi

# The gate before a commit.
check: health js-typecheck
	@echo "Check OK (health + js-typecheck)"

# Real-browser checks of what the Node context cannot see: the cascade layers,
# hidden and mode-only rules, the dark theme, horizontal overflow, the camera
# close control. It needs Chrome, so it stays out of health; without Chrome the
# runner exits 2 and so does this target.
browser-check:
	@command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found; the browser checks cannot run."; exit 1; }
	node tests/browser/run.mjs $(if $(OFFLINE),--offline) $(if $(UI_LANG),--lang $(UI_LANG))


# Deploy

# The upload is a drag-and-drop of asl-web/ as it is on disk, so this also fails
# on files the site must not carry, such as Model Test fixtures exported with
# model-test-fixtures. Not part of health: a development checkout may hold
# those on purpose.
deploy-check: js-check
	$(PYTHON) $(CHECK_RUNTIME) --deploy


# Data and models

# Optional. The Model Test panel works without these fixtures; they add real
# competition recordings and only make sense after downloading the Kaggle
# subset, whose rules forbid redistributing it. The export writes to an ignored
# folder under asl-web/data/model-test-samples/.
model-test-fixtures:
	@test -f "$(KAGGLE_DIR)/train.csv" || { \
		echo "ERROR: $(KAGGLE_DIR)/train.csv not found."; \
		echo "  The Kaggle subset is not in the repository. Accept the competition rules,"; \
		echo "  set up your Kaggle credentials, then download it:"; \
		echo "  $(PYTHON) scripts/evaluation/download_kaggle_sample_subset.py --output $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)"; \
		echo "  Details: docs/getting-started.md (Export Model Test fixtures)"; \
		exit 1; \
	}
	@echo ""
	@echo "── Model Test word samples ───────────────"
	@echo "Kaggle subset    : $(KAGGLE_DIR)"
	@echo "Samples per word : $(SAMPLES_PER_WORD)"
	$(PYTHON) scripts/evaluation/export_model_test_word_samples.py --kaggle-dir $(KAGGLE_DIR) --samples-per-word $(SAMPLES_PER_WORD)


# Maintenance

clean:
	@echo ""
	@echo "── Cache cleanup ─────────────────────────"
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -exec rm -rf {} + 2>/dev/null || true
	@find . \( -path './.git' -o -path './.venv*' \) -prune -o -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '.DS_Store' \) -delete 2>/dev/null || true
	@echo "Deleted : project caches, *.egg-info, *.py[co], .DS_Store"
	@echo ""
	@echo "Kept    : data/, models/, asl-web/models/, asl-web/data/,"
	@echo "          notebooks/, .venv*, .git/, .gitignore, the READMEs"
	@echo ""
