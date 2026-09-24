#!/usr/bin/env python3
"""Report the active Python environment. Installs nothing.

Bu komut aktif Python ortamini raporlar; kurulum yapmaz.

Diagnosis and setup are separate commands on purpose: reading this report must
never change the environment it is describing.

Exit codes:
  0  the environment was described; any problem found is a step the user has
     yet to take, such as running setup
  1  a package is installed but cannot be imported, which is a fault rather
     than a missing step
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
        return f"  X {check.name} yok"
    if check.status == "broken":
        return f"  X {check.name} import bozuk ({check.error})"
    if check.version:
        return f"  + {check.name} {check.version}"
    return f"  + {check.name} (kurulu, surum okunamadi)"


def _warnings(facts: EnvironmentFacts) -> list[list[str]]:
    """Every condition worth flagging, not just the one that names the state."""
    blocks: list[list[str]] = []
    if is_apple_command_line_tools(facts):
        blocks.append(
            [
                "UYARI: Apple CommandLineTools Python kullaniliyor.",
                '  Bu Python ile "make setup" CALISTIRILAMAZ (guard tarafindan engellenir).',
                "  Cozum:",
                "    Conda : conda activate YOUR_ENV_NAME && make setup",
                "    venv  : python3 -m venv .venv && source .venv/bin/activate && make setup",
                "    Override: make setup PYTHON=$CONDA_PREFIX/bin/python",
            ]
        )
    if is_conda_base(facts):
        blocks.append(
            [
                "UYARI: Conda/Miniforge base Python kullaniliyor.",
                '  Bu proje icin "make setup" base ortamiyla onerilmez ve default olarak BLOKLANIR.',
                "  Sebep: base ortami bircok proje tarafindan paylasilir, kolay kirlenir.",
                "  Proje ortamini aktive et:",
                "    conda activate YOUR_ENV_NAME  # kendi ortam adinizi kullanin",
                "  veya yeni venv:",
                "    python3 -m venv .venv && source .venv/bin/activate && make setup",
            ]
        )
    if facts.conda_prefix and facts.conda_prefix not in facts.executable:
        blocks.append(
            [
                "UYARI: Conda aktif ($CONDA_PREFIX dolu) ama secilen Python conda ortaminda DEGIL.",
                f"  CONDA_PREFIX   = {facts.conda_prefix}",
                f"  sys.executable = {facts.executable}",
                "  Cozum: make doctor PYTHON=$CONDA_PREFIX/bin/python",
            ]
        )
    if facts.virtual_env and facts.virtual_env not in facts.executable:
        blocks.append(
            [
                "UYARI: venv aktif ($VIRTUAL_ENV dolu) ama secilen Python venv icinde DEGIL.",
                f"  VIRTUAL_ENV    = {facts.virtual_env}",
                f"  sys.executable = {facts.executable}",
                "  Cozum: make doctor PYTHON=$VIRTUAL_ENV/bin/python",
            ]
        )
    if facts.system == "Windows":
        blocks.append(
            [
                "NOT: Windows algilandi.",
                "  Makefile Git Bash / WSL / make saglayan terminalde calisir.",
                "  PowerShell/cmd icin manuel komutlar: docs/getting-started.md",
            ]
        )
    return blocks


def _next_step(state: str, facts: EnvironmentFacts, faults: list[str]) -> list[str]:
    """What the user should do about the state, as report lines."""
    label = environment_label(facts)

    if state == "apple_clt":
        return [
            "  Hatali Python secilmis: Apple CommandLineTools Python.",
            "",
            "Cozum:",
            "  conda activate YOUR_ENV_NAME",
            "  make doctor",
            "",
            "Eger hala yanlissa:",
            "  make doctor PYTHON=$CONDA_PREFIX/bin/python",
        ]
    if state == "base":
        return [
            "  Conda/Miniforge base ortam kullaniliyor. Bu proje icin ONERILMEZ.",
            "",
            "Cozum:",
            "  conda activate YOUR_ENV_NAME",
            "  make doctor",
            "",
            "Veya yeni venv:",
            "  python3 -m venv .venv && source .venv/bin/activate",
            "  make doctor",
        ]
    if state == "mismatch":
        which = active_environment_mismatch(facts)
        variable = "$CONDA_PREFIX" if which == "conda" else "$VIRTUAL_ENV"
        return [
            "  Aktif ortam ile secilen Python uyusmuyor.",
            "",
            "Cozum:",
            f"  make doctor PYTHON={variable}/bin/python",
        ]
    if state == "basic_missing":
        return [
            "  Bazi temel paketler eksik (pytest/onnxruntime/numpy).",
            "",
            "Sonraki adim:",
            "  make setup",
            "  make doctor",
        ]
    if state == "basic_broken":
        return [
            "  Temel paketler bulundu ancak en az biri import edilemiyor.",
            *faults,
            "",
            "Paket kurulumu veya native kutuphane uyumunu kontrol edin.",
        ]
    if state == "needs_setup":
        lines = [
            f"  Ortam dogru gorunuyor (conda env: {label}), ama proje paketleri kurulmamis."
            if label
            else "  Ortam dogru gorunuyor, ama proje paketleri kurulmamis.",
            "",
            "Sonraki adim:",
            "  make setup",
            "  make doctor",
            "",
            "Web demo icin (proje paketleri gerekmez):",
            "  make web",
        ]
        return lines
    if state == "project_broken":
        return [
            "  Proje paketleri bulundu ancak import edilemiyor.",
            *faults,
            "",
            "Sonraki adim: make setup; sonra make doctor",
        ]

    ready = "  + Python ortami hazir."
    if label:
        ready = f"  + Python ortami hazir (conda env: {label})."
    elif facts.virtual_env:
        ready = "  + Python ortami hazir (venv aktif)."
    return [
        ready,
        "",
        "Gunluk komutlar:",
        "  make web                # web demoyu localde ac",
        "  make validate           # asset/model/data saglik kontrolu",
        "  make test               # hizli unit testler",
        "  make validate-full      # kapsamli asset kontrolu",
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
        f"CONDA_PREFIX      : {facts.conda_prefix or '(bos)'}",
        f"CONDA_DEFAULT_ENV : {facts.conda_default_env or '(bos)'}",
        f"VIRTUAL_ENV       : {facts.virtual_env or '(bos)'}",
        "",
        "── Python ────────────────────────────────",
        f"PYTHON (Make var) : {facts.make_python_var or '(unknown)'}",
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
        lines.append("Ortam uyarisi yok.")
        lines.append("")

    lines.append("── Paket import kontrolu ────────────────")
    lines.append("")
    lines.append("Temel paketler (validation/test icin gerekli):")
    lines.extend(_package_line(check) for check in basic)
    lines.append("")
    lines.append("Proje paketleri (editable install — make setup ile gelir):")
    for check in project:
        line = _package_line(check)
        lines.append(f"{line} -> make setup gerekli" if check.status == "missing" else line)
    lines.append("")
    lines.append("── Durum ozeti ───────────────────────────")
    lines.append("")

    faulty = [_package_line(check) for check in (*basic, *project) if check.status == "broken"]
    lines.extend(_next_step(state, facts, faulty))
    lines.append("")
    return lines, state


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:
        print(f"doctor: beklenmeyen argüman: {' '.join(argv)}", file=sys.stderr)
        return 2

    facts = describe_current()
    basic = [check_import(name) for name in BASIC_PACKAGES]
    project = [check_import(name) for name in PROJECT_PACKAGES]
    lines, state = build_report(facts, basic, project)
    print("\n".join(lines))
    return 1 if is_faulty(state, basic, project) else 0


if __name__ == "__main__":
    raise SystemExit(main())
