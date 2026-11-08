from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Import this module before services that read os.environ at module scope.
# The Docker image does not copy ai-engine/.env; Compose supplies its own env.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


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
    local_llm_timeout_seconds: float = 180.0
    smartrec_llm_enabled: bool = True

    # Pyannote Speaker Diarization Settings
    hf_token: Optional[str] = None
    pyannote_model_id: str = "pyannote/speaker-diarization-3.1"
    pyannote_device: str = "auto"  # "auto", "mps", "cuda", "cpu"
    pyannote_timeline_mode: Literal["raw", "exclusive"] = "raw"
    pyannote_turn_smoothing_enabled: bool = False
    pyannote_turn_smoothing_max_fragment_ms: int = Field(default=150, gt=0, le=10000)
    pyannote_num_speakers: Optional[int] = Field(default=None, gt=0)
    pyannote_min_speakers: Optional[int] = Field(default=None, gt=0)
    pyannote_max_speakers: Optional[int] = Field(default=None, gt=0)

    # PaddleOCR Settings
    # Model paths can be mounted from Docker host storage.
    ocr_detection_model_dir: Optional[str] = None
    ocr_recognition_model_dir: Optional[str] = None
    ocr_device: str = "cpu"

    # CPU inference configuration
    # Defaults validated on Linux ARM64 Docker.
    ocr_enable_mkldnn: bool = False
    ocr_cpu_threads: int = 1

    model_config = SettingsConfigDict(extra="ignore")


settings = Settings()
