"""asl-ml — Shared Python ML/data utilities for ASL Assistant.

This package contains language-agnostic ML/data helper code shared between
the legacy desktop prototype (`asl-desktop/`), data-preparation scripts
(`scripts/data_preparation/`), model-training scripts
(`scripts/model_training/`), and Python tests (`tests/`).

The browser runtime (`asl-web/`) does NOT depend on this package — it ships
its own JavaScript implementation. See `docs/current/model-contract.md`
for the contract that both implementations follow.

Modules:
- features.letter_features: 93D LightGBM letter feature engineering
- utils.landmarks: landmark normalization (wrist + middle MCP)
- utils.labels: label-map I/O helpers
- utils.io: filesystem helpers
"""
__version__ = "0.1.0"
