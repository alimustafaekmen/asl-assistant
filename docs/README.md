# Documentation

ASL Assistant keeps a small set of documents, each with one purpose. Start
with the root [README](../README.md) for the project overview.

| Document | Audience | Purpose |
|---|---|---|
| [Getting started](getting-started.md) | Users and developers | Run the web app, prepare a Python environment, validate the project, and troubleshoot common problems. |
| [Başlangıç rehberi (Türkçe)](getting-started.tr.md) | Kullanıcılar ve geliştiriciler | Web uygulamasını çalıştırın, izole ortam kurun ve projeyi doğrulayın. |
| [Architecture](architecture.md) | Developers | Understand component boundaries, browser pipelines, repository layout, state, and failure modes. |
| [Models and data](models-and-data.md) | ML developers and reviewers | Inspect feature order, ONNX I/O, labels, runtime JSON, evaluation scope, and artifact provenance. |
| [Project journey](project-journey.md) | Researchers and contributors | Follow the desktop-to-web evolution, experiments, engineering problems, lessons, limitations, and relation to sign-recognition research. |
| [Data workspace](../data/README.md) | ML developers | See which datasets trained the published models, which sources were only explored, and what stays outside Git. |

## Reading paths

- To try the application: README → Getting started.
- To change browser code: Architecture → Models and data.
- To inspect or replace a model: Models and data → the referenced training
  source and validation scripts.
- To trace dataset use: Data workspace → Models and data.
- To understand why the project made its current choices: Project journey.

## Documentation rules

- Working code and exported artifact metadata take precedence over prose.
- Metrics must name their dataset and evaluation scope. Browser fixtures are
  regression samples, not a substitute for held-out evaluation.
- Letter and word recognition are separate tasks and must not share claims,
  thresholds, or reliability language without evidence.
- Changes to feature order, labels, ONNX I/O, runtime JSON, or artifact sources
  must update [Models and data](models-and-data.md) in the same change.
