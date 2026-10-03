import abc
import logging
from enum import Enum
from typing import Any, Optional, Dict, Protocol, runtime_checkable

logger = logging.getLogger("smartrec.model_adapter")


class ModelType(str, Enum):
    """Phân loại kiến trúc thực thi của model."""
    LOCAL = "LOCAL"
    EXTERNAL_API = "EXTERNAL_API"


class ModelStatus(str, Enum):
    """Trạng thái vòng đời của model adapter."""
    UNINITIALIZED = "UNINITIALIZED"
    READY = "READY"
    BUSY = "BUSY"
    ERROR = "ERROR"


# ==========================================
# HỆ THỐNG NGOẠI LỆ CHUẨN HÓA (EXCEPTION HIERARCHY)
# ==========================================

class ModelAdapterError(Exception):
    """Lỗi gốc cho toàn bộ các ngoại lệ trong tầng Model Abstraction."""
    def __init__(self, message: str, model_name: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.model_name = model_name

    def __str__(self) -> str:
        if self.model_name:
            return f"[{self.model_name}] {self.message}"
        return self.message


class ModelInitializationError(ModelAdapterError):
    """Ném ra khi khởi tạo, nạp weights hoặc kết nối ban đầu thất bại."""
    pass


class ModelNotReadyError(ModelAdapterError):
    """Ném ra khi gọi predict/inference nhưng model chưa ở trạng thái sẵn sàng."""
    pass


class ModelInferenceError(ModelAdapterError):
    """Ném ra khi quá trình tính toán suy luận/predict gặp lỗi runtime."""
    pass


class ModelConnectionError(ModelAdapterError):
    """Ném ra khi mất kết nối mạng, timeout hoặc rate-limit (đối với external API)."""
    pass


class ModelCleanupError(ModelAdapterError):
    """Ném ra khi giải phóng tài nguyên hoặc đóng session client thất bại."""
    pass


# ==========================================
# PROTOCOLS CHO INJECTED BACKENDS (CONTRACTS)
# ==========================================

@runtime_checkable
class LocalPredictor(Protocol):
    """Giao ước cho backend thực thi mô hình cục bộ."""
    def predict(self, input_data: Any, **kwargs: Any) -> Any:
        ...


@runtime_checkable
class ApiClient(Protocol):
    """Giao ước cho client kết nối External API (bắt buộc có cả predict và close)."""
    def predict(self, input_data: Any, **kwargs: Any) -> Any:
        ...

    def close(self) -> None:
        ...


# ==========================================
# INTERFACE CHUNG: BASE MODEL ADAPTER
# ==========================================

class BaseModelAdapter(abc.ABC):
    """
    Contract trừu tượng chung cho toàn bộ AI models trong SmartRec.
    Áp dụng đồng nhất cho cả local pretrained models và cloud external APIs.
    """

    def __init__(
        self,
        model_name: str,
        model_type: ModelType,
        version: str = "1.0.0",
        config: Optional[Dict[str, Any]] = None
    ):
        self._model_name = model_name
        self._model_type = model_type
        self._version = version
        self._config = config or {}
        self._status = ModelStatus.UNINITIALIZED

    @property
    def model_name(self) -> str:
        """Tên định danh của model (Read-only)."""
        return self._model_name

    @property
    def model_type(self) -> ModelType:
        """Phân loại model (Read-only: LOCAL hoặc EXTERNAL_API)."""
        return self._model_type

    @property
    def version(self) -> str:
        """Phiên bản model/adapter (Read-only)."""
        return self._version

    @property
    def status(self) -> ModelStatus:
        """Trạng thái hiện tại của model adapter (Read-only)."""
        return self._status

    @property
    def is_ready(self) -> bool:
        """Kiểm tra nhanh model đã sẵn sàng nhận request suy luận hay chưa."""
        return self._status == ModelStatus.READY

    @abc.abstractmethod
    def load(self) -> None:
        """Khởi tạo tài nguyên của model."""
        pass

    @abc.abstractmethod
    def unload(self) -> None:
        """Giải phóng tài nguyên của model."""
        pass

    @abc.abstractmethod
    def predict(self, input_data: Any, **kwargs: Any) -> Any:
        """Thực thi suy luận (inference) hoặc gửi request tính toán."""
        pass

    def __enter__(self):
        """Hỗ trợ Context Manager: tự động nạp tài nguyên an toàn."""
        try:
            self.load()
        except Exception:
            try:
                self.unload()
            except Exception as cleanup_err:
                logger.warning(f"Lỗi khi dọn dẹp sau khi load thất bại tại [{self._model_name}]: {cleanup_err}")
            raise
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Hỗ trợ Context Manager: tự động dọn dẹp tài nguyên khi thoát.
        - Nếu thân with đã ném lỗi: giữ nguyên lỗi đó, ghi log nếu unload gặp lỗi (không che lỗi gốc).
        - Nếu thân with không có lỗi: cho phép lỗi unload nổi lên.
        """
        try:
            self.unload()
        except Exception as cleanup_err:
            if exc_type is not None:
                logger.error(f"Lỗi cleanup trong __exit__ của [{self._model_name}]: {cleanup_err}")
                return False
            raise cleanup_err
        return False
