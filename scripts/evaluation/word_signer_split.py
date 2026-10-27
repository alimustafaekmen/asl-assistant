"""The word notebook's signer split, for the scripts that need its test signers."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

SEED = 42


def notebook_test_signers(signers_in_order: Iterable) -> set:
    """The test signers of notebooks/word_50_training.ipynb.

    `signers_in_order` lists each signer once, in the order they first appear
    among the rows of the 50 words, as pandas `unique()` returns them. The
    notebook shuffles with the legacy global generator seeded 42; a
    `default_rng(42)` Generator gives a different order and other signers.
    """
    signers = np.array(list(signers_in_order))
    np.random.RandomState(SEED).shuffle(signers)
    n_train = int(len(signers) * 0.70)
    n_val = int(len(signers) * 0.15)
    return set(signers[n_train + n_val :].tolist())
