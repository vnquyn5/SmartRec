from pathlib import Path
import os
import subprocess
import sys
import threading
import wave
from types import SimpleNamespace
from unittest.mock import Mock, patch
import requests
import pytest
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

    class StorageClientStub:
        def download_file(self, object_key, destination_path, *, allowed_root=None):
            assert allowed_root is not None, "Worker must provide allowed_root"

            root = Path(allowed_root).resolve()
            destination = Path(destination_path).resolve()

            assert root.is_dir(), "Workspace must exist"
            assert destination != root and root in destination.parents, (
                "Download destination must be inside workspace"
            )

            with open(destination_path, "wb"):
                pass

            return destination_path

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
    monkeypatch.setattr(redis_job_worker, "storage_client", StorageClientStub())
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


def test_retry_preserves_completed_stage_artifact_and_resume_skips_ffmpeg(tmp_path, monkeypatch):
    successful = []
    fail_once = [True]

    def callback(job_id, stage, status, **kwargs):
        if stage == "WEBRTC" and status == "PROCESSING" and fail_once[0]:
            fail_once[0] = False
            raise RetryableProcessingError("temporary callback outage")
        if status == "SUCCESS":
            successful.append(stage)

    calls = _configure_no_speech_worker(tmp_path, monkeypatch, callback)
    monkeypatch.setattr(redis_job_worker.WorkerHeartbeat, "checkpoint",
                        lambda self: {"successfulStages": list(successful)})
    monkeypatch.setattr(redis_job_worker, "_get_audio_chunker", lambda: SimpleNamespace(
        process_audio=lambda **kwargs: {"is_chunked": False}))

    def extract(**kwargs):
        calls.append(kwargs)
        Path(kwargs["output_path"]).write_bytes(b"mock normalized audio")

    monkeypatch.setattr(redis_job_worker.audio_extractor, "extract_and_normalize", extract)
    with pytest.raises(RetryableProcessingError):
        redis_job_worker.process_job("job-resume")
    assert (tmp_path / "job-resume" / "01_normalized_16k.wav").is_file()

    result = redis_job_worker.process_job("job-resume")
    assert result["errorCode"] == "NO_SPEECH_DETECTED"
    assert len(calls) == 1
    assert not (tmp_path / "job-resume").exists()


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED", "FAILED", "DLQ", "PAUSED"])
def test_skipped_delivery_does_not_delete_existing_workspace(tmp_path, monkeypatch, status):
    workspace = tmp_path / "existing-job"
    workspace.mkdir()
    artifact = workspace / "01_normalized_16k.wav"
    artifact.write_bytes(b"owned by previous execution")
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda job_id: {"status": status})
    result = redis_job_worker.process_job("existing-job")
    assert result["status"] == "SKIPPED"
    assert artifact.read_bytes() == b"owned by previous execution"


def test_job_lookup_failure_preserves_workspace_before_lease_claim(tmp_path, monkeypatch):
    workspace = tmp_path / "lookup-retry"
    workspace.mkdir()
    artifact = workspace / "02_cleaned.wav"
    artifact.write_bytes(b"resume artifact")
    monkeypatch.setattr(redis_job_worker, "get_workspace_root", lambda: tmp_path)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details",
                        lambda job_id: (_ for _ in ()).throw(requests.Timeout()))
    monkeypatch.setattr(redis_job_worker, "require_stage_callback", lambda *args, **kwargs: None)
    with pytest.raises(RetryableProcessingError):
        redis_job_worker.process_job("lookup-retry")
    assert artifact.read_bytes() == b"resume artifact"


def test_worker_delivers_stt_then_router_result_before_output_success(tmp_path, monkeypatch):
    import app.services.stt_job_integration as stt
    import app.services.multimodal_pipeline as multimodal
    events = []
    _configure_no_speech_worker(tmp_path, monkeypatch,
        lambda job, stage, status, **kw: events.append((stage, status, kw)))
    job_id = "11111111-1111-4111-8111-111111111111"
    meeting_id = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda _: {
        "objectKey": "audio.wav", "meetingId": meeting_id, "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "_get_audio_chunker", lambda: SimpleNamespace(
        process_audio=lambda **kw: {"is_chunked": False}))
    payload = SimpleNamespace(status="SUCCESS", model_dump=lambda: {
        "timeline": [{"speaker_label": "SPEAKER_00", "start": 0, "end": 0.005}]})
    monkeypatch.setattr(redis_job_worker, "speaker_labeling_service", SimpleNamespace(
        process_and_export=lambda **kw: (payload, None)))
    invocation = Mock(return_value={"segments": []})
    monkeypatch.setattr(stt, "run_stt_for_job", invocation)
    ocr = Mock()
    monkeypatch.setattr(multimodal, "publish_job_ocr", ocr)
    ai_result = {
        "jobId": job_id,
        "meetingId": meeting_id,
        "taskType": "MEETING_ANALYSIS",
        "status": "SUCCESS",
        "result": {"executiveSummary": "Validated summary", "actionItems": []},
    }
    router_request = Mock(return_value=ai_result)
    monkeypatch.setattr(redis_job_worker.callback_client, "request_ai_result", router_request)
    result = redis_job_worker.process_job(job_id)
    invocation.assert_called_once()
    ocr.assert_not_called()
    args = invocation.call_args.kwargs
    assert args["execution_id"]
    assert callable(args["checkpoint"])
    assert args["formatted_segments"][0]["speakerLabel"] == "SPEAKER_00"
    router_request.assert_called_once()
    assert router_request.call_args.args[1] == job_id
    assert router_request.call_args.args[3] == args["execution_id"]
    assert router_request.call_args.kwargs["timeout_sec"] == 900
    output_success = [
        event for event in events
        if event[0] == "OUTPUT" and event[1] == "SUCCESS"
    ]
    assert len(output_success) == 1
    assert output_success[0][2]["ai_result"] == ai_result
    assert result is None


def test_worker_rejects_ai_result_for_another_job_before_output_success():
    with pytest.raises(NonRetryableProcessingError, match="valid result"):
        redis_job_worker._validate_ai_result_response(
            {
                "jobId": "11111111-1111-4111-8111-111111111111",
                "meetingId": "22222222-2222-4222-8222-222222222222",
                "status": "SUCCESS",
                "result": {},
            },
            "33333333-3333-4333-8333-333333333333",
            "22222222-2222-4222-8222-222222222222",
        )


def test_output_success_callback_forwards_ai_result(monkeypatch):
    send_callback = Mock(return_value=True)
    monkeypatch.setattr(redis_job_worker.callback_client, "send_callback", send_callback)
    ai_result = {
        "jobId": "11111111-1111-4111-8111-111111111111",
        "meetingId": "22222222-2222-4222-8222-222222222222",
        "taskType": "MEETING_ANALYSIS",
        "status": "SUCCESS",
        "result": {
            "executiveSummary": "Validated summary",
            "actionItems": [],
        },
    }

    redis_job_worker.require_stage_callback(
        "job-ai",
        "OUTPUT",
        "SUCCESS",
        execution_id="execution-ai",
        ai_result=ai_result,
    )

    _, payload = send_callback.call_args.args
    assert payload["aiResult"] == ai_result
    assert send_callback.call_args.kwargs["execution_id"] == "execution-ai"


def test_core_output_success_callback_allows_missing_ai_result(monkeypatch):
    send_callback = Mock(return_value=True)
    monkeypatch.setattr(redis_job_worker.callback_client, "send_callback", send_callback)

    assert redis_job_worker.send_stage_callback("job-ai", "OUTPUT", "SUCCESS")

    send_callback.assert_called_once()
    assert "aiResult" not in send_callback.call_args.args[1]


def test_worker_skips_ai_router_when_llm_feature_flag_is_disabled(tmp_path, monkeypatch):
    import app.services.stt_job_integration as stt
    events = []
    _configure_no_speech_worker(
        tmp_path, monkeypatch,
        lambda job, stage, status, **kw: events.append((stage, status, kw)),
    )
    job_id = "11111111-1111-4111-8111-111111111111"
    meeting_id = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(redis_job_worker.settings, "smartrec_llm_enabled", False)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda _: {
        "objectKey": "audio.wav", "meetingId": meeting_id, "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "_get_audio_chunker", lambda: SimpleNamespace(
        process_audio=lambda **kw: {"is_chunked": False}))
    diarization = SimpleNamespace(status="SUCCESS", model_dump=lambda: {
        "timeline": [{"speaker_label": "SPEAKER_00", "start": 0, "end": 0.005}]})
    monkeypatch.setattr(redis_job_worker, "speaker_labeling_service", SimpleNamespace(
        process_and_export=lambda **kw: (diarization, None)))
    monkeypatch.setattr(stt, "run_stt_for_job", lambda **kw: {"segments": []})
    router = Mock(side_effect=AssertionError("LLM router must be bypassed"))
    monkeypatch.setattr(redis_job_worker.callback_client, "request_ai_result", router)

    redis_job_worker.process_job(job_id)

    router.assert_not_called()
    output_success = [e for e in events if e[0] == "OUTPUT" and e[1] == "SUCCESS"]
    assert len(output_success) == 1
    assert output_success[0][2]["ai_result"] is None


def test_llm_router_failure_preserves_core_output_success(tmp_path, monkeypatch):
    import app.services.stt_job_integration as stt
    events = []
    _configure_no_speech_worker(
        tmp_path, monkeypatch,
        lambda job, stage, status, **kw: events.append((stage, status, kw)),
    )
    job_id = "11111111-1111-4111-8111-111111111111"
    meeting_id = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(redis_job_worker.settings, "smartrec_llm_enabled", True)
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda _: {
        "objectKey": "audio.wav", "meetingId": meeting_id, "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "_get_audio_chunker", lambda: SimpleNamespace(
        process_audio=lambda **kw: {"is_chunked": False}))
    diarization = SimpleNamespace(status="SUCCESS", model_dump=lambda: {
        "timeline": [{"speaker_label": "SPEAKER_00", "start": 0, "end": 0.005}]})
    monkeypatch.setattr(redis_job_worker, "speaker_labeling_service", SimpleNamespace(
        process_and_export=lambda **kw: (diarization, None)))
    monkeypatch.setattr(stt, "run_stt_for_job", lambda **kw: {"segments": []})
    from app.services.callback_client import AIInferenceRequestError
    router = Mock(side_effect=AIInferenceRequestError("LOCAL_MODEL_TIMEOUT", True))
    monkeypatch.setattr(redis_job_worker.callback_client, "request_ai_result", router)

    redis_job_worker.process_job(job_id)

    router.assert_called_once()
    output_success = [e for e in events if e[0] == "OUTPUT" and e[1] == "SUCCESS"]
    assert len(output_success) == 1
    assert output_success[0][2]["ai_result"] is None


def test_output_callback_delivery_failure_does_not_report_success(monkeypatch):
    send_callback = Mock(return_value=False)
    monkeypatch.setattr(redis_job_worker.callback_client, "send_callback", send_callback)
    ai_result = {
        "jobId": "11111111-1111-4111-8111-111111111111",
        "meetingId": "22222222-2222-4222-8222-222222222222",
        "status": "SUCCESS",
        "result": {"executiveSummary": "Validated summary", "actionItems": []},
    }

    with pytest.raises(RetryableProcessingError):
        redis_job_worker.require_stage_callback(
            "job-ai",
            "OUTPUT",
            "SUCCESS",
            execution_id="execution-ai",
            ai_result=ai_result,
        )

    assert send_callback.call_count == 1


@pytest.mark.parametrize("ocr_failure", [False, True])
def test_video_ocr_precedes_inference_and_failure_preserves_transcript(tmp_path, monkeypatch, ocr_failure):
    import app.services.stt_job_integration as stt
    import app.services.multimodal_pipeline as multimodal
    events = []
    _configure_no_speech_worker(tmp_path, monkeypatch,
        lambda job, stage, status, **kw: events.append((stage, status)))
    job_id = "11111111-1111-4111-8111-111111111111"
    meeting_id = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(redis_job_worker, "fetch_job_details", lambda _: {
        "objectKey": "video.mp4", "meetingId": meeting_id, "status": "QUEUED"
    })
    monkeypatch.setattr(redis_job_worker, "_get_audio_chunker", lambda: SimpleNamespace(
        process_audio=lambda **kw: {"is_chunked": False}))
    payload = SimpleNamespace(status="SUCCESS", model_dump=lambda: {
        "timeline": [{"speaker_label": "SPEAKER_00", "start": 0, "end": 0.005}]})
    monkeypatch.setattr(redis_job_worker, "speaker_labeling_service", SimpleNamespace(
        process_and_export=lambda **kw: (payload, None)))
    order = []
    monkeypatch.setattr(stt, "run_stt_for_job", lambda **kw: order.append("STT_PERSISTED"))
    def ocr(**kwargs):
        assert kwargs["meeting_id"] == meeting_id and kwargs["job_id"] == job_id
        assert kwargs["execution_id"]
        order.append("OCR")
        if ocr_failure:
            raise RetryableProcessingError("OCR_INCOMPLETE")
        return 0  # A verified empty keyframe scan is valid Core output.
    monkeypatch.setattr(multimodal, "publish_job_ocr", ocr)
    def infer(*args, **kwargs):
        order.append("LLM")
        return {"jobId": job_id, "meetingId": meeting_id, "status": "SUCCESS", "result": {}}
    monkeypatch.setattr(redis_job_worker.callback_client, "request_ai_result", infer)
    if ocr_failure:
        with pytest.raises(RetryableProcessingError):
            redis_job_worker.process_job(job_id)
        assert order == ["STT_PERSISTED", "OCR"]
        assert ("OUTPUT", "SUCCESS") not in events
        assert (tmp_path / job_id).is_dir()
    else:
        redis_job_worker.process_job(job_id)
        assert order == ["STT_PERSISTED", "OCR", "LLM"]
        assert ("OUTPUT", "SUCCESS") in events
