"""The project asset audit fails, by exit code, when the web runtime is broken.

`verify_project_assets.py` carries its own provenance comparison and its own
list of required web files. The only test of it replaced those functions with
stubs, so the comparison itself never ran: forcing it to report a match let a
drifted deploy file pass the audit. Each test here breaks one thing in a copy
of the checkout and runs the audit on it.

The copies hold no local datasets, and the dataset report lists each one it
cannot find as missing, so the runs that read failure lines leave that report
out with --no-datasets. It does not change the exit status either way.
"""

from __future__ import annotations

import json

from scripts.validation.contracts import PROJECT_ROOT

VERIFY_ASSETS = PROJECT_ROOT / "scripts" / "validation" / "verify_project_assets.py"


def test_a_healthy_copy_passes_the_audit(checkout) -> None:
    result = checkout.audit("--no-datasets")

    assert result.returncode == 0, result.stdout + result.stderr
    assert checkout.failures(result) == []
    assert "TUM ESLESIYOR" in result.stdout


def test_missing_local_datasets_do_not_fail_the_audit(checkout) -> None:
    """They are needed only to retrain, and a clone never has them."""
    result = checkout.audit()

    assert result.returncode == 0, result.stdout + result.stderr
    assert "BULUNAMADI" in result.stdout


def test_a_deploy_file_that_drifted_from_its_source_fails_the_audit(checkout) -> None:
    """Run as a user would: the entry point's exit status is what make reads."""
    source = "models/letter/letter_label_map.json"
    checkout.write(source, checkout.path(source).read_text(encoding="utf-8") + "\n")

    result = checkout.run("--no-datasets", script=VERIFY_ASSETS)

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "letter_labels.json" in failed[0] and "DRIFT" in failed[0], failed


def test_a_drifted_binary_model_fails_the_audit(checkout) -> None:
    """The deploy copy of a model is linked into the copy; replacing it drops the link."""
    deploy = "asl-web/models/word_model.onnx"
    checkout.write(deploy, checkout.path(deploy).read_bytes() + b"\0")

    result = checkout.audit("--no-datasets")

    assert result.returncode == 1, result.stdout + result.stderr
    assert any("word_model.onnx" in line and "DRIFT" in line for line in checkout.failures(result))


def test_a_deleted_provenance_source_fails_the_audit(checkout) -> None:
    checkout.remove("models/letter/onnx_exports/letter_model_static_24_web_no_zipmap.onnx")

    result = checkout.audit("--no-datasets")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "letter_model.onnx" in failed[0], failed
    assert "kaynak dosya yok" in failed[0], failed


def test_a_missing_reference_image_fails_the_audit(checkout) -> None:
    checkout.remove("asl-web/assets/signs/word-50-3.webp")

    result = checkout.audit("--no-datasets")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "word-50-3.webp" in failed[0], failed


def test_a_label_map_with_a_gap_fails_the_audit(checkout) -> None:
    """Index 23 missing: the 24th letter could never be shown."""
    labels = json.loads(checkout.path("asl-web/data/letter_labels.json").read_text())
    labels[next(name for name, index in labels.items() if index == 23)] = 24
    broken = json.dumps(labels)
    checkout.write("asl-web/data/letter_labels.json", broken)
    checkout.write("models/letter/letter_label_map.json", broken)

    result = checkout.audit("--no-datasets")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "letter_labels.json" in failed[0], failed


def test_a_smoke_fixture_of_the_wrong_shape_fails_the_audit(checkout) -> None:
    sample = json.loads(checkout.path("asl-web/data/test_sample.json").read_text())
    broken = json.dumps({**sample, "mask": sample["mask"][:-1]})
    checkout.write("asl-web/data/test_sample.json", broken)
    checkout.write("notebooks/word_50_results/test_sample.json", broken)

    result = checkout.audit("--no-datasets")

    assert result.returncode == 1, result.stdout + result.stderr
    failed = checkout.failures(result)
    assert len(failed) == 1 and "test_sample" in failed[0], failed
