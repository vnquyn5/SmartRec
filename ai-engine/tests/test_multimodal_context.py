"""Local evidence tests only: temporary files, no models or Backend services."""
import json
from dataclasses import replace
from uuid import UUID

import pytest

from app.services.artifact_provenance import capture_local_source, verify_local_source
from app.services.multimodal_context import build_local_context

MEETING = str(UUID(int=1))
JOB = str(UUID(int=2))


@pytest.fixture
def evidence(tmp_path):
    video = tmp_path / "video.mp4"
    image = tmp_path / "slide.jpg"
    video.write_bytes(b"test-video-evidence")
    image.write_bytes(b"test-image-evidence")
    capture = lambda p: capture_local_source(tmp_path, p, MEETING, JOB)
    transcript = {"meetingId": MEETING, "processingJobId": JOB, "segments": [
        {"startTimeMs": 3000, "endTimeMs": 4000, "text": "Ngân sách 10 triệu", "speakerId": None},
        {"startTimeMs": 0, "endTimeMs": 1000, "text": "Bắt đầu", "speakerId": str(UUID(int=3))},
    ]}
    ocr = {"meeting_id": MEETING, "job_id": JOB, "keyframe_run_id": "run_local",
           "source_video": video.name, "source_video_reference": capture(video).to_dict(),
           "slides": [{"slide_id": "slide_0001", "timestamp_ms": 3000,
                       "occurrences_ms": [6000, 3000, 3000], "status": "SUCCESS",
                       "raw_text": "Ngân sách 20 triệu", "normalized_text": "Ngân sách 20 triệu",
                       "image_source": capture(image).to_dict(), "error": None}]}

    def save(transcript_value=transcript, ocr_value=ocr):
        paths = [tmp_path / "transcript.json", tmp_path / "ocr.json"]
        for path, data in zip(paths, (transcript_value, ocr_value)):
            path.write_text(json.dumps(data), encoding="utf-8")
        return {"workspace_root": tmp_path, "meeting_id": MEETING, "job_id": JOB,
                "transcript_source": capture(paths[0]), "ocr_source": capture(paths[1])}
    return save, transcript, ocr, image, video


def test_timeline_conflicting_sources_remain_separate_and_repeat_slide(evidence):
    save, _, _, _, _ = evidence
    context = build_local_context(**save())
    blocks = context["blocks"]
    assert [b.get("start_ms", b.get("timestamp_ms")) for b in blocks] == [0, 3000, 3000, 6000]
    assert {b["text"] for b in blocks} == {"Bắt đầu", "Ngân sách 10 triệu", "Ngân sách 20 triệu"}
    assert all(b["citation"]["kind"] == "LOCAL" for b in blocks)
    unknown = next(b for b in blocks if b["text"] == "Ngân sách 10 triệu")
    assert unknown["speaker_reference"] is None and unknown["speaker_status"] == "UNKNOWN"
    assert context["persistent_citations"] is False
    assert "artifact_id" not in json.dumps(context)
    assert blocks[-1]["local_slide_reference"] == {"run_id": "run_local", "slide_id": "slide_0001"}


@pytest.mark.parametrize("status", ["NO_TEXT_DETECTED", "FAILED"])
def test_no_content_citation_for_blank_or_failed_ocr(evidence, status):
    save, _, ocr, _, _ = evidence
    ocr["slides"][0].update(status=status, error={"code": "OCR_INFERENCE_FAILED"} if status == "FAILED" else None)
    block = next(b for b in build_local_context(**save())["blocks"] if b["source_type"] == "SLIDE_OCR")
    assert block["text"] == "" and block["citation"] is None
    assert block["image_source"] and block["ocr_status"] == status


@pytest.mark.parametrize("dependency", ["image", "video"])
@pytest.mark.parametrize("mutation", ["delete", "replace"])
def test_missing_or_changed_media_is_unresolved(evidence, dependency, mutation):
    save, _, _, image, video = evidence
    inputs = save()
    path = image if dependency == "image" else video
    if mutation == "delete":
        path.unlink()
    else:
        path.write_bytes(b"different bytes")
    blocks = build_local_context(**inputs)["blocks"]
    slides = [b for b in blocks if b["source_type"] == "SLIDE_OCR"]
    assert all(b["source_status"] == "UNRESOLVED" and b["citation"] is None for b in slides)
    assert slides[0]["text"] == "Ngân sách 20 triệu"


def test_changed_result_cannot_cite_fabricated_text(evidence):
    save, _, _, _, _ = evidence
    inputs = save()
    (inputs["workspace_root"] / "transcript.json").write_text('{"text":"invented"}')
    result = build_local_context(**inputs)
    assert all(b["source_type"] != "TRANSCRIPT" for b in result["blocks"])
    assert any(w["code"] == "UNRESOLVED_SOURCE" for w in result["warnings"])


@pytest.mark.parametrize("where", ["reference", "transcript", "ocr", "image"])
def test_rejects_cross_job_evidence(evidence, where):
    save, transcript, ocr, _, _ = evidence
    foreign = str(UUID(int=9))
    if where == "transcript":
        transcript["processingJobId"] = foreign
    elif where == "ocr":
        ocr["job_id"] = foreign
    elif where == "image":
        ocr["slides"][0]["image_source"]["job_id"] = foreign
    inputs = save()
    if where == "reference":
        inputs["transcript_source"] = replace(inputs["transcript_source"], job_id=foreign)
    with pytest.raises(ValueError, match="different meeting/job"):
        build_local_context(**inputs)


@pytest.mark.parametrize("bad_time", [-1, True, 1.5, "1000"])
def test_rejects_invalid_ocr_milliseconds(evidence, bad_time):
    save, _, ocr, _, _ = evidence
    ocr["slides"][0]["timestamp_ms"] = bad_time
    with pytest.raises(ValueError, match="milliseconds"):
        build_local_context(**save())


def test_no_sources_no_citations(tmp_path):
    result = build_local_context(workspace_root=tmp_path, meeting_id=MEETING, job_id=JOB)
    assert result["blocks"] == [] and len(result["warnings"]) == 2


def test_no_image_reference_never_gets_persistent_or_local_citation(evidence):
    save, _, ocr, _, _ = evidence
    ocr["slides"][0]["image_source"] = None
    result = build_local_context(**save())
    assert all(b["citation"] is None for b in result["blocks"] if b["source_type"] == "SLIDE_OCR")


def test_local_source_rejects_symlink_and_traversal(tmp_path):
    original = tmp_path / "original"
    original.write_bytes(b"source")
    link = tmp_path / "link"
    link.symlink_to(original)
    with pytest.raises(ValueError, match="symlink"):
        capture_local_source(tmp_path, link, MEETING, JOB)
    source = capture_local_source(tmp_path, original, MEETING, JOB)
    with pytest.raises(ValueError, match="relative workspace"):
        verify_local_source(tmp_path, replace(source, workspace_path="../outside"), MEETING, JOB)


def test_failed_stt_has_no_content_citation(evidence):
    save, transcript, _, _, _ = evidence
    transcript["success"] = False
    result = build_local_context(**save())
    assert all(b["source_type"] != "TRANSCRIPT" for b in result["blocks"])
    assert any(w["code"] == "STT_FAILED" for w in result["warnings"])


def test_rejects_coerced_transcript_timestamps(evidence):
    save, transcript, _, _, _ = evidence
    transcript["segments"][0]["startTimeMs"] = "3000"
    with pytest.raises(ValueError, match="milliseconds"):
        build_local_context(**save())
