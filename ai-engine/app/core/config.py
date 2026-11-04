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
    workspace_root: str = "/tmp/smartrec_workspace"
    local_llm_endpoint: Optional[str] = None
    local_llm_model: Optional[str] = None
    local_llm_connect_timeout_seconds: float = 5.0
    local_llm_timeout_seconds: float = 120.0
    # Keep legacy inference behavior unless an operator explicitly disables it.
    smartrec_llm_enabled: bool = True

    # Pyannote Speaker Diarization Settings
    hf_token: Optional[str] = None
    pyannote_model_id: str = "pyannote/speaker-diarization-3.1"
    pyannote_device: str = "auto"  # "auto", "mps", "cuda", "cpu"

    # PaddleOCR Settings
    # Model paths can be mounted from Docker host storage.
    ocr_detection_model_dir: Optional[str] = None
    ocr_recognition_model_dir: Optional[str] = None
    ocr_device: str = "cpu"

    # CPU inference configuration
    # Defaults validated on Linux ARM64 Docker.
    ocr_enable_mkldnn: bool = False
    ocr_cpu_threads: int = 1

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
