"""Reusable local OCR pipeline and Celery publication within the OUTPUT stage.

Inputs must already belong to the specified job. Use a new output directory in
the existing worker workspace; never overwrite media or a previous attempt.
run_local_multimodal stays offline. publish_job_ocr uploads verified artifacts
and sends fenced metadata callbacks; neither function invokes an LLM.
"""

import json
import logging
import time
from pathlib import Path

from app.core.path_security import get_workspace_root
from app.schemas.stt_schemas import TranscriptPayload
from app.services.artifact_provenance import capture_local_source, verify_local_source
from app.services.multimodal_context import build_local_context
from app.services.ocr_postprocessor import OCRPostProcessor

logger = logging.getLogger("smartrec.multimodal")


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
    # The OCR result must refer to the exact successfully published keyframe
    # manifest selected for this attempt, including the valid empty manifest.
    manifest, _ = type(ocr_service).load_keyframe_manifest(keyframes_dir)
    manifest_ids = {
        item["slide_id"]: (item["timestamp_ms"], item["occurrences_ms"])
        for item in manifest["keyframes"]
    }
    raw_slides = raw.get("slides") if isinstance(raw, dict) else None
    if (
        not isinstance(raw_slides, list)
        or raw.get("keyframe_run_id") != manifest.get("_keyframe_run_id")
        or manifest.get("source_video") != Path(video_path).name
        or len(raw_slides) != len(manifest_ids)
    ):
        raise ValueError("OCR result does not match the verified keyframe manifest")
    seen_ids = set()
    for slide in raw_slides:
        if not isinstance(slide, dict):
            raise ValueError("OCR result contains an invalid slide")
        slide_id = slide.get("slide_id")
        if slide_id not in manifest_ids or slide_id in seen_ids:
            raise ValueError("OCR slide identity does not match the keyframe manifest")
        expected_timestamp, expected_occurrences = manifest_ids[slide_id]
        if (slide.get("timestamp_ms"), slide.get("occurrences_ms")) != (
            expected_timestamp, expected_occurrences
        ):
            raise ValueError("OCR slide timestamps do not match the keyframe manifest")
        seen_ids.add(slide_id)
    ocr_service.save_ocr_result(raw, requested)
    normalized = OCRPostProcessor.process_ocr_result(raw)
    verify_local_source(root, video_source, meeting_id, job_id)
    normalized.update(meeting_id=meeting_id, job_id=job_id,
                    source_video_reference=video_source.to_dict())
    ocr_path = OCRPostProcessor.save_postprocessed_result(normalized, requested)
    ocr_source = capture_local_source(root, ocr_path, meeting_id, job_id)
    pointer = json.loads((keyframes_dir / "current.json").read_text(encoding="utf-8"))
    manifest_path = keyframes_dir / pointer["manifest_path"]
    keyframe_source = capture_local_source(root, manifest_path, meeting_id, job_id)
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
            "ocr_source": ocr_source, "keyframe_source": keyframe_source,
            "transcript_source": transcript_source}


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
        LocalSource, capture_local_source, read_verified_json,
        verify_local_source, workspace_file,
    )
    from app.workers.processing_errors import (
        NonRetryableProcessingError, RetryableProcessingError,
    )

    meeting_id, job_id = str(UUID(str(meeting_id))), str(UUID(str(job_id)))
    started = time.monotonic()
    run_id = None
    checkpoint()
    if ocr_service is None:
        from app.services.paddle_ocr_service import PaddleOCRService
        if not settings.ocr_recognition_model_dir or not settings.ocr_detection_model_dir:
            logger.error("OCR stage failed job_id=%s meeting_id=%s stage=MODEL reason=OCR_LOCAL_MODELS_REQUIRED",
                         job_id, meeting_id)
            raise NonRetryableProcessingError("OCR_LOCAL_MODELS_REQUIRED", "Local OCR models are not configured")
        try:
            ocr_service = PaddleOCRService(
                settings.ocr_recognition_model_dir, device=settings.ocr_device,
                detection_model_dir=settings.ocr_detection_model_dir,
            )
        except Exception as exc:
            logger.error("OCR stage failed job_id=%s meeting_id=%s stage=MODEL reason=OCR_MODEL_INITIALIZATION_FAILED error=%s",
                         job_id, meeting_id, type(exc).__name__)
            raise RetryableProcessingError(
                "OCR_MODEL_INITIALIZATION_FAILED", error_code="OCR_MODEL_INITIALIZATION_FAILED"
            ) from exc
    try:
        result = run_local_multimodal(
            meeting_id=meeting_id, job_id=job_id, video_path=Path(video_path),
            output_dir=Path(output_dir), ocr_service=ocr_service, checkpoint=checkpoint,
        )
    except (FileNotFoundError, ValueError, PermissionError, json.JSONDecodeError) as exc:
        logger.error("OCR stage failed job_id=%s meeting_id=%s stage=MANIFEST reason=OCR_MANIFEST_INVALID error=%s",
                     job_id, meeting_id, type(exc).__name__)
        raise NonRetryableProcessingError("OCR_MANIFEST_INVALID", str(exc)) from exc
    root = get_workspace_root()
    try:
        normalized = read_verified_json(root, result["ocr_source"], meeting_id, job_id)
        manifest = read_verified_json(root, result["keyframe_source"], meeting_id, job_id)
        slides = normalized["slides"]
        if (manifest.get("schema_version") != "1.1"
                or not isinstance(manifest.get("keyframes"), list)
                or manifest.get("total_keyframes") != len(manifest["keyframes"])
                or normalized.get("keyframe_run_id") != Path(result["keyframe_source"].workspace_path).parent.name
                or normalized.get("meeting_id") != meeting_id
                or normalized.get("job_id") != job_id
                or normalized.get("source_video") != Path(video_path).name
                or len(slides) != len(manifest["keyframes"])):
            raise ValueError("OCR artifact does not match a valid keyframe manifest")
        video_source = LocalSource.from_dict(normalized["source_video_reference"])
        verify_local_source(root, video_source, meeting_id, job_id)
        current_video_source = capture_local_source(root, Path(video_path), meeting_id, job_id)
        if current_video_source != video_source:
            raise ValueError("OCR source video does not match the requested Job media")
        expected = {
            item["slide_id"]: (item["timestamp_ms"], item["occurrences_ms"], item["image_path"])
            for item in manifest["keyframes"]
        }
        seen = set()
        for slide in slides:
            if not isinstance(slide, dict):
                raise ValueError("Invalid OCR slide entry")
            slide_id = slide.get("slide_id")
            if slide_id not in expected or slide_id in seen:
                raise ValueError("OCR slide identity does not match manifest")
            if (slide.get("timestamp_ms"), slide.get("occurrences_ms")) != expected[slide_id][:2]:
                raise ValueError("OCR slide timestamps do not match manifest")
            if slide.get("status") not in {"SUCCESS", "NO_TEXT_DETECTED", "FAILED"}:
                raise ValueError("Invalid OCR slide status")
            if slide.get("status") == "FAILED" and not isinstance(slide.get("error"), dict):
                raise ValueError("Failed OCR slide is missing its failure cause")
            source = LocalSource.from_dict(slide["image_source"])
            expected_image = (Path(result["keyframe_source"].workspace_path).parent / expected[slide_id][2]).as_posix()
            if source.workspace_path != expected_image:
                raise ValueError("OCR image source does not match its keyframe manifest entry")
            verify_local_source(root, source, meeting_id, job_id)
            seen.add(slide_id)
        if len(seen) != len(expected):
            raise ValueError("OCR result is incomplete for the keyframe manifest")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, PermissionError) as exc:
        logger.error("OCR stage failed job_id=%s meeting_id=%s stage=VALIDATE reason=OCR_PROVENANCE_INVALID error=%s",
                     job_id, meeting_id, type(exc).__name__)
        raise NonRetryableProcessingError("OCR_PROVENANCE_INVALID", str(exc)) from exc

    total_slides = len(slides)
    no_text = sum(slide["status"] == "NO_TEXT_DETECTED" for slide in slides)
    failed = [slide for slide in slides if slide["status"] == "FAILED"]
    succeeded = sum(slide["status"] == "SUCCESS" for slide in slides)
    ocr_status = normalized.get("ocr_status")
    expected_status = (
        "NO_SLIDES_DETECTED" if total_slides == 0 else
        "PARTIAL_FAILURE" if failed and len(failed) < total_slides else
        "FAILED" if failed else
        "SUCCESS" if succeeded else "NO_TEXT_DETECTED"
    )
    if (ocr_status != expected_status
            or normalized.get("total_slides") != total_slides
            or normalized.get("successful_slides") != succeeded
            or normalized.get("no_text_slides") != no_text
            or normalized.get("failed_slides") != len(failed)):
        raise NonRetryableProcessingError("OCR_RESULT_INVALID", "OCR artifact has no valid job status")
    if failed:
        failure_codes = sorted({str((slide.get("error") or {}).get("code") or "OCR_UNKNOWN_FAILURE") for slide in failed})
        logger.error("OCR stage failed job_id=%s meeting_id=%s keyframe_run_id=%s stage=INFERENCE total_keyframes=%d total_slides=%d successful_slides=%d no_text_slides=%d failed_slides=%d ocr_status=%s reason=%s elapsed_ms=%d",
                     job_id, meeting_id, normalized.get("keyframe_run_id"), len(expected), total_slides,
                     succeeded, no_text, len(failed), ocr_status, ",".join(failure_codes),
                     round((time.monotonic() - started) * 1000))
        if "OCR_IMAGE_ERROR" in failure_codes:
            raise NonRetryableProcessingError("OCR_IMAGE_INVALID", "One or more verified keyframes could not be decoded")
        raise RetryableProcessingError(
            f"OCR_INFERENCE_FAILED: {','.join(failure_codes)}",
            error_code="OCR_INFERENCE_FAILED",
        )

    logger.info("OCR stage complete job_id=%s meeting_id=%s keyframe_run_id=%s total_keyframes=%d total_slides=%d successful_slides=%d no_text_slides=%d failed_slides=0 ocr_status=%s elapsed_ms=%d",
                job_id, meeting_id, normalized.get("keyframe_run_id"), len(expected), total_slides,
                succeeded, no_text, ocr_status, round((time.monotonic() - started) * 1000))
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
