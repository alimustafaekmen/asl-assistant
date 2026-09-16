"""Fast checks for web runtime data/model contracts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = PROJECT_ROOT / "asl-web"


def _load_json(rel_path: str):
    with (PROJECT_ROOT / rel_path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _assert_dense_label_map(labels: dict[str, int], expected_count: int) -> None:
    assert len(labels) == expected_count
    assert sorted(int(value) for value in labels.values()) == list(range(expected_count))


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

    assert isinstance(value, (int, float))
    assert 0.1 < float(value) < 5.0


def test_word_test_sample_matches_onnx_input_contract() -> None:
    sample = _load_json("asl-web/data/test_sample.json")
    features = sample.get("features")
    mask = sample.get("mask")

    assert isinstance(features, list)
    assert isinstance(mask, list)
    assert len(features) == 45 * 168
    assert len(mask) == 45
    assert all(isinstance(value, (int, float)) for value in features)
    assert all(isinstance(value, bool) for value in mask)
    assert sample.get("expected_word")


def test_jury_sample_manifest_covers_letter_domain_and_word_contract() -> None:
    manifest = _load_json("asl-web/data/jury-samples/manifest.json")
    letters = manifest.get("letters")
    words = manifest.get("words")

    assert isinstance(letters, list)
    assert isinstance(words, list)
    assert len(letters) == 24
    assert {item["label"] for item in letters} == set("ABCDEFGHIKLMNOPQRSTUVWXY")
    assert len(words) >= 1

    for item in letters + words:
        path = item.get("path")
        assert isinstance(path, str)
        assert path.startswith("./data/jury-samples/")
        assert (WEB_DIR / path.removeprefix("./")).exists()


def test_jury_sample_files_match_model_test_schema() -> None:
    for path in (WEB_DIR / "data" / "jury-samples").rglob("*.json"):
        if path.name == "manifest.json":
            continue
        sample = json.loads(path.read_text(encoding="utf-8"))
        task = sample.get("task")
        features = sample.get("features")

        assert sample.get("schema_version") == "asl-sample-v1"
        assert task in {"letter", "word"}
        assert isinstance(features, list)

        if task == "letter":
            assert len(features) == 93
            assert sample.get("expected_label")
        else:
            mask = sample.get("mask")
            assert len(features) == 45 * 168
            assert isinstance(mask, list)
            assert len(mask) == 45
            assert all(isinstance(value, bool) for value in mask)
            assert sample.get("expected_label") or sample.get("expected_word")


def test_letter_model_web_artifact_matches_no_zipmap_source() -> None:
    web_model = WEB_DIR / "models" / "letter_model.onnx"
    source_model = PROJECT_ROOT / "models" / "letter" / "onnx_exports" / "letter_model_static_24_web_no_zipmap.onnx"

    assert web_model.exists()
    assert source_model.exists()
    assert _sha256(web_model) == _sha256(source_model)
