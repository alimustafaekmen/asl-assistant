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
            "[BLOCK] Apple CommandLineTools Python ile setup CALISTIRILAMAZ.\n"
            f"  sys.executable = {facts.executable}\n"
            "  Bu Python ile editable install basarisiz olur veya yanlis environment kirlenir.\n"
            "  Cozum:\n"
            "    Conda    : conda activate YOUR_ENV_NAME && make setup\n"
            "    venv     : python3 -m venv .venv && source .venv/bin/activate && make setup\n"
            "    Override : make setup PYTHON=$CONDA_PREFIX/bin/python"
        )
    if reason == "base":
        return (
            "[BLOCK] Conda/Miniforge base Python ile setup CALISTIRILAMAZ.\n"
            f"  sys.executable    = {facts.executable}\n"
            f"  CONDA_DEFAULT_ENV = {facts.conda_default_env or '(bos)'}\n"
            f"  CONDA_PREFIX      = {facts.conda_prefix or '(bos)'}\n"
            "\n"
            "  Bu proje icin izole ortam kullan:\n"
            "    conda activate YOUR_ENV_NAME  # kendi ortam adinizi kullanin\n"
            "    make doctor\n"
            "    make setup\n"
            "\n"
            "  Eger conda aktif oldugu halde yanlis Python goruluyorsa:\n"
            "    make doctor PYTHON=$CONDA_PREFIX/bin/python\n"
            "    make setup  PYTHON=$CONDA_PREFIX/bin/python\n"
            "\n"
            "  Yeni venv:\n"
            "    python3 -m venv .venv\n"
            "    source .venv/bin/activate\n"
            "    make setup\n"
        )
    if reason == "conda":
        return (
            "[BLOCK] Conda aktif ama secilen Python conda ortaminda degil.\n"
            f"  CONDA_PREFIX   = {facts.conda_prefix}\n"
            f"  sys.executable = {facts.executable}\n"
            "  Cozum: make setup PYTHON=$CONDA_PREFIX/bin/python"
        )
    return (
        "[BLOCK] venv aktif ama secilen Python venv icinde degil.\n"
        f"  VIRTUAL_ENV    = {facts.virtual_env}\n"
        f"  sys.executable = {facts.executable}\n"
        "  Cozum: make setup PYTHON=$VIRTUAL_ENV/bin/python"
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:
        print(f"setup-guard: beklenmeyen argüman: {' '.join(argv)}", file=sys.stderr)
        return 2

    facts = describe_current()
    reason = setup_block_reason(facts)
    if reason:
        print(block_message(reason, facts))
        return 2
    print(f"[OK] Hedef Python ortami: {facts.executable}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
