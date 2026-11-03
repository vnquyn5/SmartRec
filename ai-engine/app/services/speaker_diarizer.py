import logging
import wave
from pathlib import Path
from typing import Union, Optional, List
from pyannote.core import Annotation, Timeline

from app.services.diarization_runtime import diarization_runtime
from app.services.speaker_turn_postprocessor import consolidate_speaker_turns
from app.schemas.diarization_schemas import (
    SpeakerSegment,
    SpeechActivityInterval,
    SpeakerSegmentationResponse
)

logger = logging.getLogger("smartrec.speaker_diarizer")


def format_timestamp(seconds: float) -> str:
    """Chuyển đổi số giây thành chuỗi thời gian HH:MM:SS.mmm"""
    total_millis = max(0, int(round(seconds * 1000)))
    hours = total_millis // 3_600_000
    remainder = total_millis % 3_600_000
    minutes = remainder // 60_000
    remainder = remainder % 60_000
    secs = remainder // 1_000
    millis = remainder % 1_000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


class SpeakerDiarizationService:
    """
    Dịch vụ trích xuất Voice Activity Detection (VAD) và phân đoạn người nói (Speaker Segmentation).
    """

    def __init__(self, min_speech_duration: float = 0.2, collar_merge_gap: float = 0.5):
        """
        :param min_speech_duration: Tham số tương thích API cũ; hiện không dùng để xóa các đoạn nói ngắn.
        :param collar_merge_gap: Khoảng ngắt giữa 2 lượt phát biểu của CÙNG 1 người để gộp phân đoạn.
        """
        self.min_speech_duration = min_speech_duration
        self.collar_merge_gap = collar_merge_gap

    def get_audio_duration(self, audio_path: Union[str, Path]) -> float:
        """Đọc thời lượng file audio WAV một cách chính xác."""
        with wave.open(str(audio_path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                raise ValueError(f"Sample rate không hợp lệ: {rate}")
            return frames / float(rate)

    def segment_speech(
        self,
        audio_path: Union[str, Path],
        job_id: Optional[str] = None,
        min_speech_duration: Optional[float] = None,
        collar_merge_gap: Optional[float] = None
    ) -> SpeakerSegmentationResponse:
        """
        Thực thi Diarization, trích xuất VAD và chuẩn hóa các Speaker Segments theo timestamp.
        Giữ overlap riêng biệt và chỉ gộp lượt cùng speaker khi khoảng nghỉ an toàn.
        """
        effective_collar_gap = collar_merge_gap if collar_merge_gap is not None else self.collar_merge_gap

        audio_path_obj = Path(audio_path)
        if not audio_path_obj.exists():
            return SpeakerSegmentationResponse(
                job_id=job_id,
                status="FAILED",
                audio_duration_seconds=0.0,
                speech_duration_seconds=0.0,
                speech_ratio=0.0,
                total_segments=0,
                error_code="INVALID_AUDIO",
                error_message=f"Tệp âm thanh không tồn tại: {audio_path}"
            )

        try:
            audio_duration = round(self.get_audio_duration(audio_path_obj), 3)
        except Exception as e:
            logger.error(f"Không thể đọc metadata audio '{audio_path}': {e}")
            return SpeakerSegmentationResponse(
                job_id=job_id,
                status="FAILED",
                audio_duration_seconds=0.0,
                speech_duration_seconds=0.0,
                speech_ratio=0.0,
                total_segments=0,
                error_code="INVALID_AUDIO",
                error_message=f"Lỗi đọc định dạng audio: {e}"
            )

        logger.info(f"Bắt đầu phân đoạn âm thanh cho job '{job_id}' (file: {audio_path}, duration: {audio_duration}s)...")

        try:
            # 1. Chạy inference qua interface đã chuẩn hóa
            annotation: Annotation = diarization_runtime.diarize(str(audio_path_obj))

            # 2. TRÍCH XUẤT VAD ĐỘC LẬP TỪ TIMELINE SUPPORT
            speech_timeline: Timeline = annotation.get_timeline().support()
            vad_intervals: List[SpeechActivityInterval] = []
            total_speech_sec = 0.0

            for segment in speech_timeline:
                start = round(max(0.0, min(segment.start, audio_duration)), 3)
                end = round(max(0.0, min(segment.end, audio_duration)), 3)
                if end <= start:
                    continue
                s_dur = round(end - start, 3)
                total_speech_sec += s_dur
                vad_intervals.append(SpeechActivityInterval(
                    start_seconds=start,
                    end_seconds=end,
                    duration_seconds=s_dur
                ))

            total_speech_sec = round(total_speech_sec, 3)
            speech_ratio = round(total_speech_sec / audio_duration, 4) if audio_duration > 0 else 0.0

            raw_turns: List[tuple] = list(annotation.itertracks(yield_label=True))

            # Nếu hoàn toàn không có tiếng nói
            if not raw_turns or total_speech_sec == 0.0:
                logger.info(f"Không phát hiện tiếng nói nào trong file '{audio_path}'")
                return SpeakerSegmentationResponse(
                    job_id=job_id,
                    status="NO_SPEECH_DETECTED",
                    audio_duration_seconds=audio_duration,
                    speech_duration_seconds=0.0,
                    speech_ratio=0.0,
                    total_segments=0,
                    unique_speakers=[],
                    segments=[],
                    vad_intervals=[]
                )

            # 3. Merge nearby same-speaker turns only if another speaker did not
            # occupy the gap. Different-speaker overlaps remain separate entries.
            turns = [
                (turn.start, turn.end, speaker)
                for turn, _, speaker in raw_turns
                if isinstance(speaker, str) and speaker
            ]
            merged_turns = consolidate_speaker_turns(turns, effective_collar_gap, audio_duration)

            # 4. Preserve short valid replies: diarization provides no confidence
            # signal that safely distinguishes them from noise.
            valid_segments: List[SpeakerSegment] = []
            segment_counter = 1

            for s_start, s_end, speaker in merged_turns:
                dur = round(s_end - s_start, 3)
                valid_segments.append(SpeakerSegment(
                    segment_id=segment_counter,
                    speaker=speaker,
                    start_seconds=s_start,
                    end_seconds=s_end,
                    duration_seconds=dur,
                    start_time=format_timestamp(s_start),
                    end_time=format_timestamp(s_end)
                ))
                segment_counter += 1

            unique_speakers = sorted(list(set(s.speaker for s in valid_segments)))
            status = "SUCCESS" if (valid_segments or vad_intervals) else "NO_SPEECH_DETECTED"

            return SpeakerSegmentationResponse(
                job_id=job_id,
                status=status,
                audio_duration_seconds=audio_duration,
                speech_duration_seconds=total_speech_sec,
                speech_ratio=min(1.0, speech_ratio),
                total_segments=len(valid_segments),
                unique_speakers=unique_speakers,
                segments=valid_segments,
                vad_intervals=vad_intervals
            )

        except Exception as e:
            logger.exception(f"Lỗi khi thực hiện phân đoạn giọng nói cho job '{job_id}': {e}")
            return SpeakerSegmentationResponse(
                job_id=job_id,
                status="FAILED",
                audio_duration_seconds=audio_duration,
                speech_duration_seconds=0.0,
                speech_ratio=0.0,
                total_segments=0,
                error_code="DIARIZATION_INFERENCE_ERROR",
                error_message=str(e)
            )


speaker_diarization_service = SpeakerDiarizationService()
