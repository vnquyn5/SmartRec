from typing import Optional


class AudioPipelineError(Exception):
    """Lỗi gốc cho toàn bộ các ngoại lệ trong Audio Pipeline."""
    def __init__(self, message: str, stage: str, job_id: str):
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.job_id = job_id

    def __str__(self) -> str:
        return f"[{self.job_id}][{self.stage}] {self.message}"


class InputValidationError(AudioPipelineError):
    """Ném ra khi job_id, đường dẫn file hoặc định dạng đầu vào không hợp lệ."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message=message, stage="INPUT_VALIDATION", job_id=job_id)


class FFmpegStageError(AudioPipelineError):
    """Ném ra khi quá trình tách audio hoặc chuẩn hóa 16kHz mono qua FFmpeg thất bại."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message=message, stage="FFMPEG", job_id=job_id)


class WebRTCStageError(AudioPipelineError):
    """Ném ra khi quá trình lọc nhiễu WebRTC (Noise Suppression / APM) thất bại."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message=message, stage="WEBRTC", job_id=job_id)


class PyannoteStageError(AudioPipelineError):
    """Ném ra khi quá trình Speaker Diarization bằng pyannote-audio gặp sự cố."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message=message, stage="PYANNOTE", job_id=job_id)


class OutputGenerationError(AudioPipelineError):
    """Ném ra khi tổng hợp kết quả hoặc xuất JSON trung gian thất bại."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message=message, stage="OUTPUT_GENERATION", job_id=job_id)
