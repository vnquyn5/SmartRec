import os
import sys
import shutil
import json
import gc
import logging
from pathlib import Path
import requests
import threading
import time
import numpy as np
from app.core.logging_config import setup_logging
from uuid import uuid4
from typing import Dict, Any, List, Optional
# 1. Đảm bảo thư mục gốc ai-engine luôn nằm trong sys.path
BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
from app.core.config import settings
from app.services.storage_client import StorageClient
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

setup_logging()
logger = logging.getLogger("smartrec.worker")

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://host.docker.internal:8082/api/v1").rstrip("/")
INTERNAL_TOKEN = settings.smartrec_internal_token or ""
# Khởi tạo các client dùng chung cho processor.
storage_client = StorageClient()
callback_client = CallbackClient()
audio_extractor = AudioExtractorService()
pipeline_orchestrator = None
speaker_labeling_service = None
audio_chunker = None


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


def _get_audio_chunker():
    global audio_chunker
    if audio_chunker is None:
        from app.services.audio_chunker import AudioChunker
        audio_chunker = AudioChunker()
    return audio_chunker


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
            headers={"X-Internal-Token": INTERNAL_TOKEN, "X-Execution-Id": self.execution_id},
            timeout=10.0,
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
    execution_id=None, ai_results=None) -> bool:
    """Gửi payload chuẩn hóa về endpoint POST /jobs/{jobId}/callback của Backend."""
    url = f"{BACKEND_BASE_URL}/jobs/{job_id}/callback"
    payload = {
        "stage": stage,
        "status": status,
        "errorCode": (error_code or "RETRYABLE_PROCESSING_ERROR") if status == "FAILED" else None,
        "errorMessage": error_msg,
        "segments": segments
    }
    if ai_results is not None:
        payload["aiResults"] = ai_results
    return callback_client.send_callback(url, payload, job_id=job_id, internal_token=INTERNAL_TOKEN,
        execution_id=execution_id)


def require_stage_callback(job_id: str, stage: str, status: str, segments=None, error_msg=None, error_code=None,
    execution_id=None, ai_results=None):
    if not send_stage_callback(
        job_id,
        stage,
        status,
        segments=segments,
        error_msg=error_msg,
        error_code=error_code,
        execution_id=execution_id,
        ai_results=ai_results
    ):
        raise RetryableProcessingError(
            f"Backend callback failed for {job_id} {stage} {status}"
        )


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


def _format_timestamp(seconds: float) -> str:
    """Định dạng timestamp thành chuỗi HH:MM:SS.mmm chuẩn ISO audio, xử lý carry an toàn."""
    ms_total = int(round(max(0.0, float(seconds)) * 1000))
    hours = ms_total // 3600000
    minutes = (ms_total % 3600000) // 60000
    secs = (ms_total % 60000) // 1000
    ms = ms_total % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def _atomic_write_json(file_path: str, data_json: str) -> None:
    """Ghi file JSON an toàn qua file tạm và atomic replace, chống hỏng file nếu bị ngắt tiến trình."""
    path = Path(file_path)
    tmp_path = path.with_suffix(f".tmp_{uuid4().hex}")
    tmp_path.write_text(data_json, encoding="utf-8")
    tmp_path.replace(path)


def _calculate_union_speech_duration(intervals: List[tuple[float, float]]) -> float:
    """Tính tổng thời lượng speech thực tế bằng cách hợp nhất (union) các khoảng thời gian chồng lấn."""
    if not intervals:
        return 0.0
    sorted_intervals = sorted(intervals, key=lambda x: x[0])
    merged = []
    for start, end in sorted_intervals:
        if not merged:
            merged.append([start, end])
        else:
            prev_start, prev_end = merged[-1]
            if start <= prev_end:
                merged[-1][1] = max(prev_end, end)
            else:
                merged.append([start, end])
    return sum(end - start for start, end in merged)


def _process_chunked_diarization(
    clean_wav: str,
    chunks_manifest: Dict[str, Any],
    chunks_dir: str,
    output_json_path: str,
    job_id: str,
    heartbeat: WorkerHeartbeat
) -> DiarizationExportPayload:
    """
    Xử lý Diarization đa đoạn (Chunked Diarization) chuẩn hóa:
    1. Cắt ranh giới theo Core Interval Ownership để loại bỏ triệt để phân đoạn trùng tại vùng overlap.
    2. Căn chỉnh Speaker 1-1 bằng ma trận Cosine Similarity (loại trừ greedy conflict).
    3. Tái sử dụng embedding có sẵn từ chunk payload, không trích xuất lần hai.
    4. Xử lý lỗi nghiêm ngặt: ném RetryableProcessingError nếu có chunk thất bại.
    5. Xuất DiarizationExportPayload tuân thủ 100% Pydantic Schema.
    """
    chunks = chunks_manifest.get("chunks") or []
    total_chunks = len(chunks)
    logger.info(f"[{job_id}] Bắt đầu chạy Diarization đa đoạn ({total_chunks} chunks)...")
    # Đọc thời lượng audio tổng thể
    total_audio_duration = 0.0
    try:
        import wave
        with wave.open(clean_wav, "rb") as wf:
            total_audio_duration = round(wf.getnframes() / float(wf.getframerate()), 3)
    except Exception as ex:
        logger.warning(f"[{job_id}] Không thể đọc duration từ clean_wav: {ex}")
        total_audio_duration = float(chunks_manifest.get("duration", 0.0))
    all_raw_segments = []
    global_speakers: Dict[str, Dict[str, Any]] = {}
    SIMILARITY_THRESHOLD = 0.70
    def _cosine_sim(v1: np.ndarray, v2: np.ndarray) -> float:
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(v1, v2) / (norm1 * norm2))
    for chunk in chunks:
        heartbeat.checkpoint()
        chunk_idx = chunk["chunk_index"]
        chunk_file = chunk["file_path"]
        core_start = chunk["start_seconds"]
        core_end = chunk["end_seconds"]
        ctx_start = chunk.get("context_start_seconds", core_start)
        chunk_json_path = os.path.join(chunks_dir, f"diarization_chunk_{chunk_idx:03d}.json")
        validate_safe_write_path(chunk_json_path)
        if os.path.exists(chunk_json_path):
            logger.info(f"[{job_id}] Chunk {chunk_idx}/{total_chunks} đã có artifact hợp lệ, nạp lại...")
            chunk_payload = DiarizationExportPayload.model_validate_json(Path(chunk_json_path).read_text(encoding="utf-8"))
        else:
            logger.info(f"[{job_id}] Chạy Diarization cho Chunk {chunk_idx}/{total_chunks} ({chunk['start']} -> {chunk['end']})...")
            chunk_payload, _ = _get_speaker_labeling_service().process_and_export(
                audio_path=chunk_file,
                output_json_path=chunk_json_path,
                job_id=job_id
            )
        # Xử lý kết quả chunk nghiêm ngặt (P1 Fix: Không bỏ qua chunk lỗi)
        if chunk_payload.status == "NO_SPEECH_DETECTED":
            logger.info(f"[{job_id}] Chunk {chunk_idx} không phát hiện tiếng nói (Silence).")
            continue
        elif chunk_payload.status != "SUCCESS":
            err_msg = chunk_payload.error_message or f"Chunk {chunk_idx} thất bại với status {chunk_payload.status}"
            logger.error(f"[{job_id}] {err_msg}")
            raise RetryableProcessingError(err_msg)
        chunk_dict = chunk_payload.model_dump()
        chunk_segs = chunk_dict.get("timeline") or chunk_dict.get("segments") or []
        chunk_speakers = chunk_dict.get("speakers") or []
        # Tái sử dụng embedding có sẵn từ chunk_speakers, tránh trích xuất lần hai (P1 Fix: CPU Optimization)
        local_embeddings: Dict[str, np.ndarray] = {}
        for spk in chunk_speakers:
            s_label = spk.get("speaker_label") or spk.get("speaker_id")
            emb = spk.get("embedding")
            if s_label and emb and len(emb) > 0:
                local_embeddings[s_label] = np.array(emb, dtype=np.float32)
        # Thu thập danh sách local speaker labels xuất hiện trong timeline chunk
        present_local_speakers = list(dict.fromkeys(
            s.get("speaker_label") or s.get("speaker") or "SPEAKER_00" for s in chunk_segs
        ))
        # Thuật toán ghép cặp 1-1 (P1 Fix: One-to-One Speaker Alignment)
        pair_candidates = []
        for l_spk in present_local_speakers:
            l_vec = local_embeddings.get(l_spk)
            if l_vec is not None:
                for g_id, g_data in global_speakers.items():
                    if g_data.get("centroid") is not None:
                        sim = _cosine_sim(l_vec, g_data["centroid"])
                        pair_candidates.append((sim, l_spk, g_id))
        # Sắp xếp similarity giảm dần và gán 1-1
        pair_candidates.sort(key=lambda x: x[0], reverse=True)
        assigned_local = set()
        assigned_global = set()
        local_to_global: Dict[str, str] = {}
        for sim, l_spk, g_id in pair_candidates:
            if sim >= SIMILARITY_THRESHOLD and l_spk not in assigned_local and g_id not in assigned_global:
                local_to_global[l_spk] = g_id
                assigned_local.add(l_spk)
                assigned_global.add(g_id)
                # Cập nhật centroid
                l_vec = local_embeddings[l_spk]
                old_centroid = global_speakers[g_id]["centroid"]
                global_speakers[g_id]["centroid"] = 0.8 * old_centroid + 0.2 * l_vec
        # Những local speaker chưa được gán sẽ tạo global ID mới
        for l_spk in present_local_speakers:
            if l_spk not in local_to_global:
                new_gid = f"GLOBAL_SPK_{len(global_speakers) + 1}"
                l_vec = local_embeddings.get(l_spk)
                global_speakers[new_gid] = {"centroid": l_vec}
                local_to_global[l_spk] = new_gid
        # Quy tắc sở hữu Timeline (P1 Fix: Core Interval Ownership Clipping)
        for seg in chunk_segs:
            raw_start = seg.get("start_seconds", seg.get("start_time", 0.0))
            raw_end = seg.get("end_seconds", seg.get("end_time", 0.0))
            loc_start = parse_timestamp_to_seconds(raw_start)
            loc_end = parse_timestamp_to_seconds(raw_end)
            g_start = round(ctx_start + loc_start, 3)
            g_end = round(ctx_start + loc_end, 3)
            # Cắt theo ranh giới sở hữu core interval
            clipped_start = max(g_start, core_start)
            clipped_end = min(g_end, core_end)
            if clipped_end > clipped_start:
                loc_label = seg.get("speaker_label") or seg.get("speaker") or "SPEAKER_00"
                gid = local_to_global.get(loc_label, loc_label)
                all_raw_segments.append({
                    "start": clipped_start,
                    "end": clipped_end,
                    "global_id": gid
                })
    # Xử lý trường hợp không có giọng nói sau khi duyệt toàn bộ chunks
    if not all_raw_segments:
        logger.warning(f"[{job_id}] Không phát hiện phân đoạn tiếng nói nào sau khi gộp chunks.")
        empty_payload = DiarizationExportPayload(
            status="NO_SPEECH_DETECTED",
            audio_file=os.path.basename(clean_wav),
            audio_duration_seconds=round(total_audio_duration, 3),
            speech_duration_seconds=0.0,
            speech_ratio=0.0,
            total_speakers=0,
            speakers=[],
            timeline=[],
            error_message="Không phát hiện tiếng nói trong toàn bộ các đoạn audio."
        )
        # [FIX 2]: Xuất file JSON atomic cho nhánh silence
        _atomic_write_json(output_json_path, empty_payload.model_dump_json(indent=2))
        return empty_payload

    # Sắp xếp các segments thô theo timeline xuất hiện
    all_raw_segments.sort(key=lambda s: s["start"])

    # Đánh số speaker chuẩn hóa thân thiện theo thứ tự xuất hiện đầu tiên
    speaker_order = []
    for s in all_raw_segments:
        if s["global_id"] not in speaker_order:
            speaker_order.append(s["global_id"])

    # [FIX 1]: Thu thập khoảng speech THỰC TẾ (chưa lấp khoảng nghỉ) để tính thống kê chính xác
    speaker_raw_intervals: Dict[str, List[tuple[float, float]]] = {
        g_id: [] for g_id in speaker_order
    }
    all_raw_speech_intervals: List[tuple[float, float]] = []

    for s in all_raw_segments:
        gid = s["global_id"]
        speaker_raw_intervals[gid].append((s["start"], s["end"]))
        all_raw_speech_intervals.append((s["start"], s["end"]))

    # Gộp các phân đoạn liền kề của cùng speaker nếu khoảng cách nghỉ <= 0.5s (CHỈ phục vụ hiển thị timeline)
    merged_turns = []
    for s in all_raw_segments:
        spk_idx = speaker_order.index(s["global_id"]) + 1
        label = f"Speaker {spk_idx}"

        if not merged_turns:
            merged_turns.append({
                "speaker_label": label,
                "raw_speaker_id": s["global_id"],
                "start": s["start"],
                "end": s["end"]
            })
            continue

        prev = merged_turns[-1]
        if prev["raw_speaker_id"] == s["global_id"] and (s["start"] - prev["end"]) <= 0.5:
            prev["end"] = max(prev["end"], s["end"])
        else:
            merged_turns.append({
                "speaker_label": label,
                "raw_speaker_id": s["global_id"],
                "start": s["start"],
                "end": s["end"]
            })

    # Xây dựng timeline hiển thị
    formatted_timeline = []
    for idx, turn in enumerate(merged_turns):
        t_start = round(turn["start"], 3)
        t_end = min(round(turn["end"], 3), total_audio_duration) if total_audio_duration > 0 else round(turn["end"], 3)
        duration = round(max(0.0, t_end - t_start), 3)

        formatted_timeline.append({
            "segment_id": idx + 1,
            "speaker": turn["speaker_label"],
            "speaker_label": turn["speaker_label"],
            "raw_speaker_id": turn["raw_speaker_id"],
            "start_seconds": t_start,
            "end_seconds": t_end,
            "duration_seconds": duration,
            "start_time": _format_timestamp(t_start),
            "end_time": _format_timestamp(t_end)
        })

    # [FIX 1]: Thống kê speech theo speaker từ RAW intervals (bảo toàn đúng 1.6s, không bị đội lên 2.0s)
    speaker_stats: List[Dict[str, Any]] = []
    for i, g_id in enumerate(speaker_order):
        label = f"Speaker {i+1}"
        spk_turns_count = sum(1 for t in merged_turns if t["raw_speaker_id"] == g_id)
        spk_actual_speech = round(_calculate_union_speech_duration(speaker_raw_intervals[g_id]), 3)

        speaker_stats.append({
            "speaker_id": f"spk_{i+1}",
            "speaker_label": label,
            "raw_speaker_id": g_id,
            "total_segments": spk_turns_count,
            "total_speech_duration_seconds": spk_actual_speech
        })

    # [FIX 1]: Tổng thời lượng speech union tính từ RAW intervals
    speech_duration = round(_calculate_union_speech_duration(all_raw_speech_intervals), 3)
    speech_ratio = round(speech_duration / total_audio_duration, 4) if total_audio_duration > 0 else 0.0

    combined_payload = DiarizationExportPayload(
        status="SUCCESS",
        audio_file=os.path.basename(clean_wav),
        audio_duration_seconds=round(total_audio_duration, 3),
        speech_duration_seconds=speech_duration,
        speech_ratio=speech_ratio,
        total_speakers=len(speaker_stats),
        speakers=speaker_stats,
        timeline=formatted_timeline
    )

    # [FIX 2]: Xuất file JSON atomic cho nhánh SUCCESS
    _atomic_write_json(output_json_path, combined_payload.model_dump_json(indent=2))
    logger.info(f"[{job_id}] Đã hợp nhất thành công {len(formatted_timeline)} segments từ {total_chunks} chunks.")
    return combined_payload



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
        storage_client.download_file(
            object_key=object_key,
            destination_path=raw_input_path,
        )
        # [GUARD 1]: Kiểm định an toàn đường dẫn file đầu vào
        validate_safe_read_path(raw_input_path)
        required_resume_artifacts = {
            "FFMPEG": os.path.join(workspace_dir, "01_normalized_16k.wav"),
            "WEBRTC": os.path.join(workspace_dir, "02_cleaned.wav"),
            "PYANNOTE": os.path.join(workspace_dir, "03_diarization.json"),
            "STT": os.path.join(workspace_dir, "04_transcript.json"),
            "CONTEXT": os.path.join(workspace_dir, "06_context.json"),
            "LLM": os.path.join(workspace_dir, "07_ai_results.json"),
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
            # STAGE 3: PYANNOTE (Speaker Diarization & VAD - Đơn đoạn hoặc Đa đoạn)
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
                # Kiểm tra phân đoạn audio nếu thời lượng > 15 phút (900s)
                chunker = _get_audio_chunker()
                chunks_dir = os.path.join(workspace_dir, "chunks")
                chunk_res = chunker.process_audio(
                    input_path=clean_wav,
                    output_dir=chunks_dir,
                    target_chunk_duration=600.0,
                    overlap_duration=5.0,
                    chunk_threshold_duration=900.0
                )
                if not chunk_res.get("is_chunked"):
                    # File <= 15 phút: Xử lý nguyên khối tiêu chuẩn
                    diar_payload, _ = _get_speaker_labeling_service().process_and_export(
                        audio_path=clean_wav, output_json_path=diar_json_path, job_id=job_id
                    )
                else:
                    # File > 15 phút: Xử lý đa đoạn (Chunked Diarization)
                    diar_payload = _process_chunked_diarization(
                        clean_wav=clean_wav,
                        chunks_manifest=chunk_res["manifest"],
                        chunks_dir=chunks_dir,
                        output_json_path=diar_json_path,
                        job_id=job_id,
                        heartbeat=heartbeat
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

            # Release pyannote weights before native STT/Ollama work so the
            # container does not retain the diarization model alongside them.
            try:
                from app.services.diarization_runtime import diarization_runtime
                diarization_runtime.reset()
            except Exception:
                logger.exception("[%s] Could not explicitly release diarization runtime", job_id)
            gc.collect()

            # -------------------------------------------------------------
            # STAGE 4: STT + OCR + context + local LLM, checkpointed per artifact
            # -------------------------------------------------------------
            current_stage = "OUTPUT"
            heartbeat.checkpoint()
            require_stage_callback(job_id, current_stage, "PROCESSING", execution_id=execution_id)
            transcript_path = os.path.join(workspace_dir, "04_transcript.json")
            ocr_path = os.path.join(workspace_dir, "05_ocr.json")
            context_path = os.path.join(workspace_dir, "06_context.json")
            ai_result_path = os.path.join(workspace_dir, "07_ai_results.json")
            if os.path.isfile(transcript_path):
                transcript_data = json.loads(Path(transcript_path).read_text(encoding="utf-8"))
            else:
                heartbeat.checkpoint()
                logger.info("[%s] STT via configured provider=%s", job_id, settings.stt_provider)
                from app.services.whisper_asr_service import WhisperASRService
                from app.services.speaker_transcript_aligner import align_speakers
                from types import SimpleNamespace

                with WhisperASRService(language="vi", beam_size=1) as asr:
                    stt = asr.transcribe(clean_wav)
                speaker_map = {}
                diar_timeline = diar_payload.timeline or []
                for diar_segment in diar_timeline:
                    label = diar_segment.speaker
                    if diar_segment.raw_speaker_id:
                        speaker_map[diar_segment.raw_speaker_id] = label
                    speaker_map[label] = label
                aligned = align_speakers(stt["segments"], diar_timeline, speaker_map)
                transcript_data = {
                    "meetingId": str(meeting_id), "processingJobId": job_id,
                    "success": True, "language": stt.get("detected_language") or "vi",
                    "modelName": "whisper", "segments": [
                        {"speakerId": None, "speakerLabel": aligned.get(index),
                         "startTimeMs": round(float(segment.start) * 1000),
                         "endTimeMs": round(float(segment.end) * 1000),
                         "text": str(segment.text).strip()}
                        for index, segment in enumerate(stt["segments"])
                        if str(getattr(segment, "text", "")).strip()
                    ]
                }
                _atomic_write_json(transcript_path, json.dumps(transcript_data, ensure_ascii=False))

            ocr_data = json.loads(Path(ocr_path).read_text(encoding="utf-8")) if os.path.isfile(ocr_path) else None
            if ocr_data is None:
                ocr_data = {"status": "SKIPPED", "frames": [], "error": None}
                if file_ext in {".mp4", ".mkv"}:
                    try:
                        from app.services.video_ocr import extract_video_ocr
                        ocr_data = {"status": "SUCCESS", "frames": extract_video_ocr(raw_input_path, workspace_dir), "error": None}
                    except Exception as exc:
                        logger.exception("[%s] OCR stage failed; retaining transcript and continuing", job_id)
                        ocr_data = {"status": "FAILED", "frames": [], "error": str(exc)[:1200]}
                _atomic_write_json(ocr_path, json.dumps(ocr_data, ensure_ascii=False))

            if os.path.isfile(context_path):
                context_data = json.loads(Path(context_path).read_text(encoding="utf-8"))
            else:
                from app.services.context_llm import build_context_chunks
                context_data = {"chunks": build_context_chunks(transcript_data["segments"], ocr_data["frames"])}
                _atomic_write_json(context_path, json.dumps(context_data, ensure_ascii=False))

            if os.path.isfile(ai_result_path):
                ai_results = json.loads(Path(ai_result_path).read_text(encoding="utf-8"))
            else:
                from app.services.context_llm import OllamaMeetingClient
                extraction = OllamaMeetingClient().analyze(context_data["chunks"])
                ai_results = {
                    "status": "SUCCESS", "provider": "ollama", "model": os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b"),
                    "summary": extraction.summary,
                    "keyDecisions": extraction.key_decisions,
                    "tasks": [task.model_dump(by_alias=True) for task in extraction.tasks],
                    "contextChunks": context_data["chunks"],
                }
                _atomic_write_json(ai_result_path, json.dumps(ai_results, ensure_ascii=False))
            # -------------------------------------------------------------
            # STAGE 5: OUTPUT (speaker timeline + persisted AI artifacts)
            # -------------------------------------------------------------
            current_stage = "OUTPUT"
            heartbeat.checkpoint()
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
            heartbeat.checkpoint()
            require_stage_callback(job_id, current_stage, "SUCCESS", segments=formatted_segments,
                execution_id=execution_id, ai_results={
                    "transcript": transcript_data,
                    "ocr": ocr_data,
                    "context": context_data,
                    "meetingAnalysis": ai_results,
                })
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
        preserve_workspace = True
        try:
            require_stage_callback(job_id, current_stage, "FAILED", error_msg=str(e),
                error_code="RETRYABLE_PROCESSING_ERROR", execution_id=execution_id)
        except RetryableProcessingError:
            logger.exception("Failed to report worker failure to Backend")
        raise RetryableProcessingError(str(e)) from e
    finally:
        if heartbeat:
            heartbeat.stop()
        try:
            if not preserve_workspace:
                shutil.rmtree(workspace_dir)
                logger.info(f"[{job_id}] Đã dọn dẹp workspace: {workspace_dir}")
        except Exception as cleanup_err:
            logger.warning(f"[{job_id}] Không thể dọn dẹp workspace hoàn toàn: {cleanup_err}")
if __name__ == "__main__":
    raise SystemExit("Run this processor through the Celery worker runtime.")
