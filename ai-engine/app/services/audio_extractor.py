import os
import wave
import subprocess
from typing import Dict, Any, Optional


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
            raise RuntimeError(f"FFmpeg thất bại khi chuẩn hóa audio: {result.stderr.strip()}")

        meta = self.inspect_wav(output_path)
        return {
            "status": "SUCCESS",
            "output_path": output_path,
            "sample_rate": meta["sample_rate"],
            "channels": meta["channels"],
            "duration_seconds": meta["duration_seconds"],
            "file_size_bytes": meta["file_size_bytes"],
            "message": "Trích xuất và chuẩn hóa 16kHz Mono thành công."
        }
