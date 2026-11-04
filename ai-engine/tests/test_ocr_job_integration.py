from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4
import json
import pytest

from app.services import multimodal_pipeline as pipeline
from app.services.artifact_provenance import capture_local_source
from app.services.callback_client import CallbackClient
from app.workers.processing_errors import RetryableProcessingError, NonRetryableProcessingError


def fixture_job(tmp_path, monkeypatch, status="SUCCESS"):
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting, job = str(uuid4()), str(uuid4())
    image = tmp_path / "slide.jpg"
    image.write_bytes(b"image-fixture")
    image_source = capture_local_source(tmp_path, image, meeting, job)
    data = {"slides": [{"image_source": image_source.to_dict(), "status": status,
                        "normalized_text": "Tiến độ dự án", "occurrences_ms": [0, 1000]}]}
    artifact = tmp_path / "ocr.json"
    artifact.write_text(json.dumps(data))
    source = capture_local_source(tmp_path, artifact, meeting, job)
    monkeypatch.setattr(pipeline, "run_local_multimodal", Mock(return_value={"ocr_source": source}))
    return dict(meeting_id=meeting, job_id=job, video_path=tmp_path / "video.mp4",
                output_dir=tmp_path / "output", storage_client=Mock(), callback_client=Mock(),
                backend_base_url="http://backend/api/v1", internal_token="test-token",
                execution_id=str(uuid4()), checkpoint=Mock(), ocr_service=Mock())


def test_retry_uses_same_job_scoped_ids_and_upload_before_callback(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    events = Mock()
    events.attach_mock(args["storage_client"].upload_file, "upload")
    events.attach_mock(args["callback_client"].send_ocr_metadata, "callback")
    assert pipeline.publish_job_ocr(**args) == 2
    first = [c.args[1] for c in args["callback_client"].send_ocr_metadata.call_args_list]
    assert events.mock_calls[0][0] == "upload"
    assert [c[0] for c in events.mock_calls] == ["upload", "upload", "callback", "upload", "callback"]
    pipeline.publish_job_ocr(**args)
    second = [c.args[1] for c in args["callback_client"].send_ocr_metadata.call_args_list][2:]
    assert first == second
    assert first[0]["slideId"] != first[1]["slideId"]
    assert all(f"meetings/{args['meeting_id']}/jobs/{args['job_id']}/ocr/" in p["objectKey"] for p in first)


def test_failed_ocr_does_not_publish_or_silently_fallback(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, "FAILED")
    with pytest.raises(RetryableProcessingError, match="OCR_INCOMPLETE"):
        pipeline.publish_job_ocr(**args)
    args["storage_client"].upload_file.assert_not_called()
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_no_slides_is_published_as_valid_result_and_does_not_call_slide_callback(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    artifact = tmp_path / "ocr-no-slides.json"
    artifact.write_text(json.dumps({
        "schema_version": "1.0",
        "keyframe_run_id": "run_empty",
        "result_status": "NO_SLIDES_DETECTED",
        "total_slides": 0,
        "successful_slides": 0,
        "failed_slides": 0,
        "slides": [],
        "meeting_id": args["meeting_id"],
        "job_id": args["job_id"],
        "source_video_reference": {"kind": "LOCAL"},
    }))
    source = capture_local_source(tmp_path, artifact, args["meeting_id"], args["job_id"])
    monkeypatch.setattr(pipeline, "run_local_multimodal", Mock(return_value={"ocr_source": source}))

    assert pipeline.publish_job_ocr(**args) == 0
    uploaded_path = args["storage_client"].upload_file.call_args.args[0]
    assert json.loads(Path(uploaded_path).read_text())["result_status"] == "NO_SLIDES_DETECTED"
    assert pipeline.publish_job_ocr(**args) == 0
    assert args["storage_client"].upload_file.call_count == 2
    calls = args["storage_client"].upload_file.call_args_list
    assert calls[0].args[1] == calls[1].args[1]
    assert args["callback_client"].send_ocr_metadata.call_count == 0


def test_failed_slide_preserves_specific_ocr_error_code(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch, "FAILED")
    payload = json.loads((tmp_path / "ocr.json").read_text())
    payload["slides"][0]["error"] = {"code": "OCR_INFERENCE_FAILED"}
    (tmp_path / "ocr.json").write_text(json.dumps(payload))
    source = capture_local_source(tmp_path, tmp_path / "ocr.json", args["meeting_id"], args["job_id"])
    monkeypatch.setattr(pipeline, "run_local_multimodal", Mock(return_value={"ocr_source": source}))

    with pytest.raises(RetryableProcessingError, match="OCR_INFERENCE_FAILED"):
        pipeline.publish_job_ocr(**args)
    args["storage_client"].upload_file.assert_not_called()


def test_lease_loss_after_upload_prevents_metadata(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    class Lost(Exception): pass
    args["checkpoint"].side_effect = [None, None, None, Lost()]
    with pytest.raises(Lost):
        pipeline.publish_job_ocr(**args)
    args["callback_client"].send_ocr_metadata.assert_not_called()


def test_foreign_provenance_rejected(tmp_path, monkeypatch):
    args = fixture_job(tmp_path, monkeypatch)
    args["job_id"] = str(uuid4())
    with pytest.raises(ValueError, match="different meeting/job"):
        pipeline.publish_job_ocr(**args)
    args["storage_client"].upload_file.assert_not_called()


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
