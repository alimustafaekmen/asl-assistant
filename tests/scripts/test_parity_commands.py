"""The feature parity commands report a mismatch, and a missing Node, by exit code.

The parity scripts are the only check that the browser computes the letter
and word features the models were trained on: the feature order, a mirrored
hand, the shoulder normalisation. A fault there still produces a vector of
the right length, so nothing else notices. make test trusts their exit
codes, so a script forced to exit 0 would pass every gate with a perturbed
feature in the browser code.

Each test runs a script on a copy of features.js. The faulty copy is the real
file with a few lines appended that wrap one public function and shift one
output value by 0.01, a hundred times the tolerance; the unmodified copy is
the control. The runs are independent, so they are BACKGROUND_RUNS: they
start together when collection finishes (see Background in conftest.py).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FEATURES_JS = PROJECT_ROOT / "asl-web" / "js" / "ml" / "features.js"
WORD_PARITY = PROJECT_ROOT / "tests" / "validation" / "check_word_feature_parity.py"
LETTER_PARITY = PROJECT_ROOT / "tests" / "validation" / "check_letter_feature_parity.py"
MODEL_PARITY = PROJECT_ROOT / "tests" / "validation" / "check_letter_model_parity.py"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")

# Appended to a copy of features.js. A function declaration in a classic
# script is a global binding, so reassigning it replaces what the script
# under test calls.
PERTURB = {
    "letter": """
;(function () {
  const original = computeLetterFeatures;
  computeLetterFeatures = function (frame) {
    const out = original(frame);
    out[40] += 0.01;
    return out;
  };
})();
""",
    "word": """
;(function () {
  const original = buildCompactSequenceFeatures;
  buildCompactSequenceFeatures = function (frames) {
    const out = original(frames);
    out[0][100] += 0.01;
    return out;
  };
})();
""",
    # What a syntax slip or a renamed global leaves: the script stops loading.
    "broken": '\nthrow new Error("features.js failed to load");\n',
}

# The system tools only: python is called by its full path, node is absent.
WITHOUT_NODE = "/usr/bin:/bin"


@dataclass(frozen=True)
class Case:
    script: Path
    features: str  # "copy", "perturbed:<kind>", or "" for the default file
    path: str | None = None
    # A package of this name placed first on PYTHONPATH that fails to import.
    shadow: str | None = None


CASES = {
    "letter/copy": Case(LETTER_PARITY, "copy"),
    "letter/perturbed": Case(LETTER_PARITY, "perturbed:letter"),
    "word/copy": Case(WORD_PARITY, "copy"),
    "word/perturbed": Case(WORD_PARITY, "perturbed:word"),
    "letter/broken": Case(LETTER_PARITY, "perturbed:broken"),
    "word/broken": Case(WORD_PARITY, "perturbed:broken"),
    "word/no node": Case(WORD_PARITY, "", path=WITHOUT_NODE),
    "letter/no node": Case(LETTER_PARITY, "", path=WITHOUT_NODE),
    "model/no onnxruntime": Case(MODEL_PARITY, "", shadow="onnxruntime"),
}


def _run(case: Case, scratch: Path) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(case.script)]
    if case.features:
        scratch.mkdir(parents=True)
        copy = scratch / "features.js"
        text = FEATURES_JS.read_text(encoding="utf-8")
        if case.features.startswith("perturbed:"):
            text += PERTURB[case.features.split(":", 1)[1]]
        copy.write_text(text, encoding="utf-8")
        args += ["--features-js", str(copy)]
    env = dict(os.environ)
    if case.path is not None:
        env["PATH"] = case.path
    if case.shadow is not None:
        package = scratch / "shadow" / case.shadow
        package.mkdir(parents=True)
        (package / "__init__.py").write_text('raise ImportError("shadowed by a test")\n')
        env["PYTHONPATH"] = os.pathsep.join(
            filter(None, [str(scratch / "shadow"), env.get("PYTHONPATH")])
        )
    return subprocess.run(
        args, cwd=PROJECT_ROOT, env=env, capture_output=True, text=True, timeout=300, check=False
    )


BACKGROUND_RUNS = (
    {}
    if shutil.which("node") is None
    else {name: partial(_run, case) for name, case in CASES.items()}
)


@pytest.fixture(scope="module")
def runs(background) -> dict[str, subprocess.CompletedProcess[str]]:
    return background.results(__name__, BACKGROUND_RUNS)


def _failed_fixtures(stdout: str) -> list[str]:
    """Report rows whose status column says FAIL."""
    return [line.split(",", 1)[0] for line in stdout.splitlines() if ",FAIL" in line]


@pytest.mark.parametrize("kind", ["letter", "word"])
def test_a_copy_of_the_deployed_features_passes(runs, kind: str) -> None:
    """The control: the copy itself is not what a failure below comes from."""
    result = runs[f"{kind}/copy"]

    assert result.returncode == 0, result.stdout + result.stderr
    assert _failed_fixtures(result.stdout) == []


@pytest.mark.parametrize("kind", ["letter", "word"])
def test_a_perturbed_feature_fails_the_parity_check(runs, kind: str) -> None:
    result = runs[f"{kind}/perturbed"]

    assert result.returncode == 1, result.stdout + result.stderr
    assert _failed_fixtures(result.stdout) != []
    assert "Traceback" not in result.stderr, result.stderr


@pytest.mark.parametrize("kind", ["letter", "word"])
def test_browser_code_that_does_not_load_fails_the_parity_check(runs, kind: str) -> None:
    """Every comparison failed, so it is a mismatch, not a check that could not run."""
    result = runs[f"{kind}/broken"]

    assert result.returncode == 1, result.stdout + result.stderr
    assert "Traceback" not in result.stderr, result.stderr


@pytest.mark.parametrize("kind", ["letter", "word"])
def test_feature_parity_without_node_cannot_run(runs, kind: str) -> None:
    """A check that could not run is exit 2, not a pass and not a mismatch."""
    result = runs[f"{kind}/no node"]

    assert result.returncode == 2, result.stdout + result.stderr
    assert "Traceback" not in result.stderr, result.stderr
    assert "node" in result.stdout.lower()


def test_model_parity_without_onnx_runtime_cannot_run(runs) -> None:
    result = runs["model/no onnxruntime"]

    assert result.returncode == 2, result.stdout + result.stderr
    assert "Traceback" not in result.stderr, result.stderr
