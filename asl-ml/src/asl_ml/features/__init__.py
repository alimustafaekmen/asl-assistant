"""Feature engineering for ASL ML models.

Modules:
- letter_features: 93D LightGBM letter feature engineering
  (63 normalized landmarks + 30 derived shape features)

The browser runtime (`asl-web/js/ml/features.js::computeLetterFeatures`)
implements the same algorithm in JavaScript.
"""
from asl_ml.features.letter_features import extract_features

__all__ = ["extract_features"]
