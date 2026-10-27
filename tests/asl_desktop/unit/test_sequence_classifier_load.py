"""Checkpoint loading must never unpickle arbitrary objects.

A ``.pt`` file is a pickle. Without ``weights_only=True`` (the default only from
PyTorch 2.6) ``torch.load`` unpickles it fully, so a tampered checkpoint would
run code.
"""

from __future__ import annotations

import json
import pickle
from pathlib import Path

import asl_desktop.models.sequence_classifier as sequence_module
import pytest
import torch
from asl_desktop.config import DESKTOP_WORD_MODEL_DIR
from asl_desktop.models.sequence_classifier import SequenceClassifier


class _SideEffectPayload:
    """Pickles to a call that writes a marker file when it is unpickled."""

    def __init__(self, marker: Path):
        self.marker = marker

    def __reduce__(self):
        return (Path.write_text, (self.marker, "payload ran"))


def _classifier_for(monkeypatch, model_path: Path, label_path: Path) -> SequenceClassifier:
    monkeypatch.setattr(sequence_module, "WORD_MODEL_PATH", str(model_path))
    monkeypatch.setattr(sequence_module, "WORD_LABEL_MAP_PATH", str(label_path))
    return SequenceClassifier("word")


def test_load_refuses_a_checkpoint_that_pickles_code(tmp_path, monkeypatch):
    marker = tmp_path / "marker.txt"
    model_path = tmp_path / "word_model.pt"
    torch.save(_SideEffectPayload(marker), model_path)
    label_path = tmp_path / "word_labels.json"
    label_path.write_text(json.dumps({"hello": 0, "bye": 1}), encoding="utf-8")

    classifier = _classifier_for(monkeypatch, model_path, label_path)

    with pytest.raises(pickle.UnpicklingError):
        classifier.load()
    assert not marker.exists()


def test_load_accepts_the_shipped_desktop_checkpoint(monkeypatch):
    model_path = Path(DESKTOP_WORD_MODEL_DIR) / "word_model.pt"
    label_path = Path(DESKTOP_WORD_MODEL_DIR) / "word_labels.json"
    assert model_path.exists(), "shipped checkpoint is missing from the repository"

    classifier = _classifier_for(monkeypatch, model_path, label_path)

    assert classifier.load() is True
    assert isinstance(classifier.model, torch.nn.Module)
