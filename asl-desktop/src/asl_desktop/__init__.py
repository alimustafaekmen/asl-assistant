"""Desktop prototype package initialization."""

import sys

# On macOS, importing PyTorch before LightGBM can load incompatible OpenMP
# runtimes and crash the process during prediction or shutdown. Preload the
# optional letter-model runtime first; lightweight installations may omit it.
if sys.platform == "darwin":
    try:
        import lightgbm as _lightgbm
    except (ImportError, OSError):
        _lightgbm = None
