from fastapi import APIRouter, HTTPException, status
from app.schemas.audio_schemas import AudioExtractionRequest, AudioExtractionResponse
from app.services.audio_extractor import AudioExtractorService

router = APIRouter(prefix="/api/v1/audio", tags=["Audio Preprocessing"])
audio_service = AudioExtractorService()


@router.post(
    "/extract-normalize",
    response_model=AudioExtractionResponse,
    summary="Trích xuất và chuẩn hóa luồng âm thanh sang WAV 16kHz Mono",
    description="Nhận tệp media (video/audio) từ storage, trích xuất âm thanh chuẩn PCM 16-bit, 16000Hz, Mono để cung cấp đầu vào cho các module AI."
)
async def extract_and_normalize_audio(request: AudioExtractionRequest):
    response = audio_service.extract_and_normalize(request)

    # Nếu xử lý thất bại do lỗi file hoặc lỗi FFmpeg, trả mã lỗi HTTP tương ứng
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