from app.adapters.base import (
    BaseModelAdapter,
    ModelType,
    ModelStatus,
    ModelAdapterError,
    ModelInitializationError,
    ModelNotReadyError,
    ModelInferenceError,
    ModelConnectionError,
    ModelCleanupError,
    LocalPredictor,
    ApiClient,
)

__all__ = [
    "BaseModelAdapter",
    "ModelType",
    "ModelStatus",
    "ModelAdapterError",
    "ModelInitializationError",
    "ModelNotReadyError",
    "ModelInferenceError",
    "ModelConnectionError",
    "ModelCleanupError",
    "LocalPredictor",
    "ApiClient",
    "LocalModelAdapter",
    "ExternalApiModelAdapter",
]


def __getattr__(name):
    # Keep package imports lightweight for native inference providers. The
    # LocalModelAdapter imports PyTorch, which whisper.cpp does not need.
    if name == "LocalModelAdapter":
        from app.adapters.local_adapter import LocalModelAdapter
        return LocalModelAdapter
    if name == "ExternalApiModelAdapter":
        from app.adapters.api_adapter import ExternalApiModelAdapter
        return ExternalApiModelAdapter
    raise AttributeError(name)
