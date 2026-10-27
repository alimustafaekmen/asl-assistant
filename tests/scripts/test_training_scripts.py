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
