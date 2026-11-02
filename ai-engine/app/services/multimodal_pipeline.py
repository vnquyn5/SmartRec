"""Explicit offline entry point for Task 1. Not registered as a Celery stage.

Inputs must already belong to the specified job. Use a new output directory in
the existing worker workspace; never overwrite media or a previous attempt.
No Backend callbacks, MinIO writes, LLM calls, or registry requests are made.
"""

import json
from pathlib import Path

from app.core.path_security import get_workspace_root
from app.schemas.stt_schemas import TranscriptPayload
from app.services.artifact_provenance import capture_local_source, verify_local_source
from app.services.multimodal_context import build_local_context
from app.services.ocr_postprocessor import OCRPostProcessor


def run_local_multimodal(
    *, meeting_id: str, job_id: str, video_path: Path, output_dir: Path,
    ocr_service, transcript: TranscriptPayload | None = None, extractor=None,
) -> dict:
    """Extract -> OCR -> normalize -> local evidence -> chronological context.

    ocr_service is an explicitly constructed PaddleOCRService (or test fake).
    STT is supplied as the existing parsed TranscriptPayload; this function
    neither invents speaker UUID mappings nor invokes the production worker.
    """
    meeting_id, job_id = str(meeting_id), str(job_id)
    if transcript is not None and (
        str(transcript.meetingId), str(transcript.processingJobId)
    ) != (meeting_id, job_id):
        raise ValueError("Transcript belongs to a different meeting/job")
    root = get_workspace_root().resolve(strict=True)
    video_source = capture_local_source(root, Path(video_path), meeting_id, job_id)
    requested = Path(output_dir).absolute()
    relative = requested.relative_to(root)
    current = root
    for part in relative.parts:
        if part == "..":
            raise ValueError("Unsafe output path")
        current = current / part
        if current.is_symlink():
            raise ValueError("Output symlinks are not allowed")
    if requested == root:
        raise ValueError("Use a dedicated new output directory")
    requested.mkdir(exist_ok=False)
    if extractor is None:
        from app.services.keyframe_extractor import KeyframeExtractor
        extractor = KeyframeExtractor()
    keyframes_dir = requested / "keyframes"
    extractor.extract(str(video_path), str(keyframes_dir))
    raw = ocr_service.process_keyframes(
        keyframes_dir, meeting_id=meeting_id, job_id=job_id,
    )
    ocr_service.save_ocr_result(raw, requested)
    normalized = OCRPostProcessor.process_ocr_result(raw)
    verify_local_source(root, video_source, meeting_id, job_id)
    normalized.update(meeting_id=meeting_id, job_id=job_id,
                    source_video_reference=video_source.to_dict())
    ocr_path = OCRPostProcessor.save_postprocessed_result(normalized, requested)
    ocr_source = capture_local_source(root, ocr_path, meeting_id, job_id)
    transcript_source = None
    if transcript is not None:
        transcript_path = requested / "transcript.json"
        with transcript_path.open("x", encoding="utf-8") as stream:
            stream.write(transcript.model_dump_json(indent=2))
        transcript_source = capture_local_source(root, transcript_path, meeting_id, job_id)
    context = build_local_context(
        workspace_root=root, meeting_id=meeting_id, job_id=job_id,
        transcript_source=transcript_source, ocr_source=ocr_source,
    )
    context_path = requested / "context.local.json"
    with context_path.open("x", encoding="utf-8") as stream:
        json.dump(context, stream, ensure_ascii=False, indent=2, allow_nan=False)
    return {"context": context, "context_path": str(context_path),
            "ocr_source": ocr_source, "transcript_source": transcript_source}
