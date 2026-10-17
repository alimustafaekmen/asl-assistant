"""Environment states the setup and doctor commands distinguish.

Each state is built as plain facts rather than by arranging a real interpreter
to be in it, so every path can be tested on any machine.
"""

from __future__ import annotations

import pytest

from scripts.tooling.environment import (
    EnvironmentFacts,
    ImportCheck,
    active_environment_mismatch,
    environment_label,
    is_apple_command_line_tools,
    is_conda_base,
    is_faulty,
    resolve_state,
    setup_block_reason,
)
from scripts.tooling.setup_guard import block_message

OK = [ImportCheck("pytest", "ok", "8.0"), ImportCheck("numpy", "ok", "1.26")]
PROJECT_OK = [ImportCheck("asl_features", "ok", "0.1.0"), ImportCheck("asl_desktop", "ok")]


def facts(**overrides: str) -> EnvironmentFacts:
    base = {"executable": "/home/u/envs/project/bin/python"}
    base.update(overrides)
    return EnvironmentFacts(**base)


class TestCondaBase:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"conda_default_env": "base"},
            {"conda_prefix": "/opt/miniforge/base"},
            {"executable": "/usr/local/Caskroom/miniforge/base/bin/python"},
            {"executable": "/opt/miniconda/base/bin/python"},
            {"executable": r"C:\tools\miniforge\base\python.exe"},
        ],
    )
    def test_base_installations_are_recognised(self, kwargs: dict[str, str]) -> None:
        assert is_conda_base(facts(**kwargs)) is True

    @pytest.mark.parametrize(
        "executable",
        [
            # A project environment created under a base installation carries
            # the base marker in its path but is not base.
            "/usr/local/Caskroom/miniforge/base/envs/project/bin/python",
            "/opt/miniconda/base/envs/project/bin/python",
            r"C:\tools\miniforge\base\envs\project\python.exe",
            "/usr/bin/python3",
        ],
    )
    def test_project_environments_are_not_base(self, executable: str) -> None:
        assert is_conda_base(facts(executable=executable)) is False


def test_apple_command_line_tools_is_recognised() -> None:
    clt = "/Library/Developer/CommandLineTools/usr/bin/python3"
    assert is_apple_command_line_tools(facts(executable=clt)) is True
    assert is_apple_command_line_tools(facts()) is False


class TestMismatch:
    def test_an_interpreter_outside_the_active_conda_environment(self) -> None:
        assert active_environment_mismatch(facts(conda_prefix="/other/env")) == "conda"

    def test_an_interpreter_outside_the_active_venv(self) -> None:
        assert active_environment_mismatch(facts(virtual_env="/other/venv")) == "venv"

    def test_an_interpreter_inside_the_active_environment(self) -> None:
        inside = facts(conda_prefix="/home/u/envs/project")
        assert active_environment_mismatch(inside) == ""


def test_environment_label_names_the_conda_environment() -> None:
    assert environment_label(facts(conda_prefix="/home/u/envs/project")) == "project"
    # A base installation is not a project environment, so it has no label.
    assert environment_label(facts(conda_prefix="/opt/miniforge/base")) == ""
    assert environment_label(facts()) == ""


class TestResolveState:
    def test_a_working_environment_is_ready(self) -> None:
        assert resolve_state(facts(), OK, PROJECT_OK) == "ready"

    def test_a_missing_project_package_asks_for_setup(self) -> None:
        project = [ImportCheck("asl_features", "missing"), ImportCheck("asl_desktop", "ok")]
        assert resolve_state(facts(), OK, project) == "needs_setup"

    def test_a_broken_package_is_separate_from_a_missing_one(self) -> None:
        broken = [ImportCheck("onnxruntime", "broken", error="ImportError")]
        assert resolve_state(facts(), broken, PROJECT_OK) == "basic_broken"

        project_broken = [ImportCheck("asl_features", "broken", error="OSError")]
        assert resolve_state(facts(), OK, project_broken) == "project_broken"

    def test_a_wrong_interpreter_outranks_any_package_result(self) -> None:
        """Package results mean nothing if they came from the wrong Python."""
        missing = [ImportCheck("pytest", "missing")]
        wrong = facts(executable="/Library/Developer/CommandLineTools/usr/bin/python3")
        assert resolve_state(wrong, missing, PROJECT_OK) == "apple_clt"
        assert resolve_state(facts(conda_default_env="base"), missing, PROJECT_OK) == "base"
        assert resolve_state(facts(conda_prefix="/other"), missing, PROJECT_OK) == "mismatch"


class TestSetupPolicy:
    @pytest.mark.parametrize(
        ("overrides", "reason"),
        [
            ({"executable": "/Library/Developer/CommandLineTools/usr/bin/python3"}, "apple_clt"),
            ({"conda_default_env": "base"}, "base"),
            ({"conda_prefix": "/other/env"}, "conda"),
            ({"virtual_env": "/other/venv"}, "venv"),
        ],
    )
    def test_setup_is_refused_for_every_unsafe_target(
        self, overrides: dict[str, str], reason: str
    ) -> None:
        assert setup_block_reason(facts(**overrides)) == reason

    def test_setup_proceeds_in_a_project_environment(self) -> None:
        assert setup_block_reason(facts(conda_prefix="/home/u/envs/project")) == ""

    @pytest.mark.parametrize("reason", ["apple_clt", "base", "conda", "venv"])
    def test_every_refusal_names_itself_and_a_way_out(self, reason: str) -> None:
        message = block_message(reason, facts(conda_prefix="/other", virtual_env="/other"))

        assert message.startswith("[BLOCK]")
        assert "make setup" in message or "make doctor" in message


class TestFaultReporting:
    """Which environments leave `make doctor` non-zero.

    The distinction is between a step the user has yet to take and something
    that is actually wrong, and it is read from the checks rather than from the
    single state label the report leads with.
    """

    def test_a_missing_package_is_not_a_fault(self) -> None:
        basic = [ImportCheck("pytest", "missing")]
        assert is_faulty(resolve_state(facts(), basic, PROJECT_OK), basic, PROJECT_OK) is False

    def test_a_broken_package_is_a_fault(self) -> None:
        basic = [ImportCheck("onnxruntime", "broken", error="ImportError")]
        assert is_faulty(resolve_state(facts(), basic, PROJECT_OK), basic, PROJECT_OK) is True

    @pytest.mark.parametrize(
        ("basic", "project"),
        [
            # The report leads with the missing package because installing it
            # is the more actionable step, but the broken one is still broken.
            (
                [ImportCheck("pytest", "missing"), ImportCheck("onnxruntime", "broken", error="E")],
                PROJECT_OK,
            ),
            (
                OK,
                [
                    ImportCheck("asl_features", "missing"),
                    ImportCheck("asl_desktop", "broken", error="E"),
                ],
            ),
            (
                [ImportCheck("pytest", "missing")],
                [ImportCheck("asl_features", "broken", error="E")],
            ),
        ],
    )
    def test_a_fault_survives_a_missing_package_alongside_it(
        self, basic: list[ImportCheck], project: list[ImportCheck]
    ) -> None:
        state = resolve_state(facts(), basic, project)

        assert is_faulty(state, basic, project) is True

    def test_package_results_from_the_wrong_interpreter_prove_nothing(self) -> None:
        """A wrong interpreter makes every package result describe the wrong env."""
        broken = [ImportCheck("onnxruntime", "broken", error="E")]
        for wrong in (
            facts(executable="/Library/Developer/CommandLineTools/usr/bin/python3"),
            facts(conda_default_env="base"),
            facts(conda_prefix="/other/env"),
        ):
            state = resolve_state(wrong, broken, PROJECT_OK)
            assert is_faulty(state, broken, PROJECT_OK) is False, state

    def test_a_healthy_environment_is_not_a_fault(self) -> None:
        assert is_faulty(resolve_state(facts(), OK, PROJECT_OK), OK, PROJECT_OK) is False
