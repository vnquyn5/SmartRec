"""Speech-to-Text service sử dụng faster-whisper local."""

from pathlib import Path
from typing import Any, Optional

from app.adapters.whisper_adapter import create_whisper_adapter


class WhisperASRService:
    """Quản lý model Whisper và thực hiện nhận dạng giọng nói."""

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
        language: str = "vi",
        beam_size: int = 5,
    ):
        if not language:
            raise ValueError("language không được để trống")
        if not isinstance(beam_size, int) or isinstance(beam_size, bool) or beam_size < 1:
            raise ValueError("beam_size phải là số nguyên dương")

        self.language = language
        self.beam_size = beam_size
        self._adapter = create_whisper_adapter(
            model_path=model_path,
            device=device,
            compute_type=compute_type,
        )

    def load_model(self) -> None:
        """Nạp model một lần, tái sử dụng cho các lần phiên âm."""
        self._adapter.load_model()

    def transcribe(self, audio_path: str) -> dict[str, Any]:
        """Phiên âm audio và giữ kết quả gốc để xử lý timestamp tiếp theo."""
        path = Path(audio_path).expanduser()

        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy audio: {path}")

        if not self._adapter.is_ready:
            raise RuntimeError("Whisper model chưa được load. Hãy gọi load_model().")

        segments, info = self._adapter.predict(
            str(path),
            language=self.language,
            beam_size=self.beam_size,
            word_timestamps=True,
        )

        return {
            "language": self.language,
            "detected_language": getattr(info, "language", None),
            "segments": segments,
        }

    def unload(self) -> None:
        """Giải phóng tài nguyên model."""
        self._adapter.unload()

    def __enter__(self):
        self.load_model()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.unload()
        return False
