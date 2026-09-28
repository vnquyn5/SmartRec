from fastapi import APIRouter, HTTPException, status
from app.schemas.audio_schemas import (
    AudioExtractionRequest,
    AudioExtractionResponse,
    AudioChunkRequest,
    AudioChunkResponse
)
from app.services.audio_extractor import AudioExtractorService
from app.services.audio_chunker import (
    AudioChunker,
    AudioDurationExceededError,
    AudioChunkerError
)
from app.services.ffmpeg_wrapper import AudioValidationError

router = APIRouter(prefix="/api/v1/audio", tags=["Audio Preprocessing"])
audio_service = AudioExtractorService()
chunker_service = AudioChunker()


@router.post(
    "/extract-normalize",
    response_model=AudioExtractionResponse,
    summary="Trích xuất và chuẩn hóa luồng âm thanh sang WAV 16kHz Mono",
    description="Nhận tệp media (video/audio) từ storage, trích xuất âm thanh chuẩn PCM 16-bit, 16000Hz, Mono để cung cấp đầu vào cho các module AI."
)
async def extract_and_normalize_audio(request: AudioExtractionRequest):
    response = audio_service.extract_and_normalize(request)

    if response.status == "FAILED":
        if "không tồn tại" in (response.error_message or ""):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=response.model_dump()
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=response.model_dump()
        )

    return response


@router.post(
    "/chunk",
    response_model=AudioChunkResponse,
    summary="Phân đoạn audio dài >2h thành các chunk 30–45 phút và tạo Manifest",
    description="Kiểm tra thời lượng tệp WAV: Nếu <= 2h thì bỏ qua; nếu 2h < duration <= 4h thì chia thành các chunk 40 phút và sinh manifest.json; nếu > 4h thì từ chối xử lý."
)
async def chunk_audio(request: AudioChunkRequest):
    try:
        result = chunker_service.process_audio(
            input_path=request.input_path,
            output_dir=request.output_dir,
            target_chunk_duration=request.target_chunk_duration
        )
        return AudioChunkResponse(
            status=result["status"],
            message=result["message"],
            total_duration_seconds=result.get("total_duration_seconds"),
            is_chunked=result["is_chunked"],
            manifest_file=result.get("manifest_file"),
            manifest=result.get("manifest")
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "FAILED", "error_message": f"Tệp nguồn không tồn tại: {str(e)}"}
        )
    except AudioDurationExceededError as e:
        # Lỗi vi phạm business boundary (>4h)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "FAILED", "error_message": str(e)}
        )
    except (AudioValidationError, AudioChunkerError) as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"status": "FAILED", "error_message": f"Lỗi xử lý âm thanh: {str(e)}"}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "FAILED", "error_message": f"Lỗi hệ thống ngoài dự kiến: {str(e)}"}
        )