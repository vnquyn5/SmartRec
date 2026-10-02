import os
import asyncio
import logging
from fastapi import APIRouter, HTTPException, status

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

logger = logging.getLogger("api_routes")
router = APIRouter(prefix="/audio", tags=["Audio Preprocessing"])

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
    description="Validate -> AEC -> ANS -> Quality Check theo chuẩn bất biến 16kHz Mono. Ngăn chặn triệt để HTTP 200 cho file lỗi."
)
async def process_pipeline_endpoint(request: AudioPipelineRequest):
    try:
        response = await asyncio.to_thread(
            pipeline_orchestrator.process_pipeline,
            request
        )

        # H7: Nếu không đạt chuẩn chất lượng hoặc overall_status != SUCCESS, trả ngay HTTP 422
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
