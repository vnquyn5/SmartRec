from app.celery_app import celery_app
from app.tasks import audio_job_task


def test_audio_job_task_is_registered_and_delegates_to_processor(monkeypatch):
    calls = []
    monkeypatch.setattr(audio_job_task, "_process_job", calls.append)

    assert "smartrec.process_audio_job" in celery_app.tasks
    audio_job_task.process_audio_job.run("job-123")

    assert calls == ["job-123"]


def test_lost_worker_child_is_acked_instead_of_redelivered():
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_acks_on_failure_or_timeout is True
    assert celery_app.conf.task_reject_on_worker_lost is False
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_workspace_accepts_audio_and_json_outputs(tmp_path, monkeypatch):
    from app.core.path_security import get_workspace_root, validate_safe_write_path

    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    workspace = get_workspace_root() / "job-123"
    workspace.mkdir()
    audio_output = workspace / "normalized.wav"
    diarization_output = workspace / "diarization.json"

    assert validate_safe_write_path(audio_output) == audio_output.resolve()
    assert validate_safe_write_path(diarization_output) == diarization_output.resolve()
