#!/usr/bin/env python3
"""Report the active Python environment. Installs nothing.

Diagnosis and setup are separate commands on purpose: reading this report must
never change the environment it is describing.

Exit codes:
  0  the environment was described; any problem found is a step the user has
     yet to take, such as running setup
  1  a package is installed but cannot be imported, which is a fault rather
     than a missing step
  2  the command was given an argument; it takes none
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):  # Allow `python scripts/tooling/doctor.py`.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.tooling.environment import (  # noqa: E402
    BASIC_PACKAGES,
    PROJECT_PACKAGES,
    EnvironmentFacts,
    ImportCheck,
    active_environment_mismatch,
    check_import,
    describe_current,
    environment_label,
    is_apple_command_line_tools,
    is_conda_base,
    is_faulty,
    resolve_state,
)


def _package_line(check: ImportCheck) -> str:
    if check.status == "missing":
        return f"  X {check.name} missing"
    if check.status == "broken":
        return f"  X {check.name} installed but the import fails ({check.error})"
    if check.version:
        return f"  + {check.name} {check.version}"
    return f"  + {check.name} (installed, version unknown)"


def _warnings(facts: EnvironmentFacts) -> list[list[str]]:
    """Every condition worth flagging, not just the one that names the state."""
    blocks: list[list[str]] = []
    if is_apple_command_line_tools(facts):
        blocks.append(
            [
                "WARNING: this is Apple's CommandLineTools Python.",
                '  "make setup" CANNOT RUN with this Python (the setup guard blocks it).',
                "  Fix:",
                "    Conda : conda activate YOUR_ENV_NAME && make setup",
                "    venv  : python3 -m venv .venv && source .venv/bin/activate && make setup",
                "    Override: make setup PYTHON=$CONDA_PREFIX/bin/python",
            ]
        )
    if is_conda_base(facts):
        blocks.append(
            [
                "WARNING: this is the conda/Miniforge base Python.",
                '  "make setup" into the base environment is not recommended and is BLOCKED by default.',
                "  Why: the base environment is shared by many projects and is easily polluted.",
                "  Activate the project environment:",
                "    conda activate YOUR_ENV_NAME  # use your own environment name",
                "  or create a venv:",
                "    python3 -m venv .venv && source .venv/bin/activate && make setup",
            ]
        )
    if facts.conda_prefix and facts.conda_prefix not in facts.executable:
        blocks.append(
            [
                "WARNING: conda is active ($CONDA_PREFIX is set) but the chosen Python is NOT in its environment.",
                f"  CONDA_PREFIX   = {facts.conda_prefix}",
                f"  sys.executable = {facts.executable}",
                "  Fix: $CONDA_PREFIX/bin/python scripts/tooling/doctor.py",
            ]
        )
    if facts.virtual_env and facts.virtual_env not in facts.executable:
        blocks.append(
            [
                "WARNING: a venv is active ($VIRTUAL_ENV is set) but the chosen Python is NOT inside it.",
                f"  VIRTUAL_ENV    = {facts.virtual_env}",
                f"  sys.executable = {facts.executable}",
                "  Fix: $VIRTUAL_ENV/bin/python scripts/tooling/doctor.py",
            ]
        )
    if facts.system == "Windows":
        blocks.append(
            [
                "NOTE: Windows detected.",
                "  The Makefile runs in Git Bash, WSL or another terminal that provides make.",
                "  The plain commands for PowerShell and cmd: docs/getting-started.md",
            ]
        )
    return blocks


def _next_step(state: str, facts: EnvironmentFacts, faults: list[str]) -> list[str]:
    """What the user should do about the state, as report lines."""
    label = environment_label(facts)

    if state == "apple_clt":
        return [
            "  The wrong Python is selected: Apple's CommandLineTools Python.",
            "",
            "Fix:",
            "  conda activate YOUR_ENV_NAME",
            "  python scripts/tooling/doctor.py",
            "",
            "If it is still wrong:",
            "  $CONDA_PREFIX/bin/python scripts/tooling/doctor.py",
        ]
    if state == "base":
        return [
            "  The conda/Miniforge base environment is in use. It is NOT RECOMMENDED for this project.",
            "",
            "Fix:",
            "  conda activate YOUR_ENV_NAME",
            "  python scripts/tooling/doctor.py",
            "",
            "Or create a venv:",
            "  python3 -m venv .venv && source .venv/bin/activate",
            "  python scripts/tooling/doctor.py",
        ]
    if state == "mismatch":
        which = active_environment_mismatch(facts)
        variable = "$CONDA_PREFIX" if which == "conda" else "$VIRTUAL_ENV"
        return [
            "  The active environment and the chosen Python do not match.",
            "",
            "Fix:",
            f"  {variable}/bin/python scripts/tooling/doctor.py",
        ]
    if state == "basic_missing":
        return [
            "  Some basic packages are missing (pytest/onnxruntime/numpy).",
            "",
            "Next step:",
            "  make setup",
            "  python scripts/tooling/doctor.py",
        ]
    if state == "basic_broken":
        return [
            "  The basic packages were found, but at least one cannot be imported.",
            *faults,
            "",
            "Check the package installation and the native library compatibility.",
        ]
    if state == "needs_setup":
        lines = [
            f"  The environment looks right (conda env: {label}), but the project packages are not installed."
            if label
            else "  The environment looks right, but the project packages are not installed.",
            "",
            "Next step:",
            "  make setup",
            "  python scripts/tooling/doctor.py",
            "",
            "For the web demo (no project package needed):",
            "  make web",
        ]
        return lines
    if state == "project_broken":
        return [
            "  The project packages were found but cannot be imported.",
            *faults,
            "",
            "Next step: make setup, then python scripts/tooling/doctor.py",
        ]

    ready = "  + The Python environment is ready."
    if label:
        ready = f"  + The Python environment is ready (conda env: {label})."
    elif facts.virtual_env:
        ready = "  + The Python environment is ready (venv active)."
    return [
        ready,
        "",
        "Everyday commands:",
        "  make web                # serve the web demo locally",
        "  make test               # Python and web tests, parity",
        "  make check              # lint, types, runtime files, then the tests",
    ]


def build_report(
    facts: EnvironmentFacts,
    basic: list[ImportCheck],
    project: list[ImportCheck],
) -> tuple[list[str], str]:
    """Render the whole report and name the state it describes.

    Returning the lines rather than printing them is what lets a test compare
    a whole report for a state it constructed.
    """
    state = resolve_state(facts, basic, project)
    lines = [
        "",
        "── Platform ───────────────────────────────",
        f"OS              : {facts.system}",
        f"Architecture    : {facts.machine}",
        f"Platform string : {facts.platform_string}",
        "",
        "── Environment ───────────────────────────",
        f"CONDA_PREFIX      : {facts.conda_prefix or '(empty)'}",
        f"CONDA_DEFAULT_ENV : {facts.conda_default_env or '(empty)'}",
        f"VIRTUAL_ENV       : {facts.virtual_env or '(empty)'}",
        "",
        "── Python ────────────────────────────────",
        f"sys.executable    : {facts.executable}",
        f"Python version    : {facts.python_version}",
        f"Implementation    : {facts.implementation}",
        "",
    ]

    warning_blocks = _warnings(facts)
    if warning_blocks:
        for block in warning_blocks:
            lines.extend(block)
            lines.append("")
    else:
        lines.append("No environment warning.")
        lines.append("")

    lines.append("── Package imports ───────────────────────")
    lines.append("")
    lines.append("Basic packages (validation and the tests need them):")
    lines.extend(_package_line(check) for check in basic)
    lines.append("")
    lines.append("Project packages (editable installs; make setup installs them):")
    for check in project:
        line = _package_line(check)
        lines.append(f"{line} -> run make setup" if check.status == "missing" else line)
    lines.append("")
    lines.append("── Summary ───────────────────────────────")
    lines.append("")

    faulty = [_package_line(check) for check in (*basic, *project) if check.status == "broken"]
    lines.extend(_next_step(state, facts, faulty))
    lines.append("")
    return lines, state


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:
        print(f"doctor: unexpected argument: {' '.join(argv)}", file=sys.stderr)
        return 2

    facts = describe_current()
    basic = [check_import(name) for name in BASIC_PACKAGES]
    project = [check_import(name) for name in PROJECT_PACKAGES]
    lines, state = build_report(facts, basic, project)
    print("\n".join(lines))
    return 1 if is_faulty(state, basic, project) else 0


if __name__ == "__main__":
    raise SystemExit(main())
