"""`--verbose` of the runtime asset check, and its file handling."""

from __future__ import annotations

import gc
import warnings

from scripts.validation import check_runtime_assets


def test_verbose_lists_the_onnx_inputs_and_outputs(checkout) -> None:
    """The flag's help promises the ONNX inputs and outputs, so it must print them."""
    plain = checkout.check()
    verbose = checkout.check("--verbose")

    assert plain.returncode == verbose.returncode == 0
    assert "tensor(bool)" not in plain.stdout
    assert "tensor(bool)" in verbose.stdout, "the word model's mask input should be listed"
    assert "tensor(int64)" in verbose.stdout, "the letter model's label output should be listed"


def test_json_data_files_are_closed_after_the_schema_check(checkout) -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        check_runtime_assets.check_json_schemas(checkout.root)
        gc.collect()

    leaked = [w for w in caught if issubclass(w.category, ResourceWarning)]
    assert not leaked, [str(w.message) for w in leaked]
