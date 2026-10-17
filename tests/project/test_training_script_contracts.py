"""Fast contracts for model-training data split decisions."""

from __future__ import annotations

import numpy as np
import pytest

from scripts.model_training.data_split import prepare_evaluation_split


def test_external_letter_test_data_is_kept_out_of_training() -> None:
    X_train = np.array([[1.0], [2.0], [3.0], [4.0]], dtype=np.float32)
    y_train = np.array(["A", "A", "B", "B"])
    X_test = np.array([[10.0], [20.0]], dtype=np.float32)
    y_test = np.array(["B", "A"])

    label_map, train_features, test_features, train_labels, test_labels, source = (
        prepare_evaluation_split(X_train, y_train, X_test, y_test)
    )

    assert source == "external_csv"
    assert label_map == {"A": 0, "B": 1}
    np.testing.assert_array_equal(train_features, X_train)
    np.testing.assert_array_equal(test_features, X_test)
    np.testing.assert_array_equal(train_labels, [0, 0, 1, 1])
    np.testing.assert_array_equal(test_labels, [1, 0])


def test_external_letter_test_data_rejects_unknown_labels() -> None:
    X_train = np.array([[1.0], [2.0]], dtype=np.float32)
    y_train = np.array(["A", "B"])

    with pytest.raises(ValueError, match="labels absent from training data"):
        prepare_evaluation_split(
            X_train,
            y_train,
            np.array([[3.0]], dtype=np.float32),
            np.array(["C"]),
        )


def test_external_letter_test_data_rejects_an_empty_set() -> None:
    """An empty CSV must be refused where it is read, not deep in the estimator.

    Without that check, every step before the estimator accepts a zero-row test
    set, and the failure surfaces later inside the model with a message that
    never mentions the file the user passed on the command line.
    """
    X = np.random.default_rng(0).random((20, 3), dtype=np.float32)
    y = np.array(["A"] * 10 + ["B"] * 10)

    with pytest.raises(ValueError, match="no rows"):
        prepare_evaluation_split(X, y, np.empty((0, 3), dtype=np.float32), np.array([]))


def test_external_letter_test_data_rejects_mismatched_row_counts() -> None:
    """Features and labels that disagree would evaluate against the wrong rows."""
    X = np.random.default_rng(0).random((20, 3), dtype=np.float32)
    y = np.array(["A"] * 10 + ["B"] * 10)
    X_external = np.random.default_rng(1).random((3, 3), dtype=np.float32)

    with pytest.raises(ValueError, match="3 feature rows"):
        prepare_evaluation_split(X, y, X_external, np.array(["A", "B"]))
