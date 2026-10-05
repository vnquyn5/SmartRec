import os
import json
import time
import shutil
import subprocess
from typing import Dict, Any, Optional


class FFmpegError(Exception):
    """Lỗi cơ sở cho các thao tác FFmpeg/FFprobe."""
    pass


class FFmpegNotFoundError(FFmpegError):
    """Ném ra khi không tìm thấy binary ffmpeg hoặc ffprobe trong PATH."""
    pass


class FFmpegExecutionError(FFmpegError):
    """Ném ra khi tiến trình FFmpeg kết thúc với exit code khác 0."""
    def __init__(self, command: list, returncode: int, stderr: str, stdout: str = ""):
        self.command = " ".join(command)
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        super().__init__(
            f"FFmpeg thất bại (exit code {returncode}).\n"
            f"Command: {self.command}\n"
            f"Stderr: {stderr.strip()}"
        )


class AudioValidationError(FFmpegError):
    """Ném ra khi file output không đạt tiêu chuẩn 16kHz Mono hoặc bị rỗng."""
    pass


class FFmpegWrapper:
    """
    Python Wrapper điều phối FFmpeg và FFprobe.
    Chịu trách nhiệm trích xuất, chuẩn hóa định dạng và kiểm tra metadata âm thanh.
    """

    def __init__(self, ffmpeg_bin: str = "ffmpeg", ffprobe_bin: str = "ffprobe"):
        self.ffmpeg_bin = ffmpeg_bin
        self.ffprobe_bin = ffprobe_bin
        self._validate_binaries()

    def _validate_binaries(self) -> None:
        """Kiểm tra sự tồn tại của ffmpeg và ffprobe trên hệ thống."""
        if not shutil.which(self.ffmpeg_bin):
            raise FFmpegNotFoundError(
                f"Không tìm thấy binary '{self.ffmpeg_bin}' trong PATH hệ thống. "
                "Vui lòng cài đặt FFmpeg (brew install ffmpeg)."
            )
        if not shutil.which(self.ffprobe_bin):
            raise FFmpegNotFoundError(
                f"Không tìm thấy binary '{self.ffprobe_bin}' trong PATH hệ thống."
            )

    def get_media_metadata(self, media_path: str) -> Dict[str, Any]:
        """
        Sử dụng ffprobe để lấy thông số kỹ thuật chi tiết của media (format, streams).
        """
        if not os.path.exists(media_path):
            raise FileNotFoundError(f"Tệp đầu vào không tồn tại: {media_path}")

        cmd = [
            self.ffprobe_bin,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            media_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        if result.returncode != 0:
            raise FFmpegExecutionError(cmd, result.returncode, result.stderr, result.stdout)

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as err:
            raise FFmpegError(f"Không thể parse JSON metadata từ ffprobe: {err}")

    def inspect_audio_stream(self, media_path: str) -> Optional[Dict[str, Any]]:
        """
        Tìm và trả về thông tin luồng âm thanh đầu tiên từ file media.
        Trả về None nếu file không có luồng audio (video câm).
        """
        metadata = self.get_media_metadata(media_path)
        streams = metadata.get("streams", [])
        for stream in streams:
            if stream.get("codec_type") == "audio":
                return {
                    "codec_name": stream.get("codec_name"),
                    "sample_rate": int(stream.get("sample_rate", 0)),
                    "channels": int(stream.get("channels", 0)),
                    "duration_seconds": float(
                        stream.get("duration") or metadata.get("format", {}).get("duration", 0.0)
                    )
                }
        return None

    def extract_and_normalize_audio(
        self,
        input_path: str,
        output_path: str,
        target_sample_rate: int = 16000,
        target_channels: int = 1
    ) -> Dict[str, Any]:
        """
        Trích xuất và chuẩn hóa audio:
        - Output format: WAV (PCM 16-bit, codec pcm_s16le)
        - Sample rate: 16000 Hz
        - Channels: 1 (Mono)
        """
        # 1. Validate file nguồn
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"File nguồn không tồn tại: {input_path}")

        audio_info = self.inspect_audio_stream(input_path)
        if audio_info is None:
            raise AudioValidationError(
                f"File '{os.path.basename(input_path)}' không chứa bất kỳ luồng âm thanh nào."
            )

        # Đảm bảo thư mục cha của output tồn tại
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        # 2. Xây dựng lệnh FFmpeg
        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(target_sample_rate),
            "-ac", str(target_channels),
            output_path
        ]

        # 3. Thực thi FFmpeg qua subprocess với encoding an toàn
        start_time = time.time()
        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        elapsed_time = time.time() - start_time

        # 4. Kiểm tra exit code
        if process.returncode != 0:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise FFmpegExecutionError(cmd, process.returncode, process.stderr, process.stdout)

        # 5. Kiểm tra output hậu xử lý
        if not os.path.exists(output_path):
            raise AudioValidationError(f"FFmpeg kết thúc exit 0 nhưng không tìm thấy file output: {output_path}")

        file_size = os.path.getsize(output_path)
        if file_size == 0:
            os.remove(output_path)
            raise AudioValidationError(f"File output rỗng (0 bytes): {output_path}")

        # 6. Đối soát metadata output bằng ffprobe
        out_audio_info = self.inspect_audio_stream(output_path)
        if not out_audio_info:
            os.remove(output_path)
            raise AudioValidationError("Không thể đọc metadata của file output vừa tạo.")

        if out_audio_info["sample_rate"] != target_sample_rate:
            raise AudioValidationError(
                f"Sample rate output ({out_audio_info['sample_rate']}) không khớp mục tiêu ({target_sample_rate})"
            )

        if out_audio_info["channels"] != target_channels:
            raise AudioValidationError(
                f"Channels output ({out_audio_info['channels']}) không khớp mục tiêu ({target_channels})"
            )

        return {
            "status": "SUCCESS",
            "input_file": input_path,
            "output_file": output_path,
            "format": "wav",
            "codec": out_audio_info["codec_name"],
            "sample_rate": out_audio_info["sample_rate"],
            "channels": out_audio_info["channels"],
            "duration_seconds": round(out_audio_info["duration_seconds"], 3),
            "file_size_bytes": file_size,
            "processing_time_seconds": round(elapsed_time, 3)
        }
        
    def slice_audio(
        self,
        input_path: str,
        output_path: str,
        start_seconds: float,
        duration_seconds: float
    ) -> Dict[str, Any]:
        """
        Cắt một phân đoạn âm thanh từ input_path từ start_seconds với độ dài duration_seconds.
        Giữ nguyên chuẩn 16kHz Mono PCM 16-bit.
        """
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"File nguồn không tồn tại: {input_path}")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        # Lệnh FFmpeg cắt chính xác:
        # -ss đặt trước -i để tìm kiếm nhanh (fast seek)
        # -t chỉ định thời lượng cần cắt
        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-ss", str(start_seconds),
            "-t", str(duration_seconds),
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            output_path
        ]

        start_time = time.time()
        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        elapsed_time = time.time() - start_time

        if process.returncode != 0:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise FFmpegExecutionError(cmd, process.returncode, process.stderr, process.stdout)

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise AudioValidationError(f"File chunk cắt ra bị rỗng hoặc không tồn tại: {output_path}")

        chunk_info = self.inspect_audio_stream(output_path)
        actual_duration = chunk_info["duration_seconds"] if chunk_info else duration_seconds

        return {
            "output_file": output_path,
            "duration_seconds": round(actual_duration, 3),
            "file_size_bytes": os.path.getsize(output_path),
            "processing_time_seconds": round(elapsed_time, 3)
        }
