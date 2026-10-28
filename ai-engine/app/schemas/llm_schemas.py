from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class LLMRequest(BaseModel):
    """Yêu cầu sinh nội dung từ mô hình ngôn ngữ."""
    job_id: str = Field(..., description="Mã định danh tác vụ để kiểm soát quota và tracking")
    prompt: str = Field(..., description="Nội dung prompt yêu cầu xử lý")
    system_prompt: Optional[str] = Field(None, description="System prompt định hướng")
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(2048, ge=1, le=8192)
    apply_pii_redaction: bool = Field(True, description="Áp dụng che PII trước khi gửi sang dịch vụ ngoài")


class MeetingSummaryRequest(BaseModel):
    """Yêu cầu tóm tắt cuộc họp từ transcript (do Backend/Worker gọi)."""
    job_id: str = Field(..., min_length=1, description="Mã job (UUID) để kiểm soát quota và gửi callback")
    transcript_text: str = Field(..., min_length=1, description="Nội dung transcript cuộc họp")
    meeting_title: Optional[str] = None
    execution_id: Optional[str] = Field(
        None, description="Execution id; nếu có sẽ gửi callback aiUsage về Backend"
    )


class LLMResponse(BaseModel):
    """Kết quả phản hồi từ mô hình ngôn ngữ."""
    job_id: str
    text: str
    model_name: str
    model_version: Optional[str] = None
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    processing_time_ms: int = 0
    estimated_cost_usd: float = 0.0


class AiUsagePayload(BaseModel):
    """Schema cấu trúc ghi nhận sử dụng AI, đồng bộ với entity AiUsage của backend."""
    jobId: str
    modelName: str
    modelVersion: Optional[str] = None
    inputTokens: int = 0
    outputTokens: int = 0
    totalTokens: int = 0
    processingTime: int = 0
    fallbackUsed: bool = False
    fallbackReason: Optional[str] = None
    estimatedCost: float = 0.0
