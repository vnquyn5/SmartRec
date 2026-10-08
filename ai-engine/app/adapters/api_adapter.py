import logging
import inspect
from typing import Any, Optional, Dict, Callable

from app.adapters.base import (
    BaseModelAdapter,
    ModelType,
    ModelStatus,
    ModelInitializationError,
    ModelNotReadyError,
    ModelInferenceError,
    ModelConnectionError,
    ModelCleanupError,
    ApiClient,
)

logger = logging.getLogger("smartrec.api_adapter")


def _mask_api_key(api_key: Optional[str]) -> str:
    """Che giấu API Key để ghi log an toàn, chống rò rỉ secret."""
    if not api_key:
        return "<EMPTY>"
    if len(api_key) <= 8:
        return "***"
    return f"{api_key[:3]}...{api_key[-3:]}"


def _sanitize_message(message: str, secret: Optional[str]) -> str:
    """Loại bỏ hoàn toàn raw API key khỏi chuỗi thông điệp hoặc log."""
    if not secret or not message:
        return message
    return message.replace(secret, _mask_api_key(secret))


class SanitizedExceptionCause(Exception):
    """
    Lớp exception cause độc lập, đã được lọc sạch 100% secret.
    Không giữ bất kỳ tham chiếu nào tới exception gốc, traceback hay request của SDK.
    """
    def __init__(self, original_type_name: str, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.original_type_name = original_type_name
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:
        return f"{self.original_type_name}: {self.message}"

    def __repr__(self) -> str:
        return f"{self.original_type_name}('{self.message}')"


def _extract_safe_cause(exc: Exception, secret: Optional[str]) -> SanitizedExceptionCause:
    """
    Trích xuất nguyên nhân lỗi thành một instance SanitizedExceptionCause hoàn toàn mới.
    Đảm bảo không mang theo tham chiếu đến SDK exception gốc.
    """
    type_name = type(exc).__name__
    try:
        raw_msg = str(exc)
    except Exception:
        raw_msg = "<unprintable exception>"

    safe_msg = _sanitize_message(raw_msg, secret)
    status_code = getattr(exc, "status_code", None)
    if status_code is None and hasattr(exc, "response"):
        status_code = getattr(exc.response, "status_code", None)

    return SanitizedExceptionCause(
        original_type_name=type_name,
        message=safe_msg,
        status_code=status_code
    )


class ExternalApiModelAdapter(BaseModelAdapter):
    """
    Adapter chuyên biệt cho các mô hình External API (gọi qua HTTP/REST/gRPC Cloud endpoints).
    Bảo đảm loại bỏ raw secret khỏi cả message, __cause__, __context__ và traceback.
    """

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        version: str = "1.0.0",
        timeout_seconds: float = 30.0,
        client_factory: Optional[Callable[..., Any]] = None,
        config: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            model_name=model_name,
            model_type=ModelType.EXTERNAL_API,
            version=version,
            config=config or {}
        )
        self._api_key = api_key or self._config.get("api_key")
        self._base_url = base_url or self._config.get("base_url", "https://api.smartrec.ai/v1")
        self._timeout_seconds = timeout_seconds
        self._client_factory = client_factory
        self._client: Optional[Any] = None

    @property
    def base_url(self) -> str:
        """Endpoint URL của dịch vụ API (Read-only)."""
        return self._base_url

    @property
    def timeout_seconds(self) -> float:
        """Thời gian chờ tối đa của request tính bằng giây (Read-only)."""
        return self._timeout_seconds

    def load(self) -> None:
        """
        Khởi tạo client session và xác thực thông tin cấu hình ban đầu.
        Bắt buộc client_factory trả về đối tượng có cả predict() và close().
        """
        if self.is_ready:
            logger.info(f"External API Model '{self._model_name}' đã ở trạng thái READY.")
            return

        if not self._api_key:
            self._status = ModelStatus.ERROR
            raise ModelInitializationError(
                f"Không thể khởi tạo External API '{self._model_name}': thiếu API Key xác thực.",
                model_name=self._model_name
            )

        if self._client_factory is None:
            self._status = ModelStatus.ERROR
            raise ModelInitializationError(
                f"Không thể khởi tạo External API '{self._model_name}': thiếu client_factory.",
                model_name=self._model_name
            )

        self._status = ModelStatus.BUSY
        masked_key = _mask_api_key(self._api_key)
        logger.info(
            f"Đang thiết lập kết nối tới External API Model '{self._model_name}' "
            f"tại '{self._base_url}' (Key: {masked_key})..."
        )

        try:
            sig = inspect.signature(self._client_factory)
            param_count = len(sig.parameters)
        except Exception:
            param_count = 3

        failure = None
        try:
            if param_count >= 3:
                client = self._client_factory(self._api_key, self._base_url, self._timeout_seconds)
            elif param_count == 2:
                client = self._client_factory(self._api_key, self._base_url)
            elif param_count == 1:
                client = self._client_factory(self._api_key)
            else:
                client = self._client_factory()

            if client is None:
                raise ValueError("client_factory trả về None thay vì instance client hợp lệ.")

            has_predict = callable(getattr(client, "predict", None))
            has_close = callable(getattr(client, "close", None))

            if not (has_predict and has_close):
                missing_methods = []
                if not has_predict:
                    missing_methods.append("predict()")
                if not has_close:
                    missing_methods.append("close()")
                raise TypeError(
                    f"Client trả về từ factory kiểu '{type(client).__name__}' "
                    f"không thỏa mãn ApiClient protocol (thiếu: {', '.join(missing_methods)})."
                )

            self._client = client
            self._status = ModelStatus.READY
            logger.info(f"External API Model '{self._model_name}' đã kết nối thành công và sẵn sàng.")
        except Exception as e:
            self._status = ModelStatus.ERROR
            self._client = None
            safe_err = _sanitize_message(str(e), self._api_key)
            safe_cause = _extract_safe_cause(e, self._api_key)
            failure = (
                ModelInitializationError,
                f"Không thể khởi tạo kết nối External API '{self._model_name}': {safe_err}",
                safe_cause
            )

        # Thoát khỏi except trước khi raise: ngăn chặn exception gốc bị gắn vào __context__
        if failure is not None:
            err_cls, msg, safe_cause = failure
            err_to_raise = err_cls(msg, model_name=self._model_name)
            err_to_raise.__context__ = None
            raise err_to_raise from safe_cause

    def unload(self) -> None:
        """
        Đóng session và giải phóng kết nối mạng qua client.close().
        Nếu close() thất bại, chuyển trạng thái sang ERROR và ném ModelCleanupError đã làm sạch.
        """
        logger.info(f"Đang ngắt kết nối External API Model '{self._model_name}'...")
        failure = None
        if self._client is not None:
            try:
                self._client.close()
                self._client = None
                self._status = ModelStatus.UNINITIALIZED
            except Exception as ce:
                self._status = ModelStatus.ERROR
                safe_err = _sanitize_message(str(ce), self._api_key)
                safe_cause = _extract_safe_cause(ce, self._api_key)
                failure = (
                    ModelCleanupError,
                    f"Lỗi khi đóng session External API '{self._model_name}': {safe_err}",
                    safe_cause
                )
        else:
            self._status = ModelStatus.UNINITIALIZED

        # Thoát khỏi except trước khi raise
        if failure is not None:
            err_cls, msg, safe_cause = failure
            err_to_raise = err_cls(msg, model_name=self._model_name)
            err_to_raise.__context__ = None
            raise err_to_raise from safe_cause

    def predict(self, input_data: Any, **kwargs: Any) -> Any:
        """
        Thực thi gửi request tính toán tới External API.
        Làm sạch API Key trên cả thông điệp ngoại lệ, __cause__ và triệt tiêu rò rỉ qua __context__.
        """
        if not self.is_ready or self._client is None:
            raise ModelNotReadyError(
                f"External API Model '{self._model_name}' chưa sẵn sàng. Hãy gọi load() trước khi predict.",
                model_name=self._model_name
            )

        if input_data is None:
            raise ModelInferenceError(
                "Dữ liệu đầu vào (input_data) không được là None.",
                model_name=self._model_name
            )

        failure = None
        result = None
        try:
            result = self._client.predict(input_data, **kwargs)
        except TimeoutError as te:
            safe_msg = _sanitize_message(str(te), self._api_key)
            safe_cause = _extract_safe_cause(te, self._api_key)
            failure = (
                ModelConnectionError,
                f"External API '{self._model_name}' hết thời gian phản hồi (timeout {self._timeout_seconds}s): {safe_msg}",
                safe_cause
            )
        except ConnectionError as ce:
            safe_msg = _sanitize_message(str(ce), self._api_key)
            safe_cause = _extract_safe_cause(ce, self._api_key)
            failure = (
                ModelConnectionError,
                f"Mất kết nối tới máy chủ External API '{self._model_name}': {safe_msg}",
                safe_cause
            )
        except Exception as e:
            status_code = getattr(e, "status_code", None)
            if status_code is None and hasattr(e, "response"):
                status_code = getattr(e.response, "status_code", None)

            safe_err = _sanitize_message(str(e), self._api_key)
            safe_cause = _extract_safe_cause(e, self._api_key)

            if status_code is not None:
                if status_code in (401, 403):
                    failure = (
                        ModelConnectionError,
                        f"Lỗi xác thực External API '{self._model_name}' (HTTP {status_code}): Quyền truy cập bị từ chối. {safe_err}",
                        safe_cause
                    )
                elif status_code == 429:
                    failure = (
                        ModelConnectionError,
                        f"External API '{self._model_name}' vượt hạn mức (HTTP 429 Rate Limit / Quota Exceeded). {safe_err}",
                        safe_cause
                    )
                elif 500 <= status_code < 600:
                    failure = (
                        ModelConnectionError,
                        f"Máy chủ External API '{self._model_name}' gặp sự cố (HTTP {status_code} Server Error). {safe_err}",
                        safe_cause
                    )
                elif status_code in (400, 422):
                    failure = (
                        ModelInferenceError,
                        f"Dữ liệu gửi tới External API '{self._model_name}' không hợp lệ (HTTP {status_code}). {safe_err}",
                        safe_cause
                    )

            if failure is None:
                err_msg_lower = safe_err.lower()
                if any(x in err_msg_lower for x in ("rate limit", "429", "quota", "timeout", "timed out", "connection reset", "connection refused", "401", "403", "unauthorized")):
                    failure = (
                        ModelConnectionError,
                        f"Sự cố mạng hoặc giới hạn External API '{self._model_name}': {safe_err}",
                        safe_cause
                    )
                else:
                    failure = (
                        ModelInferenceError,
                        f"Lỗi phản hồi từ External API Model '{self._model_name}': {safe_err}",
                        safe_cause
                    )

        # Thoát khỏi khối except: không raise trong khi SDK exception đang là active exception
        if failure is not None:
            err_cls, msg, safe_cause = failure
            err_to_raise = err_cls(msg, model_name=self._model_name)
            err_to_raise.__context__ = None
            raise err_to_raise from safe_cause

        return result
