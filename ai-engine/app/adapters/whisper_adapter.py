"""Selectable STT adapters with a stable faster-whisper-compatible interface."""

import os
from pathlib import Path
from typing import Any, Optional
from types import SimpleNamespace

import requests

from app.core.config import settings

# Patchable for fallback tests; native whisper.cpp path does not import Torch.
WhisperModel = None


class WhisperCppHttpAdapter:
    """Client for the local whisper.cpp HTTP server; audio stays on the host."""

    def __init__(self, endpoint: str, timeout: int):
        self.endpoint = endpoint
        self.timeout = timeout

    @property
    def is_ready(self) -> bool:
        return True

    def load_model(self) -> None:
        # The native server owns and lazily loads its model.
        return None

    def unload(self) -> None:
        return None

    def predict(self, audio_path: str, **kwargs: Any):
        language = kwargs.get("language", "vi")
        with open(audio_path, "rb") as audio:
            response = requests.post(
                self.endpoint,
                files={"file": (Path(audio_path).name, audio, "audio/wav")},
                data={"language": language, "response_format": "verbose_json", "temperature": "0"},
                timeout=self.timeout,
            )
        response.raise_for_status()
        payload = response.json()
        raw_segments = payload.get("transcription") or payload.get("segments") or []

        def seconds(value: Any) -> float:
            if isinstance(value, (int, float)):
                return float(value)
            value = str(value or "0").strip().replace(",", ".")
            try:
                return float(value)
            except ValueError:
                parts = value.split(":")
                return sum(float(part) * (60 ** i) for i, part in enumerate(reversed(parts)))

        segments = []
        for item in raw_segments:
            times = item.get("timestamps") or {}
            start = item.get("start", times.get("from", 0))
            end = item.get("end", times.get("to", 0))
            segments.append(SimpleNamespace(
                start=seconds(start), end=seconds(end), text=str(item.get("text", "")).strip(),
                id=item.get("id"), words=item.get("words", []),
            ))
        info = SimpleNamespace(language=payload.get("language", language))
        return segments, info


class WhisperPredictor:
    """Chuyển giao diện predict() sang faster-whisper transcribe()."""

    def __init__(self, model: Any):
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
) -> Any:
    """Choose the native whisper.cpp service or local faster-whisper fallback."""

    provider = os.getenv("STT_PROVIDER", settings.stt_provider).strip().lower()
    if provider == "whisper_cpp":
        return WhisperCppHttpAdapter(
            endpoint=os.getenv("WHISPER_CPP_URL", settings.stt_service_url),
            timeout=int(os.getenv("STT_TIMEOUT_SECONDS", settings.stt_timeout_seconds)),
        )
    if provider not in {"faster_whisper_cpu", "faster_whisper"}:
        raise ValueError(f"STT_PROVIDER không được hỗ trợ: {provider}")

    from app.adapters.local_adapter import LocalModelAdapter

    configured_path = model_path or os.getenv("STT_MODEL_PATH") or os.getenv("WHISPER_MODEL_PATH") or settings.stt_model_path

    if not configured_path:
        raise ValueError(
            "Thiếu WHISPER_MODEL_PATH. "
            "Hãy cấu hình STT_MODEL_PATH tới faster-whisper-small-int8 hoặc chọn STT_PROVIDER=whisper_cpp."
        )

    weights_path = Path(configured_path).expanduser().resolve()

    if not weights_path.is_dir():
        raise FileNotFoundError(f"Không tìm thấy thư mục model: {weights_path}")

    if not (weights_path / "model.bin").is_file():
        raise FileNotFoundError(f"Thiếu model.bin trong: {weights_path}")

    def loader(runtime_device: str) -> WhisperPredictor:
        model_class = WhisperModel
        if model_class is None:
            from faster_whisper import WhisperModel as model_class
        # CTranslate2 không hỗ trợ MPS.
        ct2_device = "cpu" if runtime_device == "mps" else runtime_device

        runtime_compute_type = compute_type or (
            "float16" if ct2_device == "cuda" else "int8"
        )

        model = model_class(
            str(weights_path),
            device=ct2_device,
            compute_type=runtime_compute_type,
            local_files_only=True,
            cpu_threads=int(os.getenv("STT_CPU_THREADS", settings.stt_cpu_threads)),
            num_workers=1,
        )

        return WhisperPredictor(model)

    return LocalModelAdapter(
        model_name="faster-whisper-small-int8",
        loader_fn=loader,
        version="3.0",
        device=device,
    )
