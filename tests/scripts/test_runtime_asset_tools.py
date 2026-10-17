"""What the runtime asset check reports when ONNX Runtime cannot be imported.

A check that printed that the ONNX step was skipped and then "SAFE TO
DEPLOY" with exit 0 would report models it could not look at as verified.
A missing required tool is exit 2 under the
repository's exit-code contract: the check did not run, which is neither a
pass nor a contract failure. `--no-onnx` is the explicit way to leave it out.

The import is broken by a package of the same name placed first on
PYTHONPATH, which is what a half-installed or mismatched build looks like to
the interpreter.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def without_onnxruntime(tmp_path: Path) -> Path:
    shadow = tmp_path / "shadow"
    (shadow / "onnxruntime").mkdir(parents=True)
    (shadow / "onnxruntime" / "__init__.py").write_text(
        'raise ImportError("onnxruntime is shadowed by a test")\n', encoding="utf-8"
    )
    return shadow


def test_a_missing_onnx_runtime_is_not_reported_as_verified(
    checkout, without_onnxruntime: Path
) -> None:
    result = checkout.run(pythonpath=[without_onnxruntime])

    assert result.returncode == 2, result.stdout + result.stderr
    assert "SAFE TO DEPLOY" not in result.stdout
    assert "NOT VERIFIED" in result.stdout
    assert checkout.failures(result) == []


def test_leaving_the_onnx_step_out_explicitly_still_passes(
    checkout, without_onnxruntime: Path
) -> None:
    result = checkout.run("--no-onnx", pythonpath=[without_onnxruntime])

    assert result.returncode == 0, result.stdout + result.stderr
    assert "SAFE TO DEPLOY" in result.stdout


def test_a_contract_failure_outranks_a_step_that_could_not_run(
    checkout, without_onnxruntime: Path
) -> None:
    """A fault that was found is a fact; the code reports it, not the gap."""
    source = "models/letter/letter_label_map.json"
    checkout.write(source, checkout.path(source).read_text(encoding="utf-8") + "\n")

    result = checkout.run(pythonpath=[without_onnxruntime])

    assert result.returncode == 1, result.stdout + result.stderr
    assert checkout.failures(result) == ["✗ letter_labels.json: DRIFT"]
