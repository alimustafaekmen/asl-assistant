"""Behavioral contracts for shared Python ML configuration."""

from asl_ml import config


def test_static_letter_domain_is_exactly_the_published_24_classes() -> None:
    assert config.STATIC_LETTERS == list("ABCDEFGHIKLMNOPQRSTUVWXY")
    assert len(config.STATIC_LETTERS) == len(set(config.STATIC_LETTERS)) == 24
    assert set(config.DYNAMIC_LETTERS) == {"J", "Z"}
    assert set(config.STATIC_LETTERS).isdisjoint(config.DYNAMIC_LETTERS)


def test_hand_landmark_dimension_matches_mediapipe_xyz_layout() -> None:
    assert config.NUM_LANDMARKS == 21
    assert config.HAND_LANDMARK_DIM == config.NUM_LANDMARKS * 3 == 63


def test_letter_augmentation_defaults_are_valid_ranges() -> None:
    assert config.AUGMENTATION_NOISE_STD > 0
    assert 0 < config.AUGMENTATION_ROTATION_RANGE <= 180
    assert config.AUGMENTATION_MULTIPLIER >= 1
    assert 0 < config.AUGMENTATION_SCALE_RANGE < 1
