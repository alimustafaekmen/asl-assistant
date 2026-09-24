"""Behaviour of the environment diagnostics behind `make doctor`.

These run the command rather than reading the Makefile, because what matters is
the process result a user or a script sees. A package that is installed but
cannot be imported is the case this covers: the report named it correctly while
the command still succeeded, so anything checking the exit code read a faulty
environment as ready.
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


@pytest.fixture(scope="module")
def make_available() -> None:
    if shutil.which("make") is None:
        pytest.skip("make is not on PATH, so the doctor command cannot be run")


def test_doctor_succeeds_on_a_working_environment(make_available: None) -> None:
    """The suite runs in a usable environment, so doctor must agree."""

    result = _run_doctor()

    assert result.returncode == 0, result.stdout + result.stderr


def test_doctor_fails_when_an_installed_package_cannot_be_imported(
    make_available: None, tmp_path: Path
) -> None:
    """A broken native library is a fault, not a step the user has yet to take.

    The package is found, so it is not missing; importing it raises, which is
    what a mismatched native library looks like. Reporting that as success let
    a broken environment pass for a ready one.
    """

    shadow = tmp_path / "shadow"
    package = shadow / "onnxruntime"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(
        'raise ImportError("simulated native library mismatch")\n', encoding="utf-8"
    )

    result = _run_doctor(extra_pythonpath=shadow)

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
