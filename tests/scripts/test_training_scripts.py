"""Behaviour of the training scripts' small, side-effect-light functions.

Nothing here trains a model: the functions get tiny synthetic data and write
into a temporary directory.
"""

from __future__ import annotations

import numpy as np
import pytest

train_static = pytest.importorskip("scripts.model_training.train_static_letter_model")


def test_tsne_figure_is_written_with_the_pinned_scikit_learn(tmp_path, monkeypatch) -> None:
    """--full-comparison ends with the t-SNE figure; its call must match the library.

    A keyword that scikit-learn renamed and then removed makes the call raise,
    after the models and four figures are written but before the comparison
    table and the summary.
    """
    monkeypatch.setattr(train_static, "DOCS_ASSETS_DIR", str(tmp_path))
    rng = np.random.default_rng(0)
    X = rng.normal(size=(120, 6)).astype(np.float32)
    y = np.repeat(np.arange(3), 40)

    train_static._save_tsne(X, y, ["A", "B", "C"])

    figure = tmp_path / "static-letter-tsne.png"
    assert figure.is_file() and figure.stat().st_size > 0


def test_next_step_hint_is_a_command_the_jz_trainer_accepts() -> None:
    """Copying the hint must not end in an argparse error."""
    import shlex

    from scripts.model_training.train_dynamic_jz_model import build_parser

    commands = [
        line.strip()
        for line in train_static.next_step_hint().splitlines()
        if "train_dynamic_jz_model.py" in line
    ]
    assert commands, "the hint should name the J/Z trainer"

    for command in commands:
        words = shlex.split(command.split("#")[0])
        script = next(
            i for i, word in enumerate(words) if word.endswith("train_dynamic_jz_model.py")
        )
        args = words[script + 1 :]
        build_parser().parse_args(args)


def _source_rows(rows: np.ndarray) -> np.ndarray:
    """Which original row each row came from, for rows built as in the test below.

    Original row k holds 2**k in every coordinate. Augmentation rotates x and y,
    which keeps their length, scales by at most 20% and adds small noise, so a
    copy's size still names its row.
    """
    size = np.linalg.norm(rows, axis=1) / np.sqrt(rows.shape[1])
    return np.rint(np.log2(size)).astype(int)


def test_no_copy_of_an_evaluation_row_is_trained_on() -> None:
    """Augmenting before the split puts copies of a held-out row into training."""
    count = 40
    X = np.array([np.full(63, 2.0**k) for k in range(count)], dtype=np.float32)
    y = np.array(["A", "B"] * (count // 2))
    np.random.seed(0)

    _, X_train, X_test, y_train, y_test, source = train_static.split_and_augment(X, y)

    assert source == "stratified_split"
    assert len(X_test) == len(y_test) and len(X_train) == len(y_train)
    evaluation = set(_source_rows(X_test).tolist())
    trained = set(_source_rows(X_train).tolist())
    assert evaluation, "the split should hold out some rows"
    np.testing.assert_array_equal(X_test, X[_source_rows(X_test)])
    assert evaluation.isdisjoint(trained)
    assert evaluation | trained == set(range(count))
    assert len(X_train) == (count - len(evaluation)) * (1 + train_static.AUGMENTATION_MULTIPLIER)
