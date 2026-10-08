import subprocess
from types import SimpleNamespace
from unittest.mock import Mock, patch
import requests

from app.tasks import audio_job_task
from app.tasks.audio_job_task import process_audio_job
from app.workers import redis_job_worker
from app.workers.processing_errors import NonRetryableProcessingError, RetryableProcessingError
from app.services.audio_extractor import InvalidMediaError


def _configure_no_speech_worker(tmp_path, monkeypatch, callback, object_key="audio.wav"):
    class ResourceTrackerStub:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class MinioStub:
        def fget_object(self, bucket_name, object_name, file_path):
            open(file_path, "wb").close()

    class HeartbeatStub:
        def __init__(self, job_id):
            self.job_id = job_id

        def start(self):
            pass

        def checkpoint(self):
            return {"successfulStages": []}

        def _send(self):
            return {"currentStage": "FFMPEG", "status": "PROCESSING"}

        def stop(self):
            pass

    ffmpeg_calls = []
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "validate_safe_read_path", lambda path: path)
    monkeypatch.setattr(redis_job_worker, "validate_safe_write_path", lambda path: path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": object_key, "meetingId": "meeting-1", "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "minio_client", MinioStub())
    monkeypatch.setattr(redis_job_worker, "ResourceTracker", ResourceTrackerStub)
    monkeypatch.setattr(redis_job_worker, "WorkerHeartbeat", HeartbeatStub)
    monkeypatch.setattr(redis_job_worker, "require_stage_callback", callback)
    monkeypatch.setattr(redis_job_worker, "audio_extractor", SimpleNamespace(
        extract_and_normalize=lambda **kwargs: ffmpeg_calls.append(kwargs)
    ))
    monkeypatch.setattr(redis_job_worker, "pipeline_orchestrator", SimpleNamespace(
        process_pipeline=lambda request: SimpleNamespace(overall_status="SUCCESS", final_output_file="clean.wav")
    ))
    monkeypatch.setattr(redis_job_worker.speaker_labeling_service, "process_and_export", lambda **kwargs: (
        SimpleNamespace(status="NO_SPEECH_DETECTED", error_message=None), None
    ))
    return ffmpeg_calls


def test_task_retries_only_explicit_transient_failures():
    assert process_audio_job.autoretry_for == (RetryableProcessingError,)


def test_retryable_processing_error_still_requests_celery_retry(monkeypatch):
    retry_requests = []

    def fail_transiently(job_id):
        raise RetryableProcessingError("temporary network timeout")

    monkeypatch.setattr(audio_job_task, "_process_job", fail_transiently)
    monkeypatch.setattr(process_audio_job, "retry", lambda **kwargs: retry_requests.append(kwargs) or "retry-requested")

    result = process_audio_job.run("job-transient")

    assert result == "retry-requested"
    assert len(retry_requests) == 1
    assert isinstance(retry_requests[0]["exc"], RetryableProcessingError)


def test_no_speech_reports_terminal_failure_without_raising_or_retrying(tmp_path, monkeypatch):
    callbacks = []
    ffmpeg_calls = _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: callbacks.append((stage, status, kwargs)),
    )

    result = process_audio_job.run("job-no-speech")

    assert result["status"] == "FAILED"
    assert result["stage"] == "PYANNOTE"
    assert result["errorCode"] == "NO_SPEECH_DETECTED"
    failed_callbacks = [callback for callback in callbacks if callback[1] == "FAILED"]
    assert len(failed_callbacks) == 1
    assert failed_callbacks[0][0] == "PYANNOTE"
    assert failed_callbacks[0][2]["error_code"] == "NO_SPEECH_DETECTED"
    assert len(ffmpeg_calls) == 1


def test_no_speech_callback_failure_does_not_retry_celery_task(tmp_path, monkeypatch):
    failed_reports = []

    def callback(job_id, stage, status, **kwargs):
        if status == "FAILED":
            failed_reports.append((stage, kwargs))
            raise RetryableProcessingError("callback unavailable after HTTP retries")

    ffmpeg_calls = _configure_no_speech_worker(tmp_path, monkeypatch, callback)

    result = process_audio_job.run("job-no-speech-callback-down")

    assert result["errorCode"] == "NO_SPEECH_DETECTED"
    assert len(failed_reports) == 1
    assert len(ffmpeg_calls) == 1


def test_validation_error_callback_failure_does_not_retry_or_run_ffmpeg(tmp_path, monkeypatch):
    ffmpeg_calls = []
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "WorkerHeartbeat", type("HeartbeatStub", (), {
        "__init__": lambda self, job_id: None, "start": lambda self: None,
        "checkpoint": lambda self: {"successfulStages": []},
        "_send": lambda self: {"currentStage": "FFMPEG", "status": "PROCESSING"},
        "stop": lambda self: None,
    }))
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": None, "meetingId": "meeting-1", "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "audio_extractor", SimpleNamespace(
        extract_and_normalize=lambda **kwargs: ffmpeg_calls.append(kwargs)
    ))

    with patch("app.services.callback_client.requests.post", return_value=Mock(status_code=503, text="offline")) as post, \
         patch("app.services.callback_client.time.sleep"):
        result = process_audio_job.run("job-missing-object")

    assert result["status"] == "FAILED"
    assert result["errorCode"] == "VALIDATION_ERROR"
    assert post.call_count == 3
    assert ffmpeg_calls == []


def test_terminal_job_is_skipped_without_callback_or_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": None, "meetingId": "meeting-1", "status": "COMPLETED"
    })
    monkeypatch.setattr(redis_job_worker, "require_stage_callback", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("callback must not run")))

    result = process_audio_job.run("job-already-completed")

    assert result == {"status": "SKIPPED", "reason": "TERMINAL_JOB", "jobStatus": "COMPLETED"}


def test_pause_at_safe_point_preserves_workspace_and_does_not_enter_ffmpeg(tmp_path, monkeypatch):
    callbacks = []
    class PauseHeartbeat:
        def __init__(self, job_id): pass
        def start(self): pass
        def checkpoint(self): raise redis_job_worker._PauseAtBoundary()
        def _send(self): return {"currentStage": "FFMPEG", "status": "PAUSE_REQUESTED"}
        def stop(self): pass
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": "audio.wav", "meetingId": "meeting-1", "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "WorkerHeartbeat", PauseHeartbeat)
    monkeypatch.setattr(redis_job_worker, "require_stage_callback", lambda *args, **kwargs: callbacks.append(args))

    result = redis_job_worker.process_job("job-paused")

    assert result["status"] == "PAUSED"
    assert callbacks == [("job-paused", "FFMPEG", "PAUSED")]
    assert (tmp_path / "job-paused").is_dir()


def test_cancel_at_safe_point_reports_cancelled_and_cleans_workspace(tmp_path, monkeypatch):
    callbacks = []
    class CancelHeartbeat:
        def __init__(self, job_id): pass
        def start(self): pass
        def checkpoint(self): raise redis_job_worker._CancelAtBoundary()
        def _send(self): return {"currentStage": "FFMPEG", "status": "CANCEL_REQUESTED"}
        def stop(self): pass
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": "audio.wav", "meetingId": "meeting-1", "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "WorkerHeartbeat", CancelHeartbeat)
    monkeypatch.setattr(redis_job_worker, "require_stage_callback", lambda *args, **kwargs: callbacks.append(args))

    result = redis_job_worker.process_job("job-cancelled")

    assert result["status"] == "CANCELLED"
    assert callbacks == [("job-cancelled", "FFMPEG", "CANCELLED")]
    assert not (tmp_path / "job-cancelled").exists()


def test_mp4_is_accepted_and_reaches_the_next_audio_stage(tmp_path, monkeypatch):
    callbacks = []
    ffmpeg_calls = _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: callbacks.append((stage, status, kwargs)),
        object_key="recording.mp4",
    )

    result = process_audio_job.run("job-mp4-with-audio")

    assert result["errorCode"] == "NO_SPEECH_DETECTED"
    assert len(ffmpeg_calls) == 1
    assert ffmpeg_calls[0]["input_path"].endswith("raw_input.mp4")
    assert any(stage == "FFMPEG" and status == "SUCCESS" for stage, status, _ in callbacks)
    assert any(stage == "WEBRTC" and status == "PROCESSING" for stage, status, _ in callbacks)
    assert not any(kwargs.get("error_code") == "UNSUPPORTED_FORMAT" for _, _, kwargs in callbacks)


def test_no_audio_stream_fails_ffmpeg_terminally_without_downstream_stages(tmp_path, monkeypatch):
    callbacks = []
    ffmpeg_calls = _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: callbacks.append((stage, status, kwargs)),
        object_key="silent.mp4",
    )

    def no_audio(**kwargs):
        ffmpeg_calls.append(kwargs)
        raise InvalidMediaError("MP4 không chứa audio stream")

    monkeypatch.setattr(redis_job_worker.audio_extractor, "extract_and_normalize", no_audio)
    result = process_audio_job.run("job-silent-mp4")

    assert result["status"] == "FAILED"
    assert result["stage"] == "FFMPEG"
    assert result["errorCode"] == "INVALID_AUDIO"
    assert len(ffmpeg_calls) == 1
    assert [(stage, status) for stage, status, _ in callbacks if status in {"PROCESSING", "FAILED"}] == [
        ("FFMPEG", "PROCESSING"),
        ("FFMPEG", "FAILED"),
    ]


def test_corrupt_mp4_is_terminal_without_celery_retry(tmp_path, monkeypatch):
    callbacks = []
    ffmpeg_calls = _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: callbacks.append((stage, status, kwargs)),
        object_key="corrupt.mp4",
    )

    def reject_corrupt_media(**kwargs):
        ffmpeg_calls.append(kwargs)
        raise InvalidMediaError("MP4 không thể decode")

    monkeypatch.setattr(redis_job_worker.audio_extractor, "extract_and_normalize", reject_corrupt_media)
    result = process_audio_job.run("job-corrupt-mp4")

    assert result["status"] == "FAILED"
    assert result["stage"] == "FFMPEG"
    assert result["errorCode"] == "INVALID_AUDIO"
    assert len(ffmpeg_calls) == 1
    assert not any(stage == "WEBRTC" for stage, _, _ in callbacks)


def test_media_probe_timeout_keeps_celery_retry_policy(tmp_path, monkeypatch):
    callbacks = []
    _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: callbacks.append((stage, status, kwargs)),
        object_key="recording.mp4",
    )
    monkeypatch.setattr(
        redis_job_worker.audio_extractor,
        "extract_and_normalize",
        lambda **kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired("ffprobe", 30)),
    )
    retry_requests = []
    monkeypatch.setattr(
        process_audio_job,
        "retry",
        lambda **kwargs: retry_requests.append(kwargs) or "retry-requested",
    )

    result = process_audio_job.run("job-media-probe-timeout")

    assert result == "retry-requested"
    assert len(retry_requests) == 1
    assert isinstance(retry_requests[0]["exc"], RetryableProcessingError)


def test_missing_backend_job_is_classified_non_retryable(monkeypatch):
    class NotFoundResponse:
        status_code = 404

        def raise_for_status(self):
            raise requests.HTTPError("404 not found")

    monkeypatch.setattr(redis_job_worker.requests, "get", lambda *args, **kwargs: NotFoundResponse())

    try:
        redis_job_worker.fetch_job_details("missing-job")
        assert False, "missing Backend job must be terminal"
    except NonRetryableProcessingError as error:
        assert error.error_code == "JOB_NOT_FOUND"
