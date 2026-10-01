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
    
    
class AudioANSRequest(BaseModel):
    """Schema nhận request lọc tạp âm WebRTC ANS."""
    input_path: str = Field(..., description="Đường dẫn tuyệt đối hoặc tương đối tới file WAV 16kHz Mono")
    output_path: Optional[str] = Field(None, description="Đường dẫn lưu file sau ANS. Nếu để trống, hệ thống tự sinh đuôi '_ans.wav'")
    suppression_level: int = Field(3, ge=0, le=3, description="Mức độ triệt tiêu tạp âm: 0 (Mild), 1 (Medium), 2 (High), 3 (Aggressive)")


class AudioANSResponse(BaseModel):
    """Schema trả về kết quả sau khi lọc tạp âm."""
    status: str = Field(..., description="Trạng thái: SUCCESS hoặc FAILED")
    input_file: str = Field(..., description="Đường dẫn file nguồn đã xử lý")
    output_file: Optional[str] = Field(None, description="Đường dẫn file sạch sau lọc")
    sample_rate: Optional[int] = Field(None, description="Tần số lấy mẫu (chuẩn 16000Hz)")
    channels: Optional[int] = Field(None, description="Số kênh âm thanh (chuẩn 1 Mono)")
    suppression_level: Optional[int] = Field(None, description="Mức lọc đã áp dụng (0 - 3)")
    duration_seconds: Optional[float] = Field(None, description="Thời lượng file sau xử lý")
    noise_reduction_db: Optional[float] = Field(None, description="Mức năng lượng tạp âm giảm được (dB)")
    processing_time_seconds: Optional[float] = Field(None, description="Thời gian thực thi (giây)")
    error_message: Optional[str] = Field(None, description="Thông điệp chi tiết nếu xảy ra lỗi")
    
class AudioAECRequest(BaseModel):
    """Schema nhận request triệt tiêu tiếng vang WebRTC AEC."""
    capture_path: str = Field(..., description="Đường dẫn file WAV 16kHz Mono từ microphone")
    reference_path: Optional[str] = Field(None, description="Đường dẫn file WAV 16kHz Mono từ loa ngoài (nếu có)")
    output_path: Optional[str] = Field(None, description="Đường dẫn lưu file sau AEC (mặc định tự sinh '_aec.wav')")


class AudioAECResponse(BaseModel):
    """Schema phản hồi kết quả sau khi xử lý AEC."""
    status: str = Field(..., description="Trạng thái: SUCCESS, BYPASS_NO_REFERENCE, hoặc BYPASS_INVALID_REFERENCE")
    message: str = Field(..., description="Mô tả chi tiết kết quả xử lý")
    capture_file: str = Field(..., description="Đường dẫn file capture đầu vào")
    reference_file: Optional[str] = Field(None, description="Đường dẫn file reference đối chiếu (nếu có)")
    output_file: Optional[str] = Field(None, description="Đường dẫn file âm thanh sau AEC")
    sample_rate: Optional[int] = Field(None, description="Sample rate (16000Hz)")
    channels: Optional[int] = Field(None, description="Số kênh âm thanh (1 Mono)")
    duration_seconds: Optional[float] = Field(None, description="Thời lượng file sau xử lý")
    erle_db: Optional[float] = Field(None, description="Mức giảm tiếng vang loa thu được (dB)")
    input_rms: Optional[float] = Field(None, description="Năng lượng tín hiệu trước xử lý")
    output_rms: Optional[float] = Field(None, description="Năng lượng tín hiệu sau xử lý")
    processing_time_seconds: Optional[float] = Field(None, description="Thời gian thực thi thuật toán (giây)")
    error_message: Optional[str] = Field(None, description="Thông báo lỗi chi tiết nếu phát sinh sự cố")