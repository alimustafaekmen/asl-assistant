"""generate_word_onnx_test_sample.py when ONNX Runtime is not installed."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = PROJECT_ROOT / "scripts" / "validation" / "generate_word_onnx_test_sample.py"

# A None entry in sys.modules makes `import onnxruntime` raise ImportError, the
# same as an environment without the package.
RUN_WITHOUT_ORT = (
    "import runpy, sys\n"
    "sys.modules['onnxruntime'] = None\n"
    f"sys.argv = [{str(SCRIPT)!r}, *sys.argv[1:]]\n"
    f"runpy.run_path({str(SCRIPT)!r}, run_name='__main__')\n"
)


def run_without_onnxruntime(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", RUN_WITHOUT_ORT, *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_help_works_without_onnxruntime() -> None:
    result = run_without_onnxruntime("--help")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "--write-notebooks" in result.stdout


def test_a_real_run_without_onnxruntime_says_how_to_install_it() -> None:
    result = run_without_onnxruntime()

    assert result.returncode == 1
    assert "onnxruntime is not installed" in result.stdout
