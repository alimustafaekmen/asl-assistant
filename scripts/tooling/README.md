# Tooling

Environment diagnosis and the setup policy behind `make doctor` and
`make setup`. These are developer tools: they touch no model, dataset or deploy
artifact.

| Script | Purpose |
|---|---|
| `environment.py` | Detects the active Python environment and decides what setup may do; imported by the other two, not run |
| `doctor.py` | Reports the active environment and whether `pytest`, `onnxruntime`, `numpy`, `asl_ml` and `asl_desktop` import. Installs nothing |
| `setup_guard.py` | Refuses `make setup` when it would install into the wrong environment |

```bash
make doctor                                   # report; installs nothing
make doctor PYTHON=$CONDA_PREFIX/bin/python   # check a specific interpreter
make setup                                    # runs setup_guard.py first, then installs
```

`make setup` installs editable copies of `asl-ml` and `asl-desktop`. Against
Apple's CommandLineTools Python or a shared conda base environment that would
pollute something other work depends on, and against an interpreter outside the
activated environment it would install somewhere you are not looking. None of
those failures is obvious afterwards, so the guard blocks them before anything
is written and the message names the environment and a way out.

## Why this is Python and not Makefile

The detection logic is a function of a few facts: the interpreter path, the
conda prefix, the virtual environment, and what each package does on import.
`environment.py` takes those facts as arguments and returns a decision, so every
state the commands distinguish (CommandLineTools, conda base, an interpreter
outside the active environment, a missing package, a package that is installed
but raises on import) can be built in a test without arranging a real
interpreter to be in that state. `tests/scripts/test_environment_detection.py`
and `test_environment_tooling.py` do that, and run the commands to read their
exit codes.

## Exit codes

| Code | `doctor.py` | `setup_guard.py` |
|---:|---|---|
| 0 | environment described | safe to install into |
| 1 | a package is installed but cannot be imported | not used |
| 2 | bad usage (any argument) | refused, or bad usage |

A missing package leaves `doctor.py` at 0: that is a step you have yet to take,
and the report says which one. A package that is present but raises on import is
a fault, so it is not reported as success.
