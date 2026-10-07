from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Any, Optional


@dataclass
class AIUsageRecord:
    """
    Bản ghi dữ liệu tương ứng với bảng nhật ký ai_usage trong CSDL.

    Quy ước phạm vi đo lường (Measurement Scope & Semantics):
    - processing_time: Thời gian thực thi (wall-clock latency) tính theo giây.
    - cpu_usage:
        + scope='thread': % CPU của riêng luồng thực thi Job (time.thread_time()).
        + scope='process': % CPU của worker process riêng biệt (theo target_pid).
    - ram_usage: Mức tăng RAM đỉnh (Peak RAM Delta tính bằng MB).
        + scope='thread': Luôn nhận giá trị None (do hệ điều hành không phân tách RSS theo thread).
        + scope='process': Đo lường trên target_pid; nhận giá trị None nếu tiến trình kết thúc
          sớm, PID bị tái sử dụng, hoặc sampler bị timeout.
    - vram_usage: Dung lượng VRAM đỉnh cấp phát bởi PyTorch allocator (MB) trong process,
      được tuần tự hóa bảo vệ bởi GPU lock. Nhận giá trị None nếu chạy trên CPU.
    - input_tokens, output_tokens, total_tokens: Cấu trúc token chuẩn bị trước cho Sprint 3 (Task 2.13.2).
    """
    job_id: str
    model_name: str
    model_version: str
    processing_time: float
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    vram_usage: Optional[float] = None

    # Cấu trúc token cho Sprint 3 (Task 2.13.2)
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

    # Ngữ cảnh đo lường
    measurement_scope: str = "thread"          # "thread" (mặc định) hoặc "process"

    # Metadata nghiệp vụ
    fallback_used: bool = False
    estimated_cost: float = 0.0
    status: str = "success"                    # "success" hoặc "failed"
    error_message: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Serialize bản ghi thành dictionary."""
        return {
            "job_id": self.job_id,
            "model_name": self.model_name,
            "model_version": self.model_version,
            "processing_time": round(float(self.processing_time), 4),
            "cpu_usage": round(float(self.cpu_usage), 2) if self.cpu_usage is not None else None,
            "ram_usage": round(float(self.ram_usage), 2) if self.ram_usage is not None else None,
            "vram_usage": round(float(self.vram_usage), 2) if self.vram_usage is not None else None,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "measurement_scope": self.measurement_scope,
            "fallback_used": self.fallback_used,
            "estimated_cost": self.estimated_cost,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AIUsageRecord":
        """Deserialize từ dict hoặc hàng dữ liệu database (giữ nguyên giá trị None/NULL)."""
        created_at_val = data.get("created_at")
        if isinstance(created_at_val, str):
            try:
                created_at = datetime.fromisoformat(created_at_val)
            except Exception:
                created_at = datetime.now(timezone.utc)
        elif isinstance(created_at_val, datetime):
            created_at = created_at_val
        else:
            created_at = datetime.now(timezone.utc)

        return cls(
            job_id=str(data["job_id"]),
            model_name=str(data["model_name"]),
            model_version=str(data["model_version"]),
            processing_time=float(data["processing_time"]),
            cpu_usage=float(data["cpu_usage"]) if data.get("cpu_usage") is not None else None,
            ram_usage=float(data["ram_usage"]) if data.get("ram_usage") is not None else None,
            vram_usage=float(data["vram_usage"]) if data.get("vram_usage") is not None else None,
            input_tokens=int(data["input_tokens"]) if data.get("input_tokens") is not None else None,
            output_tokens=int(data["output_tokens"]) if data.get("output_tokens") is not None else None,
            total_tokens=int(data["total_tokens"]) if data.get("total_tokens") is not None else None,
            measurement_scope=str(data.get("measurement_scope", "thread")),
            fallback_used=bool(data.get("fallback_used", False)),
            estimated_cost=float(data.get("estimated_cost", 0.0)),
            status=str(data.get("status", "success")),
            error_message=data.get("error_message"),
            created_at=created_at,
        )
