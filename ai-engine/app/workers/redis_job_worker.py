import os
import sys
import time
import shutil
import logging
from pathlib import Path
import redis
import requests
import tempfile

# 1. Đảm bảo thư mục gốc ai-engine luôn nằm trong sys.path
BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app.core.config import settings
from app.services.minio_client import get_minio_client
from app.services.audio_extractor import AudioExtractorService
from app.services.audio_pipeline import AudioPipelineOrchestrator
from app.schemas.audio_schemas import AudioPipelineRequest
from app.services.speaker_labeling_service import speaker_labeling_service
from app.tracking import ResourceTracker
from app.services.callback_client import CallbackClient
from app.core.path_security import validate_safe_read_path, validate_safe_write_path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("smartrec.worker")

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8082/api/v1").rstrip("/")

# Khởi tạo kết nối
redis_client = redis.Redis(
    host=settings.redis_host,
    port=settings.redis_port,
    db=0,
    decode_responses=True
)
minio_client = get_minio_client()
callback_client = CallbackClient()
audio_extractor = AudioExtractorService()
pipeline_orchestrator = AudioPipelineOrchestrator()


def fetch_job_details(job_id: str) -> dict:
    """Truy vấn Spring Boot để lấy metadata của Job (objectKey, meetingId, currentStage)."""
    url = f"{BACKEND_BASE_URL}/jobs/{job_id}"
    resp = requests.get(url, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


def send_stage_callback(job_id: str, stage: str, status: str, segments=None, error_msg=None) -> bool:
    """Gửi payload chuẩn hóa về endpoint POST /jobs/{jobId}/callback của Backend."""
    url = f"{BACKEND_BASE_URL}/jobs/{job_id}/callback"
    payload = {
        "stage": stage,
        "status": status,
        "errorCode": "STAGE_PROCESSING_ERROR" if status == "FAILED" else None,
        "errorMessage": error_msg,
        "segments": segments
    }
    return callback_client.send_callback(url, payload, job_id=job_id)

def parse_timestamp_to_seconds(val) -> float:
    """Chuyển đổi thời gian dạng số (float) hoặc chuỗi (HH:MM:SS.mmm / MM:SS.mmm) thành giây."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        val = val.strip()
        try:
            return float(val)
        except ValueError:
            parts = val.split(":")
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            elif len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
    return 0.0

def process_job(job_id: str):
    workspace_dir = os.path.join(tempfile.gettempdir(), "smartrec_workspace", job_id)
    os.makedirs(workspace_dir, exist_ok=True)
    current_stage = "FFMPEG"

    try:
        # Lấy thông tin Job từ Spring Boot
        job_info = fetch_job_details(job_id)
        object_key = job_info.get("objectKey")
        meeting_id = job_info.get("meetingId")
        logger.info(f"[{job_id}] ========== [BẮT ĐẦU XỬ LÝ JOB: {job_id}] ==========")

        if not object_key:
            raise ValueError(f"Job {job_id} không có objectKey hợp lệ từ Backend.")

        # Tải file gốc từ MinIO về workspace
        file_ext = os.path.splitext(object_key)[1] or ".media"
        raw_input_path = os.path.join(workspace_dir, f"raw_input{file_ext}")
        logger.info(f"[{job_id}] Đang tải '{object_key}' từ MinIO bucket '{settings.minio_bucket}'...")
        minio_client.fget_object(
            bucket_name=settings.minio_bucket,
            object_name=object_key,
            file_path=raw_input_path
        )
        
        # [GUARD 1]: Kiểm định an toàn đường dẫn file đầu vào
        validate_safe_read_path(raw_input_path)

        with ResourceTracker(
            job_id=job_id,
            model_name=settings.pyannote_model_id,
            model_version="3.1.0",
            device=settings.pyannote_device if settings.pyannote_device != "auto" else "cpu",
            scope="thread"
        ):
            # -------------------------------------------------------------
            # STAGE 1: FFMPEG (Trích xuất & chuẩn hóa sang 16kHz Mono WAV)
            # -------------------------------------------------------------
            current_stage = "FFMPEG"
            send_stage_callback(job_id, current_stage, "PROCESSING")
            logger.info(f"[{job_id}] >>> Thực thi Stage 1: FFMPEG...")
            normalized_wav = os.path.join(workspace_dir, "01_normalized_16k.wav")
            
            # [GUARD 2]: Kiểm định an toàn đường dẫn file audio chuẩn hóa trước khi ghi
            validate_safe_write_path(normalized_wav)
            
            audio_extractor.extract_and_normalize(
                input_path=raw_input_path,
                output_path=normalized_wav,
                target_sample_rate=16000,
                target_channels=1
            )
            send_stage_callback(job_id, current_stage, "SUCCESS")

            # -------------------------------------------------------------
            # STAGE 2: WEBRTC (Khử ồn ANS + Lọc vang AEC + Quality Gate)
            # -------------------------------------------------------------
            current_stage = "WEBRTC"
            send_stage_callback(job_id, current_stage, "PROCESSING")
            logger.info(f"[{job_id}] >>> Thực thi Stage 2: WEBRTC...")
            pipe_req = AudioPipelineRequest(
                job_id=job_id,
                input_path=normalized_wav,
                reference_path=None,  # Kích hoạt graceful fallback an toàn sang ANS
                output_dir=workspace_dir,
                suppression_level=3
            )
            pipe_res = pipeline_orchestrator.process_pipeline(pipe_req)
            if pipe_res.overall_status != "SUCCESS":
                raise RuntimeError(f"WebRTC Pipeline lỗi: {pipe_res.error_message}")
            clean_wav = pipe_res.final_output_file
            send_stage_callback(job_id, current_stage, "SUCCESS")

            # -------------------------------------------------------------
            # STAGE 3: PYANNOTE (Speaker Diarization & VAD)
            # -------------------------------------------------------------
            current_stage = "PYANNOTE"
            send_stage_callback(job_id, current_stage, "PROCESSING")
            logger.info(f"[{job_id}] >>> Thực thi Stage 3: PYANNOTE...")
            diar_json_path = os.path.join(workspace_dir, "03_diarization.json")
            
            # [GUARD 3]: Kiểm định an toàn đường dẫn output json diarization trước khi ghi
            validate_safe_write_path(diar_json_path)

            diar_payload, _ = speaker_labeling_service.process_and_export(
                audio_path=clean_wav,
                output_json_path=diar_json_path,
                job_id=job_id
            )
            send_stage_callback(job_id, current_stage, "SUCCESS")

            # -------------------------------------------------------------
            # STAGE 4: OUTPUT (Chuẩn hóa segments và gửi về Backend)
            # -------------------------------------------------------------
            current_stage = "OUTPUT"
            send_stage_callback(job_id, current_stage, "PROCESSING")
            logger.info(f"[{job_id}] >>> Hoàn tất Stage 4: OUTPUT...")

            diar_dict = diar_payload.model_dump()
            raw_segments = diar_dict.get("timeline") or diar_dict.get("segments") or []

            # Xác định thời lượng thực tế của file âm thanh để clamp mốc timeline
            audio_duration = None
            if clean_wav and os.path.exists(clean_wav):
                try:
                    import wave
                    with wave.open(clean_wav, "rb") as wf:
                        audio_duration = round(wf.getnframes() / float(wf.getframerate()), 3)
                        logger.info(f"[{job_id}] Audio duration đo được từ clean_wav: {audio_duration}s")
                except Exception as ex:
                    logger.warning(f"[{job_id}] Không thể đọc duration từ clean_wav: {ex}")

            formatted_segments = []
            for seg in raw_segments:
                speaker_label = (
                    seg.get("speaker_label")
                    or seg.get("speaker")
                    or seg.get("speakerLabel")
                    or "SPEAKER_00"
                )
                raw_start = seg.get("start_time") if seg.get("start_time") is not None else seg.get("start", seg.get("startTime"))
                raw_end = seg.get("end_time") if seg.get("end_time") is not None else seg.get("end", seg.get("endTime"))

                start_time = parse_timestamp_to_seconds(raw_start)
                end_time = parse_timestamp_to_seconds(raw_end)

                # Clamp timeline: đảm bảo 0.0 <= start_time < end_time <= audio_duration
                start_time = max(0.0, round(start_time, 3))
                if audio_duration is not None and audio_duration > 0:
                    end_time = min(round(end_time, 3), audio_duration)
                else:
                    end_time = round(end_time, 3)

                # Kiểm tra tính hợp lệ cơ bản
                if end_time > start_time:
                    formatted_segments.append({
                        "speakerLabel": speaker_label,
                        "startTime": start_time,
                        "endTime": end_time
                    })

            send_stage_callback(job_id, current_stage, "SUCCESS", segments=formatted_segments)
            logger.info(f"[{job_id}] ========== [HOÀN TẤT THÀNH CÔNG JOB: {job_id}] ==========")

    except Exception as e:
        logger.error(f"[{job_id}] Lỗi xử lý Job tại stage {current_stage}: {e}", exc_info=True)
        # Gửi callback FAILED về đúng stage đang thực thi
        send_stage_callback(job_id, current_stage, "FAILED", error_msg=str(e))
    finally:
        # Dọn dẹp thư mục làm việc tạm thời
        try:
            shutil.rmtree(workspace_dir)
            logger.info(f"[{job_id}] Đã dọn dẹp workspace: {workspace_dir}")
        except Exception as cleanup_err:
            logger.warning(f"[{job_id}] Không thể dọn dẹp workspace hoàn toàn: {cleanup_err}")

def start_worker():
    """Lắng nghe hàng đợi Redis 'smartrec:job:queue'."""
    logger.info("AI Engine Worker khởi động thành công.")
    logger.info(f"Đang lắng nghe hàng đợi Redis 'smartrec:job:queue' tại {settings.redis_host}:{settings.redis_port}...")
    while True:
        try:
            # brpop: Chờ phần tử mới từ queue (timeout 5s để tránh treo socket)
            res = redis_client.brpop("smartrec:job:queue", timeout=5)
            if res:
                _, job_id = res
                job_id = job_id.strip()
                logger.info(f"Phát hiện Job mới: {job_id}")
                process_job(job_id)
        except redis.ConnectionError:
            logger.warning("Mất kết nối tới Redis, thử kết nối lại sau 3s...")
            time.sleep(3)
        except Exception as ex:
            logger.error(f"Lỗi vòng lặp worker: {ex}")
            time.sleep(1)


if __name__ == "__main__":
    start_worker()