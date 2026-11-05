from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class AudioDiarizationRequest(BaseModel):
    """Yêu cầu thực thi Speaker Diarization & VAD Pipeline."""
    input_path: str = Field(..., description="Đường dẫn tới file WAV audio 16kHz đã chuẩn hóa")
    output_json_path: Optional[str] = Field(None, description="Đường dẫn file JSON đầu ra tùy chọn")
    job_id: Optional[str] = Field(None, description="Mã định danh job xử lý")


class SpeakerSegment(BaseModel):
    """Chi tiết một phân đoạn phát biểu dạng phẳng trên timeline."""
    segment_id: int = Field(..., description="Chỉ số thứ tự phân đoạn tăng dần")
    speaker: str = Field(..., description="Nhãn người nói thân thiện (ví dụ: Speaker 1, Speaker 2)")
    raw_speaker_id: Optional[str] = Field(None, description="Mã speaker gốc từ pipeline (SPEAKER_00)")
    source_chunk_index: Optional[int] = Field(None, description="Chunk source when preserving raw long-audio evidence")
    start_seconds: float = Field(..., description="Thời điểm bắt đầu (giây)")
    end_seconds: float = Field(..., description="Thời điểm kết thúc (giây)")
    duration_seconds: float = Field(..., description="Thời lượng phân đoạn (giây)")
    start_time: str = Field(..., description="Thời điểm bắt đầu định dạng HH:MM:SS.mmm")
    end_time: str = Field(..., description="Thời điểm kết thúc định dạng HH:MM:SS.mmm")
    embedding: Optional[List[float]] = Field(None, description="Vector embedding phân đoạn nếu có")


class SpeechActivityInterval(BaseModel):
    """Khoảng thời gian phát hiện hoạt động giọng nói (VAD)."""
    start_seconds: float
    end_seconds: float
    duration_seconds: float


class SpeakerTurnSmoothingDiagnostic(BaseModel):
    """Auditable candidate record; diagnostics-only currently never changes identity."""

    pattern: str
    previous_speaker: Optional[str] = None
    candidate_speaker: str
    next_speaker: Optional[str] = None
    start_seconds: float
    end_seconds: float
    duration_ms: float
    silent_gap_before_ms: Optional[float] = None
    silent_gap_after_ms: Optional[float] = None
    raw_overlap_speakers: List[str] = Field(default_factory=list)
    rapid_change_count: int = 0
    source_chunk_index: Optional[int] = None
    resolution_status: str = "PRESERVED"
    reason_code: str = "INSUFFICIENT_ACOUSTIC_EVIDENCE"


class SpeakerSegmentationResponse(BaseModel):
    """Kết quả phân đoạn giọng nói và VAD từ pipeline, chuẩn hóa để bàn giao cho các module downstream."""
    job_id: Optional[str] = None
    status: str = Field(..., description="SUCCESS | NO_SPEECH_DETECTED | FAILED")
    audio_duration_seconds: float = Field(..., description="Tổng thời lượng audio đầu vào")
    speech_duration_seconds: float = Field(..., description="Tổng thời gian có giọng nói phát biểu")
    speech_ratio: float = Field(..., description="Tỷ lệ giọng nói / tổng thời lượng audio")
    total_segments: int = Field(..., description="Tổng số phân đoạn phát biểu")
    unique_speakers: List[str] = Field(default_factory=list, description="Danh sách người nói phát hiện được")
    segments: List[SpeakerSegment] = Field(default_factory=list, description="Danh sách chi tiết các phân đoạn")
    raw_segments: List[SpeakerSegment] = Field(
        default_factory=list,
        description="Raw Pyannote evidence segments, preserved separately from the selected timeline",
    )
    timeline_mode: str = Field("raw", description="Selected presentation/alignment timeline mode")
    timeline_source: str = Field(
        "raw", description="raw | raw_postprocessed | native | native_exclusive_diagnostics_only | unavailable"
    )
    native_exclusive_segments: List[SpeakerSegment] = Field(default_factory=list)
    smoothed_segments: List[SpeakerSegment] = Field(default_factory=list)
    smoothing_enabled: bool = False
    smoothing_max_fragment_ms: Optional[int] = None
    smoothing_diagnostics: List[SpeakerTurnSmoothingDiagnostic] = Field(default_factory=list)
    vad_intervals: List[SpeechActivityInterval] = Field(
        default_factory=list,
        description="Toàn bộ các khoảng Voice Activity Detection đã hợp nhất"
    )
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class SpeakerHierarchicalSegment(BaseModel):
    """Phân đoạn gắn liền bên trong cấu trúc phân cấp của từng Speaker."""
    segment_id: int
    start: float = Field(..., description="Thời điểm bắt đầu (giây)")
    end: float = Field(..., description="Thời điểm kết thúc (giây)")
    duration: float = Field(..., description="Thời lượng (giây)")
    start_time: str = Field(..., description="Định dạng HH:MM:SS.mmm")
    end_time: str = Field(..., description="Định dạng HH:MM:SS.mmm")


class SpeakerProfile(BaseModel):
    """Đại diện thông tin của một người nói trong job."""
    speaker_label: str = Field(..., description="Tên định danh chuẩn hóa: Speaker 1, Speaker 2...")
    raw_speaker_id: str = Field(..., description="Định danh gốc từ mô hình: SPEAKER_00...")
    total_segments: int = Field(..., description="Tổng số lần người này phát biểu")
    total_speech_duration_seconds: float = Field(..., description="Tổng thời lượng người này nói (giây)")
    embedding: Optional[List[float]] = Field(None, description="Vector đặc trưng âm học của speaker nếu có")
    segments: List[SpeakerHierarchicalSegment] = Field(
        default_factory=list,
        description="Danh sách các phân đoạn thuộc về speaker này"
    )


class DiarizationExportPayload(BaseModel):
    """Cấu trúc dữ liệu JSON chuẩn hóa xuất ra để bàn giao cho các module AI tiếp theo."""
    job_id: Optional[str] = None
    audio_file: str = Field(..., description="Tên hoặc đường dẫn file audio")
    status: str = Field(..., description="SUCCESS | NO_SPEECH_DETECTED | FAILED")
    audio_duration_seconds: float
    speech_duration_seconds: float
    speech_ratio: float
    total_speakers: int
    speaker_mapping: Dict[str, str] = Field(
        default_factory=dict,
        description="Bảng tra cứu ánh xạ: {'SPEAKER_00': 'Speaker 1'}"
    )
    speakers: List[SpeakerProfile] = Field(
        default_factory=list,
        description="Cấu trúc phân cấp Speaker -> Segments"
    )
    timeline: List[SpeakerSegment] = Field(
        default_factory=list,
        description="Danh sách tuần tự toàn bộ các segments theo timestamp"
    )
    raw_timeline: List[SpeakerSegment] = Field(
        default_factory=list,
        description="Unmodified raw diarization evidence using the same speaker mapping",
    )
    timeline_mode: str = Field("raw", description="raw | exclusive")
    timeline_source: str = Field(
        "raw", description="raw | raw_postprocessed | native | native_exclusive_diagnostics_only | unavailable"
    )
    native_exclusive_timeline: List[SpeakerSegment] = Field(default_factory=list)
    smoothed_timeline: List[SpeakerSegment] = Field(default_factory=list)
    smoothing_enabled: bool = False
    smoothing_max_fragment_ms: Optional[int] = None
    smoothing_diagnostics: List[SpeakerTurnSmoothingDiagnostic] = Field(default_factory=list)
    embeddings_status: Optional[str] = Field(
        "NOT_AVAILABLE",
        description="Trạng thái trích xuất embeddings: COMPLETED | PARTIAL | FAILED | NOT_AVAILABLE"
    )
    error_code: Optional[str] = None
    error_message: Optional[str] = None
