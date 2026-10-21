import math
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
    Dịch vụ chia nhỏ audio dài thành các chunk 10–15 phút (có hỗ trợ overlap)
    và sinh Manifest JSON phục vụ quy đổi timeline cho pipeline AI.
    """

    # Hạn mức tính bằng giây
    MAX_ALLOWED_DURATION = 14400.0       # 4 giờ (Hard limit từ chối)
    CHUNK_THRESHOLD_DURATION = 900.0     # 15 phút (Ngưỡng kích hoạt chia chunk)
    DEFAULT_CHUNK_DURATION = 600.0       # 10 phút (Khoảng chuẩn cho PyAnnote CPU)
    DEFAULT_OVERLAP_DURATION = 5.0       # 5 giây (Độ chồng lấn biên để tránh nuốt từ)

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
        target_chunk_duration: float = DEFAULT_CHUNK_DURATION,
        overlap_duration: float = 0.0,
        chunk_threshold_duration: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Xử lý kiểm tra thời lượng và tiến hành chunking nếu vượt ngưỡng.
        Trả về dictionary chứa thông tin xử lý và Manifest.
        """
        if not isinstance(target_chunk_duration, (int, float)) or not math.isfinite(target_chunk_duration) or target_chunk_duration <= 0:
            raise AudioChunkerError(f"target_chunk_duration phải lớn hơn 0s (nhận được: {target_chunk_duration}s).")

        overlap_duration = max(0.0, float(overlap_duration)) if isinstance(overlap_duration, (int, float)) and math.isfinite(overlap_duration) else 0.0

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

        # Xác định ngưỡng kích hoạt chia chunk
        threshold = chunk_threshold_duration if chunk_threshold_duration is not None else self.CHUNK_THRESHOLD_DURATION

        # Rule 2: Thời lượng <= ngưỡng -> Không cần chia chunk
        if total_duration <= threshold:
            return {
                "status": "SKIPPED",
                "message": f"Thời lượng audio ({total_duration:.1f}s) <= ngưỡng ({threshold:.1f}s), không cần chia chunk.",
                "total_duration_seconds": round(total_duration, 3),
                "is_chunked": False,
                "manifest": None
            }

        # Rule 3: Thời lượng > ngưỡng -> Chia chunk có overlap
        os.makedirs(output_dir, exist_ok=True)
        chunks_metadata: List[Dict[str, Any]] = []
        current_core_start = 0.0
        chunk_index = 1
        base_filename = os.path.splitext(os.path.basename(input_path))[0]

        while current_core_start < total_duration:
            remaining_duration = total_duration - current_core_start
            current_core_duration = min(target_chunk_duration, remaining_duration)
            current_core_end = current_core_start + current_core_duration

            # Tính toán khoảng ngữ cảnh (context interval) bao gồm overlap
            ctx_start = max(0.0, current_core_start - overlap_duration)
            ctx_end = min(total_duration, current_core_end + overlap_duration)
            ctx_duration = ctx_end - ctx_start

            chunk_filename = f"{base_filename}_chunk_{chunk_index:03d}.wav"
            chunk_filepath = os.path.join(output_dir, chunk_filename)

            # Thực thi cắt file vật lý theo context interval
            self.wrapper.slice_audio(
                input_path=input_path,
                output_path=chunk_filepath,
                start_seconds=ctx_start,
                duration_seconds=ctx_duration
            )

            # Ghi nhận thông số vào danh sách
            chunks_metadata.append({
                "chunk_index": chunk_index,
                "file_path": chunk_filepath,
                "file_name": chunk_filename,
                "start": self.seconds_to_hms(current_core_start),
                "end": self.seconds_to_hms(current_core_end),
                "start_seconds": round(current_core_start, 3),
                "end_seconds": round(current_core_end, 3),
                "duration": round(current_core_duration, 3),
                "context_start_seconds": round(ctx_start, 3),
                "context_end_seconds": round(ctx_end, 3),
                "context_duration": round(ctx_duration, 3),
                "overlap_seconds": round(overlap_duration, 3)
            })

            current_core_start += current_core_duration
            chunk_index += 1

        manifest = {
            "source": os.path.basename(input_path),
            "source_path": input_path,
            "duration": round(total_duration, 3),
            "chunk_count": len(chunks_metadata),
            "chunks": chunks_metadata
        }

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