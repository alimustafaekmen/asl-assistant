# Documentation

<sub>Location: [`asl-assistant`](../README.md) / `docs`</sub>

<sub>Related: [`docs/getting-started.md`](getting-started.md) · [`docs/architecture.md`](architecture.md) · [`docs/models-and-data.md`](models-and-data.md) · [`TECHNICAL_REPORT.md`](../TECHNICAL_REPORT.md)</sub>

The root README introduces the project. Each document below answers one kind of
question in depth, and each part of the repository has a README next to its
files.

## Documents

| Document | For | What it covers |
|---|---|---|
| [README](../README.md) ([Türkçe](../README.tr.md)) | Everyone, first | What the project is, what each mode does, how it works, quick start, limits, licence and data attribution. |
| [Getting started](getting-started.md) | People who want to run the app, and developers setting up | Running the web app, setting up Python and Node, the `make` commands, the desktop prototype, Model Test fixtures, deploying, and fixing common problems. |
| [Başlangıç rehberi](getting-started.tr.md) | Turkish readers | The getting-started guide in Turkish. |
| [Architecture](architecture.md) | Developers changing the code | Repository layout, the browser modules and their load order, screens and routes, the letter and word pipelines, the camera lifecycle, configuration, where deployed files come from, and failure modes. |
| [Models and data](models-and-data.md) | ML developers and reviewers | Data sources and licences, splits, feature order, ONNX inputs and outputs, labels, runtime JSON files, provenance and the safe update procedure. |
| [Project journey](project-journey.md) | Anyone who wants to know why the project looks the way it does, and builders of similar systems | The story from desktop prototype to browser app: the experiments, what went wrong and why, lessons, and the current limits. |
| [Technical report](../TECHNICAL_REPORT.md) | Reviewers and engineers who want the whole system in one place | Architecture and design, technologies, data and pipeline, models and experiments, decisions and their alternatives, verification, results and limits. |
| [Teknik rapor](../TECHNICAL_REPORT.tr.md) | Turkish readers | The technical report in Turkish. |

## Component READMEs

| README | Purpose |
|---|---|
| [`asl-web/`](../asl-web/README.md) | The web application: running it locally, its modes, configuration, the Model Test fixture format, keyboard shortcuts and deployment. |
| [`asl-web/js/`](../asl-web/js/README.md) | The browser scripts: load order, module map, where new code goes, and the DOM, type and model contracts. |
| [`asl-web/data/model-test-samples/words/`](../asl-web/data/model-test-samples/words/README.md) | The one synthetic word fixture, which checks the pipeline rather than accuracy, and how to create real ones locally. |
| [`asl-features/`](../asl-features/README.md) | The shared Python feature code: landmark normalization, the 93-value letter features and the 45 × 168 word features. |
| [`asl-desktop/`](../asl-desktop/README.md) | The desktop prototype: what it does, how it is organised, and how to install, run and test it. |
| [`models/`](../models/README.md) | The source copy of every published model, and how the browser copies are checked against it. |
| [`models/letter/`](../models/letter/README.md) | The LightGBM letter model: its input and output, held-out accuracy, files and the ZipMap rule for its ONNX export. |
| [`models/word/`](../models/word/README.md) | The two word models, `web-50` and `desktop-25`, and why one cannot stand in for the other. |
| [`notebooks/`](../notebooks/README.md) | The word-model training notebooks and what each one is for. |
| [`notebooks/word_50_results/`](../notebooks/word_50_results/README.md) | Metrics, reports, figures and runtime JSON from the final 50-word run. |
| [`data/`](../data/README.md) | The local data workspace: which datasets trained the published models, which were only explored, and what may be committed. |
| [`scripts/`](../scripts/README.md) | The command-line tools around the models, their common commands and exit codes. |
| [`scripts/data_preparation/`](../scripts/data_preparation/README.md) | Turning downloaded image and video datasets into landmark tables. |
| [`scripts/model_training/`](../scripts/model_training/README.md) | Training the letter model, the split it uses, and the experimental J and Z trainer. |
| [`scripts/evaluation/`](../scripts/evaluation/README.md) | Exporting feature goldens and Model Test fixtures; none of it is an accuracy measurement. |
| [`scripts/validation/`](../scripts/validation/README.md) | The checks that deployed files match their sources and that the ONNX models accept and return what the JavaScript expects. |
| [`scripts/tooling/`](../scripts/tooling/README.md) | The environment diagnosis behind `make doctor` and `make setup`. |
| [`tests/`](../tests/README.md) | The four test layers and what each `make` gate runs. |
| [`tests/browser/`](../tests/browser/README.md) | The headless-Chrome checks for what only a real browser can decide. |

## Documentation rules

- Code and the metadata exported with each artifact win over prose.
- A metric names its dataset and evaluation scope. Browser fixtures are
  regression samples, not a replacement for held-out evaluation.
- Letter and word recognition are different tasks. A claim, threshold or
  reliability statement for one does not carry over to the other without
  evidence.
- A change to feature order, labels, ONNX inputs or outputs, runtime JSON, or
  an artifact's source updates [Models and data](models-and-data.md) in the
  same commit.
