# Documentation

Start with the root [README](../README.md) for what the project is and what it
can do. The documents here go into detail, one purpose each.

| Document | For | What it covers |
|---|---|---|
| [Getting started](getting-started.md) | Users and developers | Running the web app, setting up Python and Node, the `make` commands, deploying, and fixing common problems. |
| [Başlangıç rehberi](getting-started.tr.md) | Kullanıcılar ve geliştiriciler | The same guide in Turkish. |
| [Architecture](architecture.md) | Developers | Repository layout, the browser modules and their load order, the letter and word pipelines, the camera lifecycle, artifact ownership and failure modes. |
| [Models and data](models-and-data.md) | ML developers and reviewers | Feature order, ONNX inputs and outputs, labels, runtime JSON files, evaluation scope, data sources and licences. |
| [Project journey](project-journey.md) | Researchers and contributors | How the project moved from a desktop prototype to the browser, which experiments were tried, what went wrong, and the known limits. |
| [Data workspace](../data/README.md) | ML developers | Which datasets trained the published models, which were only explored, and what stays out of Git. |

Each part of the repository also has its own README:

| Folder | Notes |
|---|---|
| [`asl-web/`](../asl-web/README.md) | The web application: running it, settings, the Model Test fixture format. |
| [`asl-web/js/`](../asl-web/js/README.md) | Script load order, module map, markup contracts, type contracts. |
| [`asl-ml/`](../asl-ml/README.md) | Shared Python feature code. |
| [`asl-desktop/`](../asl-desktop/README.md) | The legacy desktop prototype. |
| [`models/`](../models/README.md) | The curated model files and their metadata. |
| [`notebooks/`](../notebooks/README.md) | Word-model training notebooks and results. |
| [`scripts/`](../scripts/README.md) | Data preparation, training, evaluation, validation and environment tools. |
| [`tests/`](../tests/README.md) | Test layout, what each gate runs, and the [browser checks](../tests/browser/README.md). |

## Where to start

- To try the application: README, then Getting started.
- To change browser code: Architecture, then the notes in `asl-web/js/`.
- To inspect or replace a model: Models and data, then the training and
  validation scripts it names.
- To see where the data came from: Data workspace, then Models and data.
- To understand why the project looks the way it does: Project journey.

## Documentation rules

- Code and the metadata exported with each artifact win over prose.
- A metric names its dataset and evaluation scope. Browser fixtures are
  regression samples, not a replacement for held-out evaluation.
- Letter and word recognition are different tasks. Claims, thresholds and
  reliability statements for one do not carry over to the other without
  evidence.
- A change to feature order, labels, ONNX inputs or outputs, runtime JSON, or
  an artifact's source updates [Models and data](models-and-data.md) in the
  same commit.
