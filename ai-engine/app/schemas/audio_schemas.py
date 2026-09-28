from typing import Optional
from pydantic import BaseModel, Field
from typing import Optional, List
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

class AudioChunkItem(BaseModel):
    """Schema mô tả metadata của từng chunk âm thanh."""
    chunk_index: int = Field(..., description="Thứ tự chunk (1, 2, 3...)")
    file_path: str = Field(..., description="Đường dẫn tuyệt đối tới file chunk trên ổ đĩa")
    file_name: str = Field(..., description="Tên tệp chunk")
    start: str = Field(..., description="Thời điểm bắt đầu định dạng HH:MM:SS")
    end: str = Field(..., description="Thời điểm kết thúc định dạng HH:MM:SS")
    start_seconds: float = Field(..., description="Thời điểm bắt đầu (giây)")
    end_seconds: float = Field(..., description="Thời điểm kết thúc (giây)")
    duration: float = Field(..., description="Độ dài phân đoạn chunk (giây)")


class AudioManifest(BaseModel):
    """Schema Manifest ánh xạ giữa các chunk và timeline của audio gốc."""
    source: str = Field(..., description="Tên tệp âm thanh nguồn")
    source_path: str = Field(..., description="Đường dẫn tệp nguồn")
    duration: float = Field(..., description="Tổng thời lượng tệp nguồn (giây)")
    chunk_count: int = Field(..., description="Tổng số lượng chunks")
    chunks: List[AudioChunkItem] = Field(..., description="Danh sách chi tiết các chunks")


class AudioChunkRequest(BaseModel):
    """Schema nhận request phân đoạn audio từ Orchestrator/Backend."""
    input_path: str = Field(
        ...,
        description="Đường dẫn tới tệp audio WAV 16kHz Mono nguồn"
    )
    output_dir: Optional[str] = Field(
        None,
        description="Thư mục lưu các chunks và file manifest.json. Mặc định tạo thư mục con cùng cấp."
    )
    target_chunk_duration: float = Field(
        2400.0,
        description="Thời lượng mục tiêu mỗi chunk tính bằng giây (Mặc định 2400s = 40 phút)"
    )


class AudioChunkResponse(BaseModel):
    """Schema trả về kết quả chunking cho pipeline xử lý AI."""
    status: str = Field(..., description="Trạng thái: SUCCESS, SKIPPED hoặc FAILED")
    message: str = Field(..., description="Mô tả kết quả xử lý")
    total_duration_seconds: Optional[float] = Field(None, description="Tổng thời lượng file nguồn")
    is_chunked: bool = Field(..., description="Đánh dấu file có bị chia nhỏ hay không")
    manifest_file: Optional[str] = Field(None, description="Đường dẫn tệp manifest.json trên ổ đĩa")
    manifest: Optional[AudioManifest] = Field(None, description="Dữ liệu manifest chi tiết")
    error_message: Optional[str] = Field(None, description="Chi tiết lỗi nếu thất bại")