"""A disposable copy of the checkout for running the validators against.

A validator that has only ever read a healthy tree has not been shown to detect
anything. The `checkout` fixture gives each test its own copy of exactly what
the runtime asset check reads, so a test can break one thing and run the real
command on it.

Large binaries are linked rather than copied to keep the suite fast. Writing
through a link would edit this repository's own file, so every change goes
through `Checkout.write`, which drops the link first.

`run` starts the real command in a new interpreter, which is what a test needs
when the entry point's exit status or the interpreter's imports are the
subject. `check` and `audit` call the runtime asset check's and the project
asset audit's `main(argv)` in this process and return the same kind of
result, for tests about what the checks find. In-process runs import NumPy
and ONNX Runtime once, and build one ONNX Runtime session per model file the
session has not seen: the unchanged letter model is shared by every copy, and
building its session is most of what one check costs.
"""

from __future__ import annotations

import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CHECK_RUNTIME = PROJECT_ROOT / "scripts" / "validation" / "check_runtime_assets.py"

# What check_runtime_assets.py reads, relative to the checkout root.
CHECKED_PATHS = ("asl-web", "models/letter", "models/word", "notebooks/word_50_results")

# Files at least this large are linked; smaller ones are copied.
LINK_THRESHOLD_BYTES = 512 * 1024

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _published_files() -> list[str]:
    """The tracked files under CHECKED_PATHS.

    Tracked files, not whatever happens to be on disk: a local fixture folder or
    an editor's metadata in this checkout must not leak into a copy that a test
    then expects to be clean. Without Git, the tree is what was downloaded.
    """
    try:
        listed = subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "ls-files", "-z", "--", *CHECKED_PATHS],
            capture_output=True,
            check=True,
            timeout=60,
        ).stdout.decode()
    except (OSError, subprocess.CalledProcessError):
        listed = ""
    files = [name for name in listed.split("\0") if name]
    if files:
        return files
    return [
        str(path.relative_to(PROJECT_ROOT))
        for top in CHECKED_PATHS
        for path in (PROJECT_ROOT / top).rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    ]


def _place(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.stat().st_size >= LINK_THRESHOLD_BYTES:
        try:
            os.symlink(source, target)
            return
        except OSError:
            pass  # No symlink permission (Windows): fall back to a copy.
    shutil.copy2(source, target)


class Checkout:
    """A copy of the checked paths, and the runtime asset check run on it."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, name: str) -> Path:
        return self.root / name

    def write(self, name: str, data: bytes | str) -> Path:
        """Replace one file in the copy without touching what a link points to."""
        path = self.path(name)
        if path.is_symlink():
            path.unlink()
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            path.write_text(data, encoding="utf-8")
        else:
            path.write_bytes(data)
        return path

    def remove(self, name: str) -> None:
        self.path(name).unlink()

    def run(
        self, *args: str, pythonpath: Iterable[Path] = (), script: Path = CHECK_RUNTIME
    ) -> subprocess.CompletedProcess[str]:
        """Run a validator on this copy as a user would, in a new interpreter."""
        env = dict(os.environ)
        extra = [str(path) for path in pythonpath]
        if env.get("PYTHONPATH"):
            extra.append(env["PYTHONPATH"])
        if extra:
            env["PYTHONPATH"] = os.pathsep.join(extra)
        return subprocess.run(
            [sys.executable, str(script), "--root", str(self.root), *args],
            cwd=PROJECT_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )

    def check(self, *args: str) -> subprocess.CompletedProcess[str]:
        """The runtime asset check's main() on this copy, in this process."""
        from scripts.validation import check_runtime_assets

        return self._in_process(check_runtime_assets.main, args)

    def audit(self, *args: str) -> subprocess.CompletedProcess[str]:
        """The project asset audit's main() on this copy, in this process."""
        from scripts.validation import verify_project_assets

        return self._in_process(verify_project_assets.main, args)

    def _in_process(
        self, main: Callable[[list[str]], int], args: Iterable[str]
    ) -> subprocess.CompletedProcess[str]:
        argv = ["--root", str(self.root), *args]
        stdout, stderr = io.StringIO(), io.StringIO()
        # An exception is not caught: it fails the test with its traceback,
        # which is what it would print from the real entry point.
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            returncode = main(argv)
        return subprocess.CompletedProcess(argv, returncode, stdout.getvalue(), stderr.getvalue())

    @staticmethod
    def failures(result: subprocess.CompletedProcess[str]) -> list[str]:
        """The checks a run marked as failed, without colour codes or the summary line."""
        lines = (ANSI.sub("", line).strip() for line in result.stdout.splitlines())
        return [line for line in lines if line.startswith("✗")]


@pytest.fixture(scope="session")
def _onnx_sessions() -> Callable[..., object]:
    """ONNX Runtime's session constructor, remembering each model file it loaded.

    A session holds no state between runs, so one per file is enough. The key
    is the file's real path, size and modification time: a copy that links the
    deployed model shares its session, and a model a test writes is a new file
    and gets its own.
    """
    import onnxruntime

    create = onnxruntime.InferenceSession
    sessions: dict[tuple[str, int, int], object] = {}

    def session(path, *args, **kwargs):
        if args or kwargs:
            return create(path, *args, **kwargs)
        stat = os.stat(path)
        key = (os.path.realpath(path), stat.st_size, stat.st_mtime_ns)
        if key not in sessions:
            sessions[key] = create(path)
        return sessions[key]

    return session


@pytest.fixture
def checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _onnx_sessions: Callable[..., object]
) -> Checkout:
    """A healthy copy of everything the runtime asset check reads."""
    import onnxruntime

    # Only the in-process runs see this; a new interpreter builds its own.
    monkeypatch.setattr(onnxruntime, "InferenceSession", _onnx_sessions)
    root = tmp_path / "checkout"
    for name in _published_files():
        source = PROJECT_ROOT / name
        if source.is_file():
            _place(source, root / name)
    return Checkout(root)


class Background:
    """Independent subprocess runs, started together as soon as tests are collected.

    The make target, parity and doctor tests each need a batch of slow
    subprocess runs that do not depend on one another. A module lists them in
    a BACKGROUND_RUNS dict of name -> callable(scratch dir); they all start
    when collection finishes, run alongside the in-process tests, and the
    module's fixture waits for its own. Run one module after another, they
    were the slowest part of the fast suite.
    """

    def __init__(self) -> None:
        self._pool: ThreadPoolExecutor | None = None
        self._started: dict[str, dict[str, Future]] = {}
        self._scratch: list[Path] = []

    def start(self, module: str, runs: dict[str, Callable[[Path], object]]) -> None:
        if module in self._started:
            return
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=16)
        scratch = Path(tempfile.mkdtemp(prefix="asl-background-"))
        self._scratch.append(scratch)
        self._started[module] = {
            name: self._pool.submit(run, scratch / str(index))
            for index, (name, run) in enumerate(runs.items())
        }

    def results(self, module: str, runs: dict[str, Callable[[Path], object]]) -> dict:
        """Every run of `module`, started now if collection did not start it."""
        self.start(module, runs)
        return {name: future.result() for name, future in self._started[module].items()}

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=True, cancel_futures=True)
        for scratch in self._scratch:
            shutil.rmtree(scratch, ignore_errors=True)


BACKGROUND = Background()


def pytest_collection_finish(session: pytest.Session) -> None:
    if session.config.option.collectonly:
        return
    modules = {item.module for item in session.items if isinstance(item, pytest.Function)}
    for module in sorted(modules, key=lambda module: module.__name__):
        runs = getattr(module, "BACKGROUND_RUNS", None)
        if runs:
            BACKGROUND.start(module.__name__, runs)


def pytest_sessionfinish(session: pytest.Session) -> None:
    BACKGROUND.close()


@pytest.fixture(scope="session")
def background() -> Background:
    return BACKGROUND
