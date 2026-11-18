"""Connect existing Whisper, speaker alignment and Backend STT callback."""

import math
import logging
import json
import os
import uuid
from types import SimpleNamespace
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from uuid import UUID, NAMESPACE_URL, uuid5

from app.services.speaker_transcript_aligner import analyze_speaker_attribution
from app.services.transcript_parser import build_transcript_payload
from app.services.artifact_provenance import (
    LocalSource, capture_local_source, read_verified_source,
    verify_local_source, workspace_file,
)
from app.core.path_security import get_workspace_root
from app.services.whisper_asr_service import WhisperASRService
from app.services.confidence_scorer import (
    extract_transcript_signals,
    build_transcript_confidence_sidecar,
    verify_transcript_confidence_sidecar,
)

logger = logging.getLogger("smartrec.stt_job")


def _atomic_json(path: Path, payload: dict) -> None:
    if path.is_symlink():
        raise PermissionError("STT checkpoint symlink is not allowed")
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _checkpoint_files(checkpoint_path: str | Path) -> tuple[Path, Path, Path]:
    root = get_workspace_root().resolve(strict=True)
    path = Path(checkpoint_path).absolute()
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise PermissionError("STT checkpoint must remain inside the job workspace") from exc
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise PermissionError("STT checkpoint path contains a symlink")
    if path.suffix.lower() != ".json" or path == root:
        raise ValueError("STT checkpoint must be a workspace JSON file")
    return root, path, path.with_suffix(".provenance.json")


def _load_stt_checkpoint(checkpoint_path, audio_path, meeting_id, job_id):
    if checkpoint_path is None:
        return None
    from app.schemas.stt_schemas import TranscriptPayload

    root, payload_path, provenance_path = _checkpoint_files(checkpoint_path)
    if not payload_path.exists() or not provenance_path.exists():
        return None
    try:
        provenance_file = workspace_file(root, provenance_path.relative_to(root).as_posix())
        provenance = json.loads(provenance_file.read_text(encoding="utf-8"))
        if provenance.get("schema_version") not in {"1.0", "1.1", "1.2", "1.3"}:
            return None
        timeline_mode = provenance.get("timeline_mode", "raw")
        if timeline_mode not in {"raw", "exclusive"}:
            return None
        payload_source = LocalSource.from_dict(provenance["payload_source"])
        audio_source = LocalSource.from_dict(provenance["audio_source"])
        if payload_source.workspace_path != payload_path.relative_to(root).as_posix():
            return None
        verify_local_source(root, audio_source, meeting_id, job_id)
        raw = read_verified_source(root, payload_source, meeting_id, job_id)
        payload = TranscriptPayload.model_validate_json(raw)
        if (str(payload.meetingId) != meeting_id
                or str(payload.processingJobId) != job_id
                or not payload.success
                or not payload.segments
                or any(not (item.speakerId or item.speakerLabel)
                       and item.attributionStatus not in {"CROSS_SPEAKER_BOUNDARY", "UNRESOLVED"}
                       for item in payload.segments)):
            return None
        smoothing_enabled = provenance.get("smoothing_enabled", False)
        smoothing_threshold = provenance.get("smoothing_max_fragment_ms")
        if not isinstance(smoothing_enabled, bool):
            return None
        if smoothing_threshold is not None and (
            not isinstance(smoothing_threshold, int) or isinstance(smoothing_threshold, bool)
        ):
            return None
        if smoothing_enabled and (
            timeline_mode != "exclusive" or smoothing_threshold is None or smoothing_threshold <= 0
        ):
            return None
        if not smoothing_enabled and smoothing_threshold is not None:
            return None
        alignment_version = provenance.get("speaker_alignment_version", 1)
        if not isinstance(alignment_version, int) or isinstance(alignment_version, bool):
            return None
        verified_payload = payload.model_dump(mode="json", exclude_none=True)
        confidence_metadata = _load_stt_confidence_sidecar(
            checkpoint_path,
            provenance,
            verified_payload,
            meeting_id,
            job_id,
        )
        return (
            verified_payload,
            timeline_mode,
            smoothing_enabled,
            smoothing_threshold,
            alignment_version,
            confidence_metadata,
        )
    except (OSError, KeyError, TypeError, ValueError, PermissionError) as exc:
        logger.warning("STT checkpoint rejected job_id=%s reason=%s", job_id, type(exc).__name__)
        return None


def _load_stt_confidence_sidecar(
    checkpoint_path,
    provenance,
    payload,
    meeting_id,
    job_id,
):
    """Load verified confidence metadata, or return None when unavailable."""
    source_data = provenance.get("confidence_source")
    if source_data is None:
        return None

    try:
        root, payload_path, _ = _checkpoint_files(checkpoint_path)
        source = LocalSource.from_dict(source_data)

        expected_path = payload_path.with_suffix(
            ".confidence.json"
        ).relative_to(root).as_posix()

        if source.workspace_path != expected_path:
            raise ValueError("Confidence sidecar path mismatch")

        raw = read_verified_source(root, source, meeting_id, job_id)
        sidecar = json.loads(raw)

        return verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id=meeting_id,
            job_id=job_id,
            transcript_segments=payload["segments"],
        )
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        logger.warning(
            "STT confidence sidecar unresolved job_id=%s",
            job_id,
        )
        return None


def _save_stt_confidence_sidecar(
    checkpoint_path,
    payload,
    confidence_metadata,
    meeting_id,
    job_id,
) -> LocalSource:
    """Persist AI-owned confidence metadata without changing STT payload."""

    root, payload_path, _ = _checkpoint_files(checkpoint_path)

    sidecar_path = payload_path.with_suffix(".confidence.json")

    sidecar = build_transcript_confidence_sidecar(
        meeting_id=meeting_id,
        job_id=job_id,
        transcript_segments=payload["segments"],
        confidence_metadata=confidence_metadata,
    )

    # Reject mismatched metadata before writing anything.
    verify_transcript_confidence_sidecar(
        sidecar=sidecar,
        meeting_id=meeting_id,
        job_id=job_id,
        transcript_segments=payload["segments"],
    )

    _atomic_json(sidecar_path, sidecar)

    return capture_local_source(
        root,
        sidecar_path,
        meeting_id,
        job_id,
    )

def _save_stt_checkpoint(
    checkpoint_path, audio_path, payload, meeting_id, job_id, timeline_mode,
    smoothing_enabled=False, smoothing_max_fragment_ms=None,
    confidence_metadata=None,
):
    if checkpoint_path is None:
        return
    from app.schemas.stt_schemas import TranscriptPayload

    root, payload_path, provenance_path = _checkpoint_files(checkpoint_path)
    validated = TranscriptPayload.model_validate(payload)
    if str(validated.meetingId) != meeting_id or str(validated.processingJobId) != job_id:
        raise ValueError("STT checkpoint payload identity mismatch")
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_json(payload_path, validated.model_dump(mode="json", exclude_none=True))
    payload_source = capture_local_source(root, payload_path, meeting_id, job_id)
    audio_source = capture_local_source(root, Path(audio_path), meeting_id, job_id)
    confidence_source = None

    if confidence_metadata is not None:
        confidence_source = _save_stt_confidence_sidecar(
            checkpoint_path,
            validated.model_dump(mode="json", exclude_none=True),
            confidence_metadata,
            meeting_id,
            job_id,
        )

    _atomic_json(provenance_path, {
        "schema_version": "1.3",
        "timeline_mode": timeline_mode,
        "smoothing_enabled": smoothing_enabled,
        "smoothing_max_fragment_ms": smoothing_max_fragment_ms,
        "speaker_alignment_version": 2,
        "payload_source": payload_source.to_dict(),
        "audio_source": audio_source.to_dict(),
        "confidence_source": (
            confidence_source.to_dict()
            if confidence_source is not None
            else None
        ),
    })


def _segments_from_cached_payload(payload):
    """Recover verified Whisper text/timing for a mode-only speaker realignment."""
    segments = []
    for index, item in enumerate(payload.get("segments") or []):
        start_ms, end_ms = item.get("startTimeMs"), item.get("endTimeMs")
        text = str(item.get("text") or "").strip()
        if not text or not isinstance(start_ms, int) or not isinstance(end_ms, int):
            raise ValueError(f"Invalid verified transcript segment #{index}")
        if start_ms < 0 or end_ms < start_ms:
            raise ValueError(f"Invalid verified transcript timestamps #{index}")
        segments.append(SimpleNamespace(
            start=start_ms / 1000.0,
            end=end_ms / 1000.0,
            text=text,
        ))
    return segments


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
    checkpoint_path: str | Path | None = None,
    timeline_mode: str = "raw",
    smoothing_enabled: bool = False,
    smoothing_max_fragment_ms: int | None = None,
) -> dict:
    """Run mandatory STT and deliver the transcript to Spring Boot."""

    if not internal_token or not internal_token.strip():
        raise ValueError("Missing internal token for STT")
    if timeline_mode not in {"raw", "exclusive"}:
        raise ValueError("timeline_mode must be 'raw' or 'exclusive'")
    if not isinstance(smoothing_enabled, bool):
        raise ValueError("smoothing_enabled must be boolean")
    if smoothing_enabled and (timeline_mode != "exclusive" or not isinstance(smoothing_max_fragment_ms, int)
                              or isinstance(smoothing_max_fragment_ms, bool) or smoothing_max_fragment_ms <= 0):
        raise ValueError("enabled smoothing requires exclusive mode and a positive integer threshold")
    if not smoothing_enabled:
        smoothing_max_fragment_ms = None

    meeting_uuid = UUID(str(meeting_id))
    job_uuid = UUID(str(job_id))
    timeline, speaker_keys = _prepare_speaker_timeline(
        formatted_segments
    )

    if checkpoint is not None:
        checkpoint()
    cached_checkpoint = _load_stt_checkpoint(checkpoint_path, audio_path, str(meeting_uuid), str(job_uuid))
    payload = None
    transcription = None
    whisper_segments = None
    confidence_metadata = None
    selected_identity = (timeline_mode, smoothing_enabled, smoothing_max_fragment_ms, 2)
    cached_identity = cached_checkpoint[1:5] if cached_checkpoint is not None else None
    checkpoint_needs_save = cached_checkpoint is None or cached_identity != selected_identity
    if cached_checkpoint is not None and cached_identity == selected_identity:
        payload = cached_checkpoint[0]
        logger.info(
            "STT checkpoint reused job_id=%s timeline_mode=%s segment_count=%d",
            job_uuid, timeline_mode, len(payload["segments"]),
        )
    elif cached_checkpoint is not None:
        (cached_payload, cached_mode, cached_smoothing_enabled, cached_smoothing_threshold,
         cached_alignment_version, cached_confidence_metadata) = cached_checkpoint
        logger.info(
            "STT checkpoint realignment job_id=%s old_identity=%s new_identity=%s; reusing verified text/timestamps",
            job_uuid, (cached_mode, cached_smoothing_enabled, cached_smoothing_threshold, cached_alignment_version),
            selected_identity,
        )
        transcription = {"language": cached_payload.get("language") or "vi"}
        whisper_segments = _segments_from_cached_payload(cached_payload)
    else:
        with WhisperASRService() as whisper:
            transcription = whisper.transcribe(audio_path)
            whisper_segments = list(transcription.get("segments") or [])
        logger.info(
            "STT complete job_id=%s model=%s device=%s elapsed_ms=%s segment_count=%d",
            job_uuid, transcription.get("model", "unknown"), transcription.get("device", "unknown"),
            transcription.get("inference_time_ms", "unknown"), len(whisper_segments),
        )

    # Recheck control after inference and before publishing any transcript.
    # This is a safe-point hook, not a substitute for Backend execution fencing.
    if checkpoint is not None:
        checkpoint()
    if payload is None and not whisper_segments:
        raise ValueError("STT_EMPTY_TRANSCRIPT")

    if payload is None:
        # Reuse the overlap-based speaker alignment algorithm.
        id_to_label = {speaker_id: label for label, speaker_id in speaker_keys.items()}
        attributions = analyze_speaker_attribution(whisper_segments, timeline)
        output_segments = []
        speaker_labels = {}
        attribution_statuses = {}
        for source_index, segment in enumerate(whisper_segments):
            text = str(getattr(segment, "text", "") or "").strip()
            if not text:
                continue
            attribution = attributions[source_index]
            if attribution.status == "CROSS_SPEAKER_BOUNDARY":
                logger.warning(
                    "STT_CROSS_SPEAKER_BOUNDARY job_id=%s segment_index=%d start=%.6f end=%.6f "
                    "overlap_by_speaker=%s",
                    job_uuid, source_index, float(segment.start), float(segment.end),
                    {key: round(value, 6) for key, value in sorted(attribution.overlap_by_speaker.items())},
                )
            word_assignments = attribution.word_assignments
            split_runs = []
            if word_assignments:
                source_words = getattr(segment, "words", None) or ()

                # Aligner chỉ trả word_assignments khi mọi word được xác minh
                # và nội dung ghép lại khớp với Whisper segment gốc.
                for word_index, (word_start, word_end, word_text, speaker_key) in enumerate(word_assignments):
                    source_word = source_words[word_index]

                    if (
                        split_runs
                        and split_runs[-1]["speaker_key"] == speaker_key
                        and abs(split_runs[-1]["end"] - word_start) <= 0.001
                    ):
                        split_runs[-1]["end"] = word_end
                        split_runs[-1]["text"] += word_text
                        split_runs[-1]["source_word_indices"].append(word_index)
                    else:
                        split_runs.append({
                            "start": word_start,
                            "end": word_end,
                            "text": word_text,
                            "speaker_key": speaker_key,
                            "source_word_indices": [word_index],
                        })

            if split_runs:
                for run in split_runs:
                    output_index = len(output_segments)
                    output_segments.append(SimpleNamespace(
                        start=run["start"],
                        end=run["end"],
                        text=run["text"].strip(),
                        source_segment_index=source_index,
                        source_word_indices=tuple(run["source_word_indices"]),
                        confidence_granularity="WORD_LEVEL_SPLIT",
                        words=tuple(
                            source_words[word_index]
                            for word_index in run["source_word_indices"]
                        ),
                    ))
                    speaker_labels[output_index] = id_to_label[speaker_keys[run["speaker_key"]]]
                    attribution_statuses[output_index] = "ATTRIBUTED"
                continue

            output_index = len(output_segments)
            output_segments.append(segment)
            attribution_statuses[output_index] = attribution.status
            if attribution.speaker_key is not None:
                aligned_id = speaker_keys.get(attribution.speaker_key)
                if aligned_id is not None:
                    speaker_labels[output_index] = id_to_label[aligned_id]

                # Collect confidence-related metadata without changing STT output.
        confidence_metadata = []

        for output_index, output_segment in enumerate(output_segments):
            is_split = (
                getattr(output_segment, "confidence_granularity", None)
                == "WORD_LEVEL_SPLIT"
            )

            metadata = extract_transcript_signals(
                output_segment,
                adapter=(transcription.get("adapter") or "unknown"),
                model_identifier=transcription.get("model"),
                model_version=transcription.get("model_version"),
                source_segment_id=str(
                    getattr(output_segment, "source_segment_index", output_index)
                ),
            )

            if is_split:
                # Source-segment scores must not be assigned to split runs.
                assert metadata["provenance"]["rawSignals"] == []

            confidence_metadata.append(metadata)

        payload = build_transcript_payload(
            meeting_id=meeting_uuid, processing_job_id=job_uuid,
            segments=output_segments, language=transcription.get("language") or "vi",
            speaker_labels=speaker_labels, attribution_statuses=attribution_statuses,
        ).model_dump(mode="json", exclude_none=True)

    if not payload["segments"]:
        raise ValueError("STT_EMPTY_TRANSCRIPT")

    if checkpoint_path is not None and checkpoint_needs_save:
        _save_stt_checkpoint(
            checkpoint_path, audio_path, payload, str(meeting_uuid), str(job_uuid), timeline_mode,
            smoothing_enabled, smoothing_max_fragment_ms,
            confidence_metadata=confidence_metadata,
        )

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
