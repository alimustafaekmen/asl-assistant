# Changelog

This file records public, user-relevant changes. Internal work notes and
step-by-step refactor logs are intentionally kept out of the repository.

## Unreleased

### Documentation and repository hygiene

- Added separate web-only, Conda, and `venv` setup paths in English and
  Turkish, with Python 3.12 and Node 24 as the documented development contract.
- Added a portable `environment.yml` and `.node-version`; no personal local
  environment name is required by the repository.
- Reorganized public documentation into five purpose-specific files: index,
  getting started, architecture, models/data, and project journey.
- Focused the repository on maintained source, documentation, tests, and the
  artifacts required to run and validate the project.
- Added a Git hygiene check that fails when ignored files remain tracked.
- Removed the automatically added MIT declaration pending an explicit project
  licensing decision.
- Replaced machine-specific environment instructions with portable Conda and
  `.venv` workflows.
- Renamed event-specific fixture paths and commands to the neutral
  `model-test-samples` and `model-test-fixtures` terminology.
- Added a code-backed development history covering the desktop 25-word phase,
  the 50-word web model, unused approaches, results, and engineering fixes.
- Expanded the project journey with primary research context, experiment
  tradeoffs, transferable lessons, limitations, and reproducibility records.
- Aligned Pyright and package metadata with the Python 3.12 contract and
  removed the machine-specific macOS analysis target.
- Consolidated letter and word artifacts under `models/`, promoted the
  desktop 25-word V4 training record, and replaced duplicate word notebooks
  with clearly named 25- and 50-class records.

### Validation

- Made Node and full-project JavaScript syntax checks mandatory in the routine
  health gate instead of silently skipping them.
- Blocked dependency installation into shared Conda base environments and
  aligned exact requirement pins with package metadata.
- Kept runtime/provenance hash checks for both deployed ONNX models.
- Added static browser UI contract tests and repository guardrails.
- Added letter and word feature-parity diagnostics.

### Runtime maintenance

- Matched the desktop letter artifact to scikit-learn 1.8.0.
- Persisted a completed personalization calibration batch once instead of
  rewriting the profile file for every captured frame.
- Removed confirmed unused browser state, compatibility branches, and the
  unused runtime curriculum request while retaining the Kjua QR path.

## 0.1.0 — 2026

### Web application

- Added letter translation, learning coach, experimental word practice,
  deterministic Model Test, and QR Demo views.
- Deployed LightGBM and SignTransformer models through ONNX Runtime Web.
- Added MediaPipe hand, pose, and face landmark processing.
- Added mode-specific confidence handling, top-3 word output, confusion hints,
  local progress storage, and speech output.

### Model and data contracts

- Established the 93D letter and 45×168 word feature contracts.
- Standardized the word padding mask as `True = real frame`.
- Replaced the active letter ZipMap export with a tensor-probability ONNX
  artifact compatible with ONNX Runtime Web.
- Added deterministic fixtures and provenance hashes for deploy artifacts.

### Project structure

- Separated the active browser product, shared Python helpers, desktop
  prototype, model provenance, training notebooks, scripts, tests, and docs.
- Added Make targets for setup, serving, validation, tests, fixture export, and
  repository health checks.
