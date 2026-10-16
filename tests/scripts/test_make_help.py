"""`make help` lists the targets the Makefile really has, each exactly once.

The list is the first thing a newcomer reads. It drifted both ways: a target
was added without a line, and a line was kept after its target went away, and
nothing noticed because nobody runs every target. These tests ask make itself
for the target list and for proof that each listed target exists, so renaming a
variable or reordering the file does not break them.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAKE = shutil.which("make")

pytestmark = pytest.mark.skipif(
    MAKE is None or os.name == "nt", reason="needs make and a POSIX shell"
)

# A help line reads "  make <target> [ARGS]  description"; the lines that show
# an example of a variable (PORT=8081) belong to their target's own line.
HELP_LINE = re.compile(r"^\s+make ([a-z][a-z0-9-]*)(?:\s|$)")


def _make(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [MAKE, "--no-print-directory", *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def _listed_targets() -> list[str]:
    result = _make("help")
    assert result.returncode == 0, result.stdout + result.stderr
    return [m.group(1) for line in result.stdout.splitlines() if (m := HELP_LINE.match(line))]


def _declared_targets() -> set[str]:
    """Every name the Makefile declares phony, as make reports it."""
    result = _make("--dry-run", "--print-data-base", "help")
    assert result.returncode == 0, result.stdout + result.stderr
    declared: set[str] = set()
    for line in result.stdout.splitlines():
        if line.startswith(".PHONY:"):
            declared.update(line.removeprefix(".PHONY:").split())
    return declared


def test_help_lists_each_target_once() -> None:
    counts = Counter(_listed_targets())

    assert {name: n for name, n in counts.items() if n > 1} == {}


def test_help_lists_every_target() -> None:
    assert _declared_targets() - set(_listed_targets()) == set()


def test_help_lists_only_targets_that_exist() -> None:
    listed = _listed_targets()
    assert listed, "no target found in the help output"

    # A dry run reads every recipe without running it; a name with no rule is
    # an error ("No rule to make target").
    result = _make("--dry-run", *listed)

    assert result.returncode == 0, result.stdout + result.stderr
    assert _declared_targets() >= set(listed)
