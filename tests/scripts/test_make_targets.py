"""The make targets run every step they promise, and fail when any step fails.

The Makefile's gates were guarded by regexes over its text. Those passed with
`node --check` turned into `|| true`, with the parity steps disabled, and with
a `-` in front of the pytest step, because the words were still there. These
tests run the real targets instead, with the external tools they call replaced
by recording stand-ins at the process boundary: the Python interpreter (which
runs ruff, pytest, the validators and the parity scripts), `node`, `git` and
the TypeScript checker. A stand-in exits 0 unless its command line contains
the scenario's failure pattern, so a test can make exactly one step fail and
read make's exit status, and can read which commands each target ran.

The scenarios are independent, so they are BACKGROUND_RUNS: they start
together when collection finishes (see Background in conftest.py) and run
alongside the rest of the suite.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAKE = shutil.which("make")

pytestmark = pytest.mark.skipif(
    MAKE is None or os.name == "nt", reason="needs make and a POSIX shell"
)

# One stand-in for every external command. It appends its name, its arguments
# and the PYTHONPATH it saw to $SHIM_LOG, prints $SHIM_GIT_OUTPUT for
# `git ls-files` (the tracked files that .gitignore matches), and exits 1 when
# its command line contains $SHIM_FAIL.
SHIM = r"""#!/bin/sh
name=$(basename "$0")
line="$name $*"
printf '%s | PYTHONPATH=%s\n' "$line" "$PYTHONPATH" >> "$SHIM_LOG"
if [ "$name" = git ]; then
  case "$line" in *ls-files*) [ -n "$SHIM_GIT_OUTPUT" ] && printf '%s\n' "$SHIM_GIT_OUTPUT";; esac
fi
if [ -n "$SHIM_FAIL" ]; then
  case "$line" in *"$SHIM_FAIL"*) echo "stand-in failed: $line" >&2; exit 1;; esac
fi
exit 0
"""


@dataclass(frozen=True)
class Scenario:
    target: str
    fail: str = ""
    git_output: str = ""
    # No stand-ins on PATH, and only the system directories: no node at all.
    bare_path: bool = False
    # Run in a scratch directory holding these files instead of the checkout.
    tree: tuple[str, ...] = ()
    make_args: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Run:
    returncode: int
    output: str
    calls: list[str]

    def ran(self, fragment: str) -> list[str]:
        """The recorded command lines containing `fragment`."""
        return [call for call in self.calls if fragment in call]


HEALTH_STEPS = {
    "lint": "-m ruff check",
    "format-check": "-m ruff format --check",
    "js-check": "node --check",
    "js-test": "node --test",
    "runtime assets": "check_runtime_assets.py",
    "project assets": "verify_project_assets.py",
    "word parity": "check_word_feature_parity.py",
    "letter parity": "check_letter_feature_parity.py",
    "pytest": "-m pytest",
}

SCENARIOS: dict[str, Scenario] = {
    "health": Scenario("health"),
    **{
        f"health/{step}": Scenario("health", fail=pattern) for step, pattern in HEALTH_STEPS.items()
    },
    "health/git-hygiene": Scenario("health", git_output="Makefile"),
    "check": Scenario("check"),
    "check/type error": Scenario("check", fail="tsc --project"),
    "check/python test": Scenario("check", fail="-m pytest"),
    "validate": Scenario("validate"),
    "validate/js-check": Scenario("validate", fail="node --check"),
    "validate/runtime assets": Scenario("validate", fail="check_runtime_assets.py"),
    "validate-full": Scenario("validate-full"),
    "validate-full/runtime assets": Scenario("validate-full", fail="check_runtime_assets.py"),
    "validate-full/project assets": Scenario("validate-full", fail="verify_project_assets.py"),
    "deploy-check": Scenario("deploy-check"),
    "deploy-check/runtime assets": Scenario("deploy-check", fail="check_runtime_assets.py"),
    "js-check/syntax error": Scenario("js-check", fail="node --check"),
    "js-check/no node": Scenario("js-check", bare_path=True),
    "js-test/no node": Scenario("js-test", bare_path=True),
    "js-test/failing test": Scenario("js-test", fail="node --test"),
    "js-test/test files": Scenario(
        "js-test",
        tree=(
            "tests/web/a.test.js",
            "tests/web/ui/b.test.js",
            "tests/web/c.test.mjs",
            "tests/web/helpers/context.mjs",
            "tests/web/fixtures/data.json",
        ),
    ),
    "parity": Scenario("parity"),
    "parity/word": Scenario("parity", fail="check_word_feature_parity.py"),
    "parity/letter": Scenario("parity", fail="check_letter_feature_parity.py"),
    "quick": Scenario("quick"),
    "quick/failing web test": Scenario("quick", fail="node --test"),
    "test-web": Scenario("test-web"),
    "test-web/one file": Scenario(
        "test-web", make_args=("FILE=tests/web/word-consent.test.js", "NAME=once")
    ),
    "test-web/failing": Scenario("test-web", fail="node --test"),
    "watch-web": Scenario("watch-web", make_args=("FILE=tests/web/word-consent.test.js",)),
    "test-py": Scenario("test-py"),
    "test-py/one file": Scenario(
        "test-py", make_args=("FILE=tests/scripts/test_gzip_copies.py", "K=truncated")
    ),
    "test-py/failing": Scenario("test-py", fail="-m pytest"),
    "test": Scenario("test"),
    "test/failing test": Scenario("test", fail="-m pytest"),
    "test-full": Scenario("test-full"),
    "setup": Scenario("setup"),
    "setup/guard refuses": Scenario(
        "setup",
        fail="setup_guard.py",
        make_args=("ALLOW_BASE_SETUP=1",),
        env={"ALLOW_BASE_SETUP": "1"},
    ),
    "doctor": Scenario("doctor"),
    "doctor/fault": Scenario("doctor", fail="doctor.py"),
    "js-typecheck": Scenario("js-typecheck"),
    "js-typecheck/type error": Scenario("js-typecheck", fail="tsc --project"),
    "git-hygiene": Scenario("git-hygiene"),
    "web": Scenario("web", make_args=("PORT=8123",)),
    "git-hygiene/tracked ignored file": Scenario("git-hygiene", git_output="Makefile"),
}

# What a bare PATH keeps: the system tools make's recipes use, and no node.
SYSTEM_PATH = "/usr/bin:/bin"


def _run(name: str, scenario: Scenario, scratch: Path) -> Run:
    shims = scratch / "bin"
    shims.mkdir(parents=True)
    for tool in ("python", "node", "git", "tsc"):
        (shims / tool).write_text(SHIM, encoding="utf-8")
        (shims / tool).chmod(0o755)
    log = scratch / "calls.log"
    log.touch()

    # A minimal environment. An enclosing make (this suite runs inside make
    # health) exports its flags and every variable given on its command line,
    # such as TEST_FAST, and the run under test must see the Makefile's own.
    env = {key: os.environ[key] for key in ("HOME", "TMPDIR", "LANG") if key in os.environ}
    env.update(scenario.env)
    env.update(SHIM_LOG=str(log), SHIM_FAIL=scenario.fail, SHIM_GIT_OUTPUT=scenario.git_output)
    inherited = os.environ.get("PATH", SYSTEM_PATH)
    env["PATH"] = SYSTEM_PATH if scenario.bare_path else f"{shims}{os.pathsep}{inherited}"

    command = [MAKE, "--no-print-directory"]
    cwd = PROJECT_ROOT
    if scenario.tree:
        cwd = scratch / "tree"
        for name_in_tree in scenario.tree:
            (cwd / name_in_tree).parent.mkdir(parents=True, exist_ok=True)
            (cwd / name_in_tree).write_text("", encoding="utf-8")
        command += ["-f", str(PROJECT_ROOT / "Makefile")]
    command += [
        scenario.target,
        f"PYTHON={shims / 'python'}",
        f"TSC={shims / 'tsc'}",
        *scenario.make_args,
    ]
    result = subprocess.run(
        command, cwd=cwd, env=env, capture_output=True, text=True, timeout=300, check=False
    )
    calls = log.read_text(encoding="utf-8").splitlines()
    return Run(result.returncode, result.stdout + result.stderr, calls)


BACKGROUND_RUNS = (
    {}
    if MAKE is None or os.name == "nt"
    else {name: partial(_run, name, scenario) for name, scenario in SCENARIOS.items()}
)


@pytest.fixture(scope="module")
def runs(background) -> dict[str, Run]:
    return background.results(__name__, BACKGROUND_RUNS)


def _files(root: Path, *patterns: str) -> set[str]:
    return {
        path.relative_to(PROJECT_ROOT).as_posix()
        for pattern in patterns
        for path in root.rglob(pattern)
    }


def _arguments(call: str) -> list[str]:
    return call.split(" | PYTHONPATH=", 1)[0].split()[1:]


# ── health ──────────────────────────────────────────────────────────────


def test_health_runs_every_step_and_reports_success(runs: dict[str, Run]) -> None:
    run = runs["health"]

    assert run.returncode == 0, run.output
    assert "Project health OK" in run.output
    for step, pattern in HEALTH_STEPS.items():
        assert run.ran(pattern), f"health did not run {step}"
    assert run.ran("git ls-files"), "health did not run git-hygiene"


@pytest.mark.parametrize("step", [*HEALTH_STEPS, "git-hygiene"])
def test_a_failing_step_fails_health(runs: dict[str, Run], step: str) -> None:
    """A `-` prefix or `|| true` on any step would let health report success."""
    run = runs[f"health/{step}"]

    assert run.returncode != 0, run.output
    assert "Project health OK" not in run.output


def test_health_checks_the_syntax_of_every_web_script(runs: dict[str, Run]) -> None:
    checked = {_arguments(call)[-1] for call in runs["health"].ran("node --check")}

    assert checked == _files(PROJECT_ROOT / "asl-web" / "js", "*.js")


def test_health_runs_every_web_test_file(runs: dict[str, Run]) -> None:
    """A narrowed glob dropped the consent and mask-polarity tests unnoticed."""
    (call,) = runs["health"].ran("node --test")
    expected = _files(PROJECT_ROOT / "tests" / "web", "*.test.js", "*.test.mjs")

    assert set(_arguments(call)[1:]) == expected


def test_health_does_not_need_the_type_checker(runs: dict[str, Run]) -> None:
    """health must work in a clone with no npm install; js-typecheck needs one."""
    assert runs["health"].ran("tsc") == []


def test_check_runs_health_and_the_type_checker(runs: dict[str, Run]) -> None:
    """A JSDoc type error passed health; check is the gate that sees it."""
    run = runs["check"]

    assert run.returncode == 0, run.output
    assert "Project health OK" in run.output
    assert run.ran("tsc --project")
    for scenario in ("check/type error", "check/python test"):
        assert runs[scenario].returncode != 0, runs[scenario].output
        assert "Check OK" not in runs[scenario].output


# ── validate, validate-full, deploy-check ───────────────────────────────


def test_validate_checks_the_web_scripts_then_the_runtime_assets(runs: dict[str, Run]) -> None:
    run = runs["validate"]

    assert run.returncode == 0, run.output
    checked = {_arguments(call)[-1] for call in run.ran("node --check")}
    assert checked == _files(PROJECT_ROOT / "asl-web" / "js", "*.js")
    assert run.ran("check_runtime_assets.py")


@pytest.mark.parametrize(
    "scenario",
    [
        "validate/js-check",
        "validate/runtime assets",
        "validate-full/runtime assets",
        "validate-full/project assets",
        "deploy-check/runtime assets",
    ],
)
def test_a_failing_validation_step_fails_the_target(runs: dict[str, Run], scenario: str) -> None:
    assert runs[scenario].returncode != 0, runs[scenario].output


def test_validate_full_runs_both_validators(runs: dict[str, Run]) -> None:
    run = runs["validate-full"]

    assert run.returncode == 0, run.output
    assert run.ran("check_runtime_assets.py") and run.ran("verify_project_assets.py")


def test_deploy_check_runs_the_inventory(runs: dict[str, Run]) -> None:
    run = runs["deploy-check"]

    assert run.returncode == 0, run.output
    assert any("--deploy" in _arguments(call) for call in run.ran("check_runtime_assets.py"))


def test_parity_runs_both_feature_checks_and_fails_with_either(runs: dict[str, Run]) -> None:
    run = runs["parity"]

    assert run.returncode == 0, run.output
    assert run.ran("check_word_feature_parity.py") and run.ran("check_letter_feature_parity.py")
    assert runs["parity/word"].returncode != 0
    assert runs["parity/letter"].returncode != 0


# ── js-check, js-test, js-typecheck ─────────────────────────────────────


def test_a_syntax_error_fails_js_check(runs: dict[str, Run]) -> None:
    run = runs["js-check/syntax error"]

    assert run.returncode != 0, run.output
    assert "syntax kontrolü tamamlandı" not in run.output


@pytest.mark.parametrize("target", ["js-check", "js-test"])
def test_the_web_checks_fail_and_say_so_without_node(runs: dict[str, Run], target: str) -> None:
    run = runs[f"{target}/no node"]

    assert run.returncode != 0, run.output
    assert "Node.js bulunamadı" in run.output


def test_a_failing_web_test_fails_js_test(runs: dict[str, Run]) -> None:
    assert runs["js-test/failing test"].returncode != 0


def test_js_test_runs_every_test_file_and_nothing_else(runs: dict[str, Run]) -> None:
    """Nested folders and .test.mjs count; helpers and fixtures are not tests.

    The helpers are already .mjs, so a new test written as .test.mjs is the
    natural next file, and the glob skipped it: a failing one passed health.
    """
    run = runs["js-test/test files"]

    assert run.returncode == 0, run.output
    (call,) = run.ran("node --test")
    assert set(_arguments(call)[1:]) == {
        "tests/web/a.test.js",
        "tests/web/ui/b.test.js",
        "tests/web/c.test.mjs",
    }


def test_js_typecheck_runs_the_checker_and_fails_with_it(runs: dict[str, Run]) -> None:
    assert runs["js-typecheck"].returncode == 0, runs["js-typecheck"].output
    assert runs["js-typecheck"].ran("tsc --project")
    assert runs["js-typecheck/type error"].returncode != 0


# ── the inner loop: quick, test-web, watch-web, test-py ─────────────────


def test_quick_runs_lint_format_and_the_web_tests_only(runs: dict[str, Run]) -> None:
    run = runs["quick"]

    assert run.returncode == 0, run.output
    for pattern in ("-m ruff check", "-m ruff format --check", "node --test"):
        assert run.ran(pattern), pattern
    assert run.ran("-m pytest") == [] and run.ran("check_runtime_assets.py") == []
    assert runs["quick/failing web test"].returncode != 0


def test_test_web_runs_every_web_test_by_default(runs: dict[str, Run]) -> None:
    (call,) = runs["test-web"].ran("node --test")

    assert set(_arguments(call)[1:]) == _files(
        PROJECT_ROOT / "tests" / "web", "*.test.js", "*.test.mjs"
    )
    assert runs["test-web/failing"].returncode != 0


def test_test_web_narrows_to_a_file_and_a_test_name(runs: dict[str, Run]) -> None:
    (call,) = runs["test-web/one file"].ran("node --test")

    assert _arguments(call) == [
        "--test",
        "--test-name-pattern=once",
        "tests/web/word-consent.test.js",
    ]


def test_watch_web_reruns_the_given_file(runs: dict[str, Run]) -> None:
    (call,) = runs["watch-web"].ran("node --test")

    assert _arguments(call) == ["--test", "--watch", "tests/web/word-consent.test.js"]


def test_test_py_narrows_to_a_file_and_a_keyword(runs: dict[str, Run]) -> None:
    default = _pytest_paths(runs["test-py"])
    (call,) = runs["test-py/one file"].ran("-m pytest")

    assert default == _pytest_paths(runs["test"]), "without FILE it runs the fast suite"
    assert _arguments(call)[2:] == ["-rs", "tests/scripts/test_gzip_copies.py", "-k", "truncated"]
    assert str(PROJECT_ROOT / "asl-ml" / "src") in call.split(" | PYTHONPATH=", 1)[1]
    assert runs["test-py/failing"].returncode != 0


# ── test, test-full ─────────────────────────────────────────────────────


def _pytest_paths(run: Run) -> list[str]:
    (call,) = run.ran("-m pytest")
    return [arg.rstrip("/") for arg in _arguments(call)[2:] if not arg.startswith("-")]


def _covered(test_file: str, paths: list[str]) -> bool:
    return any(test_file == path or test_file.startswith(f"{path}/") for path in paths)


def test_make_test_runs_every_fast_test_with_the_source_packages_importable(
    runs: dict[str, Run],
) -> None:
    """The desktop integration tests need MediaPipe and a model file; the rest are fast."""
    run = runs["test"]
    paths = _pytest_paths(run)
    test_files = _files(PROJECT_ROOT / "tests", "test_*.py")
    integration = {name for name in test_files if name.startswith("tests/asl_desktop/integration/")}

    assert run.returncode == 0, run.output
    assert sorted(name for name in test_files - integration if not _covered(name, paths)) == []
    assert not any(_covered(name, paths) for name in integration)
    (call,) = run.ran("-m pytest")
    pythonpath = call.split(" | PYTHONPATH=", 1)[1].split(os.pathsep)
    assert str(PROJECT_ROOT / "asl-ml" / "src") in pythonpath
    assert str(PROJECT_ROOT / "asl-desktop" / "src") in pythonpath


def test_make_test_runs_pytest_and_nothing_before_it(runs: dict[str, Run]) -> None:
    """pytest reports a missing package itself, as a failure.

    The recipe once probed for the packages first and printed a warning
    instead, so an environment without them ran no test and exited 0.
    """
    assert [call.split(" | ")[0].split()[:3] for call in runs["test"].calls] == [
        ["python", "-m", "pytest"]
    ]


def test_make_test_full_runs_every_python_test(runs: dict[str, Run]) -> None:
    paths = _pytest_paths(runs["test-full"])

    assert (
        sorted(
            name
            for name in _files(PROJECT_ROOT / "tests", "test_*.py")
            if not _covered(name, paths)
        )
        == []
    )


@pytest.mark.parametrize("scenario", ["test", "test-full", "health"])
def test_pytest_prints_why_each_test_was_skipped(runs: dict[str, Run], scenario: str) -> None:
    """Two lost model files once showed only as 2 skips becoming 4."""
    (call,) = runs[scenario].ran("-m pytest")

    assert "-rs" in _arguments(call)


def test_a_failing_python_test_fails_make_test(runs: dict[str, Run]) -> None:
    assert runs["test/failing test"].returncode != 0


# ── setup, doctor, git-hygiene ──────────────────────────────────────────


def test_setup_installs_the_requirements_and_the_two_local_packages(runs: dict[str, Run]) -> None:
    run = runs["setup"]
    installs = [_arguments(call) for call in run.ran("-m pip install")]

    assert run.returncode == 0, run.output
    assert run.calls[0].split(" | ")[0].endswith("setup_guard.py"), "the guard runs first"
    assert installs == [
        ["-m", "pip", "install", "-r", "requirements-dev.txt"],
        ["-m", "pip", "install", "--no-deps", "-e", "./asl-ml"],
        ["-m", "pip", "install", "--no-deps", "-e", "./asl-desktop"],
    ]


def test_setup_installs_nothing_when_the_guard_refuses(runs: dict[str, Run]) -> None:
    """No variable may turn the refusal into an install into a shared environment."""
    run = runs["setup/guard refuses"]

    assert run.returncode != 0, run.output
    assert run.ran("pip") == []


def test_doctor_takes_its_exit_status_from_the_report(runs: dict[str, Run]) -> None:
    assert runs["doctor"].returncode == 0, runs["doctor"].output
    assert runs["doctor"].ran("doctor.py")
    assert runs["doctor/fault"].returncode != 0


def test_web_serves_the_web_folder_with_the_standard_library(runs: dict[str, Run]) -> None:
    """The stand-in returns at once, so the server is recorded, never started."""
    run = runs["web"]

    assert run.returncode == 0, run.output
    assert [_arguments(call) for call in run.ran("http.server")] == [["-m", "http.server", "8123"]]
    assert "http://localhost:8123" in run.output


def test_git_hygiene_fails_on_a_tracked_file_that_gitignore_matches(runs: dict[str, Run]) -> None:
    assert runs["git-hygiene"].returncode == 0, runs["git-hygiene"].output
    run = runs["git-hygiene/tracked ignored file"]

    assert run.returncode != 0, run.output
    assert "Makefile" in run.output
