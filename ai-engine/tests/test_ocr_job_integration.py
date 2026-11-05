import json
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.services import multimodal_pipeline as pipeline
from app.services.artifact_provenance import capture_local_source
from app.services.callback_client import CallbackClient
from app.workers.processing_errors import RetryableProcessingError, NonRetryableProcessingError


def fixture_job(tmp_path, monkeypatch, statuses=("SUCCESS",), failure_code="OCR_INFERENCE_FAILED"):
    tmp_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting, job = str(uuid4()), str(uuid4())
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"verified video fixture")
    video_source = capture_local_source(tmp_path, video_path, meeting, job)
    run_id = "run_fixture"
    run_dir = tmp_path / "keyframes" / "versions" / run_id
    run_dir.mkdir(parents=True)
    slides = []
    keyframes = []
    for index, status in enumerate(statuses):
        image = run_dir / f"slide_{index + 1:04d}.jpg"
        image.write_bytes(f"image-fixture-{index}".encode())
        image_source = capture_local_source(tmp_path, image, meeting, job)
        slide_id = f"slide_{index + 1:04d}"
        occurrences = [index * 1000, index * 1000 + 500]
        slides.append({
            "slide_id": slide_id, "timestamp_ms": occurrences[0],
            "occurrences_ms": occurrences, "image_source": image_source.to_dict(),
            "status": status,
            "normalized_text": "Tiến độ dự án" if status == "SUCCESS" else "",
            "error": {"code": failure_code, "message": "RuntimeError"} if status == "FAILED" else None,
        })
        keyframes.append({"slide_id": slide_id, "timestamp_ms": occurrences[0],
                          "occurrences_ms": occurrences, "image_path": image.name})

    manifest = {"schema_version": "1.1", "source_video": video_path.name,
                "total_keyframes": len(keyframes), "keyframes": keyframes}
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    manifest_source = capture_local_source(tmp_path, manifest_path, meeting, job)
    successful = sum(item["status"] == "SUCCESS" for item in slides)
    no_text = sum(item["status"] == "NO_TEXT_DETECTED" for item in slides)
    failed = sum(item["status"] == "FAILED" for item in slides)
    ocr_status = ("NO_SLIDES_DETECTED" if not slides else "FAILED" if failed == len(slides) else
                  "PARTIAL_FAILURE" if failed else "SUCCESS" if successful else "NO_TEXT_DETECTED")
    data = {"schema_version": "1.0", "keyframe_run_id": run_id,
            "meeting_id": meeting, "job_id": job, "source_video": video_path.name,
            "source_video_reference": video_source.to_dict(),
            "total_slides": len(slides), "successful_slides": successful,
            "no_text_slides": no_text, "failed_slides": failed,
            "ocr_status": ocr_status, "slides": slides}
    artifact = tmp_path / "ocr.json"
    artifact.write_text(json.dumps(data))
    ocr_source = capture_local_source(tmp_path, artifact, meeting, job)
    monkeypatch.setattr(pipeline, "run_local_multimodal", Mock(return_value={
        "ocr_source": ocr_source, "keyframe_source": manifest_source,
    }))
    return dict(meeting_id=meeting, job_id=job, video_path=video_path,
                output_dir=tmp_path / "output", storage_client=Mock(), callback_client=Mock(),
                backend_base_url="http://backend/api/v1", internal_token="test-token",
                execution_id=str(uuid4()), checkpoint=Mock(), ocr_service=Mock())


def test_one_and_multiple_recognized_keyframes_publish_deterministic_metadata(tmp_path, monkeypatch):
    for count in (1, 2):
        args = fixture_job(tmp_path / str(count), monkeypatch, ("SUCCESS",) * count)
        events = Mock()
        events.attach_mock(args["storage_client"].upload_file, "upload")
        events.attach_mock(args["callback_client"].send_ocr_metadata, "callback")
        assert pipeline.publish_job_ocr(**args) == count * 2
        assert events.mock_calls[0][0] == "upload"
        first = [call.args[1] for call in args["callback_client"].send_ocr_metadata.call_args_list]
        assert all(item["ocrText"] == "Tiến độ dự án" for item in first)
        pipeline.publish_job_ocr(**args)
        second = [call.args[1] for call in args["callback_client"].send_ocr_metadata.call_args_list][count * 2:]
        assert first == second


def test_valid_empty_manifest_persists_empty_artifact_without_fake_callback(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, ())
    assert pipeline.publish_job_ocr(**args) == 0
    args["storage_client"].upload_file.assert_called_once()
    assert args["storage_client"].upload_file.call_args.args[1].endswith("ocr.postprocessed.json")
    uploaded_artifact = json.loads(Path(args["storage_client"].upload_file.call_args.args[0]).read_text())
    assert uploaded_artifact["ocr_status"] == "NO_SLIDES_DETECTED"
    assert uploaded_artifact["slides"] == []
    args["callback_client"].send_ocr_metadata.assert_not_called()


@pytest.mark.parametrize("statuses", [("NO_TEXT_DETECTED",), ("NO_TEXT_DETECTED", "NO_TEXT_DETECTED")])
def test_no_text_is_valid_and_preserves_slide_images_with_empty_text(tmp_path, monkeypatch, statuses):
    args = fixture_job(tmp_path, monkeypatch, statuses)
    assert pipeline.publish_job_ocr(**args) == len(statuses) * 2
    callbacks = [call.args[1] for call in args["callback_client"].send_ocr_metadata.call_args_list]
    assert callbacks and all(item["ocrText"] == "" for item in callbacks)


def test_failed_or_partially_failed_slide_fails_strictly_without_publication(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, ("SUCCESS", "FAILED"))
    with pytest.raises(RetryableProcessingError, match="OCR_INFERENCE_FAILED") as raised:
        pipeline.publish_job_ocr(**args)
    assert raised.value.error_code == "OCR_INFERENCE_FAILED"
    args["storage_client"].upload_file.assert_not_called()
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_corrupt_keyframe_is_permanent_failure_not_silently_skipped(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, ("FAILED",), failure_code="OCR_IMAGE_ERROR")
    with pytest.raises(NonRetryableProcessingError) as raised:
        pipeline.publish_job_ocr(**args)
    assert raised.value.error_code == "OCR_IMAGE_INVALID"
    args["storage_client"].upload_file.assert_not_called()
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_corrupt_manifest_is_not_converted_to_empty_result(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, ())
    root = tmp_path
    manifest_path = root / "keyframes" / "versions" / "run_fixture" / "manifest.json"
    manifest_path.write_text('{"schema_version":"1.1","total_keyframes":99,"keyframes":[]}')
    source = capture_local_source(root, manifest_path, args["meeting_id"], args["job_id"])
    local_result = pipeline.run_local_multimodal
    local_result.return_value["keyframe_source"] = source
    with pytest.raises(NonRetryableProcessingError) as raised:
        pipeline.publish_job_ocr(**args)
    assert raised.value.error_code == "OCR_PROVENANCE_INVALID"
    args["storage_client"].upload_file.assert_not_called()


def test_foreign_provenance_is_rejected(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    args["job_id"] = str(uuid4())
    with pytest.raises(NonRetryableProcessingError, match="different meeting/job"):
        pipeline.publish_job_ocr(**args)
    args["storage_client"].upload_file.assert_not_called()


def test_minio_upload_failure_prevents_callbacks(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    args["storage_client"].upload_file.side_effect = RetryableProcessingError("storage unavailable")
    with pytest.raises(RetryableProcessingError, match="storage unavailable"):
        pipeline.publish_job_ocr(**args)
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_spring_callback_failure_propagates_and_retry_uses_same_ids(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    args["callback_client"].send_ocr_metadata.side_effect = [RetryableProcessingError("callback unavailable"), None]
    with pytest.raises(RetryableProcessingError, match="callback unavailable"):
        pipeline.publish_job_ocr(**args)
    first_payload = args["callback_client"].send_ocr_metadata.call_args.args[1]
    args["callback_client"].send_ocr_metadata.side_effect = None
    pipeline.publish_job_ocr(**args)
    later_payloads = [call.args[1] for call in args["callback_client"].send_ocr_metadata.call_args_list]
    ids_by_timestamp = {}
    for payload in later_payloads:
        previous = ids_by_timestamp.setdefault(payload["timestampMs"], payload["slideId"])
        assert payload["slideId"] == previous
    assert ids_by_timestamp[first_payload["timestampMs"]] == first_payload["slideId"]


def test_lease_loss_after_upload_prevents_metadata(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    class Lost(Exception):
        pass
    args["checkpoint"].side_effect = [None, None, None, Lost()]
    with pytest.raises(Lost):
        pipeline.publish_job_ocr(**args)
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_callback_retries_transient_errors_and_forwards_auth(monkeypatch):
    post = Mock(side_effect=[Mock(status_code=503), Mock(status_code=201)])
    monkeypatch.setattr("app.services.callback_client.requests.post", post)
    monkeypatch.setattr("app.services.callback_client.time.sleep", lambda _: None)
    checkpoint = Mock()
    payload = {"meetingId": str(uuid4())}
    CallbackClient().send_ocr_metadata("http://backend/api/v1", payload,
        internal_token="test-token", execution_id="execution", checkpoint=checkpoint)
    assert post.call_count == 2
    assert checkpoint.call_count == 2
    assert post.call_args.kwargs["headers"] == {"X-Internal-Token": "test-token", "X-Execution-Id": "execution"}


@pytest.mark.parametrize("status", [401, 403, 409])
def test_callback_does_not_retry_rejected_write(monkeypatch, status):
    post = Mock(return_value=Mock(status_code=status))
    monkeypatch.setattr("app.services.callback_client.requests.post", post)
    with pytest.raises(NonRetryableProcessingError):
        CallbackClient().send_ocr_metadata("http://backend/api/v1", {"meetingId": str(uuid4())},
            internal_token="test-token", execution_id="execution", checkpoint=Mock())
    assert post.call_count == 1
