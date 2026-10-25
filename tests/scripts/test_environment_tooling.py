"""Behaviour of the setup guard and the environment report.

These run the scripts rather than reading them, because what matters is the
process result a user or a script sees.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


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
    assert "unexpected" in captured.err
    assert captured.out == "", "nothing is diagnosed after a usage error"
