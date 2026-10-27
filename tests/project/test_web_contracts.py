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


def test_word_teaching_data_covers_exactly_the_word_labels() -> None:
    """The notebook exports the coach's word files; they reach asl-web/data by hand.

    A word missing from the curriculum is never taught, and a pair that names a
    word the model cannot output is a warning that can never fire. The pairs
    are ordered (a confused for b), so they are not required to be symmetric.
    """
    labels = set(_load_json("asl-web/data/word_labels.json"))
    curriculum = _load_json("asl-web/data/curriculum.json")
    pairs = _load_json("asl-web/data/confusion_pairs.json")
    stats = _load_json("asl-web/data/per_word_stats.json")

    curriculum_words = [item["word"] for item in curriculum]
    assert len(curriculum_words) == len(set(curriculum_words))
    assert set(curriculum_words) == labels
    assert set(stats) == labels
    for pair in pairs:
        assert {pair["word_a"], pair["word_b"]} <= labels
        assert pair["word_a"] != pair["word_b"]
        assert isinstance(pair["count"], int) and pair["count"] > 0


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


def _load_word_reference() -> dict:
    """word_reference.json with a duplicated key reported rather than merged."""

    def no_duplicates(pairs: list[tuple[str, object]]) -> dict:
        keys = [key for key, _ in pairs]
        assert len(keys) == len(set(keys)), "duplicate key in word_reference.json"
        return dict(pairs)

    path = PROJECT_ROOT / "asl-web/data/word_reference.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle, object_pairs_hook=no_duplicates)


def test_word_reference_has_exactly_one_card_for_each_word_label() -> None:
    reference = _load_word_reference()
    labels = _load_json("asl-web/data/word_labels.json")

    assert reference["schema_version"] == "word-reference-v1"
    assert isinstance(reference["gloss_reviewed"], bool)
    assert set(reference["words"]) == set(labels)
    for label, entry in reference["words"].items():
        # The card number is the printed number on the page and the position in
        # the model's output order, so a swapped pair of rectangles fails here.
        assert entry["card"] == labels[label] + 1, label
        assert entry["page"] == math.ceil(entry["card"] / 10), label
        assert entry["title"].replace(" ", "") == label, label
        assert entry["gloss_tr"].strip(), label


def test_word_reference_pages_exist_and_cards_do_not_overlap() -> None:
    reference = _load_word_reference()
    pages = reference["pages"]

    assert len(pages) == 5
    for page in pages:
        assert (PROJECT_ROOT / "asl-web" / page).is_file(), page

    by_page: dict[int, list[tuple[str, list[float]]]] = {}
    for label, entry in reference["words"].items():
        assert 1 <= entry["page"] <= len(pages), label
        x, y, w, h = entry["rect"]
        assert w > 0 and h > 0, label
        assert 0 <= x and 0 <= y and x + w <= 1 and y + h <= 1, label
        by_page.setdefault(entry["page"], []).append((label, entry["rect"]))

    for page, cards in by_page.items():
        assert len(cards) == 10, f"page {page} holds {len(cards)} cards"
        # Cards read left to right, then down: a pair of swapped rectangles are
        # each a real card, so only the reading order can tell.
        ordered = sorted(cards, key=lambda item: reference["words"][item[0]]["card"])
        for index in range(0, 10, 2):
            (_, left), (_, right) = ordered[index], ordered[index + 1]
            assert abs(left[1] - right[1]) < 0.01 and left[0] < right[0], (page, index)
            if index:
                above = ordered[index - 2][1]
                assert left[1] >= above[1] + above[3], (page, index)
        for i, (a_label, a) in enumerate(cards):
            for b_label, b in cards[i + 1 :]:
                apart = (
                    a[0] + a[2] <= b[0]
                    or b[0] + b[2] <= a[0]
                    or a[1] + a[3] <= b[1]
                    or b[1] + b[3] <= a[1]
                )
                assert apart, f"{a_label} and {b_label} overlap on page {page}"


def test_word_reference_rectangles_sit_on_the_cards_drawn_in_the_pages() -> None:
    """The geometry is data because it is measured; this measures it again.

    A card has a coloured border on a white gutter. Each rectangle's own edges
    must be border, and the pixels just outside them gutter, so a page redrawn
    with another layout fails here until the file is regenerated.
    """
    import numpy as np
    from PIL import Image

    reference = _load_word_reference()
    width, height = reference["page_size"]
    inked_pages = {}
    for index, page in enumerate(reference["pages"], start=1):
        with Image.open(PROJECT_ROOT / "asl-web" / page) as image:
            assert image.size == (width, height), page
            inked_pages[index] = np.asarray(image.convert("RGB")).min(axis=2) < 235

    def band(page: int, xs: slice, ys: slice, axis: int) -> float:
        """Share of the line that has ink somewhere in the sampled strip."""
        return float(inked_pages[page][ys, xs].any(axis=axis).mean())

    for label, entry in reference["words"].items():
        x, y, w, h = entry["rect"]
        x0, y0 = round(x * width), round(y * height)
        x1, y1 = round((x + w) * width) - 1, round((y + h) * height) - 1
        page = entry["page"]
        # Corners are rounded, so the edges are sampled along their straight
        # part. The border is anti-aliased, hence a strip of three pixels
        # inside the edge, and a gutter pixel three outside it.
        across, down = slice(x0 + 30, x1 - 29), slice(y0 + 30, y1 - 29)
        edges = {
            "top": band(page, across, slice(y0, y0 + 3), 0),
            "bottom": band(page, across, slice(y1 - 2, y1 + 1), 0),
            "left": band(page, slice(x0, x0 + 3), down, 1),
            "right": band(page, slice(x1 - 2, x1 + 1), down, 1),
        }
        outside = {
            "top": band(page, across, slice(y0 - 3, y0 - 2), 0),
            "bottom": band(page, across, slice(y1 + 3, y1 + 4), 0),
            "left": band(page, slice(x0 - 3, x0 - 2), down, 1),
            "right": band(page, slice(x1 + 3, x1 + 4), down, 1),
        }
        assert all(value > 0.95 for value in edges.values()), (label, edges)
        assert all(value < 0.05 for value in outside.values()), (label, outside)


def test_model_card_numbers_equal_the_recorded_results() -> None:
    """The Project page renders these, so each is read from where it was recorded.

    The card restates nothing from memory: the letter figures come from the
    training metadata, the word figures from the notebook's final model and
    split, the class counts from the label maps and the sizes from the files
    that are deployed. Rounding is to the four places the results are quoted at.
    """
    card = _load_json("asl-web/data/model-card.json")
    letter_meta = _load_json("models/letter/letter_model_meta.json")
    results = _load_json("notebooks/word_50_results/all_experiment_results.json")
    final, split = results["final_model"], results["metadata"]
    models_dir = PROJECT_ROOT / "asl-web/models"

    assert card["schema_version"] == "model-card-v1"

    letter = card["letter"]
    assert (
        letter["classes"]
        == letter_meta["classes"]
        == len(_load_json("asl-web/data/letter_labels.json"))
    )
    assert letter["input_features"] == letter_meta["num_features"]
    assert letter["accuracy_held_out"] == letter_meta["accuracy_held_out"]
    assert letter["held_out_samples"] == letter_meta["held_out_test_samples"]
    assert letter["model_type"] == letter_meta["model_type"]
    assert letter["size_bytes"] == (models_dir / "letter_model.onnx").stat().st_size
    assert letter["size_bytes_gzip"] == (models_dir / "letter_model.onnx.gz").stat().st_size

    word = card["word"]
    assert (
        word["classes"] == split["num_classes"] == len(_load_json("asl-web/data/word_labels.json"))
    )
    assert word["accuracy"] == round(final["test_acc"], 4)
    assert word["macro_f1"] == round(final["test_f1"], 4)
    assert word["test_samples"] == split["test_samples"]
    assert word["test_signers"] == split["test_signers"]
    assert word["input"] == [final["seq_len"], final["feature_dim"]]
    assert word["parameters"] == final["params"]
    assert word["model_type"] == final["model_name"]
    assert word["size_bytes"] == (models_dir / "word_model.onnx").stat().st_size

    # No top-k figure is recorded anywhere, so none may be published here.
    assert not {key for key in word if "top" in key}


def test_model_card_licence_is_the_one_the_repository_ships() -> None:
    card = _load_json("asl-web/data/model-card.json")
    licence_text = (PROJECT_ROOT / "LICENSE").read_text(encoding="utf-8")

    assert card["licence"]["name"] in licence_text
    assert card["licence"]["applies_to"] == ["source code", "model files"]


def test_desktop_word_metadata_describes_the_25_class_contract() -> None:
    metadata = _load_json("models/word/desktop-25/word_model_meta.json")
    labels = _load_json("models/word/desktop-25/word_labels.json")

    _assert_dense_label_map(labels, expected_count=25)
    assert metadata["classes"] == 25
    assert metadata["sequence_length"] == 30
    assert metadata["num_features"] == 321
    assert metadata["model_type"].upper() == "GRU"
    assert metadata["bidirectional"] is True
