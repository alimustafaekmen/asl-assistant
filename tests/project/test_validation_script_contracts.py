"""CLI and exit-code contracts for repository validation commands."""

from __future__ import annotations

import pytest

from scripts.validation import check_runtime_assets, verify_project_assets


def test_runtime_validation_checks_onnx_by_default() -> None:
    args = check_runtime_assets.parse_args([])

    assert args.no_onnx is False


def test_runtime_validation_has_one_explicit_onnx_opt_out() -> None:
    args = check_runtime_assets.parse_args(["--no-onnx"])

    assert args.no_onnx is True
    with pytest.raises(SystemExit):
        check_runtime_assets.parse_args(["--check-onnx"])


@pytest.mark.parametrize(
    ("runtime_ok", "provenance_ok", "expected"),
    [(True, True, 0), (False, True, 1), (True, False, 1)],
)
def test_project_asset_audit_propagates_required_failures(
    monkeypatch,
    runtime_ok: bool,
    provenance_ok: bool,
    expected: int,
) -> None:
    monkeypatch.setattr(verify_project_assets, "check_web_runtime", lambda: runtime_ok)
    monkeypatch.setattr(
        verify_project_assets,
        "check_provenance_hash_chain",
        lambda: provenance_ok,
    )
    monkeypatch.setattr(verify_project_assets, "check_dataset", lambda _name, _path: None)
    monkeypatch.setattr(verify_project_assets, "check_dynamic_data", lambda: None)
    monkeypatch.setattr(verify_project_assets, "check_models", lambda: None)

    assert verify_project_assets.main() == expected
