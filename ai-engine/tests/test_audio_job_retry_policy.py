import os
import subprocess
import sys
import threading
import wave
from types import SimpleNamespace
from unittest.mock import Mock, patch
import requests
from celery.exceptions import Retry

from app.tasks import audio_job_task
from app.tasks.audio_job_task import process_audio_job
from app.workers import redis_job_worker
from app.workers.processing_errors import NonRetryableProcessingError, RetryableProcessingError
from app.services.audio_extractor import InvalidMediaError


def _configure_no_speech_worker(tmp_path, monkeypatch, callback, object_key="audio.wav", execution_lost=False):
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

    heartbeat_instances = []

    class HeartbeatStub:
        def __init__(self, job_id, execution_id):
            self.job_id = job_id
            self.execution_id = execution_id
            self._execution_lost = threading.Event()
            heartbeat_instances.append(self)

        def start(self):
            pass

        def checkpoint(self):
            if self._execution_lost.is_set():
                raise redis_job_worker._ExecutionLost()
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

    clean_wav = tmp_path / "clean.wav"

    def process_pipeline(request):
        # The worker copies the WebRTC output and later opens it with wave;
        # provide a tiny valid mono PCM WAV instead of a path-only fixture.
        with wave.open(str(clean_wav), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\x00\x00" * 160)
        return SimpleNamespace(overall_status="SUCCESS", final_output_file=str(clean_wav))

    monkeypatch.setattr(redis_job_worker, "pipeline_orchestrator", SimpleNamespace(
        process_pipeline=process_pipeline
    ))
    def no_speech_result(**kwargs):
        if execution_lost:
            # Simulate lease revocation while the inference stage is running,
            # immediately before that stage reports its deterministic error.
            heartbeat_instances[-1]._execution_lost.set()
        return SimpleNamespace(status="NO_SPEECH_DETECTED", error_message=None), None

    monkeypatch.setattr(redis_job_worker, "speaker_labeling_service", SimpleNamespace(
        process_and_export=no_speech_result
    ))
    return ffmpeg_calls


def test_task_retries_only_explicit_transient_failures():
    assert process_audio_job.autoretry_for == (RetryableProcessingError,)


def test_importing_worker_does_not_load_gpu_inference_dependencies():
    import_smoke = (
        "import sys; from app.workers import redis_job_worker; "
        "assert 'app.services.speaker_labeling_service' not in sys.modules; "
        "assert 'app.services.diarization_runtime' not in sys.modules; "
        "assert 'torch' not in sys.modules; "
        "assert 'pyannote.audio' not in sys.modules"
    )
    result = subprocess.run(
        [sys.executable, "-c", import_smoke],
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_worker_stops_at_checkpoint_when_backend_denies_execution(monkeypatch):
    heartbeat = redis_job_worker.WorkerHeartbeat("job-lease-lost", "execution-old")
    sends = []

    def denied_control():
        sends.append(True)
        heartbeat._execution_lost.set()
        return {"executionAllowed": False, "status": "PROCESSING"}

    monkeypatch.setattr(heartbeat, "_send", denied_control)

    import pytest
    with pytest.raises(redis_job_worker._ExecutionLost):
        heartbeat.checkpoint()
    with pytest.raises(redis_job_worker._ExecutionLost):
        heartbeat.checkpoint()

    assert len(sends) == 1


def test_retryable_processing_error_still_requests_celery_retry(monkeypatch):
    retry_requests = []

    def fail_transiently(job_id):
        raise RetryableProcessingError("temporary network timeout")

    def retry_as_celery_does(**kwargs):
        retry_requests.append(kwargs)
        raise Retry(exc=kwargs.get("exc"))

    monkeypatch.setattr(audio_job_task, "_process_job", fail_transiently)
    monkeypatch.setattr(process_audio_job, "retry", retry_as_celery_does)

    import pytest
    with pytest.raises(Retry):
        process_audio_job.run("job-transient")

    assert len(retry_requests) == 1
    assert isinstance(retry_requests[0]["exc"], RetryableProcessingError)


def test_lost_execution_before_processing_exception_does_not_report_or_retry(tmp_path, monkeypatch):
    failed_callbacks = []
    retry_requests = []
    _configure_no_speech_worker(
        tmp_path,
        monkeypatch,
        lambda job_id, stage, status, **kwargs: failed_callbacks.append((stage, status)),
        execution_lost=True,
    )
    def retry_if_called(**kwargs):
        retry_requests.append(kwargs)
        raise Retry(exc=kwargs.get("exc"))

    monkeypatch.setattr(process_audio_job, "retry", retry_if_called)

    result = process_audio_job.run("job-execution-revoked-before-error")

    assert result == {"status": "SKIPPED", "reason": "EXECUTION_LEASE_LOST"}
    assert not any(status == "FAILED" for _, status in failed_callbacks)
    assert retry_requests == []


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
        "__init__": lambda self, job_id, execution_id: setattr(self, "_execution_lost", threading.Event()), "start": lambda self: None,
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
        def __init__(self, job_id, execution_id): pass
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
        def __init__(self, job_id, execution_id): pass
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


def test_duplicate_worker_without_execution_lease_skips_pipeline(tmp_path, monkeypatch):
    ffmpeg_calls = []

    class LeaseLostHeartbeat:
        def __init__(self, job_id, execution_id): pass
        def start(self): pass
        def checkpoint(self): raise redis_job_worker._ExecutionLost()
        def stop(self): pass

    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {
        "objectKey": "audio.wav", "meetingId": "meeting-1", "status": "PROCESSING"
    })
    monkeypatch.setattr(redis_job_worker, "WorkerHeartbeat", LeaseLostHeartbeat)
    monkeypatch.setattr(redis_job_worker, "audio_extractor", SimpleNamespace(
        extract_and_normalize=lambda **kwargs: ffmpeg_calls.append(kwargs)
    ))

    result = redis_job_worker.process_job("job-owned-by-another-worker")

    assert result == {"status": "SKIPPED", "reason": "EXECUTION_LEASE_LOST"}
    assert ffmpeg_calls == []


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
    def retry_as_celery_does(**kwargs):
        retry_requests.append(kwargs)
        raise Retry(exc=kwargs.get("exc"))

    monkeypatch.setattr(
        process_audio_job,
        "retry",
        retry_as_celery_does,
    )

    import pytest
    with pytest.raises(Retry):
        process_audio_job.run("job-media-probe-timeout")

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
