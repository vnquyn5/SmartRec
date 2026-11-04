"""Connect existing Whisper, speaker alignment and Backend STT callback."""

import math
from types import SimpleNamespace
from typing import Any, Callable, Mapping, Sequence
from uuid import UUID, NAMESPACE_URL, uuid5

from app.services.speaker_transcript_aligner import align_speakers
from app.services.transcript_parser import build_transcript_payload
from app.services.whisper_asr_service import WhisperASRService


def _prepare_speaker_timeline(
    formatted_segments: Sequence[Mapping[str, Any]],
):
    """Convert Worker OUTPUT segments into the existing aligner contract."""
    timeline = []
    speaker_keys = {}

    for segment in formatted_segments:
        label = str(segment.get("speakerLabel") or "").strip().upper()

        if not label or len(label) > 100:
            raise ValueError("Invalid diarization speaker label")

        start = float(segment["startTime"])
        end = float(segment["endTime"])

        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end <= start
        ):
            raise ValueError("Invalid diarization timestamps")

        # Internal alignment identifiers only; never sent to Backend.
        speaker_keys[label] = uuid5(
            NAMESPACE_URL,
            f"smartrec:alignment:{label}",
        )

        timeline.append(
            SimpleNamespace(
                start_seconds=start,
                end_seconds=end,
                raw_speaker_id=label,
                speaker=label,
            )
        )

    if not timeline:
        raise ValueError("STT requires a non-empty diarization timeline")

    return timeline, speaker_keys


def run_stt_for_job(
    *,
    audio_path: str,
    formatted_segments: Sequence[Mapping[str, Any]],
    meeting_id: str,
    job_id: str,
    callback_client: Any,
    backend_base_url: str,
    internal_token: str,
    checkpoint: Callable[[], Any] | None = None,
    execution_id: str | None = None,
) -> dict:
    """Run mandatory STT and deliver the transcript to Spring Boot."""

    if not internal_token or not internal_token.strip():
        raise ValueError("Missing internal token for STT")

    meeting_uuid = UUID(str(meeting_id))
    job_uuid = UUID(str(job_id))
    timeline, speaker_keys = _prepare_speaker_timeline(
        formatted_segments
    )

    if checkpoint is not None:
        checkpoint()
    with WhisperASRService() as whisper:
        transcription = whisper.transcribe(audio_path)
        whisper_segments = list(transcription.get("segments") or [])

    # Recheck control after inference and before publishing any transcript.
    # This is a safe-point hook, not a substitute for Backend execution fencing.
    if checkpoint is not None:
        checkpoint()
    if not whisper_segments:
        raise ValueError("STT_EMPTY_TRANSCRIPT")

    # Reuse the Sprint 3 overlap-based speaker alignment algorithm.
    aligned_ids = align_speakers(
        whisper_segments,
        timeline,
        speaker_keys,
    )

    id_to_label = {
        speaker_id: label
        for label, speaker_id in speaker_keys.items()
    }

    speaker_labels = {}

    for index, segment in enumerate(whisper_segments):
        if not str(getattr(segment, "text", "") or "").strip():
            continue

        aligned_id = aligned_ids.get(index)

        if aligned_id is None or aligned_id not in id_to_label:
            raise ValueError(
                f"STT_SPEAKER_UNRESOLVED: segment {index}"
            )

        speaker_labels[index] = id_to_label[aligned_id]

    payload = build_transcript_payload(
        meeting_id=meeting_uuid,
        processing_job_id=job_uuid,
        segments=whisper_segments,
        language=transcription.get("language") or "vi",
        speaker_labels=speaker_labels,
    ).model_dump(mode="json", exclude_none=True)

    if not payload["segments"]:
        raise ValueError("STT_EMPTY_TRANSCRIPT")

    if checkpoint is not None:
        checkpoint()
    delivered = callback_client.send_stt_result(
        backend_base_url,
        payload,
        internal_token=internal_token,
        **({"execution_id": execution_id} if execution_id is not None else {}),
    )

    if not delivered:
        raise RuntimeError("STT_CALLBACK_DELIVERY_FAILED")

    if checkpoint is not None:
        checkpoint()
    return payload
