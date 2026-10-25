"""The committed feature golden must equal what the Python feature code computes.

``tests/web/fixtures/feature-golden.json`` is what the browser tests hold
``asl-web/js/ml/features.js`` to. If it were allowed to differ from Python, a
change in ``asl_features`` (a reordered group, a flipped flag, another scale
reference) could pass here and in the browser at once while the model's input
contract broke. These tests rebuild the golden from the Python code and compare.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
EXPORTER = PROJECT_ROOT / "scripts" / "evaluation" / "export_feature_goldens.py"
COMMITTED = PROJECT_ROOT / "tests" / "web" / "fixtures" / "feature-golden.json"

# Rounding to seven decimals can flip the last digit between platforms, and
# float32 maths on x86 Linux differs from arm64 macOS by a few units in the
# last place, so large values get a relative margin too.
ATOL = 2e-6
RTOL = 2e-6


@pytest.fixture(scope="module")
def exporter():
    spec = importlib.util.spec_from_file_location("export_feature_goldens", EXPORTER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def committed():
    return json.loads(COMMITTED.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rebuilt(exporter):
    # Through JSON, as the browser reads it.
    return json.loads(json.dumps(exporter.build_golden()))


def test_the_committed_golden_covers_what_the_exporter_builds(committed, rebuilt):
    assert [c["name"] for c in committed["letter"]["cases"]] == [
        c["name"] for c in rebuilt["letter"]["cases"]
    ]
    assert [s["name"] for s in committed["word"]["sequences"]] == [
        s["name"] for s in rebuilt["word"]["sequences"]
    ]


def test_letter_inputs_are_unchanged(committed, rebuilt):
    for old, new in zip(committed["letter"]["cases"], rebuilt["letter"]["cases"]):
        assert old["source"] == new["source"], old["name"]
        for slot in ("right", "left"):
            np.testing.assert_allclose(
                old[slot], new[slot], rtol=RTOL, atol=ATOL, err_msg=old["name"]
            )


def test_letter_vectors_match_what_asl_features_computes_now(committed, rebuilt):
    for old, new in zip(committed["letter"]["cases"], rebuilt["letter"]["cases"]):
        np.testing.assert_allclose(
            old["expect"],
            new["expect"],
            rtol=RTOL,
            atol=ATOL,
            err_msg=f"{old['name']}: 93-D vector",
        )


def test_word_inputs_are_unchanged(committed, rebuilt):
    for old, new in zip(committed["word"]["sequences"], rebuilt["word"]["sequences"]):
        assert old["dominant"] == new["dominant"], old["name"]
        np.testing.assert_allclose(
            old["frames"], new["frames"], rtol=RTOL, atol=ATOL, err_msg=old["name"]
        )


def test_word_frames_match_what_the_notebook_contract_computes_now(committed, rebuilt):
    for old, new in zip(committed["word"]["sequences"], rebuilt["word"]["sequences"]):
        assert np.shape(old["expect"]) == (len(old["frames"]), 168), old["name"]
        np.testing.assert_allclose(
            old["expect"],
            new["expect"],
            rtol=RTOL,
            atol=ATOL,
            err_msg=f"{old['name']}: 168-D frames",
        )


def _case(committed, name):
    return next(c for c in committed["letter"]["cases"] if c["name"] == name)


def test_golden_flags_follow_the_hand_shape(committed):
    open_palm = np.array(_case(committed, "open_palm_right")["expect"])
    fist = np.array(_case(committed, "fist_right")["expect"])

    np.testing.assert_array_equal(open_palm[88:93], [1, 1, 1, 1, 1])
    np.testing.assert_array_equal(fist[88:93], [0, 0, 0, 0, 0])


def test_golden_hand_is_centred_with_landmark_9_at_unit_distance(committed):
    for name in ("open_palm_right", "fist_right", "fist_left_alone", "far_open_palm_right"):
        vector = np.array(_case(committed, name)["expect"])
        np.testing.assert_array_equal(vector[0:3], [0, 0, 0], err_msg=name)
        assert np.linalg.norm(vector[27:30]) == pytest.approx(1.0, abs=1e-5), name


def test_golden_keeps_a_far_hand_instead_of_zeroing_it(committed):
    far = _case(committed, "far_open_palm_right")
    wrist, landmark_9 = np.array(far["right"][0:3]), np.array(far["right"][27:30])

    # The fixture really is a distant hand, and its vector is not the all-zero
    # answer reserved for a hand with no usable scale.
    assert np.linalg.norm(landmark_9 - wrist) == pytest.approx(0.05, abs=1e-4)
    assert np.any(np.array(far["expect"]) != 0)
    assert not np.any(np.array(_case(committed, "collapsed_hand")["expect"]))
    assert not np.any(np.array(_case(committed, "no_hands")["expect"]))


def test_golden_fits_the_size_budget():
    assert COMMITTED.stat().st_size < 300 * 1024
