"""Behaviour of the environment diagnostics behind `make doctor`.

These run the command rather than reading the Makefile, because what matters is
the process result a user or a script sees. A package that is installed but
cannot be imported is the case this covers: if the report names it but the
command still succeeds, anything checking the exit code reads a faulty
environment as ready.

Each doctor run imports every project package, about a second, so the two runs
are BACKGROUND_RUNS: they start together when collection finishes (see
Background in conftest.py).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _run_doctor(extra_pythonpath: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    if extra_pythonpath is not None:
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{extra_pythonpath}{os.pathsep}{existing}" if existing else str(extra_pythonpath)
        )
    return subprocess.run(
        ["make", "doctor"],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )


def _doctor_with_a_broken_import(scratch: Path) -> subprocess.CompletedProcess[str]:
    shadow = scratch / "shadow"
    package = shadow / "onnxruntime"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(
        'raise ImportError("simulated native library mismatch")\n', encoding="utf-8"
    )
    return _run_doctor(extra_pythonpath=shadow)


BACKGROUND_RUNS = (
    {}
    if shutil.which("make") is None
    else {"working": lambda _scratch: _run_doctor(), "broken import": _doctor_with_a_broken_import}
)


@pytest.fixture(scope="module")
def doctor_runs(background) -> dict[str, subprocess.CompletedProcess[str]]:
    if shutil.which("make") is None:
        pytest.skip("make is not on PATH, so the doctor command cannot be run")
    return background.results(__name__, BACKGROUND_RUNS)


def test_doctor_succeeds_on_a_working_environment(doctor_runs) -> None:
    """The suite runs in a usable environment, so doctor must agree."""

    result = doctor_runs["working"]

    assert result.returncode == 0, result.stdout + result.stderr


def test_doctor_fails_when_an_installed_package_cannot_be_imported(doctor_runs) -> None:
    """A broken native library is a fault, not a step the user has yet to take.

    The package is found, so it is not missing; importing it raises, which is
    what a mismatched native library looks like. Reporting that as success
    would let a broken environment pass for a ready one.
    """

    result = doctor_runs["broken import"]

    assert result.returncode != 0, "a broken import must not report success"
    assert "bozuk" in result.stdout, result.stdout


def _run_setup_guard(**env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "scripts/tooling/setup_guard.py"],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_setup_guard_accepts_the_current_environment() -> None:
    """The suite runs in an environment setup could safely install into."""

    result = _run_setup_guard()

    assert result.returncode == 0, result.stdout + result.stderr
    assert "[OK]" in result.stdout


def test_setup_guard_refuses_a_conda_base_environment() -> None:
    """Installing into a shared base pollutes every other project using it."""

    result = _run_setup_guard(CONDA_DEFAULT_ENV="base")

    assert result.returncode == 2, result.stdout + result.stderr
    assert "[BLOCK]" in result.stdout


def test_setup_guard_refuses_an_interpreter_outside_the_active_environment() -> None:
    """Otherwise setup installs somewhere the user is not looking."""

    result = _run_setup_guard(CONDA_PREFIX="/nonexistent/other-env")

    assert result.returncode == 2, result.stdout + result.stderr
    assert "[BLOCK]" in result.stdout


def test_doctor_rejects_an_unexpected_argument_as_a_usage_error(capsys) -> None:
    """Exit 2 is usage; returning 0 would read a typo as a healthy environment."""
    from scripts.tooling import doctor

    assert doctor.main(["--fix"]) == 2
    captured = capsys.readouterr()
    assert "beklenmeyen" in captured.err
    assert captured.out == "", "nothing is diagnosed after a usage error"
