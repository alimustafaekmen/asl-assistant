# Tooling Scripts

Environment diagnosis and setup policy for the repository's own commands. These
are developer tools: they touch no model, dataset or deploy artifact.

| Script | Purpose |
|---|---|
| `environment.py` | Pure environment detection and setup policy; imported, not run |
| `doctor.py` | Report the active Python environment. Installs nothing |
| `setup_guard.py` | Refuse `make setup` when it would install into the wrong environment |

Run from the repository root:

```bash
# Run from any configured Python environment.
make doctor
```

## Why these are not in the Makefile

The detection logic used to live in the Makefile as embedded Python source. It
worked, but nothing could import it, so the only way to check that it told a
missing package from a broken one was to search the Makefile for a line of
code. That is a test of how something is written rather than what it does, and
it passed while `make doctor` still exited zero for an environment whose
packages would not import.

`environment.py` takes the facts it needs as arguments and returns a decision.
Every state the commands distinguish — Apple CommandLineTools, conda base, an
interpreter outside the active environment, a missing package, a package that
is installed but raises on import — can be built in a test without arranging a
real interpreter to be in that state.

## Exit codes

| Code | `doctor.py` | `setup_guard.py` |
|---:|---|---|
| 0 | environment described | safe to install into |
| 1 | a package is installed but cannot be imported | — |
| 2 | bad usage | refused; the message names the environment and a way out |

A missing package leaves `doctor.py` at 0: that is a step the user has yet to
take, and the report says which one. A package that is present but raises is a
fault, so it is not reported as success.
