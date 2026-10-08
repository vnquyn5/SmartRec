import os
import wave
import logging
import subprocess
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class InvalidMediaError(Exception):
    """Deterministic input media error that must not trigger a worker retry."""

    error_code = "INVALID_AUDIO"


class NoAudioStreamError(InvalidMediaError):
    """Valid media container has no audio stream to send into the pipeline."""


DETERMINISTIC_MEDIA_ERRORS = (
    "invalid data found when processing input",
    "moov atom not found",
    "could not find codec parameters",
    "error while decoding",
    "invalid nal unit",
    "invalid start code",
    "corrupt input packet",
    "packet corrupt",
    "decoding failed",
)


def _is_deterministic_media_error(message: str) -> bool:
    normalized = (message or "").lower()
    return any(marker in normalized for marker in DETERMINISTIC_MEDIA_ERRORS)


def _short_error(message: str, limit: int = 600) -> str:
    lines = [line.strip() for line in (message or "").splitlines() if line.strip()]
    return " | ".join(lines[-3:])[-limit:] or "không có thông tin lỗi chi tiết"


class AudioExtractorService:
    """Service trích xuất và chuẩn hóa audio thành định dạng chuẩn 16kHz, Mono, PCM 16-bit."""

    @staticmethod
    def inspect_wav(file_path: str) -> Dict[str, Any]:
        """Đọc thông số kỹ thuật của file WAV."""
        with wave.open(file_path, "rb") as wf:
            channels = wf.getnchannels()
            sample_rate = wf.getframerate()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()
            duration = n_frames / float(sample_rate)
            file_size = os.path.getsize(file_path)

        return {
            "channels": channels,
            "sample_rate": sample_rate,
            "sampwidth": sampwidth,
            "duration_seconds": round(duration, 3),
            "file_size_bytes": file_size
        }

    def extract_and_normalize(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        target_sample_rate: int = 16000,
        target_channels: int = 1
    ) -> Dict[str, Any]:
        """
        Trích xuất và chuẩn hóa tệp âm thanh/video sang WAV chuẩn 16kHz Mono PCM 16-bit.
        """
        input_path = os.path.abspath(input_path)
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"Tệp nguồn không tồn tại: {input_path}")

        if not output_path:
            base_dir = os.path.dirname(input_path)
            stem = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(base_dir, f"{stem}_normalized_16k.wav")

        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        extension = os.path.splitext(input_path)[1].lower()
        logger.info("Input media detected: extension=%s", extension or "<none>")

        # Use ffprobe to reject valid video containers without an audio stream
        # before invoking FFmpeg. Probe timeouts/binary/I/O failures intentionally
        # propagate as infrastructure errors and remain retryable in the worker.
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input_path,
        ]
        probe = subprocess.run(
            probe_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        if probe.returncode != 0:
            probe_error = _short_error(probe.stderr)
            if _is_deterministic_media_error(probe.stderr):
                raise InvalidMediaError(f"Tệp media không hợp lệ hoặc bị hỏng: {probe_error}")
            raise RuntimeError(f"Không thể kiểm tra audio stream của media: {probe_error}")
        if not probe.stdout.strip():
            raise NoAudioStreamError(
                f"Tệp media '{os.path.basename(input_path)}' không chứa audio stream."
            )

        if extension in {".mp4", ".mkv"}:
            logger.info("Extracting audio stream from video: extension=%s", extension)

        # Lệnh FFmpeg chuẩn hóa: 16kHz, Mono, PCM 16-bit s16le
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(target_sample_rate),
            "-ac", str(target_channels),
            output_path
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180
        )
        if result.returncode != 0:
            ffmpeg_error = _short_error(result.stderr)
            if _is_deterministic_media_error(result.stderr):
                raise InvalidMediaError(f"FFmpeg không thể decode tệp media: {ffmpeg_error}")
            raise RuntimeError(f"FFmpeg gặp lỗi khi chuẩn hóa audio: {ffmpeg_error}")

        try:
            meta = self.inspect_wav(output_path)
        except (wave.Error, EOFError) as err:
            raise InvalidMediaError(f"FFmpeg tạo WAV không hợp lệ: {err}") from err
        if meta["duration_seconds"] <= 0:
            raise InvalidMediaError("FFmpeg tạo WAV không có audio frame hợp lệ.")
        if meta["sample_rate"] != target_sample_rate or meta["channels"] != target_channels or meta["sampwidth"] != 2:
            raise InvalidMediaError(
                "WAV sau chuẩn hóa không đạt PCM 16-bit, sample rate hoặc số kênh yêu cầu."
            )
        logger.info(
            "FFMPEG normalized output: path=%s audio_duration=%ss sample_rate=%s channels=%s",
            output_path,
            meta["duration_seconds"],
            meta["sample_rate"],
            meta["channels"],
        )
        return {
            "status": "SUCCESS",
            "output_path": output_path,
            "sample_rate": meta["sample_rate"],
            "channels": meta["channels"],
            "duration_seconds": meta["duration_seconds"],
            "file_size_bytes": meta["file_size_bytes"],
            "message": "Trích xuất và chuẩn hóa 16kHz Mono thành công."
        }
