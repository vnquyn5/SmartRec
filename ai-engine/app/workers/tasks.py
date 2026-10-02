from typing import Optional, Dict, Any
from app.core.celery_app import celery_app
from app.core.path_security import validate_safe_read_path, validate_safe_write_path
from app.services.speaker_labeling_service import speaker_labeling_service


@celery_app.task(name="smartrec.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="smartrec.diarize")
def diarize_audio_task(
    audio_path: str,
    output_json_path: Optional[str] = None,
    job_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Background worker task thực thi Speaker Diarization & VAD pipeline.
    Bảo đảm thực thi kiểm tra an toàn đường dẫn như API HTTP.
    """
    # 1. Kiểm tra an toàn đường dẫn đồng bộ với HTTP API
    safe_input = validate_safe_read_path(audio_path)
    safe_output = validate_safe_write_path(output_json_path) if output_json_path else None

    # 2. Xử lý qua service
    payload, saved_file = speaker_labeling_service.process_and_export(
        audio_path=safe_input,
        output_json_path=safe_output,
        job_id=job_id
    )

    res = payload.model_dump()
    if saved_file:
        res["saved_json_path"] = str(saved_file)
    return res
