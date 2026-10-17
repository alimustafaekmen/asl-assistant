#!/usr/bin/env python3
"""Refuse `make setup` when it would install into the wrong environment.

Setup performs editable installs. Against Apple's CommandLineTools Python or a
shared conda base it pollutes an environment other work depends on, and against
an interpreter outside the activated environment it installs somewhere the user
is not looking. None of those failures are obvious afterwards, so they are
blocked before anything is written.

Exit codes:
  0  the target environment is safe to install into
  2  refused; the message names the environment and how to correct it
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):  # Allow `python scripts/tooling/setup_guard.py`.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.tooling.environment import (  # noqa: E402
    EnvironmentFacts,
    describe_current,
    setup_block_reason,
)


def block_message(reason: str, facts: EnvironmentFacts) -> str:
    """The refusal a user sees, naming what is wrong and how to fix it."""
    if reason == "apple_clt":
        return (
            "[BLOCK] setup CANNOT RUN with Apple's CommandLineTools Python.\n"
            f"  sys.executable = {facts.executable}\n"
            "  With this Python the editable install fails or pollutes the wrong environment.\n"
            "  Fix:\n"
            "    Conda    : conda activate YOUR_ENV_NAME && make setup\n"
            "    venv     : python3 -m venv .venv && source .venv/bin/activate && make setup\n"
            "    Override : make setup PYTHON=$CONDA_PREFIX/bin/python"
        )
    if reason == "base":
        return (
            "[BLOCK] setup CANNOT RUN with the conda/Miniforge base Python.\n"
            f"  sys.executable    = {facts.executable}\n"
            f"  CONDA_DEFAULT_ENV = {facts.conda_default_env or '(empty)'}\n"
            f"  CONDA_PREFIX      = {facts.conda_prefix or '(empty)'}\n"
            "\n"
            "  Use an isolated environment for this project:\n"
            "    conda activate YOUR_ENV_NAME  # use your own environment name\n"
            "    make doctor\n"
            "    make setup\n"
            "\n"
            "  If the wrong Python shows up although conda is active:\n"
            "    make doctor PYTHON=$CONDA_PREFIX/bin/python\n"
            "    make setup  PYTHON=$CONDA_PREFIX/bin/python\n"
            "\n"
            "  A new venv:\n"
            "    python3 -m venv .venv\n"
            "    source .venv/bin/activate\n"
            "    make setup\n"
        )
    if reason == "conda":
        return (
            "[BLOCK] conda is active but the chosen Python is not in its environment.\n"
            f"  CONDA_PREFIX   = {facts.conda_prefix}\n"
            f"  sys.executable = {facts.executable}\n"
            "  Fix: make setup PYTHON=$CONDA_PREFIX/bin/python"
        )
    return (
        "[BLOCK] a venv is active but the chosen Python is not inside it.\n"
        f"  VIRTUAL_ENV    = {facts.virtual_env}\n"
        f"  sys.executable = {facts.executable}\n"
        "  Fix: make setup PYTHON=$VIRTUAL_ENV/bin/python"
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:
        print(f"setup-guard: unexpected argument: {' '.join(argv)}", file=sys.stderr)
        return 2

    facts = describe_current()
    reason = setup_block_reason(facts)
    if reason:
        print(block_message(reason, facts))
        return 2
    print(f"[OK] Target Python environment: {facts.executable}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
