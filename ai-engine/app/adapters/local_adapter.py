import logging
import gc
import inspect
from typing import Any, Optional, Dict, Callable
import torch

from app.adapters.base import (
    BaseModelAdapter,
    ModelType,
    ModelStatus,
    ModelInitializationError,
    ModelNotReadyError,
    ModelInferenceError,
    ModelCleanupError,
    LocalPredictor,
)

logger = logging.getLogger("smartrec.local_adapter")


class LocalModelAdapter(BaseModelAdapter):
    """
    Adapter chuyên biệt cho các mô hình Local Pretrained Models (chạy offline trên GPU/CPU).
    """

    def __init__(
        self,
        model_name: str,
        loader_fn: Optional[Callable[..., Any]] = None,
        version: str = "1.0.0",
        device: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            model_name=model_name,
            model_type=ModelType.LOCAL,
            version=version,
            config=config or {}
        )
        self._device = device or self._detect_optimal_device()
        self._loader_fn = loader_fn
        self._predictor: Optional[Any] = None

    @property
    def device(self) -> str:
        """Thiết bị tính toán mục tiêu của local model (Read-only)."""
        return self._device

    def _detect_optimal_device(self) -> str:
        """Tự động phát hiện phần cứng tối ưu theo thứ tự: CUDA -> MPS -> CPU."""
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def load(self) -> None:
        """
        Nạp model và weights vào bộ nhớ thiết bị.
        Xác định chữ ký loader trước và gọi đúng 1 lần duy nhất.
        """
        if self.is_ready:
            logger.info(f"Local Model '{self._model_name}' đã ở trạng thái READY.")
            return

        if self._loader_fn is None:
            self._status = ModelStatus.ERROR
            raise ModelInitializationError(
                f"Không thể khởi tạo Local Model '{self._model_name}': thiếu loader_fn.",
                model_name=self._model_name
            )

        self._status = ModelStatus.BUSY

        # 1. Xác định chữ ký tham số trước
        pass_device = True
        try:
            sig = inspect.signature(self._loader_fn)
            if len(sig.parameters) == 0:
                pass_device = False
        except Exception:
            pass_device = True

        # 2. Gọi loader_fn DUY NHẤT 1 LẦN
        try:
            if pass_device:
                predictor = self._loader_fn(self._device)
            else:
                predictor = self._loader_fn()

            if predictor is None:
                raise ValueError("loader_fn trả về None thay vì instance mô hình hợp lệ.")

            has_predict_method = callable(getattr(predictor, "predict", None))
            is_callable_obj = callable(predictor)

            if not (isinstance(predictor, LocalPredictor) or has_predict_method or is_callable_obj):
                raise TypeError(
                    f"Instance nạp từ loader_fn kiểu '{type(predictor).__name__}' "
                    "không thỏa mãn LocalPredictor protocol (thiếu method 'predict')."
                )

            self._predictor = predictor
            self._status = ModelStatus.READY
            logger.info(f"Local Model '{self._model_name}' đã nạp thành công lên '{self._device}'.")
        except Exception as e:
            self._status = ModelStatus.ERROR
            self._predictor = None
            raise ModelInitializationError(
                f"Không thể khởi tạo Local Model '{self._model_name}': {str(e)}",
                model_name=self._model_name
            ) from e

    def unload(self) -> None:
        """Giải phóng bộ nhớ RAM và VRAM theo đúng thiết bị đang sử dụng."""
        logger.info(f"Đang giải phóng tài nguyên Local Model '{self._model_name}'...")
        try:
            self._predictor = None
            gc.collect()

            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif self._device == "mps" and hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                torch.mps.empty_cache()

            self._status = ModelStatus.UNINITIALIZED
        except Exception as e:
            self._status = ModelStatus.ERROR
            raise ModelCleanupError(
                f"Lỗi khi giải phóng tài nguyên Local Model '{self._model_name}': {str(e)}",
                model_name=self._model_name
            ) from e

    def predict(self, input_data: Any, **kwargs: Any) -> Any:
        """Thực thi suy luận (inference) an toàn trên predictor thực tế."""
        if not self.is_ready or self._predictor is None:
            raise ModelNotReadyError(
                f"Local Model '{self._model_name}' chưa sẵn sàng. Hãy gọi load() trước khi predict.",
                model_name=self._model_name
            )

        if input_data is None:
            raise ModelInferenceError(
                "Dữ liệu đầu vào (input_data) không được là None.",
                model_name=self._model_name
            )

        try:
            if callable(getattr(self._predictor, "predict", None)):
                return self._predictor.predict(input_data, **kwargs)
            elif callable(self._predictor):
                return self._predictor(input_data, **kwargs)
            else:
                raise TypeError("Predictor không có phương thức thực thi suy luận hợp lệ.")
        except Exception as e:
            raise ModelInferenceError(
                f"Lỗi runtime trong quá trình suy luận Local Model '{self._model_name}': {str(e)}",
                model_name=self._model_name
            ) from e
