"""Pure train/evaluation split decisions shared by the letter training CLI."""

from __future__ import annotations

import numpy as np
from sklearn.model_selection import train_test_split


def prepare_evaluation_split(
    X: np.ndarray,
    y_str: np.ndarray,
    X_external: np.ndarray | None = None,
    y_external_str: np.ndarray | None = None,
) -> tuple[dict[str, int], np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]:
    """Encode labels and choose either an external or stratified test set."""
    if (X_external is None) != (y_external_str is None):
        raise ValueError("External evaluation features and labels must be provided together")

    unique = sorted(set(y_str))
    label_map = {label: index for index, label in enumerate(unique)}
    y = np.array([label_map[label] for label in y_str], dtype=np.int32)

    if X_external is None:
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.15,
            random_state=42,
            stratify=y,
        )
        return label_map, X_train, X_test, y_train, y_test, "stratified_split"

    if X_external.ndim != 2 or X.ndim != 2 or X_external.shape[1] != X.shape[1]:
        raise ValueError(
            f"External test features must match train width {X.shape[1]}, "
            f"got {getattr(X_external, 'shape', None)}"
        )

    # An empty external set is accepted by everything here and then fails deep
    # inside the estimator, with a message that says nothing about the CSV the
    # user passed. Say it here instead.
    if len(X_external) == 0:
        raise ValueError("External test CSV holds no rows; nothing would be evaluated")

    if len(X_external) != len(y_external_str):
        raise ValueError(
            f"External test CSV has {len(X_external)} feature rows but {len(y_external_str)} labels"
        )

    unknown = sorted(set(y_external_str) - set(label_map))
    if unknown:
        raise ValueError(f"External test CSV has labels absent from training data: {unknown}")

    y_test = np.array([label_map[label] for label in y_external_str], dtype=np.int32)
    return label_map, X, X_external, y, y_test, "external_csv"
