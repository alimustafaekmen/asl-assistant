"""Environment detection and setup policy.

The decisions take the facts they need as arguments, so each state the commands
care about (Apple CommandLineTools, conda base, an interpreter outside the
active environment, missing packages, a package that cannot be imported) can be
produced in a test without arranging a real interpreter to be in that state.

Only `describe_current()` and `check_import()` look at the running process, and
they decide nothing, so observation and decision stay apart.
"""

from __future__ import annotations

import os
import platform
import sys
from dataclasses import dataclass
from importlib.util import find_spec

# A conda installation's own environment, as opposed to a project environment
# created under it. Windows spellings are included because the same check runs
# there through Git Bash or WSL.
_BASE_MARKERS = (
    "/miniforge/base/",
    "/miniconda/base/",
    "/anaconda/base/",
    "/Caskroom/miniforge/base/",
    "\\miniforge\\base\\",
    "\\miniconda\\base\\",
    "\\anaconda\\base\\",
)

_ENVS_MARKERS = ("/envs/", "\\envs\\")

APPLE_CLT_MARKER = "/Library/Developer/CommandLineTools/"

# The packages the report groups separately: the ones any checkout needs, and
# the ones `make setup` installs from this repository.
BASIC_PACKAGES = ("pytest", "onnxruntime", "numpy")
PROJECT_PACKAGES = ("asl_features", "asl_desktop")


@dataclass(frozen=True)
class EnvironmentFacts:
    """Everything the diagnosis reads about the running interpreter."""

    executable: str
    conda_prefix: str = ""
    conda_default_env: str = ""
    virtual_env: str = ""
    system: str = ""
    machine: str = ""
    platform_string: str = ""
    python_version: str = ""
    implementation: str = ""
    make_python_var: str = ""


@dataclass(frozen=True)
class ImportCheck:
    """One package's availability.

    `status` is "ok" (imported), "missing" (not installed) or "broken"
    (installed but raised on import, which is what a mismatched native library
    looks like).
    """

    name: str
    status: str
    version: str = ""
    error: str = ""


def describe_current() -> EnvironmentFacts:
    """Read the running interpreter and its environment variables."""
    return EnvironmentFacts(
        executable=sys.executable,
        conda_prefix=os.environ.get("CONDA_PREFIX", ""),
        conda_default_env=os.environ.get("CONDA_DEFAULT_ENV", ""),
        virtual_env=os.environ.get("VIRTUAL_ENV", ""),
        system=platform.system(),
        machine=platform.machine(),
        platform_string=platform.platform(),
        python_version=sys.version.split()[0],
        implementation=platform.python_implementation(),
        make_python_var=os.environ.get("MAKE_PYTHON_VAR", ""),
    )


def is_conda_base(facts: EnvironmentFacts) -> bool:
    """Whether the interpreter is a conda installation's own base environment.

    An interpreter under `envs/` belongs to a project environment even when its
    path also contains a base marker, which is the case for every environment
    created under a base installation.
    """
    if facts.conda_default_env == "base":
        return True
    prefix = facts.conda_prefix
    if prefix and (prefix.endswith("/base") or prefix.endswith("\\base")):
        return True
    for marker in _BASE_MARKERS:
        if marker in facts.executable:
            return not any(env in facts.executable for env in _ENVS_MARKERS)
    return False


def is_apple_command_line_tools(facts: EnvironmentFacts) -> bool:
    """Whether this is the Python shipped with Apple's CommandLineTools."""
    return APPLE_CLT_MARKER in facts.executable


def active_environment_mismatch(facts: EnvironmentFacts) -> str:
    """Which activated environment the chosen interpreter does not belong to.

    Returns "conda", "venv", or "" when the interpreter matches whatever is
    active. Activating an environment and then running a different interpreter
    installs into, or reports on, the wrong place.
    """
    if facts.conda_prefix and facts.conda_prefix not in facts.executable:
        return "conda"
    if facts.virtual_env and facts.virtual_env not in facts.executable:
        return "venv"
    return ""


def environment_label(facts: EnvironmentFacts) -> str:
    """The conda environment's own name, when the interpreter is in one."""
    prefix = facts.conda_prefix
    if prefix and any(marker in prefix for marker in _ENVS_MARKERS):
        return prefix.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return ""


def check_import(name: str) -> ImportCheck:
    """Report whether a package is absent, importable, or installed but broken.

    find_spec() alone cannot tell a working package from one whose native
    library does not load, so the import is attempted.
    """
    try:
        if find_spec(name) is None:
            return ImportCheck(name=name, status="missing")
    except Exception as exc:  # A broken parent package can raise here.
        return ImportCheck(name=name, status="broken", error=type(exc).__name__)
    try:
        module = __import__(name)
    except Exception as exc:
        return ImportCheck(name=name, status="broken", error=type(exc).__name__)
    return ImportCheck(name=name, status="ok", version=getattr(module, "__version__", "") or "")


def resolve_state(
    facts: EnvironmentFacts,
    basic: list[ImportCheck],
    project: list[ImportCheck],
) -> str:
    """Name the single state the environment is in, worst problem first.

    The order matters: a wrong interpreter makes every package result
    meaningless, so it is reported before anything is said about packages.
    """
    if is_apple_command_line_tools(facts):
        return "apple_clt"
    if is_conda_base(facts):
        return "base"
    if active_environment_mismatch(facts):
        return "mismatch"
    if any(check.status == "missing" for check in basic):
        return "basic_missing"
    if any(check.status == "broken" for check in basic):
        return "basic_broken"
    if any(check.status == "missing" for check in project):
        return "needs_setup"
    if any(check.status == "broken" for check in project):
        return "project_broken"
    return "ready"


# States where the interpreter itself is the problem. The package results in
# those cases describe whichever Python was picked up, not the one the user
# meant, so nothing is concluded from them.
INTERPRETER_STATES = frozenset({"apple_clt", "base", "mismatch"})


def has_broken_packages(*groups: list[ImportCheck]) -> bool:
    """Whether any checked package is installed but raises on import."""
    return any(check.status == "broken" for group in groups for check in group)


def is_faulty(state: str, basic: list[ImportCheck], project: list[ImportCheck]) -> bool:
    """Whether the environment is broken rather than merely incomplete.

    A missing package is a step the user has yet to take; a package that is
    present but raises is a fault. It stays a fault when something else is also
    missing, which is why this reads the checks rather than the single state
    label the report leads with: that label reports the most actionable problem
    first, and "install the missing package" outranks "this one is broken".
    """
    if state in INTERPRETER_STATES:
        return False
    return has_broken_packages(basic, project)


def setup_block_reason(facts: EnvironmentFacts) -> str:
    """Why `make setup` must refuse to run, or "" when it may proceed.

    Setup performs editable installs. Running it against the system Python or a
    shared conda base pollutes an environment many things depend on, and
    running it against an interpreter outside the activated environment
    installs somewhere the user is not looking.
    """
    if is_apple_command_line_tools(facts):
        return "apple_clt"
    if is_conda_base(facts):
        return "base"
    return active_environment_mismatch(facts)
