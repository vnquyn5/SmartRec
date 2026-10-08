from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "smartrec-ai-engine"
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

    # Pyannote Speaker Diarization Settings
    hf_token: Optional[str] = None
    pyannote_model_id: str = "pyannote/speaker-diarization-3.1"
    pyannote_device: str = "auto"  # "auto", "mps", "cuda", "cpu"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
