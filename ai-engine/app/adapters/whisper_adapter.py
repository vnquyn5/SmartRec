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
    """Tạo LocalModelAdapter cho faster-whisper large-v3."""

    configured_path = model_path or os.getenv("WHISPER_MODEL_PATH")

    if not configured_path:
        raise ValueError(
            "Thiếu WHISPER_MODEL_PATH. "
            "Hãy cấu hình đường dẫn local tới faster-whisper-large-v3."
        )

    weights_path = Path(configured_path).expanduser().resolve()

    if not weights_path.is_dir():
        raise FileNotFoundError(f"Không tìm thấy thư mục model: {weights_path}")

    if not (weights_path / "model.bin").is_file():
        raise FileNotFoundError(f"Thiếu model.bin trong: {weights_path}")

    def loader(runtime_device: str) -> WhisperPredictor:
        # CTranslate2 không hỗ trợ MPS.
        ct2_device = "cpu" if runtime_device == "mps" else runtime_device

        runtime_compute_type = compute_type or (
            "float16" if ct2_device == "cuda" else "int8"
        )

        model = WhisperModel(
            str(weights_path),
            device=ct2_device,
            compute_type=runtime_compute_type,
            local_files_only=True,
        )

        return WhisperPredictor(model)

    # CTranslate2 không hỗ trợ MPS; tự động chọn CUDA hoặc CPU.
    if device is None:
        runtime_device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        runtime_device = "cpu" if device == "mps" else device

    return LocalModelAdapter(
        model_name="faster-whisper-large-v3",
        loader_fn=loader,
        version="3.0",
        device=runtime_device,
    )
