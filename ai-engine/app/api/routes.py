import os
import asyncio
import logging
import hmac
from uuid import UUID
from pathlib import Path
from fastapi import APIRouter, HTTPException, status, Header

from app.schemas.audio_schemas import (
    AudioExtractionRequest,
    AudioExtractionResponse,
    AudioChunkRequest,
    AudioChunkResponse,
    AudioANSRequest,
    AudioANSResponse,
    AudioAECRequest,
    AudioAECResponse,
    AudioPipelineRequest,
    AudioPipelineResponse
)
from app.schemas.diarization_schemas import (
    AudioDiarizationRequest,
    DiarizationExportPayload
)
from app.core.path_security import validate_safe_read_path, validate_safe_write_path
from app.services.audio_extractor import AudioExtractorService
from app.services.audio_chunker import AudioChunker
from app.services.audio_ans import (
    AudioANSService,
    InvalidAudioFormatError as ANSInvalidFormatError,
    AudioSignalLostError as ANSSignalLostError
)
from app.services.audio_aec import (
    AudioAECService,
    InvalidAudioFormatError as AECInvalidFormatError,
    AudioSignalLostError as AECSignalLostError
)
from app.services.audio_pipeline import AudioPipelineOrchestrator
from app.services.speaker_labeling_service import speaker_labeling_service
from app.core.config import settings
from app.tasks.audio_job_task import process_audio_job

logger = logging.getLogger("api_routes")
router = APIRouter(prefix="/audio", tags=["Audio Preprocessing"])
internal_router = APIRouter(prefix="/internal/jobs", tags=["Internal jobs"])


@internal_router.post("/{job_id}/enqueue")
async def enqueue_audio_job(job_id: UUID, x_internal_token: str | None = Header(default=None)):
    configured = settings.smartrec_internal_token
    if not configured or not x_internal_token or not hmac.compare_digest(configured, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
    normalized_job_id = str(job_id)
    task = process_audio_job.delay(normalized_job_id)
    return {"jobId": normalized_job_id, "taskId": task.id, "status": "QUEUED"}

extractor_service = AudioExtractorService()
chunker_service = AudioChunker()
ans_service = AudioANSService(default_suppression_level=3)
aec_service = AudioAECService()
pipeline_orchestrator = AudioPipelineOrchestrator(
    aec_service=aec_service,
    ans_service=ans_service
)


@router.post(
    "/extract",
    response_model=AudioExtractionResponse,
    summary="Trích xuất và chuẩn hóa Audio (16kHz Mono WAV)",
    description="Chuyển đổi video/audio sang chuẩn WAV PCM 16-bit, 16000Hz, Mono. Non-blocking qua worker thread."
)
async def extract_audio_endpoint(request: AudioExtractionRequest):
    try:
        result = await asyncio.to_thread(
            extractor_service.extract_and_normalize,
            input_path=request.input_path,
            output_path=request.output_path,
            target_sample_rate=request.target_sample_rate,
            target_channels=request.target_channels
        )
        return AudioExtractionResponse(**result)
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "message": f"Tệp nguồn không tồn tại: {str(err)}"}
        )
    except Exception as err:
        logger.exception("Lỗi trong extract endpoint")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "message": f"Lỗi trích xuất audio: {str(err)}"}
        )


@router.post(
    "/chunk",
    response_model=AudioChunkResponse,
    summary="Chia nhỏ Audio theo ngưỡng thời lượng",
    description="Kiểm tra thời lượng audio; tự động cắt nhỏ nếu vượt ngưỡng và sinh manifest.json."
)
async def chunk_audio_endpoint(request: AudioChunkRequest):
    try:
        result = await asyncio.to_thread(
            chunker_service.process_audio,
            input_path=request.input_path,
            output_dir=request.output_dir,
            target_chunk_duration=request.target_chunk_duration
        )
        return AudioChunkResponse(**result)
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "message": f"Tệp nguồn không tồn tại: {str(err)}"}
        )
    except Exception as err:
        logger.exception("Lỗi trong chunk endpoint")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "message": f"Lỗi chia nhỏ audio: {str(err)}"}
        )


@router.post("/noise-suppression", response_model=AudioANSResponse)
async def suppress_noise_endpoint(request: AudioANSRequest):
    try:
        result = await asyncio.to_thread(
            ans_service.apply_noise_suppression,
            input_path=request.input_path,
            output_path=request.output_path,
            suppression_level=request.suppression_level
        )
        return AudioANSResponse(**result)
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "message": f"Tệp nguồn không tồn tại: {str(err)}"}
        )
    except ANSInvalidFormatError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "FAILED", "message": f"Định dạng audio không hợp lệ: {str(err)}"}
        )
    except ANSSignalLostError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"status": "FAILED", "message": f"Mất tín hiệu âm thanh: {str(err)}"}
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "message": f"Lỗi xử lý ANS: {str(err)}"}
        )


@router.post("/echo-cancellation", response_model=AudioAECResponse)
async def cancel_echo_endpoint(request: AudioAECRequest):
    try:
        result = await asyncio.to_thread(
            aec_service.cancel_echo,
            capture_path=request.capture_path,
            reference_path=request.reference_path,
            output_path=request.output_path
        )
        return AudioAECResponse(**result)
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "message": f"Tệp nguồn không tồn tại: {str(err)}"}
        )
    except AECInvalidFormatError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "FAILED", "message": f"Định dạng audio không hợp lệ: {str(err)}"}
        )
    except AECSignalLostError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"status": "FAILED", "message": f"Mất tín hiệu âm thanh: {str(err)}"}
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "message": f"Lỗi xử lý AEC: {str(err)}"}
        )


@router.post(
    "/pipeline/process",
    response_model=AudioPipelineResponse,
    summary="Chuỗi tiền xử lý âm thanh hợp nhất",
    description="Validate -> AEC -> ANS -> Quality Check theo chuẩn bất biến 16kHz Mono."
)
async def process_pipeline_endpoint(request: AudioPipelineRequest):
    try:
        response = await asyncio.to_thread(
            pipeline_orchestrator.process_pipeline,
            request
        )

        if response.overall_status != "SUCCESS" or (response.quality_check and not response.quality_check.passed):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=response.model_dump()
            )

        return response

    except HTTPException:
        raise
    except Exception as err:
        logger.exception("Lỗi nghiêm trọng trong Pipeline processing")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "job_id": request.job_id,
                "overall_status": "FAILED",
                "error_message": f"Lỗi máy chủ nội bộ: {str(err)}"
            }
        )


@router.post(
    "/diarize",
    response_model=DiarizationExportPayload,
    summary="Speaker Diarization & VAD Pipeline",
    description="Chạy VAD, Diarization, tự động trích xuất Speaker Embeddings và chuẩn hóa JSON phân cấp."
)
async def diarize_audio_endpoint(request: AudioDiarizationRequest):
    try:
        safe_input = validate_safe_read_path(request.input_path)
        safe_output = validate_safe_write_path(request.output_json_path) if request.output_json_path else None

        payload, _ = await asyncio.to_thread(
            speaker_labeling_service.process_and_export,
            audio_path=safe_input,
            output_json_path=safe_output,
            job_id=request.job_id
        )

        if payload.status == "FAILED":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=payload.model_dump()
            )

        return payload

    except HTTPException:
        raise
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "message": str(err)}
        )
    except PermissionError as perm_err:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"status": "FAILED", "message": str(perm_err)}
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "FAILED", "message": str(val_err)}
        )
    except Exception as err:
        logger.exception("Lỗi nghiêm trọng trong Diarize endpoint")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "message": f"Lỗi xử lý Diarization: {str(err)}"}
        )
