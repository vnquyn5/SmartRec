"""Build a local, chronological evidence view; not a Backend Context DTO.

Only text read from checksum-verified evidence is cited. OCR and speech are
separate observations, including when they disagree. No LLM inference occurs.
"""

from copy import deepcopy
from pathlib import Path

from app.schemas.stt_schemas import TranscriptPayload
from app.services.artifact_provenance import LocalSource, read_verified_json, verify_local_source


def _milliseconds(value) -> int:
    if type(value) is not int or value < 0:
        raise ValueError("Timestamp must be a non-negative integer in milliseconds")
    return value


def build_local_context(
    *, workspace_root: Path, meeting_id: str, job_id: str,
    transcript_source: LocalSource | None = None,
    ocr_source: LocalSource | None = None,
) -> dict:
    """Read scoped result files and verify citation dependencies on every call.

    Missing/changed evidence is unresolved, never a fabricated citation. Scope
    mismatches fail the entire call rather than mixing jobs. A valid local
    citation is not a persistent citation and expires if its files disappear.
    """
    meeting_id, job_id = str(meeting_id), str(job_id)
    if not meeting_id.strip() or not job_id.strip():
        raise ValueError("Context requires meeting_id and job_id")
    blocks, warnings = [], []
    verified_dependencies = {}

    def load(source, role):
        if source is None:
            warnings.append({"source": role, "code": "SOURCE_NOT_PROVIDED"})
            return None
        if (source.meeting_id, source.job_id) != (meeting_id, job_id):
            raise ValueError("Source belongs to a different meeting/job")
        try:
            return read_verified_json(workspace_root, source, meeting_id, job_id)
        except (OSError, ValueError, TypeError) as exc:
            warnings.append({"source": role, "code": "UNRESOLVED_SOURCE", "reason": str(exc)})
            return None

    transcript = load(transcript_source, "TRANSCRIPT")
    if transcript is not None:
        for segment in transcript.get("segments", []):
            _milliseconds(segment.get("startTimeMs"))
            _milliseconds(segment.get("endTimeMs"))
        payload = TranscriptPayload.model_validate(transcript)
        if (str(payload.meetingId), str(payload.processingJobId)) != (meeting_id, job_id):
            raise ValueError("Transcript payload belongs to a different meeting/job")
        if not payload.success:
            warnings.append({"source": "TRANSCRIPT", "code": "STT_FAILED"})
        else:
            for index, segment in enumerate(payload.segments):
                # Preserve the text; whitespace-only input supplies no evidence.
                if not segment.text.strip():
                    continue
                blocks.append({
                    "source_type": "TRANSCRIPT", "text": segment.text,
                    "start_ms": segment.startTimeMs, "end_ms": segment.endTimeMs,
                    "speaker_reference": str(segment.speakerId) if segment.speakerId else None,
                    "speaker_status": "PROVIDED" if segment.speakerId else "UNKNOWN",
                    "source_status": "LOCAL_VERIFIED",
                    "citation": {"kind": "LOCAL", "result": transcript_source.to_dict(),
                                "selector": {"segment_index": index}},
                })

    ocr = load(ocr_source, "SLIDE_OCR")
    if ocr is not None:
        if (ocr.get("meeting_id"), ocr.get("job_id")) != (meeting_id, job_id):
            raise ValueError("OCR payload belongs to a different meeting/job")
        run_id = ocr.get("keyframe_run_id")
        if not isinstance(run_id, str) or not run_id.strip():
            raise ValueError("OCR needs a local keyframe run identity")
        slides = ocr.get("slides")
        if not isinstance(slides, list):
            raise ValueError("OCR slides must be a list")
        seen = set()
        for index, slide in enumerate(slides):
            if not isinstance(slide, dict):
                raise ValueError("OCR slide must be an object")
            slide_id = slide.get("slide_id")
            if not isinstance(slide_id, str) or not slide_id.strip() or slide_id in seen:
                raise ValueError("OCR needs unique local slide IDs within its run")
            seen.add(slide_id)
            timestamp = _milliseconds(slide.get("timestamp_ms"))
            occurrences = slide.get("occurrences_ms")
            if not isinstance(occurrences, list) or not occurrences:
                raise ValueError("OCR needs occurrence timestamps")
            times = sorted({_milliseconds(t) for t in occurrences})
            if timestamp not in times:
                raise ValueError("OCR timestamp must be an occurrence")
            status = slide.get("status")
            if status not in {"SUCCESS", "NO_TEXT_DETECTED", "FAILED"}:
                raise ValueError("Unknown OCR status")
            text = slide.get("normalized_text", "")
            if not isinstance(text, str):
                raise ValueError("OCR text must be a string")
            dependencies = []
            source_status = "LOCAL_VERIFIED"
            for role, value in (("video", ocr.get("source_video_reference")),
                                ("image", slide.get("image_source"))):
                try:
                    reference = LocalSource.from_dict(value or {})
                    if (reference.meeting_id, reference.job_id) != (meeting_id, job_id):
                        raise ValueError("Source belongs to a different meeting/job")
                except (KeyError, TypeError, ValueError) as exc:
                    # A foreign source is a scope error, not a missing-file warning.
                    if isinstance(value, dict) and (value.get("meeting_id"), value.get("job_id")) != (meeting_id, job_id):
                        raise ValueError("OCR dependency belongs to a different meeting/job") from exc
                    source_status = "UNRESOLVED"
                    continue
                try:
                    if reference not in verified_dependencies:
                        try:
                            verify_local_source(workspace_root, reference, meeting_id, job_id)
                            verified_dependencies[reference] = True
                        except (OSError, ValueError):
                            verified_dependencies[reference] = False
                    if not verified_dependencies[reference]:
                        raise ValueError("Unresolved dependency")
                    dependencies.append({"role": role, "source": reference.to_dict()})
                except (OSError, ValueError):
                    source_status = "UNRESOLVED"
            if source_status == "UNRESOLVED":
                warnings.append({"source": "SLIDE_OCR", "local_slide_id": slide_id,
                                 "code": "UNRESOLVED_SOURCE"})
            for occurrence in times:
                citation = None
                if status == "SUCCESS" and text.strip() and source_status == "LOCAL_VERIFIED":
                    citation = {"kind": "LOCAL", "result": ocr_source.to_dict(),
                                "selector": {"slide_index": index, "occurrence_ms": occurrence},
                                "dependencies": deepcopy(dependencies)}
                blocks.append({
                    "source_type": "SLIDE_OCR", "timestamp_ms": occurrence,
                    "timestamp_basis": slide.get("timestamp_basis", "sample_target"),
                    "text": text if status == "SUCCESS" else "",
                    "raw_text": slide.get("raw_text", ""), "ocr_status": status,
                    "local_slide_reference": {"run_id": run_id, "slide_id": slide_id},
                    "source_video": ocr.get("source_video"),
                    "image_source": deepcopy(slide.get("image_source")),
                    "source_status": source_status, "citation": citation,
                    "error": deepcopy(slide.get("error")),
                    "layout_type": slide.get("layout_type"),
                    "detections": deepcopy(slide.get("detections", [])),
                    "table_candidate": deepcopy(slide.get("table_candidate")),
                })

    blocks.sort(key=lambda block: (block.get("start_ms", block.get("timestamp_ms")),
                                block["source_type"]))
    return {"schema": "smartrec.ai.local-context.v1", "meeting_id": meeting_id,
            "job_id": job_id, "time_unit": "milliseconds", "blocks": blocks,
            "warnings": warnings, "persistent_citations": False,
            "backend_integration": "BLOCKED_BY_BE"}
