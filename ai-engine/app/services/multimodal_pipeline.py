"""Reusable local OCR pipeline and Celery publication within the OUTPUT stage.

Inputs must already belong to the specified job. Use a new output directory in
the existing worker workspace; never overwrite media or a previous attempt.
run_local_multimodal stays offline. publish_job_ocr uploads verified artifacts
and sends fenced metadata callbacks; neither function invokes an LLM.
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
    ocr_service, transcript: TranscriptPayload | None = None, extractor=None, checkpoint=lambda: None,
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
    checkpoint()
    extractor.extract(str(video_path), str(keyframes_dir))
    checkpoint()
    raw = ocr_service.process_keyframes(
        keyframes_dir, meeting_id=meeting_id, job_id=job_id,
    )
    checkpoint()
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


def publish_job_ocr(
    *, meeting_id, job_id, video_path, output_dir, storage_client,
    callback_client, backend_base_url, internal_token, execution_id,
    checkpoint, ocr_service=None,
):
    """Persist verified OCR before LLM; failures retain STT via worker retry policy.

    No transcript-only fallback is enabled until Job warnings support it.
    UUIDs and object keys depend on job/meeting/timestamp, never attempt/run ID.
    """
    from uuid import UUID, uuid5, NAMESPACE_URL
    from app.core.config import settings
    from app.services.artifact_provenance import (
        LocalSource, read_verified_json, workspace_file,
    )
    from app.workers.processing_errors import RetryableProcessingError

    meeting_id, job_id = str(UUID(str(meeting_id))), str(UUID(str(job_id)))
    checkpoint()
    if ocr_service is None:
        from app.services.paddle_ocr_service import PaddleOCRService
        if not settings.ocr_recognition_model_dir or not settings.ocr_detection_model_dir:
            raise RetryableProcessingError("OCR_LOCAL_MODELS_REQUIRED")
        ocr_service = PaddleOCRService(
            settings.ocr_recognition_model_dir, device=settings.ocr_device,
            detection_model_dir=settings.ocr_detection_model_dir,
        )
    result = run_local_multimodal(
        meeting_id=meeting_id, job_id=job_id, video_path=Path(video_path),
        output_dir=Path(output_dir), ocr_service=ocr_service, checkpoint=checkpoint,
    )
    root = get_workspace_root()
    normalized = read_verified_json(root, result["ocr_source"], meeting_id, job_id)
    slides = normalized["slides"]
    if not slides or any(slide["status"] == "FAILED" for slide in slides):
        raise RetryableProcessingError("OCR_INCOMPLETE")
    prefix = f"meetings/{meeting_id}/jobs/{job_id}/ocr"
    pending = []
    for slide in slides:
        source = LocalSource.from_dict(slide["image_source"])
        verify_local_source(root, source, meeting_id, job_id)
        for timestamp in sorted(set(slide["occurrences_ms"])):
            slide_id = str(uuid5(NAMESPACE_URL, f"{prefix}/{timestamp}"))
            pending.append((source, {
                "slideId": slide_id, "meetingId": meeting_id, "jobId": job_id,
                "timestampMs": timestamp, "objectKey": f"{prefix}/{slide_id}.jpg",
                "ocrText": slide["normalized_text"], "keywords": [],
            }))
    if not pending:
        raise RetryableProcessingError("OCR_INCOMPLETE")
    checkpoint()
    storage_client.upload_file(
        str(workspace_file(root, result["ocr_source"].workspace_path)),
        f"{prefix}/ocr.postprocessed.json",
    )
    for source, metadata in pending:
        checkpoint()
        storage_client.upload_file(str(workspace_file(root, source.workspace_path)), metadata["objectKey"])
        checkpoint()
        callback_client.send_ocr_metadata(
            backend_base_url, metadata, internal_token=internal_token,
            execution_id=execution_id, checkpoint=checkpoint,
        )
    return len(pending)
