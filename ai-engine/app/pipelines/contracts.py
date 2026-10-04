from enum import Enum
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field, asdict


class AudioStage(str, Enum):
    """Định danh tuần tự các stage trong Audio Pipeline."""
    INPUT_VALIDATION = "INPUT_VALIDATION"
    FFMPEG = "FFMPEG"
    WEBRTC = "WEBRTC"
    PYANNOTE = "PYANNOTE"
    OUTPUT_GENERATION = "OUTPUT_GENERATION"


class PipelineStatus(str, Enum):
    """Trạng thái thực thi của pipeline hoặc stage."""
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


@dataclass
class PipelineJobContext:
    """Ngữ cảnh thực thi của một Audio Job."""
    job_id: str
    media_id: str
    file_location: str
    file_type: str
    work_dir: Path

    def __post_init__(self):
        if isinstance(self.work_dir, str):
            self.work_dir = Path(self.work_dir)
        self.work_dir.mkdir(parents=True, exist_ok=True)


@dataclass
class AudioMetadata:
    """Metadata kỹ thuật của file audio sau chuẩn hóa."""
    sample_rate: int = 16000
    channels: int = 1
    duration: float = 0.0
    format: str = "wav"


@dataclass
class SpeakerSegment:
    """Đoạn phát biểu của một người nói theo timestamp."""
    speaker: str
    start: float
    end: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "speaker": self.speaker,
            "start": round(float(self.start), 3),
            "end": round(float(self.end), 3)
        }


@dataclass
class StageResult:
    """Kết quả trả về sau khi hoàn thành một stage."""
    stage: AudioStage
    success: bool
    output_path: Optional[str] = None
    duration_seconds: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage.value,
            "success": self.success,
            "output_path": self.output_path,
            "duration_seconds": round(self.duration_seconds, 3),
            "metadata": self.metadata,
            "error_message": self.error_message,
        }


@dataclass
class AudioPipelineOutput:
    """Cấu trúc JSON đầu ra thống nhất của Audio Pipeline."""
    job_id: str
    media_id: str
    status: str
    audio_metadata: Dict[str, Any]
    segments: List[Dict[str, Any]]
    stage_execution_times: Dict[str, float] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "media_id": self.media_id,
            "status": self.status,
            "audio_metadata": self.audio_metadata,
            "segments": self.segments,
            "stage_execution_times": self.stage_execution_times,
            "error": self.error,
        }
