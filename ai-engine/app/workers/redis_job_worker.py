import os
import sys
import shutil
import logging
from pathlib import Path
import requests
import threading
import time
from uuid import uuid4

# 1. Đảm bảo thư mục gốc ai-engine luôn nằm trong sys.path
BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app.core.config import settings
from app.services.minio_client import get_minio_client
from app.services.audio_extractor import AudioExtractorService, InvalidMediaError
from app.schemas.audio_schemas import AudioPipelineRequest
from app.schemas.diarization_schemas import DiarizationExportPayload
from app.tracking import ResourceTracker
from app.services.callback_client import CallbackClient
from app.core.path_security import get_workspace_root, validate_safe_read_path, validate_safe_write_path
from app.core.path_security import SUPPORTED_MEDIA_INPUT_EXTENSIONS
from app.workers.processing_errors import (
    NoSpeechDetectedError,
    NonRetryableProcessingError,
    RetryableProcessingError,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("smartrec.worker")

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://host.docker.internal:8082/api/v1").rstrip("/")
INTERNAL_TOKEN = settings.smartrec_internal_token or ""

# Khởi tạo các client dùng chung cho processor.
minio_client = get_minio_client()
callback_client = CallbackClient()
audio_extractor = AudioExtractorService()
# These processing services are loaded on demand so importing task/control
# code for unit tests does not require GPU inference dependencies.
pipeline_orchestrator = None
speaker_labeling_service = None


def _get_pipeline_orchestrator():
    global pipeline_orchestrator
    if pipeline_orchestrator is None:
        from app.services.audio_pipeline import AudioPipelineOrchestrator

        pipeline_orchestrator = AudioPipelineOrchestrator()
    return pipeline_orchestrator


def _get_speaker_labeling_service():
    global speaker_labeling_service
    if speaker_labeling_service is None:
        from app.services.speaker_labeling_service import speaker_labeling_service as service

        speaker_labeling_service = service
    return speaker_labeling_service


class _PauseAtBoundary(Exception):
    pass


class _CancelAtBoundary(Exception):
    pass


class _ExecutionLost(Exception):
    pass


class WorkerHeartbeat:
    """Keeps the backend lease fresh during long, atomic processing stages."""
    def __init__(self, job_id: str, execution_id: str):
        self.job_id = job_id
        self.execution_id = execution_id
        self.interval = max(5, int(os.getenv("SMARTREC_HEARTBEAT_INTERVAL_SECONDS", "12")))
        self._stop = threading.Event()
        self._execution_lost = threading.Event()
        self._lock = threading.Lock()
        self._latest = None
        self._thread = threading.Thread(target=self._run, name=f"heartbeat-{job_id}", daemon=True)

    def _send(self):
        response = requests.post(
            f"{BACKEND_BASE_URL}/jobs/{self.job_id}/heartbeat",
            headers={"X-Internal-Token": INTERNAL_TOKEN, "X-Execution-Id": self.execution_id}, timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
        if not data.get("executionAllowed", False):
            self._execution_lost.set()
        with self._lock:
            self._latest = data
        return data

    def _run(self):
        while not self._stop.wait(self.interval):
            try:
                data = self._send()
                if not data.get("executionAllowed", False):
                    logger.info("[%s] Execution lease bị từ chối; worker sẽ dừng tại safe point", self.job_id)
                    return
            except Exception as exc:
                logger.warning("[%s] Heartbeat delivery failed: %s", self.job_id, exc)

    def start(self):
        self._thread.start()

    def checkpoint(self):
        if self._execution_lost.is_set():
            raise _ExecutionLost()
        data = self._send()
        if not data.get("executionAllowed", False):
            raise _ExecutionLost()
        status = str(data.get("status") or "").upper()
        if status in {"PAUSE_REQUESTED", "PAUSED"}:
            raise _PauseAtBoundary()
        if status in {"CANCEL_REQUESTED", "CANCELLED"}:
            raise _CancelAtBoundary()
        if status in {"FAILED", "DLQ", "COMPLETED"}:
            raise NonRetryableProcessingError("JOB_TERMINAL", f"Backend job is already {status}")
        if status not in {"PROCESSING", "RUNNING", "QUEUED", "RETRYING"}:
            raise RetryableProcessingError(f"Unexpected backend job status: {status or 'unknown'}")
        return data

    def stop(self):
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2)


def fetch_job_details(job_id: str) -> dict:
    """Truy vấn Spring Boot để lấy metadata của Job (objectKey, meetingId, currentStage)."""
    url = f"{BACKEND_BASE_URL}/jobs/{job_id}"
    resp = requests.get(url, headers={"X-Internal-Token": INTERNAL_TOKEN}, timeout=10.0)
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        if resp.status_code == 404:
            raise NonRetryableProcessingError("JOB_NOT_FOUND", f"Job {job_id} không còn tồn tại ở Backend") from exc
        raise
    return resp.json()


def send_stage_callback(job_id: str, stage: str, status: str, segments=None, error_msg=None, error_code=None,
                        execution_id=None) -> bool:
    """Gửi payload chuẩn hóa về endpoint POST /jobs/{jobId}/callback của Backend."""
    url = f"{BACKEND_BASE_URL}/jobs/{job_id}/callback"
    payload = {
        "stage": stage,
        "status": status,
        "errorCode": (error_code or "RETRYABLE_PROCESSING_ERROR") if status == "FAILED" else None,
        "errorMessage": error_msg,
        "segments": segments
    }
    return callback_client.send_callback(url, payload, job_id=job_id, internal_token=INTERNAL_TOKEN,
                                         execution_id=execution_id)

def require_stage_callback(job_id: str, stage: str, status: str, segments=None, error_msg=None, error_code=None,
                           execution_id=None):
    if not send_stage_callback(job_id, stage, status, segments=segments, error_msg=error_msg, error_code=error_code,
                               execution_id=execution_id):
        raise RetryableProcessingError(f"Backend callback failed for {job_id} {stage} {status}")

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
    execution_id = str(uuid4())
    workspace_dir = os.path.join(str(get_workspace_root()), job_id)
    current_stage = "FFMPEG"
    heartbeat = None
    preserve_workspace = False
    successful_stages = set()

    try:
        os.makedirs(workspace_dir, exist_ok=True)
        # Lấy thông tin Job từ Spring Boot
        job_info = fetch_job_details(job_id)
        job_status = str(job_info.get("status") or "").strip().upper()
        if job_status in {"FAILED", "COMPLETED", "CANCELLED", "DLQ", "SUCCEEDED"}:
            logger.info("[%s] Bỏ qua stale/terminal job với status=%s", job_id, job_status)
            return {"status": "SKIPPED", "reason": "TERMINAL_JOB", "jobStatus": job_status}

        if job_status == "PAUSED":
            logger.info("[%s] Bỏ qua task trùng vì Job đang PAUSED", job_id)
            preserve_workspace = True
            return {"status": "SKIPPED", "reason": "PAUSED"}

        current_stage = str(job_info.get("stage") or current_stage)

        heartbeat = WorkerHeartbeat(job_id, execution_id)
        heartbeat.start()

        object_key = job_info.get("objectKey")
        meeting_id = job_info.get("meetingId")
        logger.info(f"[{job_id}] ========== [BẮT ĐẦU XỬ LÝ JOB: {job_id}] ==========")

        heartbeat_state = heartbeat.checkpoint()
        current_stage = str(heartbeat_state.get("currentStage") or current_stage)
        successful_stages = set(heartbeat_state.get("successfulStages") or [])

        if not meeting_id:
            raise NonRetryableProcessingError("VALIDATION_ERROR", f"Job {job_id} thiếu meetingId từ Backend.")
        if not object_key:
            raise NonRetryableProcessingError("VALIDATION_ERROR", f"Job {job_id} không có objectKey hợp lệ từ Backend.")

        file_ext = os.path.splitext(object_key)[1].lower()
        logger.info("[%s] Input media detected: extension=%s", job_id, file_ext or "<none>")
        if file_ext not in SUPPORTED_MEDIA_INPUT_EXTENSIONS:
            raise NonRetryableProcessingError(
                "UNSUPPORTED_FORMAT",
                f"Định dạng tệp '{file_ext}' không được hỗ trợ.",
            )

        # Tải file gốc từ MinIO về workspace
        file_ext = file_ext or ".media"
        raw_input_path = os.path.join(workspace_dir, f"raw_input{file_ext}")
        logger.info(f"[{job_id}] Đang tải '{object_key}' từ MinIO bucket '{settings.minio_bucket}'...")
        minio_client.fget_object(
            bucket_name=settings.minio_bucket,
            object_name=object_key,
            file_path=raw_input_path
        )
        
        # [GUARD 1]: Kiểm định an toàn đường dẫn file đầu vào
        validate_safe_read_path(raw_input_path)

        required_resume_artifacts = {
            "FFMPEG": os.path.join(workspace_dir, "01_normalized_16k.wav"),
            "WEBRTC": os.path.join(workspace_dir, "02_cleaned.wav"),
            "PYANNOTE": os.path.join(workspace_dir, "03_diarization.json"),
        }
        missing_artifact = next((stage for stage in successful_stages
                                 if stage in required_resume_artifacts
                                 and not os.path.isfile(required_resume_artifacts[stage])), None)
        if missing_artifact:
            raise NonRetryableProcessingError(
                "WORKSPACE_LOST",
                f"Không thể tiếp tục từ stage {missing_artifact}: workspace trung gian không còn đầy đủ.",
            )

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
            normalized_wav = os.path.join(workspace_dir, "01_normalized_16k.wav")
            if "FFMPEG" not in successful_stages or not os.path.exists(normalized_wav):
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "PROCESSING", execution_id=execution_id)
                logger.info(f"[{job_id}] >>> Thực thi Stage 1: FFMPEG...")
                validate_safe_write_path(normalized_wav)
                try:
                    audio_extractor.extract_and_normalize(
                        input_path=raw_input_path, output_path=normalized_wav,
                        target_sample_rate=16000, target_channels=1
                    )
                except InvalidMediaError as e:
                    raise NonRetryableProcessingError(e.error_code, str(e)) from e
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "SUCCESS", execution_id=execution_id)

            # -------------------------------------------------------------
            # STAGE 2: WEBRTC (Khử ồn ANS + Lọc vang AEC + Quality Gate)
            # -------------------------------------------------------------
            current_stage = "WEBRTC"
            stable_clean_wav = os.path.join(workspace_dir, "02_cleaned.wav")
            if "WEBRTC" in successful_stages and os.path.exists(stable_clean_wav):
                clean_wav = stable_clean_wav
            else:
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "PROCESSING", execution_id=execution_id)
                logger.info(f"[{job_id}] >>> Thực thi Stage 2: WEBRTC...")
                pipe_req = AudioPipelineRequest(
                    job_id=job_id, input_path=normalized_wav, reference_path=None,
                    output_dir=workspace_dir, suppression_level=3
                )
                pipe_res = _get_pipeline_orchestrator().process_pipeline(pipe_req)
                if pipe_res.overall_status != "SUCCESS":
                    raise NonRetryableProcessingError("VALIDATION_ERROR", f"WebRTC Pipeline lỗi: {pipe_res.error_message}")
                clean_wav = pipe_res.final_output_file
                if clean_wav and os.path.abspath(clean_wav) != os.path.abspath(stable_clean_wav):
                    shutil.copy2(clean_wav, stable_clean_wav)
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "SUCCESS", execution_id=execution_id)
            clean_wav = stable_clean_wav

            # -------------------------------------------------------------
            # STAGE 3: PYANNOTE (Speaker Diarization & VAD)
            # -------------------------------------------------------------
            current_stage = "PYANNOTE"
            diar_json_path = os.path.join(workspace_dir, "03_diarization.json")
            if "PYANNOTE" in successful_stages and os.path.exists(diar_json_path):
                diar_payload = DiarizationExportPayload.model_validate_json(Path(diar_json_path).read_text())
            else:
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "PROCESSING", execution_id=execution_id)
                logger.info(f"[{job_id}] >>> Thực thi Stage 3: PYANNOTE...")
                validate_safe_write_path(diar_json_path)
                diar_payload, _ = _get_speaker_labeling_service().process_and_export(
                    audio_path=clean_wav, output_json_path=diar_json_path, job_id=job_id
                )
                if diar_payload.status != "SUCCESS":
                    if diar_payload.status == "NO_SPEECH_DETECTED":
                        raise NoSpeechDetectedError(diar_payload.error_message or "Không phát hiện tiếng nói trong audio")
                    error_code = getattr(diar_payload, "error_code", None) or "DIARIZATION_INFERENCE_ERROR"
                    error_message = diar_payload.error_message or diar_payload.status
                    if error_code in {"INVALID_AUDIO", "UNSUPPORTED_FORMAT", "AUDIO_EMPTY", "AUDIO_CORRUPTED", "VALIDATION_ERROR"}:
                        raise NonRetryableProcessingError(error_code, error_message)
                    raise RetryableProcessingError(error_message)
                heartbeat.checkpoint()
                require_stage_callback(job_id, current_stage, "SUCCESS", execution_id=execution_id)

            # -------------------------------------------------------------
            # STAGE 4: OUTPUT (Chuẩn hóa segments và gửi về Backend)
            # -------------------------------------------------------------
            current_stage = "OUTPUT"
            heartbeat.checkpoint()
            require_stage_callback(job_id, current_stage, "PROCESSING", execution_id=execution_id)
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

            # OUTPUT work is short but still has a safe point before committing
            # its terminal success callback.
            heartbeat.checkpoint()
            require_stage_callback(job_id, current_stage, "SUCCESS", segments=formatted_segments,
                                   execution_id=execution_id)
            logger.info(f"[{job_id}] ========== [HOÀN TẤT THÀNH CÔNG JOB: {job_id}] ==========")

    except _ExecutionLost:
        preserve_workspace = True
        logger.info("[%s] Bỏ qua task vì execution lease đã thuộc worker khác hoặc Job terminal", job_id)
        return {"status": "SKIPPED", "reason": "EXECUTION_LEASE_LOST"}
    except _PauseAtBoundary:
        control = heartbeat._send() if heartbeat else {}
        current_stage = control.get("currentStage") or current_stage
        preserve_workspace = True
        require_stage_callback(job_id, current_stage, "PAUSED", execution_id=execution_id)
        logger.info("[%s] Job paused safely at stage boundary %s", job_id, current_stage)
        return {"status": "PAUSED", "stage": current_stage}
    except _CancelAtBoundary:
        control = heartbeat._send() if heartbeat else {}
        current_stage = control.get("currentStage") or current_stage
        require_stage_callback(job_id, current_stage, "CANCELLED", execution_id=execution_id)
        logger.info("[%s] Job cancelled safely at stage boundary %s", job_id, current_stage)
        return {"status": "CANCELLED", "stage": current_stage}
    except NonRetryableProcessingError as e:
        if heartbeat and heartbeat._execution_lost.is_set():
            preserve_workspace = True
            logger.info("[%s] Không báo lỗi stage vì execution lease đã mất", job_id)
            return {"status": "SKIPPED", "reason": "EXECUTION_LEASE_LOST"}
        logger.error(f"[{job_id}] Lỗi xử lý Job tại stage {current_stage}: {e}", exc_info=True)
        try:
            require_stage_callback(job_id, current_stage, "FAILED", error_msg=str(e), error_code=e.error_code,
                                   execution_id=execution_id)
        except Exception:
            # Reporting failure must not convert a deterministic processing failure
            # into a Celery task retry. The task returns terminally after HTTP retries.
            logger.exception(
                "[%s] Không gửi được callback FAILED sau retry HTTP; giữ lỗi terminal %s và không retry pipeline",
                job_id,
                e.error_code,
            )
        return {"status": "FAILED", "stage": current_stage, "errorCode": e.error_code, "errorMessage": str(e)}
    except Exception as e:
        if heartbeat and heartbeat._execution_lost.is_set():
            preserve_workspace = True
            logger.info("[%s] Bỏ qua exception vì execution lease đã mất", job_id)
            return {"status": "SKIPPED", "reason": "EXECUTION_LEASE_LOST"}
        logger.error(f"[{job_id}] Lỗi xử lý Job tại stage {current_stage}: {e}", exc_info=True)
        try:
            require_stage_callback(job_id, current_stage, "FAILED", error_msg=str(e),
                                   error_code="RETRYABLE_PROCESSING_ERROR", execution_id=execution_id)
        except RetryableProcessingError:
            logger.exception("Failed to report worker failure to Backend")
        raise RetryableProcessingError(str(e)) from e
    finally:
        if heartbeat:
            heartbeat.stop()
        # Dọn dẹp thư mục làm việc tạm thời
        try:
            if not preserve_workspace:
                shutil.rmtree(workspace_dir)
                logger.info(f"[{job_id}] Đã dọn dẹp workspace: {workspace_dir}")
        except Exception as cleanup_err:
            logger.warning(f"[{job_id}] Không thể dọn dẹp workspace hoàn toàn: {cleanup_err}")


if __name__ == "__main__":
    raise SystemExit("Run this processor through the Celery worker runtime.")
