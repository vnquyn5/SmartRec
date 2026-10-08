import os
import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator


def validate_safe_path(path_str: Optional[str], field_name: str = "path") -> Optional[str]:
    """Kiểm tra và chuẩn hóa đường dẫn an toàn (Chống Path Traversal)."""
    if path_str is None:
        return None

    clean_path = path_str.strip()
    if not clean_path:
        raise ValueError(f"Trường '{field_name}' không được để trống.")

    # Chuẩn hóa đường dẫn
    normalized = os.path.normpath(clean_path)

    if "\x00" in normalized:
        raise ValueError(f"Đường dẫn '{field_name}' chứa ký tự không hợp lệ.")

    parts = normalized.split(os.sep)
    if ".." in parts:
        raise ValueError(f"Đường dẫn '{field_name}' chứa mẫu Path Traversal trái phép ('..').")

    return normalized


def validate_job_id_format(job_id_str: str) -> str:
    """[H3] Khóa chặt job_id: Chỉ cho phép chữ cái, chữ số, gạch dưới và gạch ngang."""
    clean_id = job_id_str.strip()
    if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", clean_id):
        raise ValueError(
            f"job_id '{job_id_str}' không hợp lệ. Chỉ cho phép ký tự chữ cái, số, '-' hoặc '_', độ dài 1-64 ký tự."
        )
    return clean_id


# -----------------------------------------------------------------------------
# 1. EXTRACT & NORMALIZE SCHEMAS
# -----------------------------------------------------------------------------
class AudioExtractionRequest(BaseModel):
    input_path: str = Field(..., description="Đường dẫn file video/audio nguồn")
    output_path: Optional[str] = Field(None, description="Đường dẫn lưu file WAV sau chuẩn hóa")
    target_sample_rate: int = Field(16000, description="Tần số lấy mẫu mục tiêu (16kHz)")
    target_channels: int = Field(1, description="Số kênh âm thanh (Mono)")

    @field_validator("input_path", "output_path")
    @classmethod
    def check_paths(cls, v, info):
        return validate_safe_path(v, info.field_name)

    @field_validator("target_sample_rate")
    @classmethod
    def check_sample_rate(cls, v):
        if v != 16000:
            raise ValueError("Hệ thống chỉ chấp nhận target_sample_rate = 16000 (16kHz).")
        return v

    @field_validator("target_channels")
    @classmethod
    def check_channels(cls, v):
        if v != 1:
            raise ValueError("Hệ thống chỉ chấp nhận target_channels = 1 (Mono).")
        return v

    @model_validator(mode="after")
    def prevent_self_overwrite(self):
        if self.output_path and os.path.abspath(self.input_path) == os.path.abspath(self.output_path):
            raise ValueError("output_path không được trùng với input_path (tránh ghi đè file nguồn).")
        return self


class AudioExtractionResponse(BaseModel):
    status: str = Field(..., example="SUCCESS")
    output_path: str = Field(...)
    sample_rate: int = Field(16000)
    channels: int = Field(1)
    duration_seconds: float = Field(...)
    file_size_bytes: int = Field(...)
    message: Optional[str] = None


# -----------------------------------------------------------------------------
# 2. CHUNKER SCHEMAS
# -----------------------------------------------------------------------------
class AudioChunkRequest(BaseModel):
    input_path: str = Field(..., description="Đường dẫn file WAV nguồn")
    output_dir: Optional[str] = Field(None, description="Thư mục lưu các phân đoạn chunk")
    target_chunk_duration: float = Field(
        2400.0,
        ge=600.0,
        le=2700.0,
        description="Thời lượng mỗi chunk (từ 600s/10 phút đến 2700s/45 phút)"
    )

    @field_validator("input_path", "output_dir")
    @classmethod
    def check_paths(cls, v, info):
        return validate_safe_path(v, info.field_name)


class AudioChunkResponse(BaseModel):
    status: str = Field(..., example="SUCCESS")
    message: str = Field(...)
    total_duration_seconds: float = Field(...)
    is_chunked: bool = Field(...)
    manifest_file: Optional[str] = Field(None)
    manifest: Optional[Dict[str, Any]] = Field(None)


# -----------------------------------------------------------------------------
# 3. ANS & AEC SCHEMAS
# -----------------------------------------------------------------------------
class AudioANSRequest(BaseModel):
    input_path: str = Field(..., description="File WAV 16kHz Mono đầu vào")
    output_path: Optional[str] = Field(None, description="File WAV đích sau khi khử nhiễu")
    suppression_level: int = Field(3, ge=0, le=3, description="Mức độ giảm nhiễu (0-3)")

    @field_validator("input_path", "output_path")
    @classmethod
    def check_paths(cls, v, info):
        return validate_safe_path(v, info.field_name)

    @model_validator(mode="after")
    def prevent_self_overwrite(self):
        if self.output_path and os.path.abspath(self.input_path) == os.path.abspath(self.output_path):
            raise ValueError("output_path không được trùng với input_path.")
        return self


class AudioANSResponse(BaseModel):
    status: str = Field(..., example="SUCCESS")
    output_path: str = Field(...)
    noise_reduction_db: float = Field(...)
    processing_time_seconds: float = Field(...)
    suppression_level: int = Field(3)
    output_file: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def sync_output_fields(cls, data: Any):
        if isinstance(data, dict):
            # Đồng bộ output_path và output_file
            p = data.get("output_path") or data.get("output_file")
            if p:
                data["output_path"] = p
                data["output_file"] = p
            # Phòng ngừa suppression_level bị None
            if data.get("suppression_level") is None:
                data["suppression_level"] = 3
        return data


class AudioAECRequest(BaseModel):
    capture_path: str = Field(..., description="File thu âm mic có tiếng vọng")
    reference_path: Optional[str] = Field(None, description="File âm thanh loa tham chiếu")
    output_path: Optional[str] = Field(None, description="File đích sau khi triệt tiêu echo")

    @field_validator("capture_path", "reference_path", "output_path")
    @classmethod
    def check_paths(cls, v, info):
        return validate_safe_path(v, info.field_name)

    @model_validator(mode="after")
    def prevent_self_overwrite(self):
        if self.output_path and os.path.abspath(self.capture_path) == os.path.abspath(self.output_path):
            raise ValueError("output_path không được trùng với capture_path.")
        return self


class AudioAECResponse(BaseModel):
    status: str = Field(..., example="SUCCESS")
    output_path: str = Field(...)
    erle_db: float = Field(...)
    processing_time_seconds: float = Field(...)
    reference_provided: bool = Field(True)
    output_file: Optional[str] = None  # Đồng bộ đầy đủ với service payload

    @model_validator(mode="before")
    @classmethod
    def sync_output_fields(cls, data: Any):
        if isinstance(data, dict):
            p = data.get("output_path") or data.get("output_file")
            if p:
                data["output_path"] = p
                data["output_file"] = p
        return data


# -----------------------------------------------------------------------------
# 4. PIPELINE SCHEMAS (Khắc phục H3)
# -----------------------------------------------------------------------------
class QualityCheckMetrics(BaseModel):
    passed: bool = Field(...)
    sample_rate: int = Field(16000)
    channels: int = Field(1)
    duration_seconds: float = Field(...)
    file_size_bytes: int = Field(...)
    rms_energy: float = Field(...)
    is_silent: bool = Field(False)
    is_clipped: bool = Field(False)
    duration_drift_samples: int = Field(0)
    error_message: Optional[str] = None


class StepLogEntry(BaseModel):
    step: str = Field(...)
    status: str = Field(...)
    input_file: str = Field(...)
    output_file: str = Field(...)
    input_duration: float = Field(...)
    output_duration: float = Field(...)
    processing_time_seconds: float = Field(...)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None


class AudioPipelineRequest(BaseModel):
    job_id: str = Field(..., description="Mã định danh duy nhất (chỉ gồm a-z, A-Z, 0-9, _, -)")
    session_id: Optional[str] = Field(None)
    input_path: str = Field(...)
    reference_path: Optional[str] = Field(None)
    suppression_level: int = Field(3, ge=0, le=3)
    output_dir: Optional[str] = Field(None)

    @field_validator("job_id")
    @classmethod
    def check_job_id(cls, v):
        return validate_job_id_format(v)

    @field_validator("input_path", "reference_path", "output_dir")
    @classmethod
    def check_paths(cls, v, info):
        return validate_safe_path(v, info.field_name)


class AudioPipelineResponse(BaseModel):
    job_id: str = Field(...)
    session_id: Optional[str] = None
    overall_status: str = Field(...)
    final_output_file: Optional[str] = None
    total_processing_time_seconds: float = Field(...)
    quality_check: Optional[QualityCheckMetrics] = None
    step_logs: List[StepLogEntry] = Field(default_factory=list)
    error_message: Optional[str] = None
