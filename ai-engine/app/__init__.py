import importlib

import numpy as np

# Compatibility shims for legacy numpy aliases (removed in numpy 2.x).
# setattr is used so static type checkers don't flag missing attributes.
if not hasattr(np, "NaN"):
    setattr(np, "NaN", np.nan)
if not hasattr(np, "NAN"):
    setattr(np, "NAN", np.nan)
if not hasattr(np, "float_"):
    setattr(np, "float_", float)
if not hasattr(np, "int_"):
    setattr(np, "int_", int)

try:
    torchaudio = importlib.import_module("torchaudio")
    if not hasattr(torchaudio, "set_audio_backend"):
        setattr(torchaudio, "set_audio_backend", lambda x: None)
except ImportError:
    pass
