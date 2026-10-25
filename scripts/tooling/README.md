# Tooling

| Script | Purpose |
|---|---|
| `environment.py` | Detects the active Python environment and decides what setup may do; imported by the other two |
| `doctor.py` | Reports the active environment and whether the packages the project needs import; installs nothing |
| `setup_guard.py` | Stops `make setup` before it installs into the wrong environment |

```bash
python scripts/tooling/doctor.py
```

`make setup` runs the guard first. It refuses Conda's `base` environment,
Apple's Command Line Tools Python and an interpreter outside the active
environment, because an editable install there would change an interpreter
other work depends on. The decision logic takes the interpreter path, the Conda
prefix and the virtual environment as arguments, so the tests in
`tests/scripts/` can cover every case without a real interpreter in that state.

`doctor.py` exits 0 when it could describe the environment, even with a package
missing, and 1 when a package is installed but cannot be imported.
`setup_guard.py` exits 2 when it refuses.
