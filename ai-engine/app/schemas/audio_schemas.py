from typing import Optional
from pydantic import BaseModel, Field


class AudioExtractionRequest(BaseModel):
    """Schema nhận request tiền xử lý âm thanh từ Backend Spring Boot."""
    input_path: str = Field(
        ...,
        description="Đường dẫn tuyệt đối hoặc tương đối tới tệp media nguồn (MP4, MKV, MP3, WAV...)"
    )
    output_path: Optional[str] = Field(
        None,
        description="Đường dẫn lưu file WAV đích. Nếu để trống, hệ thống tự sinh tên file chuẩn hóa cùng thư mục."
    )
    target_sample_rate: int = Field(
        16000,
        description="Tần số lấy mẫu mục tiêu (chuẩn AI là 16000Hz)"
    )
    target_channels: int = Field(
        1,
        description="Số kênh âm thanh mục tiêu (1: Mono, 2: Stereo)"
    )


class AudioExtractionResponse(BaseModel):
    """Schema trả về kết quả tiền xử lý âm thanh cho pipeline."""
    status: str = Field(..., description="Trạng thái xử lý: SUCCESS hoặc FAILED")
    input_file: str = Field(..., description="Đường dẫn file nguồn đã nhận")
    output_file: Optional[str] = Field(None, description="Đường dẫn file WAV đã chuẩn hóa")
    format: Optional[str] = Field(None, description="Định dạng container (wav)")
    codec: Optional[str] = Field(None, description="Codec âm thanh (pcm_s16le)")
    sample_rate: Optional[int] = Field(None, description="Tần số lấy mẫu thực tế (Hz)")
    channels: Optional[int] = Field(None, description="Số kênh âm thanh thực tế")
    duration_seconds: Optional[float] = Field(None, description="Độ dài âm thanh tính bằng giây")
    file_size_bytes: Optional[int] = Field(None, description="Dung lượng file output (bytes)")
    processing_time_seconds: Optional[float] = Field(None, description="Thời gian thực thi trích xuất (giây)")
    error_message: Optional[str] = Field(None, description="Thông báo lỗi chi tiết nếu xử lý thất bại")