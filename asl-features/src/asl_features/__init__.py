"""asl-features: the feature code shared across ASL Assistant's Python side.

It holds the landmark normalization and the letter and word model features,
used by the legacy desktop prototype (`asl-desktop/`), the data-preparation,
training, evaluation and validation scripts (`scripts/`), and the Python tests
(`tests/`).

The browser runtime (`asl-web/`) does NOT depend on this package; it ships
its own JavaScript implementation. The Features section of `docs/technical-report.md`
describes the contract that both implementations follow.

Modules:
- config: landmark, letter-class, and augmentation constants
- landmarks: landmark normalization (wrist + middle MCP) and the square-units step
- letter: the 93D feature vector of the LightGBM letter model
- word: the 45 x 168 sequence features of the trained word notebook
"""

__version__ = "0.1.0"
