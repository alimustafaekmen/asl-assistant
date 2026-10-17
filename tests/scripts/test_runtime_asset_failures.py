"""The runtime asset check fails, by exit code, when a deploy contract breaks.

Each test copies the checkout, breaks one thing the deploy depends on, runs the
check and reads its exit status and its failure lines. Breaking the check
itself, by forcing its result to success or a comparison to true, makes these
fail; nothing here reads the validator's source. The healthy copy and one
drifted copy run the command in a new interpreter, as make does, so the entry
point's exit status is covered; the rest call main(argv) in this process.

A fault is put in the way a real export would leave it: the deploy copy, its
source and the export manifest's record change together, so the fault under
test is the only one in the copy. Healthy copies pass first, or a failure below
could be an artefact of the copy rather than of the fault.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest
from onnx import TensorProto, helper, numpy_helper

from scripts.validation.contracts import ARTIFACTS, PROJECT_ROOT

EXPORT_MANIFEST = "notebooks/word_50_results/manifest.json"


def _contract(name: str):
    return next(artifact for artifact in ARTIFACTS if artifact.name == name)


def install(checkout, artifact: str, data: bytes | str) -> None:
    """Replace one published artifact as a consistent export would.

    The deploy copy and its source get the same bytes, and the export manifest
    entry that recorded the old source, found by its hash, records the new one.
    """
    contract = _contract(artifact)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    source = contract.source_path.relative_to(PROJECT_ROOT).as_posix()
    old_hash = hashlib.sha256(checkout.path(source).read_bytes()).hexdigest()

    checkout.write(contract.deploy_path.relative_to(PROJECT_ROOT).as_posix(), raw)
    checkout.write(source, raw)

    manifest = json.loads(checkout.path(EXPORT_MANIFEST).read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        if entry.get("sha256") == old_hash:
            entry["size_bytes"] = len(raw)
            entry["sha256"] = hashlib.sha256(raw).hexdigest()
    checkout.write(EXPORT_MANIFEST, json.dumps(manifest, indent=2))


def word_model_bytes(
    frames: int = 45,
    features: int = 168,
    classes: int = 50,
    mask_frames: int | None = None,
    mask_type: int = TensorProto.BOOL,
    input_type: int = TensorProto.FLOAT,
    output_type: int = TensorProto.FLOAT,
) -> bytes:
    """A stand-in word model with the given interface.

    Its weights are zero and its bias is the logits the smoke fixture records,
    so with the contract interface it reproduces the fixture's prediction and
    the whole check passes. Any failure is then the interface's alone. The
    zero weights also keep the file above the size floor for a truncated copy.
    """
    mask_frames = frames if mask_frames is None else mask_frames
    sample = json.loads((PROJECT_ROOT / "asl-web/data/test_sample.json").read_text())
    logits = np.resize(np.array(sample["expected_logits"], dtype=np.float32), classes)
    graph = helper.make_graph(
        [
            helper.make_node("Cast", ["input"], ["input_f"], to=TensorProto.FLOAT),
            helper.make_node("Flatten", ["input_f"], ["flat"], axis=1),
            helper.make_node("MatMul", ["flat", "w_frames"], ["from_frames"]),
            helper.make_node("Cast", ["mask"], ["mask_f"], to=TensorProto.FLOAT),
            helper.make_node("MatMul", ["mask_f", "w_mask"], ["from_mask"]),
            helper.make_node("Add", ["from_frames", "from_mask"], ["summed"]),
            helper.make_node("Add", ["summed", "bias"], ["logits"]),
            helper.make_node("Cast", ["logits"], ["output"], to=output_type),
        ],
        "word_stub",
        [
            helper.make_tensor_value_info("input", input_type, ["batch", frames, features]),
            helper.make_tensor_value_info("mask", mask_type, ["batch", mask_frames]),
        ],
        [helper.make_tensor_value_info("output", output_type, ["batch", classes])],
        initializer=[
            numpy_helper.from_array(
                np.zeros((frames * features, classes), dtype=np.float32), "w_frames"
            ),
            numpy_helper.from_array(np.zeros((mask_frames, classes), dtype=np.float32), "w_mask"),
            numpy_helper.from_array(logits, "bias"),
            # Past the 1500 KB floor whatever the interface, so the file is not
            # rejected as a truncated copy before its interface is read.
            numpy_helper.from_array(np.zeros(128 * 1024, dtype=np.float32), "padding"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    return model.SerializeToString()


def test_a_healthy_copy_passes(checkout) -> None:
    result = checkout.run()

    assert result.returncode == 0, result.stdout + result.stderr
    assert checkout.failures(result) == []
    assert "SAFE TO DEPLOY" in result.stdout


def test_a_deploy_file_that_drifted_from_its_source_fails(checkout) -> None:
    """The source was exported again and the deploy copy was not updated."""
    source = "models/letter/letter_label_map.json"
    checkout.write(source, checkout.path(source).read_text(encoding="utf-8") + "\n")

    result = checkout.run("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    assert checkout.failures(result) == ["✗ letter_labels.json: DRIFT"]


def test_a_deleted_provenance_source_fails(checkout) -> None:
    """Every source is tracked, so a missing one is a lost file, not a partial setup.

    A check that only warned of an incomplete development environment, and
    passed, would leave nothing able to show that the deployed model is the
    exported one.
    """
    checkout.remove("models/letter/letter_label_map.json")

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "letter_labels.json" in failed[0], failed
    assert "source file missing" in failed[0], failed


def test_a_deploy_json_that_does_not_parse_fails(checkout) -> None:
    # Padded past the size floor, so what fails is the content, not the length.
    install(checkout, "per_word_stats.json", "{" + " " * 4096)

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "per_word_stats.json: parse error" in failed[0], failed


@pytest.mark.parametrize("temperature", [0, -1, 5])
def test_an_implausible_temperature_fails(checkout, temperature: float) -> None:
    """The browser divides logits by T: zero or negative breaks every word result."""
    calibration = json.loads(checkout.path("asl-web/data/temperature.json").read_text())
    install(checkout, "temperature.json", json.dumps({**calibration, "T": temperature}))

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "implausible T value" in failed[0], failed


def test_a_missing_deploy_artifact_fails(checkout) -> None:
    """A reference image has no source pair, so only the presence check sees it."""
    checkout.remove("asl-web/assets/signs/word-25.png")

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    assert checkout.failures(result) == ["✗ asl-web/assets/signs/word-25.png: NOT FOUND"]


FIXTURES = "asl-web/data/model-test-samples"


def _edit_json(checkout, name: str, change) -> None:
    data = json.loads(checkout.path(name).read_text(encoding="utf-8"))
    change(data)
    checkout.write(name, json.dumps(data))


def _unregistered_fixture(checkout) -> None:
    letter = checkout.path(f"{FIXTURES}/letters/letter-a.json").read_text(encoding="utf-8")
    checkout.write(f"{FIXTURES}/letters/letter-a-copy.json", letter)


MODEL_TEST_FAULTS = {
    "manifest schema": (
        lambda c: _edit_json(
            c, f"{FIXTURES}/manifest.json", lambda m: m.update(schema_version="v0")
        ),
        "schema_version invalid",
    ),
    "short letter fixture": (
        lambda c: _edit_json(c, f"{FIXTURES}/letters/letter-b.json", lambda f: f["features"].pop()),
        "features length must be 93",
    ),
    "word mask of numbers": (
        lambda c: _edit_json(
            c,
            f"{FIXTURES}/words/word-give-smoke.json",
            lambda f: f.update(mask=[int(v) for v in f["mask"]]),
        ),
        "mask must be 45 booleans",
    ),
    "fixture the manifest does not list": (_unregistered_fixture, "manifest/file drift"),
}


@pytest.mark.parametrize("fault", MODEL_TEST_FAULTS)
def test_a_broken_model_test_fixture_set_fails(checkout, fault: str) -> None:
    """The Model Test screen loads these by the manifest; each fault breaks a sample."""
    damage, message = MODEL_TEST_FAULTS[fault]
    damage(checkout)

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and message in failed[0], failed


@pytest.mark.parametrize(
    "fetched",
    [
        "asl-web/data/asl_video_links.json",
        "asl-web/data/letter_test_sample.json",
        "asl-web/data/word_reference.json",
        "asl-web/data/model-card.json",
        "asl-web/data/letter_curriculum.json",
        "asl-web/data/letter_confusion.json",
    ],
)
def test_a_missing_data_file_the_app_fetches_fails(checkout, fetched: str) -> None:
    """The reference panel, the Model Test fallback, the word cards, the Project page and the coach request these.

    None has a source pair or a schema check, so only the presence check stops
    a deploy that would ship a request that 404s.
    """
    checkout.remove(fetched)

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    assert checkout.failures(result) == [f"✗ {fetched}: NOT FOUND"]


def test_a_truncated_deploy_artifact_fails(checkout) -> None:
    """What a partial copy or a committed Git LFS pointer leaves behind."""
    checkout.write("asl-web/assets/signs/letters.png", b"version https://git-lfs")

    result = checkout.check("--no-onnx")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "letters.png: TOO SMALL" in failed[0], failed


def test_a_stand_in_word_model_with_the_contract_interface_passes(checkout) -> None:
    """The control for the shape tests: the stand-in itself is not a fault."""
    install(checkout, "word_model.onnx", word_model_bytes())

    result = checkout.check()

    assert result.returncode == 0, result.stdout + result.stderr
    assert checkout.failures(result) == []


@pytest.mark.parametrize(
    "interface",
    [{"frames": 44}, {"features": 160}, {"mask_frames": 44}, {"classes": 49}],
    ids=["frames", "features", "mask-frames", "classes"],
)
def test_a_word_model_with_the_wrong_shape_fails(checkout, interface: dict[str, int]) -> None:
    install(checkout, "word_model.onnx", word_model_bytes(**interface))

    result = checkout.check()

    assert result.returncode == 1, result.stdout + result.stderr
    assert any("word_model SHAPE MISMATCH" in line for line in checkout.failures(result))


@pytest.mark.parametrize(
    "interface",
    [
        {"frames": 44},
        {"features": 160},
        {"mask_frames": 44},
        {"classes": 49},
        {"mask_type": TensorProto.FLOAT},
        {"input_type": TensorProto.DOUBLE},
        {"output_type": TensorProto.DOUBLE},
    ],
    ids=[
        "frames",
        "features",
        "mask-frames",
        "classes",
        "float-mask",
        "double-input",
        "double-output",
    ],
)
def test_a_word_model_that_breaks_its_interface_is_reported_alone(
    checkout, interface: dict[str, int]
) -> None:
    """A model with the wrong interface is one fault, reported once.

    Running the smoke inference on it anyway would crash with a traceback, or
    add a second failure that hides which contract broke. A float mask is the
    mask polarity contract's neighbour: the browser sends booleans.
    """
    install(checkout, "word_model.onnx", word_model_bytes(**interface))

    result = checkout.check()

    assert result.returncode == 1, result.stdout + result.stderr
    assert "Traceback" not in result.stderr, result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and failed[0].startswith("✗ word_model"), failed


def _sample(checkout) -> dict:
    return json.loads(checkout.path("asl-web/data/test_sample.json").read_text(encoding="utf-8"))


def test_a_smoke_fixture_the_model_does_not_reproduce_fails(checkout) -> None:
    install(checkout, "test_sample.json", json.dumps({**_sample(checkout), "expected_word": "dog"}))

    result = checkout.check()

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "offline test FAIL" in failed[0], failed


def test_a_missing_smoke_fixture_fails_the_offline_inference(checkout) -> None:
    """Without the fixture nothing shows the model still predicts what it did."""
    checkout.remove("asl-web/data/test_sample.json")

    result = checkout.check()

    assert result.returncode == 1, result.stdout + result.stderr
    assert any("offline test" in line for line in checkout.failures(result)), result.stdout


def test_a_smoke_fixture_that_cannot_be_fed_to_the_model_fails(checkout) -> None:
    """An error while preparing the inference fails the run; it is not a warning."""
    sample = _sample(checkout)
    install(
        checkout, "test_sample.json", json.dumps({**sample, "features": sample["features"][:-1]})
    )

    result = checkout.check()

    assert result.returncode == 1, result.stdout + result.stderr
    assert any("offline test" in line for line in checkout.failures(result)), result.stdout
