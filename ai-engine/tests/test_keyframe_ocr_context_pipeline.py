"""Real extraction/postprocessing code with synthetic frames and fake OCR.

No Paddle weights, real meeting media, MinIO or Backend is used.
"""
from types import SimpleNamespace
from uuid import UUID

import cv2
import numpy as np
import pytest

from app.schemas.stt_schemas import TranscriptPayload
from app.services.keyframe_extractor import KeyframeExtractor
from app.services.paddle_ocr_service import PaddleOCRService
from app.services.ocr_postprocessor import OCRPostProcessor
from app.services.multimodal_pipeline import run_local_multimodal
from app.services.multimodal_context import build_local_context
from app.services.artifact_provenance import read_verified_json

MEETING, JOB = str(UUID(int=1)), str(UUID(int=2))


@pytest.fixture
def local_pipeline(tmp_path, monkeypatch):
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    video = tmp_path / "synthetic.mp4"
    video.write_bytes(b"video decoder is faked in this test")
    a = np.random.default_rng(1).integers(0, 256, (64, 96, 3), dtype=np.uint8)
    b = np.random.default_rng(2).integers(0, 256, (64, 96, 3), dtype=np.uint8)
    extractor = KeyframeExtractor(min_sharpness=0)
    monkeypatch.setattr(extractor, "inspect_video", lambda _: {
        "source_video": video.name, "video_path": str(video), "duration_seconds": 9.0})
    # Actual candidate selection, SSIM and global dedup run over synthetic frames.
    monkeypatch.setattr(extractor, "sample_frames", lambda *args: iter(enumerate([a, a, a, b, b, b, a, a, a])))
    ocr = PaddleOCRService.__new__(PaddleOCRService)
    ocr._ocr = SimpleNamespace(predict=lambda **kwargs: [SimpleNamespace(json={"res": {
        "rec_texts": ["\ufeff  Ngân\u200b sách\n 20 triệu  "],
        "rec_scores": [0.91], "rec_boxes": [[0, 0, 60, 20]],
    }})])
    return video, extractor, ocr


def test_local_pipeline_dedup_provenance_normalization_and_context(tmp_path, local_pipeline):
    video, extractor, ocr = local_pipeline
    transcript = TranscriptPayload.model_validate({
        "meetingId": MEETING, "processingJobId": JOB, "segments": [
            {"startTimeMs": 2000, "endTimeMs": 4000, "text": "Ngân sách 10 triệu"}]})
    result = run_local_multimodal(meeting_id=MEETING, job_id=JOB, video_path=video,
                                 output_dir=tmp_path / "attempt", ocr_service=ocr,
                                 transcript=transcript, extractor=extractor)
    manifest, images = ocr.load_keyframe_manifest(tmp_path / "attempt" / "keyframes")
    assert len(images) == 2 and all(image.is_file() for image in images)
    assert manifest["keyframes"][0]["occurrences_ms"] == [2000, 8000]
    blocks = result["context"]["blocks"]
    slides = [b for b in blocks if b["source_type"] == "SLIDE_OCR"]
    assert [b["timestamp_ms"] for b in slides] == [2000, 5000, 8000]
    assert all(b["text"] == "Ngân sách 20 triệu" for b in slides)
    assert all(b["timestamp_basis"] == "sample_target" for b in slides)
    assert all(b["citation"] and b["citation"]["kind"] == "LOCAL" for b in blocks)
    assert any(b["text"] == "Ngân sách 10 triệu" for b in blocks)
    assert result["context"]["backend_integration"] == "BLOCKED_BY_BE"
    images[0].unlink()
    rebuilt = build_local_context(workspace_root=tmp_path, meeting_id=MEETING, job_id=JOB,
                                  transcript_source=result["transcript_source"], ocr_source=result["ocr_source"])
    assert all(b["citation"] is None for b in rebuilt["blocks"]
               if b.get("local_slide_reference", {}).get("slide_id") == "slide_0001")


def test_successful_scan_with_zero_keyframes_is_verified_empty_ocr(tmp_path, local_pipeline, monkeypatch):
    video, extractor, ocr = local_pipeline
    monkeypatch.setattr(extractor, "sample_frames", lambda *args: iter(()))
    result = run_local_multimodal(meeting_id=MEETING, job_id=JOB, video_path=video,
                                 output_dir=tmp_path / "empty-scan", ocr_service=ocr,
                                 extractor=extractor)
    artifact = read_verified_json(tmp_path, result["ocr_source"], MEETING, JOB)
    manifest = read_verified_json(tmp_path, result["keyframe_source"], MEETING, JOB)
    assert manifest["total_keyframes"] == 0 and manifest["keyframes"] == []
    assert artifact["ocr_status"] == "NO_SLIDES_DETECTED"
    assert artifact["slides"] == []
    assert artifact["failed_slides"] == 0


@pytest.mark.parametrize("case,expected", [("empty", "NO_TEXT_DETECTED"), ("missing", "FAILED"),
                                           ("corrupt", "FAILED"), ("inference", "FAILED")])
def test_ocr_blank_missing_corrupt_and_failure(tmp_path, local_pipeline, case, expected):
    video, extractor, ocr = local_pipeline
    output = tmp_path / "keyframes"
    extractor.extract(str(video), str(output))
    _, paths = ocr.load_keyframe_manifest(output)
    if case == "missing":
        paths[0].unlink()
    elif case == "corrupt":
        paths[0].write_bytes(b"not a jpeg")
    elif case == "empty":
        ocr._ocr.predict = lambda **kwargs: [SimpleNamespace(json={"res": {
            "rec_texts": [], "rec_scores": [], "rec_boxes": []}})]
    else:
        def failed(**kwargs):
            raise RuntimeError("fake inference unavailable")
        ocr._ocr.predict = failed
    result = ocr.process_keyframes(output, meeting_id=MEETING, job_id=JOB)
    slide = OCRPostProcessor.process_ocr_result(result)["slides"][0]
    assert slide["status"] == expected and slide["normalized_text"] == ""
    if case == "empty":
        assert slide["image_source"] is not None and slide["error"] is None
    else:
        assert slide["error"] and slide["raw_text"] == ""


def test_image_changed_during_ocr_cannot_be_cited(tmp_path, local_pipeline):
    video, extractor, ocr = local_pipeline
    output = tmp_path / "keyframes"
    extractor.extract(str(video), str(output))
    _, images = ocr.load_keyframe_manifest(output)
    def mutate(**kwargs):
        images[0].write_bytes(b"replaced during OCR")
        return []
    ocr._ocr.predict = mutate
    slide = ocr.process_keyframes(output, meeting_id=MEETING, job_id=JOB)["slides"][0]
    assert slide["status"] == "FAILED" and slide["image_source"] is None


def test_existing_output_is_never_overwritten(tmp_path, local_pipeline):
    video, extractor, ocr = local_pipeline
    output = tmp_path / "existing"
    output.mkdir()
    marker = output / "keep"
    marker.write_text("unchanged")
    with pytest.raises(FileExistsError):
        run_local_multimodal(meeting_id=MEETING, job_id=JOB, video_path=video,
                             output_dir=output, ocr_service=ocr, extractor=extractor)
    assert marker.read_text() == "unchanged"


def test_sampling_labels_requested_seek_time_not_decoder_precision(monkeypatch):
    class Capture:
        def isOpened(self): return True
        def set(self, prop, value): return True
        def read(self): return True, np.zeros((8, 8, 3), dtype=np.uint8)
        def release(self): pass
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: Capture())
    frames = list(KeyframeExtractor(sample_interval_seconds=0.5).sample_frames("fake", 1.1))
    assert [time for time, _ in frames] == [0.0, 0.5, 1.0]


def test_ocr_reading_order_and_original_confidence_preserved():
    detections = [{"text": "B", "confidence": .2, "bounding_box": [40, 0, 60, 20]},
                  {"text": "A", "confidence": .9, "bounding_box": [0, 0, 20, 20]}]
    raw = {"schema_version": "1.0", "keyframe_run_id": "run_x", "slides": [
        {"slide_id": "slide_0001", "timestamp_ms": 0, "occurrences_ms": [0],
         "status": "SUCCESS", "text": "B\nA", "detections": detections}]}
    slide = OCRPostProcessor.process_ocr_result(raw)["slides"][0]
    assert slide["raw_text"] == "B\nA" and slide["normalized_text"] == "A\nB"
    assert [d["confidence"] for d in slide["detections"]] == [.9, .2]
