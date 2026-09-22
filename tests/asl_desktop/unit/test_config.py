"""Ownership and path contracts for desktop-only configuration."""

from pathlib import Path

from asl_desktop import config


def test_desktop_paths_resolve_from_repository_root() -> None:
    root = Path(config.PROJECT_ROOT)

    assert root == Path(config.__file__).resolve().parents[3]
    assert Path(config.LETTER_MODEL_PATH) == root / "models" / "letter" / "letter_model.pkl"
    assert Path(config.WORD_MODEL_PATH) == root / "models" / "word" / "desktop-25" / "word_model.pt"
    assert Path(config.ASSET_SIGNS_DIR) == root / "asl-web" / "assets" / "signs"


def test_desktop_sequence_contract_remains_distinct_from_web_word_model() -> None:
    assert config.SEQUENCE_LENGTH == 30
    assert config.DEFAULT_WORDS and len(config.DEFAULT_WORDS) == 25
    assert len(config.DEFAULT_WORDS) == len(set(config.DEFAULT_WORDS))
