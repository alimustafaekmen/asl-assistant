"""Fast checks for web runtime data/model contracts."""

from __future__ import annotations

import json
import math
from pathlib import Path, PurePosixPath

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_json(rel_path: str) -> object:
    with (PROJECT_ROOT / rel_path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _assert_dense_label_map(labels: dict[str, int], expected_count: int) -> None:
    assert len(labels) == expected_count
    assert sorted(int(value) for value in labels.values()) == list(range(expected_count))


def _assert_manifest_entries(entries: object, *, task: str) -> list[dict]:
    assert isinstance(entries, list) and entries
    assert all(isinstance(item, dict) for item in entries)

    ids = [item.get("id") for item in entries]
    paths = [item.get("path") for item in entries]
    assert all(isinstance(value, str) and value for value in ids)
    assert len(ids) == len(set(ids))
    assert all(isinstance(value, str) and value for value in paths)
    assert len(paths) == len(set(paths))

    for item in entries:
        relative = str(item["path"]).removeprefix("./")
        path = PurePosixPath(relative)
        assert not path.is_absolute()
        assert ".." not in path.parts
        assert path.parts[:2] == ("data", "model-test-samples")
        assert item.get("expected_label")
        assert str(item["id"]).startswith(f"{task}-")

    return entries


def test_letter_labels_are_dense_static_24_contract() -> None:
    labels = _load_json("asl-web/data/letter_labels.json")

    _assert_dense_label_map(labels, expected_count=24)
    assert "J" not in labels
    assert "Z" not in labels
    assert set(labels) == set("ABCDEFGHIKLMNOPQRSTUVWXY")


def test_word_labels_are_dense_50_contract() -> None:
    labels = _load_json("asl-web/data/word_labels.json")

    _assert_dense_label_map(labels, expected_count=50)


def test_temperature_json_has_reasonable_word_temperature() -> None:
    temperature = _load_json("asl-web/data/temperature.json")
    value = temperature.get("T", temperature.get("temperature"))

    assert isinstance(value, (int, float)) and not isinstance(value, bool)
    assert math.isfinite(float(value))
    assert 0.1 < float(value) < 5.0


def test_word_test_sample_matches_onnx_input_contract() -> None:
    sample = _load_json("asl-web/data/test_sample.json")
    features = sample.get("features")
    mask = sample.get("mask")

    assert isinstance(features, list)
    assert isinstance(mask, list)
    assert len(features) == 45 * 168
    assert len(mask) == 45
    assert all(
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        for value in features
    )
    assert all(isinstance(value, bool) for value in mask)
    assert any(mask), "Smoke fixture must contain at least one real frame"
    assert sample.get("expected_word") in _load_json("asl-web/data/word_labels.json")


def test_model_test_sample_manifest_covers_letter_domain_and_word_contract() -> None:
    manifest = _load_json("asl-web/data/model-test-samples/manifest.json")
    letters = manifest.get("letters")
    words = manifest.get("words")

    assert manifest.get("schema_version") == "asl-model-test-manifest-v1"
    letters = _assert_manifest_entries(letters, task="letter")
    words = _assert_manifest_entries(words, task="word")

    assert manifest.get("letter_count") == len(letters)
    assert manifest.get("word_count") == len(words)
    assert {item["label"] for item in letters} == set("ABCDEFGHIKLMNOPQRSTUVWXY")
    assert {item["label"] for item in words} <= set(_load_json("asl-web/data/word_labels.json"))


def test_local_word_fixtures_cover_the_word_vocabulary() -> None:
    """The fixtures exported from the competition data stay local, by its rules.

    A clone has none; where they exist, they and the published word fixtures
    together must cover all 50 words.
    """
    local_path = PROJECT_ROOT / "asl-web/data/model-test-samples/local/manifest.json"
    if not local_path.exists():
        pytest.skip("local competition-derived word fixtures are not present")
    published = _load_json("asl-web/data/model-test-samples/manifest.json")
    local = _load_json("asl-web/data/model-test-samples/local/manifest.json")
    local_words = _assert_manifest_entries(local.get("words"), task="word")

    assert local.get("word_count") == len(local_words)
    assert all(item["path"].startswith("./data/model-test-samples/local/") for item in local_words)
    labels = {item["label"] for item in published["words"] + local_words}
    assert labels == set(_load_json("asl-web/data/word_labels.json"))


def test_desktop_word_metadata_describes_the_25_class_contract() -> None:
    metadata = _load_json("models/word/desktop-25/word_model_meta.json")
    labels = _load_json("models/word/desktop-25/word_labels.json")

    _assert_dense_label_map(labels, expected_count=25)
    assert metadata["classes"] == 25
    assert metadata["sequence_length"] == 30
    assert metadata["num_features"] == 321
    assert metadata["model_type"].upper() == "GRU"
    assert metadata["bidirectional"] is True
