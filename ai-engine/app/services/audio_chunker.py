import os
import json
from typing import Dict, Any, List, Optional
from app.services.ffmpeg_wrapper import (
    FFmpegWrapper,
    AudioValidationError,
    FFmpegExecutionError,
    FFmpegError
)


class AudioChunkerError(Exception):
    """Lỗi xử lý trong AudioChunker."""
    pass


class AudioDurationExceededError(AudioChunkerError):
    """Ném ra khi audio vượt quá 4 giờ (> 14400s) - vi phạm Business Boundary."""
    pass


class AudioChunker:
    """
    Dịch vụ chia nhỏ audio dài >2h thành các chunk 30–45 phút
    và sinh Manifest JSON phục vụ quy đổi timeline cho pipeline AI.
    """

    # Hạn mức tính bằng giây
    MAX_ALLOWED_DURATION = 14400.0  # 4 giờ (Hard limit từ chối)
    CHUNK_THRESHOLD_DURATION = 7200.0  # 2 giờ (Ngưỡng kích hoạt chia chunk)
    DEFAULT_CHUNK_DURATION = 2400.0  # 40 phút (Khoảng chuẩn 30-45 phút)

    def __init__(self, wrapper: Optional[FFmpegWrapper] = None):
        self.wrapper = wrapper or FFmpegWrapper()

    @staticmethod
    def seconds_to_hms(seconds: float) -> str:
        """Quy đổi số giây thành chuỗi định dạng HH:MM:SS."""
        total_seconds = int(round(seconds))
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        secs = total_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"

    def process_audio(
        self,
        input_path: str,
        output_dir: Optional[str] = None,
        target_chunk_duration: float = DEFAULT_CHUNK_DURATION
    ) -> Dict[str, Any]:
        """
        Xử lý kiểm tra thời lượng và tiến hành chunking nếu > 2h.
        Trả về dictionary chứa thông tin xử lý và Manifest.
        """
        input_path = os.path.abspath(input_path)
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"File nguồn không tồn tại: {input_path}")

        # 1. Kiểm tra metadata và duration
        audio_info = self.wrapper.inspect_audio_stream(input_path)
        if not audio_info:
            raise AudioValidationError(f"Tệp không chứa luồng audio hợp lệ: {input_path}")

        total_duration = audio_info["duration_seconds"]

        # Rule 1: Từ chối nếu thời lượng > 4 giờ
        if total_duration > self.MAX_ALLOWED_DURATION:
            raise AudioDurationExceededError(
                f"Thời lượng audio ({total_duration:.1f}s) vượt quá giới hạn cho phép 4 giờ (14400s). "
                "Hệ thống từ chối xử lý theo Business Rule."
            )

        # Chuẩn bị thư mục chứa chunk
        if not output_dir:
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            output_dir = os.path.join(os.path.dirname(input_path), f"{base_name}_chunks")
        output_dir = os.path.abspath(output_dir)

        # Rule 2: Thời lượng <= 2 giờ -> Không cần chia chunk
        if total_duration <= self.CHUNK_THRESHOLD_DURATION:
            return {
                "status": "SKIPPED",
                "message": "Thời lượng audio <= 2 giờ, không cần chia chunk.",
                "total_duration_seconds": round(total_duration, 3),
                "is_chunked": False,
                "manifest": None
            }

        # Rule 3: 2 giờ < Thời lượng <= 4 giờ -> Chia chunk từ 30–45 phút
        os.makedirs(output_dir, exist_ok=True)
        chunks_metadata: List[Dict[str, Any]] = []
        current_start = 0.0
        chunk_index = 1
        base_filename = os.path.splitext(os.path.basename(input_path))[0]

        while current_start < total_duration:
            # Tính toán độ dài chunk hiện tại
            remaining_duration = total_duration - current_start
            current_chunk_duration = min(target_chunk_duration, remaining_duration)
            current_end = current_start + current_chunk_duration

            chunk_filename = f"{base_filename}_chunk_{chunk_index:03d}.wav"
            chunk_filepath = os.path.join(output_dir, chunk_filename)

            # Thực thi cắt file
            self.wrapper.slice_audio(
                input_path=input_path,
                output_path=chunk_filepath,
                start_seconds=current_start,
                duration_seconds=current_chunk_duration
            )

            # Ghi nhận thông số vào danh sách
            chunks_metadata.append({
                "chunk_index": chunk_index,
                "file_path": chunk_filepath,
                "file_name": chunk_filename,
                "start": self.seconds_to_hms(current_start),
                "end": self.seconds_to_hms(current_end),
                "start_seconds": round(current_start, 3),
                "end_seconds": round(current_end, 3),
                "duration": round(current_chunk_duration, 3)
            })

            current_start += current_chunk_duration
            chunk_index += 1

        # Tạo cấu trúc Manifest JSON
        manifest = {
            "source": os.path.basename(input_path),
            "source_path": input_path,
            "duration": round(total_duration, 3),
            "chunk_count": len(chunks_metadata),
            "chunks": chunks_metadata
        }

        # Lưu manifest ra file JSON tại thư mục chunks
        manifest_path = os.path.join(output_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        return {
            "status": "SUCCESS",
            "message": f"Đã chia thành công audio thành {len(chunks_metadata)} chunks.",
            "total_duration_seconds": round(total_duration, 3),
            "is_chunked": True,
            "manifest_file": manifest_path,
            "manifest": manifest
        }