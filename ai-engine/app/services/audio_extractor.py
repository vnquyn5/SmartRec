import os
from typing import Optional
from app.services.ffmpeg_wrapper import (
    FFmpegWrapper,
    FFmpegError,
    FFmpegExecutionError,
    AudioValidationError
)
from app.schemas.audio_schemas import AudioExtractionRequest, AudioExtractionResponse


class AudioExtractorService:
    """
    Tầng nghiệp vụ (Service Layer) bọc FFmpegWrapper.
    Tiếp nhận request dạng Schema, điều phối xử lý và chuẩn hóa Response.
    """

    def __init__(self, wrapper: Optional[FFmpegWrapper] = None):
        self.wrapper = wrapper or FFmpegWrapper()

    def extract_and_normalize(self, request: AudioExtractionRequest) -> AudioExtractionResponse:
        input_path = os.path.abspath(request.input_path)

        # Tự động sinh đường dẫn output nếu phía Backend không truyền
        if not request.output_path:
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            dir_name = os.path.dirname(input_path)
            output_path = os.path.join(dir_name, f"{base_name}_normalized_16k.wav")
        else:
            output_path = os.path.abspath(request.output_path)

        try:
            result = self.wrapper.extract_and_normalize_audio(
                input_path=input_path,
                output_path=output_path,
                target_sample_rate=request.target_sample_rate,
                target_channels=request.target_channels
            )

            return AudioExtractionResponse(
                status="SUCCESS",
                input_file=result["input_file"],
                output_file=result["output_file"],
                format=result["format"],
                codec=result["codec"],
                sample_rate=result["sample_rate"],
                channels=result["channels"],
                duration_seconds=result["duration_seconds"],
                file_size_bytes=result["file_size_bytes"],
                processing_time_seconds=result["processing_time_seconds"]
            )

        except FileNotFoundError as e:
            return AudioExtractionResponse(
                status="FAILED",
                input_file=input_path,
                error_message=f"Tệp nguồn không tồn tại: {str(e)}"
            )
        except (AudioValidationError, FFmpegExecutionError, FFmpegError) as e:
            return AudioExtractionResponse(
                status="FAILED",
                input_file=input_path,
                error_message=f"Lỗi xử lý FFmpeg: {str(e)}"
            )
        except Exception as e:
            return AudioExtractionResponse(
                status="FAILED",
                input_file=input_path,
                error_message=f"Lỗi không xác định trong quá trình tiền xử lý: {str(e)}"
            )