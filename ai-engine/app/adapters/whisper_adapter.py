"""Adapter kết nối faster-whisper với Model Abstraction của SmartRec."""

import os
from pathlib import Path
from typing import Any, Optional
import torch

from faster_whisper import WhisperModel

from app.adapters.local_adapter import LocalModelAdapter


class WhisperPredictor:
    """Chuyển giao diện predict() sang faster-whisper transcribe()."""

    def __init__(self, model: WhisperModel):
        self.model = model

    def predict(self, input_data: Any, **kwargs: Any):
        segments, info = self.model.transcribe(input_data, **kwargs)

        # faster-whisper trả về generator; materialize để inference
        # hoàn tất trong khi model vẫn được giữ trong bộ nhớ.
        return list(segments), info



def create_whisper_adapter(
    model_path: Optional[str] = None,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
) -> LocalModelAdapter:
    """Tạo LocalModelAdapter cho Faster-Whisper model được chọn."""

    configured_path = model_path or os.getenv("WHISPER_MODEL_PATH")

    if not configured_path:
        raise ValueError(
            "Thiếu WHISPER_MODEL_PATH. "
            "Hãy cấu hình đường dẫn tới model Faster-Whisper."
        )

    weights_path = Path(configured_path).expanduser().resolve()

    if not weights_path.is_dir():
        raise FileNotFoundError(
            f"Không tìm thấy thư mục model: {weights_path}"
        )

    if not (weights_path / "model.bin").is_file():
        raise FileNotFoundError(
            f"Thiếu model.bin trong: {weights_path}"
        )

    # Các model STT được hỗ trợ.
    supported_models = {
        "faster-whisper-small": "1.0",
        "faster-whisper-medium": "1.0",
        "faster-whisper-large-v3": "3.0",
    }

    # Tham số cấu hình có thể chọn model thông qua .env.
    configured_model_id = os.getenv("STT_MODEL_ID")

    model_id = configured_model_id or weights_path.name

    if model_id not in supported_models:
        raise ValueError(
            f"Model STT không được hỗ trợ: {model_id}"
        )

    # Ngăn việc cấu hình Small nhưng vô tình nạp weights Large.
    if weights_path.name in supported_models:
        if weights_path.name != model_id:
            raise ValueError(
                f"STT_MODEL_ID={model_id} không khớp "
                f"với thư mục model {weights_path.name}"
            )

    # Ưu tiên tham số truyền trực tiếp, sau đó đến môi trường.
    requested_device = (
        device or os.getenv("WHISPER_DEVICE", "auto")
    ).strip().lower()

    if requested_device == "auto":
        runtime_device = (
            "cuda" if torch.cuda.is_available() else "cpu"
        )
    elif requested_device == "mps":
        # CTranslate2 không hỗ trợ MPS.
        runtime_device = "cpu"
    elif requested_device in {"cpu", "cuda"}:
        runtime_device = requested_device
    else:
        raise ValueError(
            f"WHISPER_DEVICE không hợp lệ: {requested_device}"
        )

    def loader(selected_device: str) -> WhisperPredictor:
        ct2_device = (
            "cpu" if selected_device == "mps" else selected_device
        )

        runtime_compute_type = (
            compute_type
            or os.getenv("WHISPER_COMPUTE_TYPE")
            or (
                "int8_float16"
                if ct2_device == "cuda"
                else "int8"
            )
        )

        model = WhisperModel(
            str(weights_path),
            device=ct2_device,
            compute_type=runtime_compute_type,
            local_files_only=True,
        )

        return WhisperPredictor(model)

    return LocalModelAdapter(
        model_name=model_id,
        loader_fn=loader,
        version=supported_models[model_id],
        device=runtime_device,
    )
