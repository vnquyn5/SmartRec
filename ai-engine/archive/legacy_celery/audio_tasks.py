import os
import shutil
import logging
from typing import Dict, Any

from app.pipelines.audio_pipeline import AudioPipelineExecutor
from app.tracking import ResourceTracker
from app.services.callback_client import CallbackClient
from app.celery_app import celery_app

logger = logging.getLogger("smartrec.tasks.audio")
callback_client = CallbackClient()


@celery_app.task(name="tasks.audio.process_pipeline", bind=True)
def process_audio_pipeline_task(self, job_data: Dict[str, Any]):
    """
    Celery Task nhận Job từ Redis Queue, chạy Pipeline và gửi Callback về Spring Boot.
    """
    job_id = job_data.get("job_id")
    meeting_id = job_data.get("meeting_id")
    file_location = job_data.get("file_location")
    callback_url = job_data.get("callback_url")
    config = job_data.get("config", {})

    if not all([job_id, meeting_id, file_location, callback_url]):
        logger.error(f"Job data thiếu thông tin bắt buộc: {job_data}")
        return {"status": "FAILED", "error": "MISSING_REQUIRED_FIELDS"}

    # Khởi tạo workspace tạm biệt lập cho Job
    workspace_dir = f"/tmp/smartrec_workspace/{job_id}"
    os.makedirs(workspace_dir, exist_ok=True)

    try:
        # Bọc toàn bộ pipeline bằng ResourceTracker (Task 2.13.1)
        with ResourceTracker(
            job_id=job_id,
            model_name="pyannote/speaker-diarization-3.1",
            model_version="3.1.0",
            device="cpu",
            scope="thread"
        ) as tracker:
            logger.info(f"[{job_id}] Bắt đầu xử lý Audio Pipeline cho Meeting {meeting_id}...")

            # Stage 1: FFmpeg (16kHz Mono)
            ffmpeg_res = AudioPipelineExecutor.run_ffmpeg(workspace_dir, file_location)
            if ffmpeg_res.status == "FAILED":
                raise RuntimeError(f"FFmpeg thất bại: {ffmpeg_res.error_message}")

            # Stage 2: WebRTC (AEC / ANS / Quality Gate)
            webrtc_res = AudioPipelineExecutor.run_webrtc(workspace_dir, ffmpeg_res.output_path)
            if webrtc_res.status == "FAILED":
                raise RuntimeError(f"WebRTC thất bại: {webrtc_res.error_message}")

            # Stage 3: pyannote (Speaker Diarization)
            diar_res = AudioPipelineExecutor.run_pyannote(
                workspace_dir,
                webrtc_res.output_path,
                config=config
            )
            if diar_res.status == "FAILED":
                raise RuntimeError(f"Diarization thất bại: {diar_res.error_message}")

            # Stage 4: Gom JSON chuẩn hóa
            output_json = AudioPipelineExecutor.build_output_json(
                job_id=job_id,
                meeting_id=meeting_id,
                diarization_json_path=diar_res.output_path
            )

        processing_time = tracker.record.processing_time if tracker.record else 0.0

        # Gửi Callback thành công về Spring Boot
        callback_payload = {
            "job_id": job_id,
            "meeting_id": meeting_id,
            "stage": "DIARIZATION",
            "status": "COMPLETED",
            "processing_time": round(float(processing_time), 2),
            "data": output_json.get("speaker_diarization", {}),
            "error": None
        }
        callback_client.send_callback(callback_url, callback_payload)
        return {"status": "COMPLETED"}

    except Exception as e:
        logger.error(f"[{job_id}] Pipeline gặp lỗi: {e}", exc_info=True)
        # Gửi Callback thất bại về Spring Boot
        failure_payload = {
            "job_id": job_id,
            "meeting_id": meeting_id,
            "stage": "DIARIZATION",
            "status": "FAILED",
            "processing_time": 0.0,
            "data": None,
            "error": {
                "code": "PIPELINE_EXECUTION_ERROR",
                "message": str(e)
            }
        }
        callback_client.send_callback(callback_url, failure_payload)
        return {"status": "FAILED", "error": str(e)}

    finally:
        # Dọn dẹp thư mục workspace để giải phóng dung lượng đĩa
        if os.path.exists(workspace_dir):
            shutil.rmtree(workspace_dir, ignore_errors=True)