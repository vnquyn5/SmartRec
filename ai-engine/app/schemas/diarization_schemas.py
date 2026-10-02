from typing import List, Optional
from pydantic import BaseModel, Field


class SpeakerSegment(BaseModel):
    """Chi tiết một phân đoạn phát biểu."""
    segment_id: int = Field(..., description="Chỉ số thứ tự phân đoạn")
    speaker: str = Field(..., description="Định danh người nói tạm thời (ví dụ: SPEAKER_00)")
    start_seconds: float = Field(..., description="Thời điểm bắt đầu (giây)")
    end_seconds: float = Field(..., description="Thời điểm kết thúc (giây)")
    duration_seconds: float = Field(..., description="Thời lượng phân đoạn (giây)")
    start_time: str = Field(..., description="Thời điểm bắt đầu định dạng HH:MM:SS.mmm")
    end_time: str = Field(..., description="Thời điểm kết thúc định dạng HH:MM:SS.mmm")


class SpeechActivityInterval(BaseModel):
    """Khoảng thời gian phát hiện hoạt động giọng nói (VAD)."""
    start_seconds: float
    end_seconds: float
    duration_seconds: float


class SpeakerSegmentationResponse(BaseModel):
    """Kết quả phân đoạn giọng nói và Voice Activity Detection."""
    job_id: Optional[str] = None
    status: str = Field(..., description="SUCCESS | NO_SPEECH_DETECTED | FAILED")
    audio_duration_seconds: float = Field(..., description="Tổng thời lượng audio đầu vào")
    speech_duration_seconds: float = Field(..., description="Tổng thời gian có giọng nói phát biểu")
    speech_ratio: float = Field(..., description="Tỷ lệ giọng nói / tổng thời lượng audio")
    total_segments: int = Field(..., description="Tổng số phân đoạn phát biểu")
    unique_speakers: List[str] = Field(default_factory=list, description="Danh sách người nói phát hiện được")
    segments: List[SpeakerSegment] = Field(default_factory=list, description="Danh sách chi tiết các phân đoạn")
    vad_intervals: List[SpeechActivityInterval] = Field(
        default_factory=list,
        description="Toàn bộ các khoảng Voice Activity Detection đã hợp nhất"
    )
    error_message: Optional[str] = None
