import logging
import math
import wave
from pathlib import Path
from typing import Union, Optional, List, Tuple, Dict
from pyannote.core import Annotation, Timeline

from app.services.diarization_runtime import DiarizationOutput, diarization_runtime
from app.core.config import settings
from app.schemas.diarization_schemas import (
    SpeakerSegment,
    SpeechActivityInterval,
    SpeakerSegmentationResponse,
    SpeakerTurnSmoothingDiagnostic,
)

logger = logging.getLogger("smartrec.speaker_diarizer")


def resolve_speaker_count_constraints(
    num_speakers: Optional[int] = None,
    min_speakers: Optional[int] = None,
    max_speakers: Optional[int] = None,
) -> Tuple[Dict[str, int], str]:
    """Validate pyannote's optional exact or bounded speaker count arguments."""
    values = {
        "num_speakers": num_speakers,
        "min_speakers": min_speakers,
        "max_speakers": max_speakers,
    }
    for name, value in values.items():
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
            raise ValueError(f"{name} must be a positive integer")
    if num_speakers is not None and (min_speakers is not None or max_speakers is not None):
        raise ValueError("num_speakers cannot be combined with min_speakers or max_speakers")
    if min_speakers is not None and max_speakers is not None and min_speakers > max_speakers:
        raise ValueError("min_speakers cannot exceed max_speakers")
    constraints = {name: value for name, value in values.items() if value is not None}
    mode = "exact" if num_speakers is not None else "bounded" if constraints else "automatic"
    return constraints, mode


def merge_speaker_turns(
    raw_turns: List[Tuple[float, float, str]], collar_merge_gap: float,
) -> List[Tuple[float, float, str]]:
    """Merge same-speaker turns conservatively without filling another speaker's turn."""
    ordered = sorted(raw_turns, key=lambda item: (item[0], item[1], item[2]))
    by_speaker: Dict[str, List[Tuple[float, float]]] = {}
    for start, end, speaker in ordered:
        if not (start >= 0 and end > start):
            continue
        by_speaker.setdefault(speaker, []).append((start, end))

    merged: List[Tuple[float, float, str]] = []
    for speaker, turns in by_speaker.items():
        turns.sort(key=lambda item: (item[0], item[1]))
        current_start, current_end = turns[0]
        for next_start, next_end in turns[1:]:
            gap = next_start - current_end
            other_speaker_in_gap = gap > 0 and any(
                other_speaker != speaker
                and other_start < next_start
                and other_end > current_end
                for other_start, other_end, other_speaker in ordered
            )
            if gap <= collar_merge_gap and not other_speaker_in_gap:
                current_end = max(current_end, next_end)
            else:
                merged.append((current_start, current_end, speaker))
                current_start, current_end = next_start, next_end
        merged.append((current_start, current_end, speaker))
    return sorted(merged, key=lambda item: (item[0], item[1], item[2]))


def calculate_overlap_duration(turns: List[Tuple[float, float, str]]) -> float:
    """Return wall-clock time with at least two distinct speakers active."""
    events: Dict[float, Dict[str, int]] = {}
    for start, end, speaker in turns:
        if start < 0 or end <= start:
            continue
        start_events = events.setdefault(start, {})
        start_events[speaker] = start_events.get(speaker, 0) + 1
        end_events = events.setdefault(end, {})
        end_events[speaker] = end_events.get(speaker, 0) - 1

    active: Dict[str, int] = {}
    previous_time = None
    overlap = 0.0
    for timestamp in sorted(events):
        if previous_time is not None and len(active) > 1:
            overlap += timestamp - previous_time
        for speaker, change in events[timestamp].items():
            active[speaker] = active.get(speaker, 0) + change
            if active[speaker] <= 0:
                active.pop(speaker, None)
        previous_time = timestamp
    return round(overlap, 3)


def annotation_to_speaker_segments(annotation: Annotation) -> List[SpeakerSegment]:
    """Convert an annotation to millisecond-precision segments without merging/filtering."""
    turns = sorted(
        ((round(segment.start, 3), round(segment.end, 3), str(speaker))
         for segment, _, speaker in annotation.itertracks(yield_label=True)),
        key=lambda item: (item[0], item[1], item[2]),
    )
    result = []
    for index, (start, end, speaker) in enumerate(turns, start=1):
        if start < 0 or end <= start:
            continue
        duration = round(end - start, 3)
        result.append(SpeakerSegment(
            segment_id=index,
            speaker=speaker,
            raw_speaker_id=speaker,
            start_seconds=start,
            end_seconds=end,
            duration_seconds=duration,
            start_time=format_timestamp(start),
            end_time=format_timestamp(end),
        ))
    return result


def validate_exclusive_annotation(
    exclusive: Optional[Annotation],
    raw_speaker_ids: set[str],
    audio_duration: float,
    exclusive_error: Optional[str] = None,
) -> List[Tuple[float, float, str]]:
    """Validate native exclusive output; never derive or arbitrate conflicts here."""
    if exclusive_error:
        raise ValueError(exclusive_error)
    if exclusive is None:
        raise LookupError("The configured Pyannote pipeline did not return native exclusive diarization")
    turns = []
    for segment, _, speaker in exclusive.itertracks(yield_label=True):
        start, end, speaker = float(segment.start), float(segment.end), str(speaker)
        if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
            raise ValueError("Native exclusive timeline contains invalid timestamps")
        if end > audio_duration + 0.001:
            raise ValueError("Native exclusive timeline extends past the audio duration")
        if speaker not in raw_speaker_ids:
            raise ValueError(f"Native exclusive timeline invented speaker ID {speaker!r}")
        start, end = round(start, 3), round(end, 3)
        if end <= start:
            raise ValueError("Native exclusive segment has no millisecond-scale duration")
        turns.append((start, end, speaker))
    turns.sort(key=lambda item: (item[0], item[1], item[2]))
    if raw_speaker_ids and not turns:
        raise ValueError("Native exclusive timeline is empty while raw diarization contains speech")

    active: List[Tuple[float, str]] = []
    for start, end, speaker in turns:
        active = [(active_end, active_speaker) for active_end, active_speaker in active if active_end > start]
        if any(active_speaker != speaker for _, active_speaker in active):
            raise ValueError("Native exclusive timeline contains cross-speaker overlap")
        active.append((end, speaker))
    return turns


def detect_speaker_turn_fragments(
    native_exclusive_segments: List[SpeakerSegment],
    raw_segments: List[SpeakerSegment],
    max_fragment_ms: int,
) -> List[SpeakerTurnSmoothingDiagnostic]:
    """Report suspicious short turns without assigning a replacement speaker."""
    ordered = sorted(
        native_exclusive_segments,
        key=lambda item: (item.start_seconds, item.end_seconds, item.speaker),
    )
    candidates: List[SpeakerTurnSmoothingDiagnostic] = []
    for index, segment in enumerate(ordered):
        duration_ms = (segment.end_seconds - segment.start_seconds) * 1000.0
        if duration_ms <= 0 or duration_ms > max_fragment_ms:
            continue
        previous = ordered[index - 1] if index > 0 else None
        following = ordered[index + 1] if index + 1 < len(ordered) else None
        is_aba = bool(
            previous and following
            and previous.speaker == following.speaker
            and previous.speaker != segment.speaker
        )
        window_start = index
        while window_start > 0 and ordered[index].end_seconds - ordered[window_start - 1].start_seconds <= 1.0:
            window_start -= 1
        window_end = index
        while window_end + 1 < len(ordered) and ordered[window_end + 1].end_seconds - ordered[index].start_seconds <= 1.0:
            window_end += 1
        rapid_change_count = sum(
            ordered[pos - 1].speaker != ordered[pos].speaker
            for pos in range(window_start + 1, window_end + 1)
        )
        if rapid_change_count >= 3:
            pattern = "RAPID_SWITCH_SEQUENCE"
        elif is_aba:
            pattern = "ABA_MICRO_TURN"
        elif previous and following:
            pattern = "SHORT_ADJACENT_TURN"
        else:
            pattern = "ISOLATED_MICRO_SEGMENT"

        raw_overlap_speakers = sorted({
            raw.speaker for raw in raw_segments
            if raw.speaker != segment.speaker
            and raw.start_seconds < segment.end_seconds
            and raw.end_seconds > segment.start_seconds
        })
        gap_before = (
            round(max(0.0, segment.start_seconds - previous.end_seconds) * 1000.0, 3)
            if previous else None
        )
        gap_after = (
            round(max(0.0, following.start_seconds - segment.end_seconds) * 1000.0, 3)
            if following else None
        )
        candidates.append(SpeakerTurnSmoothingDiagnostic(
            pattern=pattern,
            previous_speaker=previous.speaker if previous else None,
            candidate_speaker=segment.speaker,
            next_speaker=following.speaker if following else None,
            start_seconds=segment.start_seconds,
            end_seconds=segment.end_seconds,
            duration_ms=round(duration_ms, 3),
            silent_gap_before_ms=gap_before,
            silent_gap_after_ms=gap_after,
            raw_overlap_speakers=raw_overlap_speakers,
            rapid_change_count=rapid_change_count,
        ))
    return candidates


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
        :param min_speech_duration: Thời lượng tối thiểu (giây) để tính là một segment hợp lệ (bỏ nhiễu).
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
        collar_merge_gap: Optional[float] = None,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        timeline_mode: Optional[str] = None,
    ) -> SpeakerSegmentationResponse:
        """
        Thực thi Diarization, trích xuất VAD và chuẩn hóa các Speaker Segments theo timestamp.
        Xử lý đầy đủ trường hợp nói chồng lấn (Overlapping Speech) và chen ngang.
        """
        effective_min_duration = min_speech_duration if min_speech_duration is not None else self.min_speech_duration
        effective_collar_gap = collar_merge_gap if collar_merge_gap is not None else self.collar_merge_gap
        effective_timeline_mode = timeline_mode or settings.pyannote_timeline_mode
        if effective_timeline_mode not in {"raw", "exclusive"}:
            raise ValueError("timeline_mode must be 'raw' or 'exclusive'")
        smoothing_enabled = (
            effective_timeline_mode == "exclusive"
            and settings.pyannote_turn_smoothing_enabled
        )
        smoothing_threshold_ms = (
            settings.pyannote_turn_smoothing_max_fragment_ms if smoothing_enabled else None
        )
        if num_speakers is None and min_speakers is None and max_speakers is None:
            num_speakers = settings.pyannote_num_speakers
            min_speakers = settings.pyannote_min_speakers
            max_speakers = settings.pyannote_max_speakers
        speaker_constraints, speaker_count_mode = resolve_speaker_count_constraints(
            num_speakers, min_speakers, max_speakers
        )

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
            diarization_output: DiarizationOutput = diarization_runtime.diarize_with_output(
                str(audio_path_obj), **speaker_constraints
            )
            annotation = diarization_output.speaker_diarization
            raw_segments = annotation_to_speaker_segments(annotation)
            native_exclusive_segments: List[SpeakerSegment] = []
            smoothing_diagnostics: List[SpeakerTurnSmoothingDiagnostic] = []

            if effective_timeline_mode == "exclusive":
                raw_speaker_ids = {segment.speaker for segment in raw_segments}
                try:
                    selected_turns = validate_exclusive_annotation(
                        diarization_output.exclusive_speaker_diarization,
                        raw_speaker_ids,
                        audio_duration,
                        diarization_output.exclusive_error,
                    )
                except LookupError as exc:
                    logger.error(
                        "EXCLUSIVE_DIARIZATION_UNAVAILABLE job_id=%s pipeline_output=%s reason=%s",
                        job_id, diarization_output.output_type, exc,
                    )
                    return SpeakerSegmentationResponse(
                        job_id=job_id,
                        status="FAILED",
                        audio_duration_seconds=audio_duration,
                        speech_duration_seconds=0.0,
                        speech_ratio=0.0,
                        total_segments=0,
                        raw_segments=raw_segments,
                        timeline_mode=effective_timeline_mode,
                        timeline_source="unavailable",
                        smoothing_enabled=smoothing_enabled,
                        smoothing_max_fragment_ms=smoothing_threshold_ms,
                        error_code="EXCLUSIVE_DIARIZATION_UNAVAILABLE",
                        error_message=str(exc),
                    )
                except ValueError as exc:
                    logger.error("EXCLUSIVE_DIARIZATION_INVALID job_id=%s reason=%s", job_id, exc)
                    return SpeakerSegmentationResponse(
                        job_id=job_id,
                        status="FAILED",
                        audio_duration_seconds=audio_duration,
                        speech_duration_seconds=0.0,
                        speech_ratio=0.0,
                        total_segments=0,
                        raw_segments=raw_segments,
                        timeline_mode=effective_timeline_mode,
                        timeline_source="unavailable",
                        smoothing_enabled=smoothing_enabled,
                        smoothing_max_fragment_ms=smoothing_threshold_ms,
                        error_code="EXCLUSIVE_DIARIZATION_INVALID",
                        error_message=str(exc),
                    )
                selected_source = "native"
                selected_min_duration = 0.0
                native_exclusive_segments = annotation_to_speaker_segments(
                    diarization_output.exclusive_speaker_diarization
                )
                if smoothing_enabled:
                    smoothing_diagnostics = detect_speaker_turn_fragments(
                        native_exclusive_segments,
                        raw_segments,
                        smoothing_threshold_ms,
                    )
                    selected_source = "native_exclusive_diagnostics_only"
                    if smoothing_diagnostics:
                        logger.warning(
                            "SPEAKER_TURN_FRAGMENTATION job_id=%s threshold_ms=%d candidates=%s",
                            job_id, smoothing_threshold_ms,
                            [item.model_dump() for item in smoothing_diagnostics],
                        )
            else:
                selected_turns = []
                selected_source = "raw_postprocessed"
                selected_min_duration = effective_min_duration

            # 2. TRÍCH XUẤT VAD ĐỘC LẬP TỪ TIMELINE SUPPORT
            speech_timeline: Timeline = annotation.get_timeline().support()
            vad_intervals: List[SpeechActivityInterval] = []
            total_speech_sec = 0.0

            for segment in speech_timeline:
                s_dur = round(segment.duration, 3)
                total_speech_sec += s_dur
                vad_intervals.append(SpeechActivityInterval(
                    start_seconds=round(segment.start, 3),
                    end_seconds=round(segment.end, 3),
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
                    raw_segments=raw_segments,
                    timeline_mode=effective_timeline_mode,
                    timeline_source=selected_source,
                    native_exclusive_segments=native_exclusive_segments,
                    smoothed_segments=native_exclusive_segments if smoothing_enabled else [],
                    smoothing_enabled=smoothing_enabled,
                    smoothing_max_fragment_ms=smoothing_threshold_ms,
                    smoothing_diagnostics=smoothing_diagnostics,
                    vad_intervals=[]
                )

            # 3. Merge same-speaker turns only when no other speaker occupies the gap.
            raw_speaker_turns: List[Tuple[float, float, str]] = []
            for turn, _, speaker in raw_turns:
                t_start = round(turn.start, 3)
                t_end = round(turn.end, 3)
                if t_end > t_start:
                    raw_speaker_turns.append((t_start, t_end, str(speaker)))
            if effective_timeline_mode == "raw":
                selected_turns = merge_speaker_turns(raw_speaker_turns, effective_collar_gap)
            logger.info(
                "PYANNOTE_RAW_TURNS job_id=%s turns=%s",
                job_id,
                [
                    {
                        "start": start,
                        "end": end,
                        "speaker": speaker,
                    }
                    for start, end, speaker in raw_speaker_turns[:100]
                ],
            )

            logger.info(
                "PYANNOTE_SELECTED_TURNS job_id=%s mode=%s source=%s turns=%s",
                job_id, effective_timeline_mode, selected_source,
                [{"start": start, "end": end, "speaker": speaker}
                 for start, end, speaker in selected_turns[:100]],
            )

            short_segment_count = sum(
                1 for start, end, _ in raw_speaker_turns
                if end - start < effective_min_duration
            )

            # 5. LỌC NHIỄU THEO THỜI LƯỢNG TỐI THIỂU (MIN DURATION FILTER)
            valid_segments: List[SpeakerSegment] = []
            segment_counter = 1
            post_merge_short_segment_count = 0
            speech_by_speaker: Dict[str, float] = {}
            for start, end, speaker in raw_speaker_turns:
                speech_by_speaker[speaker] = speech_by_speaker.get(speaker, 0.0) + end - start

            for s_start, s_end, speaker in selected_turns:
                dur = round(s_end - s_start, 3)
                if dur >= selected_min_duration:
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
                else:
                    post_merge_short_segment_count += 1

            unique_speakers = sorted(list(set(s.speaker for s in valid_segments)))
            raw_overlap_duration = calculate_overlap_duration(raw_speaker_turns)
            overlap_duration = calculate_overlap_duration(selected_turns)
            logger.info(
                "DIARIZATION_DIAGNOSTICS job_id=%s speaker_count=%d raw_segment_count=%d "
                "merged_segment_count=%d short_segment_count=%d post_merge_short_segment_count=%d "
                "speaker_total_speech_duration=%s raw_overlap_duration=%.3f selected_overlap_duration=%.3f "
                "speaker_count_mode=%s diarization_device=%s timeline_mode=%s timeline_source=%s",
                job_id, len(set(speaker for _, _, speaker in raw_speaker_turns)),
                len(raw_speaker_turns), len(selected_turns), short_segment_count, post_merge_short_segment_count,
                {speaker: round(duration, 3) for speaker, duration in sorted(speech_by_speaker.items())},
                raw_overlap_duration, overlap_duration, speaker_count_mode, diarization_runtime.device,
                effective_timeline_mode, selected_source,
            )
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
                raw_segments=raw_segments,
                timeline_mode=effective_timeline_mode,
                timeline_source=selected_source,
                native_exclusive_segments=native_exclusive_segments,
                smoothed_segments=valid_segments if smoothing_enabled else [],
                smoothing_enabled=smoothing_enabled,
                smoothing_max_fragment_ms=smoothing_threshold_ms,
                smoothing_diagnostics=smoothing_diagnostics,
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
                error_message=str(e),
                timeline_mode=effective_timeline_mode,
                timeline_source="unavailable" if effective_timeline_mode == "exclusive" else "raw_postprocessed",
                smoothing_enabled=smoothing_enabled,
                smoothing_max_fragment_ms=smoothing_threshold_ms,
            )


speaker_diarization_service = SpeakerDiarizationService()
