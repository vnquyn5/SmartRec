import os
import logging
import threading
from typing import Optional, Dict, Any, Union
from pathlib import Path
import torch
from pyannote.core import Annotation

from app.core.config import settings

logger = logging.getLogger("smartrec.diarization_runtime")


class DiarizationRuntimeError(Exception):
    """Lỗi nền tảng runtime của module Diarization."""
    pass


class DiarizationTokenMissingError(DiarizationRuntimeError):
    """Lỗi thiếu token Hugging Face để tải gated model."""
    pass


class DiarizationAccessDeniedError(DiarizationRuntimeError):
    """Lỗi token không hợp lệ hoặc tài khoản chưa được duyệt quyền repo gated (HTTP 401/403)."""
    pass


class DiarizationModelLoadError(DiarizationRuntimeError):
    """Lỗi nạp pretrained model thất bại do nguyên nhân hệ thống/mạng/cấu hình."""
    pass


def resolve_device(preferred_device: str = "auto") -> torch.device:
    """
    Xác định thiết bị thực thi tối ưu nhất, ưu tiên GPU local.
    Thứ tự ưu tiên: CUDA -> MPS (Apple Silicon GPU) -> CPU.
    """
    pref = preferred_device.lower().strip()
    if pref == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    elif pref == "cuda":
        if not torch.cuda.is_available():
            raise DiarizationRuntimeError("Yêu cầu thiết bị CUDA nhưng hệ thống không hỗ trợ.")
        return torch.device("cuda")
    elif pref == "mps":
        if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            raise DiarizationRuntimeError("Yêu cầu thiết bị MPS nhưng hệ thống không hỗ trợ.")
        return torch.device("mps")
    elif pref == "cpu":
        return torch.device("cpu")
    else:
        raise DiarizationRuntimeError(f"Cấu hình thiết bị không hợp lệ: '{preferred_device}'")


class DiarizationRuntimeManager:
    """
    Quản lý vòng đời (Lifecycle) và nạp pretrained model cho Speaker Diarization theo mẫu Singleton.
    Đảm bảo an toàn đa luồng (Thread-safe) với cơ chế Double-Checked Locking.
    """
    _instance: Optional["DiarizationRuntimeManager"] = None
    _init_lock = threading.Lock()
    _load_lock = threading.Lock()
    _pipeline = None
    _active_device: Optional[torch.device] = None
    _model_id: Optional[str] = None

    def __new__(cls) -> "DiarizationRuntimeManager":
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def get_token(self) -> str:
        """Lấy Hugging Face token từ settings hoặc biến môi trường."""
        token = settings.hf_token or os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
        if not token or not token.strip():
            raise DiarizationTokenMissingError(
                "Thiếu HF_TOKEN. Model pyannote/speaker-diarization-3.1 yêu cầu Hugging Face token hợp lệ "
                "đã chấp nhận điều khoản tại https://huggingface.co/pyannote/speaker-diarization-3.1."
            )
        return token.strip()

    def load_pipeline(self, force_reload: bool = False, device_override: Optional[str] = None):
        """
        Nạp pipeline Pyannote vào bộ nhớ và gán vào thiết bị tối ưu.
        Đảm bảo Thread-safe: chỉ nạp duy nhất một lần khi có nhiều luồng cùng gọi đồng thời.
        """
        if self._pipeline is not None and not force_reload:
            return self._pipeline

        with self._load_lock:
            # Double-Checked Locking kiểm tra lại sau khi giữ lock
            if self._pipeline is not None and not force_reload:
                return self._pipeline

            model_id = settings.pyannote_model_id
            target_device_str = device_override or settings.pyannote_device
            target_device = resolve_device(target_device_str)
            token = self.get_token()

            logger.info(f"Bắt đầu nạp pretrained model '{model_id}' trên thiết bị '{target_device}'...")

            try:
                from pyannote.audio import Pipeline
            except ImportError as e:
                raise DiarizationRuntimeError(f"Chưa cài đặt dependency pyannote.audio: {e}") from e

            try:
                pipeline = Pipeline.from_pretrained(model_id, token=token)
                if pipeline is None:
                    raise DiarizationAccessDeniedError(
                        f"Không thể khởi tạo Pipeline từ '{model_id}'. Quyền truy cập bị từ chối hoặc token không hợp lệ."
                    )

                # Chuyển pipeline lên thiết bị (ưu tiên GPU), hỗ trợ fallback sang CPU nếu MPS gặp lỗi
                try:
                    pipeline.to(target_device)
                    self._active_device = target_device
                except Exception as dev_err:
                    if target_device.type == "mps":
                        logger.warning(f"Không thể gán pipeline lên MPS ({dev_err}), tự động fallback về CPU.")
                        pipeline.to(torch.device("cpu"))
                        self._active_device = torch.device("cpu")
                    else:
                        raise dev_err

                self._pipeline = pipeline
                self._model_id = model_id
                logger.info(f"Nạp model '{model_id}' thành công trên thiết bị: {self._active_device}")
                return self._pipeline

            except (DiarizationTokenMissingError, DiarizationAccessDeniedError):
                raise
            except Exception as e:
                err_msg = str(e).lower()
                # Bắt các mã lỗi HTTP 401, 403, Gated repo hoặc unauthorized từ huggingface_hub
                if any(k in err_msg for k in ["401", "403", "gated", "unauthorized", "access denied", "forbidden", "restricted"]):
                    raise DiarizationAccessDeniedError(
                        f"Quyền truy cập model '{model_id}' bị từ chối (401/403 hoặc chưa chấp nhận điều khoản repo): {e}"
                    ) from e
                raise DiarizationModelLoadError(f"Lỗi trong quá trình nạp model '{model_id}': {e}") from e

    def diarize(self, audio_input: Union[str, Path, Dict[str, Any]], **kwargs) -> Annotation:
        """
        Interface thực thi inference chuẩn hóa cho các task downstream (2.10.2 & 2.10.3).
        Tự động bóc tách và kiểm tra nghiêm ngặt kiểu trả về pyannote.core.Annotation.
        """
        pipeline = self.load_pipeline()
        raw_output = pipeline(audio_input, **kwargs)

        # Bóc tách Annotation từ DiarizeOutput (pyannote 4.x) hoặc trả về trực tiếp (pyannote 3.x)
        annotation = getattr(raw_output, "speaker_diarization", raw_output)

        if not isinstance(annotation, Annotation):
            raise DiarizationRuntimeError(
                f"Đầu ra của pipeline không đạt chuẩn pyannote.core.Annotation (kiểu thực tế: {type(annotation).__name__})"
            )

        return annotation

    def get_runtime_info(self) -> Dict[str, Any]:
        """Trả về thông tin trạng thái runtime phục vụ giám sát pipeline."""
        return {
            "model_id": self._model_id or settings.pyannote_model_id,
            "is_loaded": self._pipeline is not None,
            "active_device": str(self._active_device) if self._active_device else None,
            "torch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "mps_available": hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        }

    def reset(self):
        """Giải phóng pipeline khỏi bộ nhớ (dùng cho testing/cleanup)."""
        with self._load_lock:
            self._pipeline = None
            self._active_device = None
            self._model_id = None


diarization_runtime = DiarizationRuntimeManager()
