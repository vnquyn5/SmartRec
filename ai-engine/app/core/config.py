from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "smartrec-ai-engine"
    log_level: str = "INFO"
    redis_host: str = "localhost"
    redis_port: int = 6379
    minio_endpoint: str = "http://localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "smartrec-media"
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"
    smartrec_internal_token: Optional[str] = None
    backend_base_url: str = "http://host.docker.internal:8082/api/v1"
    workspace_root: str = "/tmp/smartrec_workspace"

    # Pyannote Speaker Diarization Settings
    hf_token: Optional[str] = None
    pyannote_model_id: str = "pyannote/speaker-diarization-3.1"
    pyannote_device: str = "auto"  # "auto", "mps", "cuda", "cpu"

    # Cloud GPU diarization (server chạy trên Colab/GPU + tunnel). Để trống = chạy pyannote local như cũ.
    cloud_gpu_url: Optional[str] = None
    cloud_gpu_timeout_seconds: int = 900
    # "Hộp thư" GitHub Gist: server GPU tự ghi link tunnel mới vào đây mỗi lần bật lại.
    cloud_gpu_registry_gist_id: Optional[str] = None
    cloud_gpu_registry_github_token: Optional[str] = None
    cloud_gpu_registry_filename: str = "gpu_url.txt"
    cloud_gpu_registry_ttl_seconds: int = 20

    # LLM & Fallback Configuration
    llm_default_route: str = "local"
    local_llm_endpoint: str = "http://localhost:11434/api/generate"
    local_llm_model: str = "qwen2.5:7b"
    local_llm_timeout_seconds: float = 120.0

    fallback_enabled: bool = True
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 30.0

    # Job Limits & Cost Guard
    job_max_requests_limit: int = 5
    job_max_cost_limit_usd: float = 0.50
    gemini_cost_per_1k_input_tokens: float = 0.000075
    gemini_cost_per_1k_output_tokens: float = 0.000300

    # Chính sách PII: True = luôn che PII khi gửi ra dịch vụ ngoài, client không thể tắt.
    pii_redaction_enforced: bool = True

    # Backend lưu quota/cost/idempotency: "auto" (Redis nếu kết nối được, nếu không dùng memory),
    # "redis" (bắt buộc Redis) hoặc "memory".
    llm_guard_backend: str = "auto"
    llm_guard_state_ttl_seconds: int = 86400

    # Throttle & retry gọi Gemini
    gemini_rpm_limit: int = 12
    gemini_rate_limit_max_wait_seconds: float = 5.0
    gemini_max_retries: int = 3
    gemini_retry_base_backoff_seconds: float = 1.0
    gemini_retry_max_backoff_seconds: float = 8.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
