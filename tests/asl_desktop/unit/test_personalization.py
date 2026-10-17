"""Persistence behaviour of the few-shot letter templates."""

from __future__ import annotations

import logging
from pathlib import Path

import asl_desktop.services.personalization as personalization_module
import numpy as np
import pytest
from asl_desktop.services.personalization import PersonalizedKNN


class _SideEffectPayload:
    """Pickles to a call that writes a marker file when it is unpickled."""

    def __init__(self, marker: Path):
        self.marker = marker

    def __reduce__(self):
        return (Path.write_text, (self.marker, "payload ran"))


@pytest.fixture
def profiles_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(personalization_module, "PROFILES_DIR", str(tmp_path))
    return tmp_path


def test_saved_templates_round_trip(profiles_dir):
    knn = PersonalizedKNN()
    knn.record_template("A", np.array([1.0, 0.0, 0.0], dtype=np.float32))
    knn.record_template("A", np.array([0.9, 0.1, 0.0], dtype=np.float32))
    knn.record_template("B", np.array([0.0, 1.0, 0.0], dtype=np.float32))

    reloaded = PersonalizedKNN()

    assert sorted(reloaded.templates) == ["A", "B"]
    assert reloaded.templates["A"].shape == (2, 3)
    assert reloaded.predict(np.array([0.0, 1.0, 0.0]))[0] == "B"


def test_object_array_file_is_refused_without_running_it(profiles_dir, caplog):
    marker = profiles_dir / "marker.txt"
    payload = np.empty(1, dtype=object)
    payload[0] = _SideEffectPayload(marker)
    np.savez(profiles_dir / "user_templates.npz", A=payload)

    with caplog.at_level(logging.WARNING, logger="ASL.Personalization"):
        knn = PersonalizedKNN()

    assert knn.templates == {}
    assert not marker.exists()
    assert any(record.levelno == logging.WARNING for record in caplog.records)
