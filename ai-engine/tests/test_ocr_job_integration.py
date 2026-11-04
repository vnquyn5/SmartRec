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
