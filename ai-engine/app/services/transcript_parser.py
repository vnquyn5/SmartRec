"""Chuyển kết quả faster-whisper thành transcript JSON cho SmartRec."""

import math
from typing import Any, Mapping, Optional, Sequence
from uuid import UUID

from app.schemas.stt_schemas import TranscriptPayload, TranscriptSegment


def seconds_to_ms(value: float) -> int:
    """Chuyển giây sang milliseconds, làm tròn tới mili giây gần nhất."""
    seconds = float(value)

    if not math.isfinite(seconds) or seconds < 0:
        raise ValueError("Timestamp phải là số hữu hạn và không âm.")

    return int(math.floor(seconds * 1000 + 0.5))


def parse_whisper_segments(
    segments: Sequence[Any],
    *,
    speaker_ids: Optional[Mapping[int, UUID]] = None,
) -> list[TranscriptSegment]:
    """
    Chuẩn hóa Whisper segments thành danh sách câu thoại.

    speaker_ids: ánh xạ index của Whisper segment sang UUID speaker
    đã được xác nhận bởi Backend/Diarization integration.
    """
    result: list[TranscriptSegment] = []

    for index, segment in enumerate(segments):
        text = str(getattr(segment, "text", "") or "").strip()

        if not text:
            continue

        # Sử dụng cùng segment boundaries với Speaker Aligner.
        # Word timestamps không quyết định khoảng thời gian của transcript.
        start_seconds = segment.start
        end_seconds = segment.end

        start_ms = seconds_to_ms(start_seconds)
        end_ms = seconds_to_ms(end_seconds)

        if end_ms < start_ms:
            raise ValueError(
                f"Whisper segment #{index} có timestamp không hợp lệ."
            )

        speaker_id = None
        if speaker_ids is not None:
            speaker_id = speaker_ids.get(index)

        result.append(
            TranscriptSegment(
                speakerId=speaker_id,
                startTimeMs=start_ms,
                endTimeMs=end_ms,
                text=text,
            )
        )

    return result


def build_transcript_payload(
    *,
    meeting_id: UUID,
    processing_job_id: UUID,
    segments: Sequence[Any],
    language: str = "vi",
    speaker_ids: Optional[Mapping[int, UUID]] = None,
) -> TranscriptPayload:
    """Tạo payload transcript theo hợp đồng dữ liệu Backend."""

    return TranscriptPayload(
        meetingId=meeting_id,
        processingJobId=processing_job_id,
        success=True,
        language=language,
        modelName="whisper",
        segments=parse_whisper_segments(
            segments,
            speaker_ids=speaker_ids,
        ),
    )
